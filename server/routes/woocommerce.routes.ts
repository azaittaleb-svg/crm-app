import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { WooCommerceService } from '../services/woocommerce.service';
import { logger } from '../utils/logger';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const woocommerceService = new WooCommerceService();

const TRACKING_MAP_FILE = path.join(process.cwd(), 'data', 'tracking_numbers.json');
const TRACKING_RESULTS_FILE = path.join(process.cwd(), 'data', 'tracking_results.json');
const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

interface TrackingCacheRecord {
  code: string;
  summary: any;
  results: any[];
  currentStep: number;
  isFinished: boolean;
  lastUpdated: string;
  updatedAtMs: number;
}

function getSavedTrackingMap(): Record<string, string> {
  try {
    if (fs.existsSync(TRACKING_MAP_FILE)) {
      const data = fs.readFileSync(TRACKING_MAP_FILE, 'utf-8');
      return JSON.parse(data) || {};
    }
  } catch (e) {
    logger.error('Error reading tracking map file:', e);
  }
  return {};
}

function saveTrackingMap(map: Record<string, string>) {
  try {
    const dir = path.dirname(TRACKING_MAP_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(TRACKING_MAP_FILE, JSON.stringify(map, null, 2), 'utf-8');
  } catch (e) {
    logger.error('Error saving tracking map file:', e);
  }
}

function getSavedTrackingResults(): Record<string, TrackingCacheRecord> {
  try {
    if (fs.existsSync(TRACKING_RESULTS_FILE)) {
      const data = fs.readFileSync(TRACKING_RESULTS_FILE, 'utf-8');
      return JSON.parse(data) || {};
    }
  } catch (e) {
    logger.error('Error reading tracking results file:', e);
  }
  return {};
}

function saveTrackingResultRecord(code: string, entry: TrackingCacheRecord) {
  try {
    const dir = path.dirname(TRACKING_RESULTS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const current = getSavedTrackingResults();
    current[code] = entry;
    fs.writeFileSync(TRACKING_RESULTS_FILE, JSON.stringify(current, null, 2), 'utf-8');
  } catch (e) {
    logger.error('Error saving tracking results file:', e);
  }
}

// In-memory cache synced with persistent file
const trackingCache: Record<string, TrackingCacheRecord> = (() => {
  try {
    return getSavedTrackingResults();
  } catch {
    return {};
  }
})();

function extractSummary(fullText: string) {
  const summary = {
    poids: '-',
    produit: '-',
    crbt: 'Sans',
    depart: '-',
    arrivee: '-',
  };

  const poidsMatch =
    fullText.match(/(?:Poid[s]?\s*(?:du\s*colis)?[\s:]*)([\d\.,]+\s*Kg)/i) ||
    fullText.match(/([\d\.,]+\s*Kg)/i);
  if (poidsMatch) summary.poids = poidsMatch[1].trim();

  const produitMatch = fullText.match(/Produit[\s:]*([A-Za-z0-9_\-]+)/i);
  if (produitMatch) summary.produit = produitMatch[1].trim();

  const crbtMatch = fullText.match(/Montant\s*CRBT[\s:]*([A-Za-z0-9\.,\s]+)/i);
  if (crbtMatch) {
    const val = crbtMatch[1].trim().split('\n')[0];
    summary.crbt = val.substring(0, 20);
  }

  const departMatch = fullText.match(/(?:POSITION\s*DE\s*DÉPART|DÉPART)[\s:]*([A-Za-z0-9\s\-\_]+)/i);
  if (departMatch) {
    const val = departMatch[1].trim().split('\n')[0];
    summary.depart = val.replace(/POSITION/g, '').replace(/DÉPART/g, '').trim().substring(0, 30);
  }

  const arriveeMatch = fullText.match(/(?:POSITION\s*D[\'’]ARRIVÉE|ARRIVÉE)[\s:]*([A-Za-z0-9\s\-\_]+)/i);
  if (arriveeMatch) {
    const val = arriveeMatch[1].trim().split('\n')[0];
    summary.arrivee = val.replace(/POSITION/g, '').replace(/ARRIVÉE/g, '').trim().substring(0, 30);
  }

  return summary;
}

function analyzeTrackingEvents(results: any[]) {
  if (!results || results.length === 0) {
    return {
      currentStep: 1,
      isFinished: false,
      isDelivered: false,
      isAgencyPickup: false,
      isOutForDelivery: false,
      isTransit: false,
      isDepot: true,
      statusLabel: 'Pris en charge (Dépôt)',
      statusTag: '📦 Pris en charge',
    };
  }

  // In Barid tracking, the newest event is at index 0
  const latest = results[0];
  const latestText = `${latest.details || latest.libelleEvenement || ''} ${latest.localisation || latest.evenementLocalisation || ''}`.toLowerCase().trim();

  // 1. Truly Delivered (Final step 4)
  // Must match explicit delivery completion words AND NOT match in-progress agency pickup or delivery driver tournée words
  const isDelivered =
    /(envoi\s+livr[eé]|colis\s+livr[eé]|remis\s+au\s+(destinataire|client|guichet)|distribution\s+effectu[eé]e|livraison\s+effectu[eé]e|livr[eé]\s+au\s+guichet|\blivr[eé]\b)/i.test(latestText) &&
    !/(sorti\s+par\s+le\s+livreur|sorti\s+pour|livreur|en\s+cours|instance|r[eé]cup[eé]rer|agence\s+messagerie)/i.test(latestText);

  // 2. A récupérer en agence / En instance au guichet (Step 3 - En agence)
  const isAgencyPickup =
    !isDelivered &&
    /(à\s*r[eé]cup[eé]rer|a\s*recuperer|en\s+instance|mise\s+en\s+instance|avis[eé]|disponible\s+en\s+agence|au\s+guichet|agence\s+messagerie|agence\s+de\s+destination)/i.test(latestText);

  // 3. Sorti par le livreur / Distribution en cours (Step 3 - Tournée)
  const isOutForDelivery =
    !isDelivered &&
    !isAgencyPickup &&
    /(sorti\s+par\s+le\s+livreur|sorti\s+pour\s+distribution|en\s+cours\s+de\s+distribution|en\s+cours\s+de\s+livraison|tourn[eé]e|avec\s+le\s+livreur|distribution)/i.test(latestText);

  // 4. En cours d'acheminement / Transit (Step 2 - Transit)
  const isTransit =
    !isDelivered &&
    !isAgencyPickup &&
    !isOutForDelivery &&
    (/(acheminement|sorti\s+[aà]\s+destination|centre\s+national|centre\s+messagerie|hub|tri|ctd|transit|transfert)/i.test(latestText) || results.length > 1);

  let currentStep = 1;
  let statusLabel = 'Pris en charge (Dépôt)';
  let statusTag = '📦 Pris en charge';

  if (isDelivered) {
    currentStep = 4;
    statusLabel = 'Colis Livré (Terminé)';
    statusTag = '✓ Colis Livré (Terminé)';
  } else if (isAgencyPickup) {
    currentStep = 3;
    statusLabel = 'À récupérer en agence';
    statusTag = '📍 À récupérer en agence';
  } else if (isOutForDelivery) {
    currentStep = 3;
    statusLabel = 'En cours de distribution (Livreur)';
    statusTag = '🚚 En cours de distribution';
  } else if (isTransit) {
    currentStep = 2;
    statusLabel = "En cours d'acheminement";
    statusTag = "🚚 En cours d'acheminement";
  }

  return {
    currentStep,
    isFinished: isDelivered,
    isDelivered,
    isAgencyPickup,
    isOutForDelivery,
    isTransit,
    isDepot: !isDelivered && !isAgencyPickup && !isOutForDelivery && !isTransit,
    statusLabel,
    statusTag,
  };
}

function calculateStep(results: any[]) {
  return analyzeTrackingEvents(results).currentStep;
}

function parseBaridHtml(htmlText: string) {
  const $ = cheerio.load(htmlText);
  const fullText = $('body').text().replace(/\s+/g, ' ');

  const summary = extractSummary(fullText);
  const tracking_info: any[] = [];
  let current_date = '';

  $('tr').each((_, row) => {
    const cols: string[] = [];
    $(row)
      .find('td, th')
      .each((_, cell) => {
        const text = $(cell).text().trim();
        if (text) cols.push(text);
      });

    if (cols.length === 0) return;

    const row_str = cols.join(' ').toLowerCase();

    // Skip Headers
    if (['num. de suivi', "date d'expédition", 'poid du colis', 'détails', 'localisation'].some((h) => row_str.includes(h))) {
      if (!cols.some((c) => /\d{2}:\d{2}/.test(c))) {
        return;
      }
    }

    // Detect Date Row (ex: 18/04/2026)
    const date_match = row_str.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (cols.length === 1 && date_match) {
      current_date = date_match[1];
      return;
    }

    // Detect Timestamp Row
    let time_col: string | null = null;
    for (const col of cols) {
      if (/^\d{2}:\d{2}(:\d{2})?$/.test(col)) {
        time_col = col;
        break;
      }
    }

    if (time_col) {
      const cols_remaining = cols.filter((c) => c !== time_col && !/^\d{2}\/\d{2}\/\d{4}$/.test(c));
      const row_date = date_match ? date_match[1] : current_date;

      const local = cols_remaining.length > 0 ? cols_remaining[0] : '-';
      const det = cols_remaining.length > 1 ? cols_remaining[1] : local;

      tracking_info.push({
        date: row_date || '-',
        heure: time_col,
        localisation: local,
        details: det,
      });
    }
  });

  // Fallback Text Parsing
  if (tracking_info.length === 0) {
    const rawLines = $('body').text().split('\n').map((l) => l.trim()).filter(Boolean);
    let c_date = '';
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(line)) {
        c_date = line;
      } else if (/^\d{2}:\d{2}(:\d{2})?$/.test(line)) {
        const time_val = line;
        const loc_val = i + 1 < rawLines.length ? rawLines[i + 1] : '-';
        const det_val = i + 2 < rawLines.length ? rawLines[i + 2] : loc_val;

        if (!['poid', 'num', 'suivi', 'date'].some((k) => loc_val.toLowerCase().includes(k))) {
          tracking_info.push({
            date: c_date || '-',
            heure: time_val,
            localisation: loc_val,
            details: det_val,
          });
        }
      }
    }
  }

  const currentStep = calculateStep(tracking_info);

  return {
    summary,
    results: tracking_info,
    currentStep,
  };
}

router.get('/woocommerce/orders', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const orders = await woocommerceService.getOrders(forceRefresh);
    const trackingMap = getSavedTrackingMap();

    const enrichedOrders = (orders || []).map((ord: any) => {
      const savedCode = trackingMap[ord.id] || trackingMap[String(ord.id)];
      if (savedCode) {
        return {
          ...ord,
          tracking_number: savedCode,
        };
      }
      return ord;
    });

    res.json(enrichedOrders);
  } catch (error: any) {
    logger.error('Error in /woocommerce/orders route:', error);
    res.status(200).json([]);
  }
});

router.get('/tracking/map', (req, res) => {
  const map = getSavedTrackingMap();
  res.json(map || {});
});

router.post('/tracking/map', (req, res) => {
  try {
    const { orderId, code } = req.body || {};
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    const cleanCode = (code || '').toString().trim().toUpperCase();
    const currentMap = getSavedTrackingMap();
    if (cleanCode) {
      currentMap[String(orderId)] = cleanCode;
    } else {
      delete currentMap[String(orderId)];
    }
    saveTrackingMap(currentMap);
    res.json({ success: true, orderId, code: cleanCode, map: currentMap });
  } catch (err: any) {
    logger.error('Error in /tracking/map POST route:', err);
    res.status(500).json({ error: err.message || 'Failed to save tracking number' });
  }
});

router.post('/woocommerce/products/stock', async (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }
    const stockMap = await woocommerceService.getProductStockList(items);
    res.json(stockMap);
  } catch (error: any) {
    logger.error('Error in /woocommerce/products/stock route:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch stock' });
  }
});

/**
 * Webhook to push tracking data directly from Python Flask script or N8N/Make
 */
const handleTrackingWebhook = (req: any, res: any) => {
  try {
    const { code, tracking_code, summary, results, currentStep } = req.body;
    const cleanCode = (code || tracking_code || '').toString().trim().toUpperCase();

    if (!cleanCode) {
      return res.status(400).json({ success: false, error: 'Code tracking requis' });
    }

    const normResults = Array.isArray(results) ? results : [];
    const normSummary = summary || { poids: '-', produit: '-', crbt: 'Sans', depart: '-', arrivee: '-' };
    const trackingAnalysis = analyzeTrackingEvents(normResults);
    const step = currentStep || trackingAnalysis.currentStep;
    const isFinished = trackingAnalysis.isFinished;

    const entry: TrackingCacheRecord = {
      code: cleanCode,
      summary: normSummary,
      results: normResults,
      currentStep: step,
      isFinished,
      lastUpdated: new Date().toISOString(),
      updatedAtMs: Date.now(),
    };

    trackingCache[cleanCode] = entry;
    saveTrackingResultRecord(cleanCode, entry);

    logger.info(`Webhook tracking saved for ${cleanCode} (Finished: ${isFinished})`);
    return res.json({
      success: true,
      code: cleanCode,
      isFinished,
      message: `Données de suivi sauvegardées pour ${cleanCode}`,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

router.post('/tracking/webhook', handleTrackingWebhook);
router.post('/api/tracking/webhook', handleTrackingWebhook); // alias for backward compatibility

/**
 * Endpoint to parse and save raw copied text/HTML from Barid Al-Maghrib
 */
const handleTrackingParse = (req: any, res: any) => {
  try {
    const { code, text } = req.body;
    const cleanCode = (code || '').toString().trim().toUpperCase();
    const rawText = (text || '').toString().trim();

    if (!cleanCode) {
      return res.status(400).json({ success: false, error: 'Code tracking requis' });
    }
    if (!rawText) {
      return res.status(400).json({ success: false, error: 'Texte ou HTML de suivi requis' });
    }

    const parsedData = parseBaridHtml(rawText);
    if (!parsedData.results || parsedData.results.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Impossible d\'extraire les événements du texte fourni. Vérifiez le format.',
      });
    }

    const trackingAnalysis = analyzeTrackingEvents(parsedData.results);
    const entry: TrackingCacheRecord = {
      code: cleanCode,
      summary: parsedData.summary,
      results: parsedData.results,
      currentStep: trackingAnalysis.currentStep,
      isFinished: trackingAnalysis.isFinished,
      lastUpdated: new Date().toISOString(),
      updatedAtMs: Date.now(),
    };

    trackingCache[cleanCode] = entry;
    saveTrackingResultRecord(cleanCode, entry);

    return res.json({
      success: true,
      code: cleanCode,
      summary: parsedData.summary,
      results: parsedData.results,
      currentStep: trackingAnalysis.currentStep,
      isFinished: trackingAnalysis.isFinished,
      lastUpdated: entry.lastUpdated,
      fromCache: false,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

router.post('/tracking/parse', handleTrackingParse);
router.post('/api/tracking/parse', handleTrackingParse); // alias for backward compatibility

/**
 * Get all cached tracking results
 */
const handleTrackingCache = (_req: any, res: any) => {
  res.json({
    success: true,
    cache: getSavedTrackingResults(),
  });
};

router.get('/tracking/cache', handleTrackingCache);
router.get('/api/tracking/cache', handleTrackingCache); // alias for backward compatibility

/**
 * Express Route /track or /api/tracking/barid matching Flask Python script
 */
const handleTrackRequest = async (req: any, res: any) => {
  const code = (req.query.code || req.body?.code || '').toString().trim().toUpperCase();
  const forceRefresh = req.query.force === 'true' || req.query.refresh === 'true';

  if (!code) {
    return res.status(400).json({ success: false, error: 'Code tracking requis' });
  }

  // Check cached data (Persistent storage + in-memory)
  const cached = trackingCache[code] || getSavedTrackingResults()[code];
  if (cached && !forceRefresh) {
    // 1. If tracking is finished (Delivered/Terminé), it's permanent and final
    if (cached.isFinished || cached.currentStep === 4) {
      return res.json({
        success: true,
        code,
        summary: cached.summary,
        results: cached.results,
        currentStep: cached.currentStep,
        isFinished: true,
        lastUpdated: cached.lastUpdated,
        fromCache: true,
        cacheStatus: 'completed_final',
      });
    }

    // 2. If tracking is still active, check if within 2-hour window
    const updatedAt = cached.updatedAtMs || (cached.lastUpdated ? new Date(cached.lastUpdated).getTime() : 0);
    const elapsed = Date.now() - updatedAt;
    if (elapsed < TWO_HOURS_MS) {
      const remainingMinutes = Math.max(1, Math.round((TWO_HOURS_MS - elapsed) / 60000));
      return res.json({
        success: true,
        code,
        summary: cached.summary,
        results: cached.results,
        currentStep: cached.currentStep,
        isFinished: false,
        lastUpdated: cached.lastUpdated,
        fromCache: true,
        cacheStatus: 'active_within_2h',
        nextUpdateInMinutes: remainingMinutes,
      });
    }
  }

  // Helper to save and return tracking result
  const saveAndReturn = (summary: any, events: any[], fromCache = false, warning?: string) => {
    const trackingAnalysis = analyzeTrackingEvents(events);
    const step = trackingAnalysis.currentStep;
    const isFinished = trackingAnalysis.isFinished;

    const entry: TrackingCacheRecord = {
      code,
      summary,
      results: events,
      currentStep: step,
      isFinished,
      lastUpdated: new Date().toISOString(),
      updatedAtMs: Date.now(),
    };

    trackingCache[code] = entry;
    saveTrackingResultRecord(code, entry);

    return res.json({
      success: true,
      code,
      summary,
      results: events,
      currentStep: step,
      isFinished,
      lastUpdated: entry.lastUpdated,
      fromCache,
      ...(warning ? { warning } : {}),
    });
  };

  try {
    // 1. Try primary fast API on Vercel
    try {
      const vercelUrl = `https://barid-tracking-api.vercel.app/track?code=${encodeURIComponent(code)}`;
      const vercelRes = await fetch(vercelUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(2500),
      });
      if (vercelRes.ok) {
        const data = await vercelRes.json();
        const events = Array.isArray(data.historique_details)
          ? data.historique_details
          : Array.isArray(data.results)
          ? data.results
          : Array.isArray(data.events)
          ? data.events
          : [];

        if (data && (data.success || events.length > 0)) {
          const summary = {
            poids: data.informations_commande?.poids_du_colis || data.summary?.poids || '-',
            produit: data.informations_commande?.produit || data.summary?.produit || '-',
            crbt: data.informations_commande?.montant_crbt || data.summary?.crbt || 'Sans',
            depart: data.informations_commande?.position_de_depart || data.summary?.depart || '-',
            arrivee: data.informations_commande?.position_d_arrivee || data.summary?.arrivee || '-',
          };
          return saveAndReturn(summary, events);
        }
      }
    } catch (e: any) {
      logger.debug(`Vercel tracking proxy note for ${code}: ${e?.message || e}`);
    }

    // 2. Direct barid.ma fetch
    const url = `https://www.barid.ma/bamb2cstorefront/fr/tracking/getdetailentrytracking?code=${encodeURIComponent(code)}`;
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    };

    let response: any = null;
    try {
      response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(2500),
      });
    } catch (fetchErr: any) {
      logger.debug(`Direct fetch note for ${code}: ${fetchErr?.message || fetchErr}`);
    }

    if (response && response.ok) {
      const responseText = await response.text();

      // Check if JSON response (API) or HTML response (Web page)
      if (responseText.trim().startsWith('[')) {
        try {
          const rawArray = JSON.parse(responseText);
          const normResults = rawArray.map((ev: any) => ({
            date: ev.dateEvenement || '-',
            heure: ev.heureEvenement || '-',
            localisation: ev.evenementLocalisation || '-',
            details: ev.libelleEvenement || ev.evenementLocalisation || '-',
          }));

          const summary = {
            poids: '-',
            produit: '-',
            crbt: 'Sans',
            depart: normResults.length > 0 ? normResults[normResults.length - 1].localisation : '-',
            arrivee: normResults.length > 0 ? normResults[0].localisation : '-',
          };

          return saveAndReturn(summary, normResults);
        } catch {
          // Fallback to HTML parser below
        }
      }

      // Parse HTML response
      const parsedData = parseBaridHtml(responseText);
      if (parsedData.results && parsedData.results.length > 0) {
        return saveAndReturn(parsedData.summary, parsedData.results);
      }
    }

    // 3. If direct fetch didn't return valid results, try fallback to cached data if available
    if (cached) {
      return res.json({
        success: true,
        code,
        summary: cached.summary,
        results: cached.results,
        currentStep: cached.currentStep,
        isFinished: cached.isFinished,
        lastUpdated: cached.lastUpdated,
        fromCache: true,
        warning: 'Serveur Barid momentanément indisponible. Données en cache utilisées.',
      });
    }

    // If no data and no cache, return friendly status response
    return res.status(200).json({
      success: false,
      code,
      error: 'Serveur Barid Al-Maghrib momentanément inaccessible ou aucune donnée disponible.',
      directUrl: `https://www.barid.ma/bamb2cstorefront/fr/tracking/getdetailentrytracking?code=${encodeURIComponent(code)}`,
    });
  } catch (error: any) {
    logger.debug(`Tracking resolution note for ${code}: ${error?.message || error}`);

    if (cached) {
      return res.json({
        success: true,
        code,
        summary: cached.summary,
        results: cached.results,
        currentStep: cached.currentStep,
        isFinished: cached.isFinished,
        lastUpdated: cached.lastUpdated,
        fromCache: true,
        warning: 'Données en cache utilisées suite à une indisponibilité temporaire du serveur Barid.',
      });
    }

    return res.status(200).json({
      success: false,
      code,
      error: error.message || 'Impossible d\'obtenir le suivi Barid Al-Maghrib pour le moment.',
      directUrl: `https://www.barid.ma/bamb2cstorefront/fr/tracking/getdetailentrytracking?code=${encodeURIComponent(code)}`,
    });
  }
};

router.get('/track', handleTrackRequest);
router.get('/tracking/barid', handleTrackRequest);
router.get('/tracking/webhook', handleTrackRequest);

export default router;


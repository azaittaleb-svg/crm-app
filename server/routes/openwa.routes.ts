import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const JSONBIN_URL = 'https://api.jsonbin.io/v3/b/6a8c5406da38895dfe0ad362/latest';

interface OpenWaConfig {
  url: string;
  apiBase: string;
  webhooks: string;
  updatedAt: string;
  status: string;
}

const DEFAULT_FALLBACK_CONFIG: OpenWaConfig = {
  url: 'https://adopt-hart-venture-insured.trycloudflare.com',
  apiBase: 'https://adopt-hart-venture-insured.trycloudflare.com/api',
  webhooks: 'https://adopt-hart-venture-insured.trycloudflare.com/api/webhooks',
  updatedAt: new Date().toISOString(),
  status: 'online',
};

let cachedConfig: OpenWaConfig = { ...DEFAULT_FALLBACK_CONFIG };
let lastFetchTime = 0;

async function getTunnelConfig(forceRefresh = false): Promise<OpenWaConfig> {
  const now = Date.now();
  if (!forceRefresh && now - lastFetchTime < 15000) {
    return cachedConfig;
  }

  try {
    const res = await fetch(JSONBIN_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(4000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.record?.apiBase) {
        cachedConfig = data.record;
        lastFetchTime = now;
        return cachedConfig;
      }
    }
  } catch (err: any) {
    console.warn('JSONBin tunnel fetch warning, using cached/fallback config:', err.message);
  }

  lastFetchTime = now; // prevent tight loop retries
  return cachedConfig;
}

function getForwardHeaders(req: Request) {
  const apiKey =
    (req.headers['x-openwa-key'] as string) ||
    (req.headers['x-api-key'] as string) ||
    (req.query.openwaApiKey as string) ||
    (req.body?.openwaApiKey as string) ||
    process.env.OPENWA_API_KEY ||
    '';

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  return headers;
}

/**
 * Helper to resolve the active session ID / Name from the OpenWA server
 */
async function resolveActiveSession(config: OpenWaConfig, headers: Record<string, string>, requestedSession?: string) {
  try {
    const res = await fetch(`${config.apiBase}/sessions`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000),
    });

    if (res.status === 401) {
      return { unauthorized: true };
    }

    if (res.ok) {
      const sessions = await res.json();
      if (Array.isArray(sessions) && sessions.length > 0) {
        // 1. If requestedSession is provided, try to match by name or id
        if (requestedSession && requestedSession !== 'default') {
          const match = sessions.find((s: any) => s.name === requestedSession || s.id === requestedSession);
          if (match) return { session: match, sessionId: match.id || match.name };
        }

        // 2. Look for ready/connected session
        const readySession = sessions.find((s: any) => s.status === 'ready' || s.status === 'CONNECTED' || s.status === 'WORKING');
        if (readySession) return { session: readySession, sessionId: readySession.id || readySession.name };

        // 3. Look for qr_ready session
        const qrSession = sessions.find((s: any) => s.status === 'qr_ready' || s.status === 'SCAN_QR_CODE');
        if (qrSession) return { session: qrSession, sessionId: qrSession.id || qrSession.name };

        // 4. Default to first session
        return { session: sessions[0], sessionId: sessions[0].id || sessions[0].name };
      }
    }
  } catch (err: any) {
    console.warn('Could not list sessions:', err.message);
  }

  return { sessionId: requestedSession || 'default' };
}

// 1. Get current tunnel config from JSONBin
router.get('/openwa/config', async (req: Request, res: Response) => {
  const force = req.query.refresh === 'true';
  const config = await getTunnelConfig(force);
  if (!config) {
    return res.status(502).json({ error: "Impossible de récupérer la configuration depuis JSONBin." });
  }
  return res.json(config);
});

// 2. Health & Status check
router.get('/openwa/status', async (req: Request, res: Response) => {
  const config = await getTunnelConfig(req.query.refresh === 'true');
  if (!config) {
    return res.status(502).json({ isOnline: false, status: 'NO_CONFIG', error: 'Tunnel URL introuvable' });
  }

  const headers = getForwardHeaders(req);
  const requestedSession = (req.query.session as string) || 'default';

  try {
    // 1. Check /api/sessions to see all sessions
    const sessionsRes = await fetch(`${config.apiBase}/sessions`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (sessionsRes.status === 401) {
      return res.json({
        isOnline: true,
        status: 'UNAUTHORIZED',
        error: 'Clé API requise ou invalide (401)',
      });
    }

    if (sessionsRes.ok) {
      const sessions = await sessionsRes.json();
      let targetSession: any = null;

      if (Array.isArray(sessions) && sessions.length > 0) {
        targetSession = sessions.find((s: any) => s.name === requestedSession || s.id === requestedSession) ||
          sessions.find((s: any) => s.status === 'ready') ||
          sessions[0];
      }

      if (targetSession) {
        const rawStatus = targetSession.status || 'UNKNOWN';
        let uiStatus = rawStatus.toUpperCase();

        if (rawStatus === 'ready' || rawStatus === 'WORKING' || rawStatus === 'CONNECTED') {
          uiStatus = 'CONNECTED';
        } else if (rawStatus === 'qr_ready' || rawStatus === 'UNPAIRED' || rawStatus === 'SCAN_QR_CODE') {
          uiStatus = 'SCAN_QR_CODE';
        } else if (rawStatus === 'initializing' || rawStatus === 'created' || rawStatus === 'STARTING') {
          uiStatus = 'STARTING';
        }

        return res.json({
          isOnline: true,
          status: uiStatus,
          rawStatus,
          sessionName: targetSession.name,
          sessionId: targetSession.id,
          phone: targetSession.phone,
          pushName: targetSession.pushName,
        });
      } else {
        // No sessions exist yet, return UNPAIRED so user gets prompt/QR
        return res.json({
          isOnline: true,
          status: 'SCAN_QR_CODE',
          rawStatus: 'no_sessions',
          sessionName: requestedSession,
        });
      }
    }

    return res.json({
      isOnline: false,
      status: 'DISCONNECTED',
      error: `Réponse serveur HTTP ${sessionsRes.status}`,
    });
  } catch (error: any) {
    return res.json({
      isOnline: false,
      status: 'OFFLINE',
      error: error.message || 'Serveur injoignable',
    });
  }
});

// 3. Get QR Code
router.get('/openwa/qr', async (req: Request, res: Response) => {
  const config = await getTunnelConfig();
  if (!config) {
    return res.status(502).json({ error: 'Tunnel URL introuvable' });
  }

  const headers = getForwardHeaders(req);
  const requestedSession = (req.query.session as string) || 'default';

  try {
    const { sessionId, session } = await resolveActiveSession(config, headers, requestedSession);
    const sid = sessionId || session?.id || session?.name || requestedSession;

    // Try modern endpoint: /api/sessions/{sessionId}/qr
    let qrRes = await fetch(`${config.apiBase}/sessions/${encodeURIComponent(sid)}/qr`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });

    // Fallback: /api/sessions/{sessionName}/qr
    if (!qrRes.ok && session?.name && session.name !== sid) {
      qrRes = await fetch(`${config.apiBase}/sessions/${encodeURIComponent(session.name)}/qr`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000),
      });
    }

    if (!qrRes.ok) {
      return res.status(qrRes.status).json({ error: `QR Code non disponible (${qrRes.status})` });
    }

    const data = await qrRes.json();
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 4. Start session
router.post('/openwa/start', async (req: Request, res: Response) => {
  const config = await getTunnelConfig();
  if (!config) return res.status(502).json({ error: 'Tunnel URL introuvable' });

  const headers = getForwardHeaders(req);
  headers['Content-Type'] = 'application/json';
  const requestedSession = (req.body.session as string) || 'default';

  try {
    const { sessionId, session } = await resolveActiveSession(config, headers, requestedSession);
    const sid = sessionId || session?.id || session?.name || requestedSession;

    // Try endpoint 1: /sessions/{sid}/start
    let response = await fetch(`${config.apiBase}/sessions/${encodeURIComponent(sid)}/start`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    // Try endpoint 2: /sessions/start with body
    if (!response || !response.ok) {
      response = await fetch(`${config.apiBase}/sessions/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: sid }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
    }

    // Try endpoint 3: /start
    if (!response || !response.ok) {
      response = await fetch(`${config.apiBase}/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ session: sid }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
    }

    const data = response ? await response.json().catch(() => ({ success: response!.ok })) : { success: true };
    return res.status(response?.status || 200).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 4b. Stop session
router.post('/openwa/stop', async (req: Request, res: Response) => {
  const config = await getTunnelConfig();
  if (!config) return res.status(502).json({ error: 'Tunnel URL introuvable' });

  const headers = getForwardHeaders(req);
  headers['Content-Type'] = 'application/json';
  const requestedSession = (req.body.session as string) || 'default';

  try {
    const { sessionId, session } = await resolveActiveSession(config, headers, requestedSession);
    const sid = sessionId || session?.id || session?.name || requestedSession;

    // Try endpoint 1: /sessions/{sid}/stop
    let response = await fetch(`${config.apiBase}/sessions/${encodeURIComponent(sid)}/stop`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    // Try endpoint 2: /sessions/stop
    if (!response || !response.ok) {
      response = await fetch(`${config.apiBase}/sessions/stop`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: sid }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
    }

    const data = response ? await response.json().catch(() => ({ success: response!.ok })) : { success: true };
    return res.status(response?.status || 200).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 5. Restart session
router.post('/openwa/restart', async (req: Request, res: Response) => {
  const config = await getTunnelConfig();
  if (!config) return res.status(502).json({ error: 'Tunnel URL introuvable' });

  const headers = getForwardHeaders(req);
  headers['Content-Type'] = 'application/json';
  const requestedSession = (req.body.session as string) || 'default';

  try {
    const { sessionId, session } = await resolveActiveSession(config, headers, requestedSession);
    const sid = sessionId || session?.id || session?.name || requestedSession;

    // Try direct restart endpoint if available
    let response = await fetch(`${config.apiBase}/sessions/${encodeURIComponent(sid)}/restart`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (!response || !response.ok) {
      // Stop then start
      await fetch(`${config.apiBase}/sessions/${encodeURIComponent(sid)}/stop`, { method: 'POST', headers }).catch(() => null);
      response = await fetch(`${config.apiBase}/sessions/${encodeURIComponent(sid)}/start`, { method: 'POST', headers }).catch(() => null);
    }

    const data = response ? await response.json().catch(() => ({ success: response!.ok })) : { success: true };
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 6. Logout session
router.post('/openwa/logout', async (req: Request, res: Response) => {
  const config = await getTunnelConfig();
  if (!config) return res.status(502).json({ error: 'Tunnel URL introuvable' });

  const headers = getForwardHeaders(req);
  headers['Content-Type'] = 'application/json';
  const requestedSession = (req.body.session as string) || 'default';

  try {
    const { sessionId, session } = await resolveActiveSession(config, headers, requestedSession);
    const sid = sessionId || session?.id || session?.name || requestedSession;

    let response = await fetch(`${config.apiBase}/sessions/${encodeURIComponent(sid)}/logout`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (!response || !response.ok) {
      response = await fetch(`${config.apiBase}/sessions/logout`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: sid }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);
    }

    const data = response ? await response.json().catch(() => ({ success: response!.ok })) : { success: true };
    return res.status(response?.status || 200).json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 7. Send message (OpenWA / WAHA Modern)
router.post('/openwa/sendText', async (req: Request, res: Response) => {
  const config = await getTunnelConfig();
  if (!config) return res.status(502).json({ error: 'Tunnel URL introuvable' });

  const headers = getForwardHeaders(req);
  headers['Content-Type'] = 'application/json';

  const { phoneNumber, message, session: requestedSession = 'default' } = req.body;
  if (!phoneNumber || !message) {
    return res.status(400).json({ error: 'Numéro de téléphone et message obligatoires' });
  }

  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  const chatId = `${cleanPhone}@c.us`;

  try {
    // 1. Resolve active session ID dynamically
    const { sessionId, session, unauthorized } = await resolveActiveSession(config, headers, requestedSession);

    if (unauthorized) {
      return res.status(401).json({ error: 'Clé API invalide ou non autorisée (401)' });
    }

    // Try candidates: session.id (UUID), session.name, requestedSession
    const candidates = [
      session?.id,
      session?.name,
      sessionId,
      requestedSession,
    ].filter((val, idx, arr): val is string => Boolean(val) && arr.indexOf(val) === idx);

    let lastError = '';

    for (const sid of candidates) {
      const endpoints = [
        {
          url: `${config.apiBase}/sendText`,
          body: { chatId, text: message, session: sid },
        },
        {
          url: `${config.apiBase}/sessions/${encodeURIComponent(sid)}/messages/send-text`,
          body: { chatId, text: message },
        },
        {
          url: `${config.apiBase}/sessions/${encodeURIComponent(sid)}/send-text`,
          body: { chatId, text: message },
        },
        {
          url: `${config.apiBase}/send-message`,
          body: { phone: cleanPhone, message, session: sid },
        },
      ];

      for (const ep of endpoints) {
        try {
          const response = await fetch(ep.url, {
            method: 'POST',
            headers,
            body: JSON.stringify(ep.body),
            signal: AbortSignal.timeout(15000),
          });

          if (response.ok) {
            const data = await response.json().catch(() => ({ success: true }));
            return res.json(data);
          }

          const errText = await response.text();

          if (response.status === 401) {
            return res.status(401).json({ error: 'Clé API invalide ou non autorisée (401)' });
          }

          if (response.status === 409) {
            return res.status(409).json({ error: `La session WhatsApp n'est pas encore connectée (Statut: non prêt).` });
          }

          lastError = `Erreur (${response.status}): ${errText}`;
        } catch (err: any) {
          lastError = err.message;
        }
      }
    }

    return res.status(400).json({ error: lastError || "Échec de l'envoi du message WhatsApp" });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || "Erreur interne lors de l'envoi" });
  }
});

export default router;

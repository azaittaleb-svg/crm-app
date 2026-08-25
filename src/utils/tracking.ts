/**
 * Tracking utilities for Barid Al-Maghrib / Amana parcels
 */

export interface TrackingEvent {
  date: string;
  heure?: string;
  localisation?: string;
  details?: string;
  libelleEvenement?: string;
  evenementLocalisation?: string;
  dateEvenement?: string;
  heureEvenement?: string;
}

export interface TrackingAnalysis {
  currentStep: 1 | 2 | 3 | 4;
  isFinished: boolean;
  isDelivered: boolean;
  isAgencyPickup: boolean;
  isOutForDelivery: boolean;
  isTransit: boolean;
  isDepot: boolean;
  statusLabel: string;
  statusTag: string;
  step3Label: string;
  step3Desc: string;
}

export function analyzeTrackingEvents(events: TrackingEvent[] = []): TrackingAnalysis {
  if (!events || events.length === 0) {
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
      step3Label: 'Distribution',
      step3Desc: 'Tournée',
    };
  }

  // In Barid tracking, the newest event is at index 0
  const latest = events[0];
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
    (/(acheminement|sorti\s+[aà]\s+destination|centre\s+national|centre\s+messagerie|hub|tri|ctd|transit|transfert)/i.test(latestText) || events.length > 1);

  const isDepot = !isDelivered && !isAgencyPickup && !isOutForDelivery && !isTransit;

  let currentStep: 1 | 2 | 3 | 4 = 1;
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
    isDepot,
    statusLabel,
    statusTag,
    step3Label: isAgencyPickup ? 'En agence' : 'Distribution',
    step3Desc: isAgencyPickup ? 'À récupérer' : 'Tournée',
  };
}

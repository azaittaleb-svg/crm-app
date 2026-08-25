export interface WhatsAppSendResult {
  success: boolean;
  message?: string;
  error?: string;
}

/**
 * Checks if a given phone number is a landline / special non-mobile number (numéro fixe / numéro spécial).
 * In Morocco:
 * - Fixe / Spécial starts with 05, 08 (or +2125, +2128, 2125, 2128, 002125, 002128)
 * - Mobile starts exclusively with 06, 07 (or +2126, +2127, 2126, 2127, 002126, 002127)
 */
export const isLandlinePhone = (phone?: string | null): boolean => {
  if (!phone || typeof phone !== 'string') return false;
  // Strip spaces, dashes, dots, plus signs, brackets
  const clean = phone.replace(/[^0-9]/g, '');
  if (!clean) return false;

  // International starting with 00212 or 212
  if (clean.startsWith('002125') || clean.startsWith('002128')) return true;
  if (clean.startsWith('2125') || clean.startsWith('2128')) return true;

  // National format starting with 05 or 08
  if (clean.startsWith('05') || clean.startsWith('08')) return true;

  // 9-digit format starting directly with 5 or 8 (without leading 0 or country code)
  if ((clean.startsWith('5') || clean.startsWith('8')) && clean.length === 9) return true;

  // If phone explicitly starts with mobile prefix (06, 07, 2126, 2127, 002126, 002127)
  const isMobile =
    clean.startsWith('06') ||
    clean.startsWith('07') ||
    clean.startsWith('2126') ||
    clean.startsWith('2127') ||
    clean.startsWith('002126') ||
    clean.startsWith('002127') ||
    ((clean.startsWith('6') || clean.startsWith('7')) && clean.length === 9);

  // If not mobile and has 05 / 08 or not a standard mobile Moroccan prefix
  if (!isMobile && (clean.startsWith('5') || clean.startsWith('8') || clean.startsWith('05') || clean.startsWith('08'))) {
    return true;
  }

  return false;
};

/**
 * Checks if a phone number is eligible for WhatsApp sending
 * Must not be empty, must not be a landline/fixe, and must have valid length.
 */
export const isWhatsAppEligiblePhone = (phone?: string | null): boolean => {
  if (!phone || typeof phone !== 'string') return false;
  const trimmed = phone.trim();
  if (!trimmed) return false;
  if (isLandlinePhone(trimmed)) return false;
  const clean = trimmed.replace(/[^0-9]/g, '');
  return clean.length >= 9;
};

/**
 * Clean and format phone number for WhatsApp sending.
 * Converts 06..., 07... to 2126..., 2127...
 */
export const formatWhatsAppNumber = (phone: string): string => {
  if (!phone) return '';
  let cleaned = phone.replace(/[^0-9]/g, '');
  
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    cleaned = '212' + cleaned.substring(1);
  } else if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }
  
  return cleaned;
};

/**
 * Send WhatsApp message directly via OpenWA API server.
 * Automatically checks and refuses sending to landline numbers.
 */
export const sendWhatsAppMessage = async (phone: string, text: string): Promise<WhatsAppSendResult> => {
  try {
    if (isLandlinePhone(phone)) {
      return {
        success: false,
        error: 'Impossible d\'envoyer un message WhatsApp : le numéro renseigné est un numéro fixe / spécial (05... / 08... / 002128...).',
      };
    }

    const cleanPhone = formatWhatsAppNumber(phone);
    if (!cleanPhone || cleanPhone.length < 8) {
      return { success: false, error: 'Numéro de téléphone mobile invalide ou manquant.' };
    }

    if (!text || text.trim().length === 0) {
      return { success: false, error: 'Le contenu du message est vide.' };
    }

    // Retrieve stored API key if available
    let apiKey = '';
    try {
      apiKey = localStorage.getItem('openwa_api_key') || '';
    } catch {}

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (apiKey) {
      headers['X-Api-Key'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await fetch('/api/openwa/sendText', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        phoneNumber: cleanPhone,
        message: text,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const errMsg = data?.error || data?.message || `Erreur serveur HTTP ${response.status}`;
      return { success: false, error: errMsg };
    }

    const resData = await response.json().catch(() => ({ success: true }));
    return {
      success: true,
      message: 'Message envoyé avec succès via OpenWA.',
    };
  } catch (error: any) {
    console.error("Erreur sendWhatsAppMessage OpenWA:", error);
    if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
      return { success: false, error: 'Le serveur OpenWA a mis trop de temps à répondre (Timeout).' };
    }
    return { success: false, error: error.message || "Erreur lors de l'envoi via OpenWA" };
  }
};



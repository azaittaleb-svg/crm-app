import { auth } from '../lib/firebase';

export interface OpenWaConfig {
  url: string;
  apiBase: string;
  webhooks: string;
  updatedAt: string;
  status: string;
}

const DEFAULT_SESSION = 'default';
export const DEFAULT_MASTER_KEY = 'owa_k1_c215d77011fd7c8c5b11406ae1b179a731fafc0e557042cce24f91352b4c4e53';
export const JSONBIN_URL = 'https://api.jsonbin.io/v3/b/6a8c5406da38895dfe0ad362/latest';

const getHeaders = async (apiKey: string = '') => {
  const effectiveKey = apiKey || localStorage.getItem('openwa_api_key') || DEFAULT_MASTER_KEY;
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  
  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (err) {
    // ignore
  }

  if (effectiveKey) {
    headers['X-OpenWA-Key'] = effectiveKey;
    headers['X-Api-Key'] = effectiveKey;
    if (!headers['Authorization']) {
      headers['Authorization'] = `Bearer ${effectiveKey}`;
    }
  }
  return headers;
};

export const DEFAULT_FALLBACK_CONFIG: OpenWaConfig = {
  url: 'https://visitor-floor-blackjack-kingdom.trycloudflare.com',
  apiBase: 'https://visitor-floor-blackjack-kingdom.trycloudflare.com/api',
  webhooks: 'https://visitor-floor-blackjack-kingdom.trycloudflare.com/api/webhooks',
  updatedAt: new Date().toISOString(),
  status: 'online',
};

const CACHE_KEY = 'openwa_cached_config';

export const getDynamicBaseUrl = async (): Promise<OpenWaConfig> => {
  // 1. Try local proxy
  try {
    const headers = await getHeaders('');
    const response = await fetch('/api/openwa/config', {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(4000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.apiBase) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
        return data;
      }
    }
  } catch (err: any) {
    // fallback
  }

  // 2. Try direct JSONBin (used in Google AI Studio / Remote Web)
  try {
    const directRes = await fetch(JSONBIN_URL, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (directRes.ok) {
      const json = await directRes.json();
      if (json?.record?.apiBase) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(json.record)); } catch {}
        return json.record;
      }
    }
  } catch (err: any) {
    console.warn('Direct JSONBin fetch warning:', err.message);
  }

  // 3. Try localStorage cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed?.apiBase) return parsed;
    }
  } catch {}

  // 4. Return default fallback
  return DEFAULT_FALLBACK_CONFIG;
};

export const checkServerHealth = async (apiBase: string, apiKey: string = ''): Promise<boolean> => {
  // 1. Try local proxy
  try {
    const headers = await getHeaders(apiKey);
    const res = await fetch('/api/openwa/status', {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.isOnline === true;
    }
  } catch (e) {
    // fallback
  }

  // 2. Direct Cloudflare Tunnel fallback (Google AI Studio)
  try {
    const base = apiBase || (await getDynamicBaseUrl()).apiBase;
    const headers = await getHeaders(apiKey);
    const directRes = await fetch(`${base}/health`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000),
    });
    if (directRes.ok) return true;

    const sessionsRes = await fetch(`${base}/sessions`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000),
    });
    return sessionsRes.ok;
  } catch (e) {
    return false;
  }
};

export const getSessionStatus = async (
  apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<{ status: string; me?: any; error?: string; sessionName?: string; phone?: string; pushName?: string }> => {
  // 1. Try local proxy
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch(`/api/openwa/status?session=${encodeURIComponent(session)}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000),
    });
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    // fallback
  }

  // 2. Direct Cloudflare Tunnel fallback (Google AI Studio)
  try {
    const base = apiBase || (await getDynamicBaseUrl()).apiBase;
    const headers = await getHeaders(apiKey);
    const sessionsRes = await fetch(`${base}/sessions`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });

    if (sessionsRes.status === 401) {
      return { status: 'UNAUTHORIZED', error: 'Clé API requise ou invalide (401)' };
    }

    if (sessionsRes.ok) {
      const sessions = await sessionsRes.json();
      let target: any = null;
      if (Array.isArray(sessions) && sessions.length > 0) {
        target = sessions.find((s: any) => s.name === session || s.id === session) ||
          sessions.find((s: any) => s.status === 'ready') ||
          sessions[0];
      }

      if (target) {
        const rawStatus = target.status || 'UNKNOWN';
        let uiStatus = rawStatus.toUpperCase();
        if (rawStatus === 'ready' || rawStatus === 'WORKING' || rawStatus === 'CONNECTED') {
          uiStatus = 'CONNECTED';
        } else if (rawStatus === 'qr_ready' || rawStatus === 'UNPAIRED' || rawStatus === 'SCAN_QR_CODE') {
          uiStatus = 'SCAN_QR_CODE';
        } else if (rawStatus === 'initializing' || rawStatus === 'created' || rawStatus === 'STARTING') {
          uiStatus = 'STARTING';
        }
        return {
          status: uiStatus,
          sessionName: target.name,
          phone: target.phone,
          pushName: target.pushName,
        };
      }
      return { status: 'SCAN_QR_CODE', sessionName: session };
    }
    return { status: 'DISCONNECTED' };
  } catch (error: any) {
    return { status: 'ERROR', error: error.message };
  }
};

export const getQrCode = async (
  apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<string | null> => {
  // 1. Try local proxy
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch(`/api/openwa/qr?session=${encodeURIComponent(session)}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(6000),
    });
    if (response.ok) {
      const data = await response.json();
      return data.qrCode || data.data || data.url || data.qr || null;
    }
  } catch (error) {
    // fallback
  }

  // 2. Direct Cloudflare Tunnel fallback
  try {
    const base = apiBase || (await getDynamicBaseUrl()).apiBase;
    const headers = await getHeaders(apiKey);
    const sessionsRes = await fetch(`${base}/sessions`, { method: 'GET', headers });
    const sessions = await sessionsRes.json();
    const sid = (Array.isArray(sessions) && sessions.find((s: any) => s.name === session || s.id === session)?.id) || session;

    const qrRes = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/auth/qr`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000),
    });
    if (qrRes.ok) {
      const data = await qrRes.json();
      return data.qrCode || data.data || data.url || data.qr || null;
    }
  } catch (e) {
    // ignore
  }
  return null;
};

export const startSession = async (
  apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<boolean> => {
  // 1. Try local proxy
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/start', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) return true;
  } catch (error) {
    // fallback
  }

  // 2. Direct Cloudflare Tunnel fallback
  try {
    const base = apiBase || (await getDynamicBaseUrl()).apiBase;
    const headers = await getHeaders(apiKey);
    headers['Content-Type'] = 'application/json';
    const sessionsRes = await fetch(`${base}/sessions`, { method: 'GET', headers });
    const sessions = await sessionsRes.json();
    const sid = (Array.isArray(sessions) && sessions.find((s: any) => s.name === session || s.id === session)?.id) || session;

    const res = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/start`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(12000),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
};

export const stopSession = async (
  apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<boolean> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/stop', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch (error) {
    return false;
  }
};

export const restartSession = async (
  apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<boolean> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/restart', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(12000),
    });
    return response.ok;
  } catch (error) {
    return false;
  }
};

export const logoutSession = async (
  apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<boolean> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/logout', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(12000),
    });
    return response.ok;
  } catch (error) {
    return false;
  }
};

export const sendTestMessage = async (
  apiBase: string,
  apiKey: string = '',
  phoneNumber: string,
  message: string,
  session = DEFAULT_SESSION
): Promise<boolean> => {
  // 1. Try local proxy
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/sendText', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ session, phoneNumber, message }),
      signal: AbortSignal.timeout(20000),
    });

    if (response.ok) return true;
    if (response.status === 401) {
      throw new Error('Clé API non autorisée');
    }
  } catch (error: any) {
    if (error.message.includes('Clé API')) throw error;
  }

  // 2. Direct Cloudflare Tunnel fallback (Google AI Studio)
  try {
    const base = apiBase || (await getDynamicBaseUrl()).apiBase;
    const headers = await getHeaders(apiKey);
    headers['Content-Type'] = 'application/json';

    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    const chatId = `${cleanPhone}@c.us`;

    const sessionsRes = await fetch(`${base}/sessions`, { method: 'GET', headers });
    const sessions = await sessionsRes.json();
    const target = Array.isArray(sessions) && (sessions.find((s: any) => s.name === session || s.id === session) || sessions.find((s: any) => s.status === 'ready') || sessions[0]);
    const sid = target?.id || target?.name || session;

    const directRes = await fetch(`${base}/sessions/${encodeURIComponent(sid)}/messages/send-text`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ chatId, text: message }),
      signal: AbortSignal.timeout(20000),
    });

    if (directRes.ok) return true;
    const errText = await directRes.text();
    throw new Error(`Erreur envoi (${directRes.status}): ${errText}`);
  } catch (err: any) {
    throw err;
  }
};

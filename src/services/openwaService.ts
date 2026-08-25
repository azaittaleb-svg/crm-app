import { auth } from '../lib/firebase';

export interface OpenWaConfig {
  url: string;
  apiBase: string;
  webhooks: string;
  updatedAt: string;
  status: string;
}

const DEFAULT_SESSION = 'default';

const getHeaders = async (apiKey: string) => {
  const headers: Record<string, string> = { 'Accept': 'application/json' };
  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (err) {
    console.warn('Could not retrieve auth token for OpenWA request:', err);
  }

  if (apiKey) {
    headers['X-OpenWA-Key'] = apiKey;
    headers['X-Api-Key'] = apiKey;
  }
  return headers;
};

export const DEFAULT_FALLBACK_CONFIG: OpenWaConfig = {
  url: 'https://adopt-hart-venture-insured.trycloudflare.com',
  apiBase: 'https://adopt-hart-venture-insured.trycloudflare.com/api',
  webhooks: 'https://adopt-hart-venture-insured.trycloudflare.com/api/webhooks',
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
      signal: AbortSignal.timeout(6000),
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.apiBase) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        } catch {}
        return data;
      }
    }
  } catch (err: any) {
    console.warn('Proxy config fetch timed out or failed, checking cache/direct:', err.message);
  }

  // 2. Try direct JSONBin
  try {
    const directRes = await fetch('https://api.jsonbin.io/v3/b/6a8c5406da38895dfe0ad362/latest', {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(4000),
    });
    if (directRes.ok) {
      const json = await directRes.json();
      if (json?.record?.apiBase) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(json.record));
        } catch {}
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

export const checkServerHealth = async (_apiBase: string, apiKey: string = ''): Promise<boolean> => {
  try {
    const headers = await getHeaders(apiKey);
    const res = await fetch('/api/openwa/status', {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.isOnline === true;
  } catch (e) {
    console.error('Health check failed:', e);
    return false;
  }
};

export const getSessionStatus = async (
  _apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<{ status: string; me?: any; error?: string }> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch(`/api/openwa/status?session=${encodeURIComponent(session)}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { status: 'DISCONNECTED' };
    return await response.json();
  } catch (error) {
    console.error('Erreur getSessionStatus:', error);
    return { status: 'ERROR' };
  }
};

export const getQrCode = async (
  _apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<string | null> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch(`/api/openwa/qr?session=${encodeURIComponent(session)}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.qrCode || data.data || data.url || data.qr || null;
  } catch (error) {
    console.error('Erreur getQrCode:', error);
    return null;
  }
};

export const startSession = async (
  _apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<boolean> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/start', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(12000),
    });
    return response.ok;
  } catch (error) {
    console.error('Erreur startSession:', error);
    return false;
  }
};

export const stopSession = async (
  _apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<boolean> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/stop', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(12000),
    });
    return response.ok;
  } catch (error) {
    console.error('Erreur stopSession:', error);
    return false;
  }
};

export const restartSession = async (
  _apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<boolean> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/restart', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(12000),
    });
    return response.ok;
  } catch (error) {
    console.error('Erreur restartSession:', error);
    return false;
  }
};

export const logoutSession = async (
  _apiBase: string,
  apiKey: string = '',
  session = DEFAULT_SESSION
): Promise<boolean> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/logout', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ session }),
      signal: AbortSignal.timeout(12000),
    });
    return response.ok;
  } catch (error) {
    console.error('Erreur logoutSession:', error);
    return false;
  }
};

export const sendTestMessage = async (
  _apiBase: string,
  apiKey: string = '',
  phoneNumber: string,
  message: string,
  session = DEFAULT_SESSION
): Promise<boolean> => {
  try {
    const headers = await getHeaders(apiKey);
    const response = await fetch('/api/openwa/sendText', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session,
        phoneNumber,
        message,
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      throw new Error(errJson?.error || errJson?.message || "Erreur lors de l'envoi");
    }
    return true;
  } catch (error: any) {
    console.error('Erreur sendTestMessage:', error);
    throw error;
  }
};


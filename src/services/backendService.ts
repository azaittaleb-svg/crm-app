import { auth } from '../lib/firebase';

/**
 * Centralized service for communicating with the server-side endpoints.
 */

export interface ExtractItemsResponse {
  items: Array<{
    designation?: string;
    qte?: number;
    prix_dollar?: number;
    price_markup_usd?: number;
    ship_usd?: number;
    diw_dh?: number;
  }>;
}

export interface InvoiceScanResult {
  ref: string;
  date: string;
  supplierId: string | null;
  applyTax: boolean;
  taxRate: number;
  subtotal: number;
  total: number;
  items: Array<{
    description: string;
    quantity: number;
    price: number;
  }>;
  validationErrors?: string[];
}

export interface SendEmailPayload {
  to: string;
  subject: string;
  body: string;
  attachmentName?: string;
  pdfBase64?: string;
}

async function getAuthHeaders(additionalHeaders: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...additionalHeaders };
  try {
    const user = auth.currentUser;
    if (user) {
      const token = await user.getIdToken();
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch (err) {
    console.error('Error fetching auth token for headers:', err);
  }
  return headers;
}

export const backendService = {
  /**
   * Calls the Gemini API via the server to extract structured purchase items from a text prompt.
   */
  async extractItems(prompt: string, exchangeRate: number): Promise<ExtractItemsResponse> {
    const response = await fetch('/api/extract-items', {
      method: 'POST',
      headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prompt, exchangeRate }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Erreur lors de l'extraction des articles par l'IA");
    }

    return response.json();
  },

  /**
   * Calls the Gemini API via the server to scan and parse a purchase PDF document with math and coherence validations.
   */
  async scanPurchasePdf(text: string, suppliers: any[]): Promise<InvoiceScanResult> {
    const response = await fetch('/api/scan-purchase-pdf', {
      method: 'POST',
      headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ text, suppliers }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Erreur lors de la numérisation de la facture par l'IA");
    }

    return response.json();
  },

  /**
   * Calls the server-side email endpoint to send a PDF attachment to the specified recipient.
   */
  async sendEmail(payload: SendEmailPayload): Promise<{ success: boolean; messageId?: string }> {
    const response = await fetch('/api/send-email', {
      method: 'POST',
      headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Erreur lors de l'envoi de l'email");
    }

    return response.json();
  },

  /**
   * Fetch system performance metrics
   */
  async getPerformanceMetrics(): Promise<any> {
    try {
      const response = await fetch('/api/monitoring/metrics', {
        headers: await getAuthHeaders(),
      });
      if (!response.ok) {
        return {
          system: { memory: { heapUsedMb: 0, heapTotalMb: 0 }, uptimeSeconds: 0 },
          cache: { enabled: true, size: 0 },
          aggregates: []
        };
      }
      return response.json();
    } catch (err) {
      return {
        system: { memory: { heapUsedMb: 0, heapTotalMb: 0 }, uptimeSeconds: 0 },
        cache: { enabled: true, size: 0 },
        aggregates: []
      };
    }
  },

  /**
   * Clear system performance metrics log
   */
  async clearPerformanceMetrics(): Promise<any> {
    const response = await fetch('/api/monitoring/metrics/clear', {
      method: 'POST',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Impossible de réinitialiser les métriques');
    return response.json();
  },

  /**
   * Toggle Redis-compatible cache engine
   */
  async toggleCache(enabled: boolean): Promise<any> {
    const response = await fetch('/api/monitoring/cache/toggle', {
      method: 'POST',
      headers: await getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) throw new Error("Impossible de modifier l'état du cache");
    return response.json();
  },

  /**
   * Flush global server-side cache
   */
  async flushCache(): Promise<any> {
    const response = await fetch('/api/monitoring/cache/flush', {
      method: 'POST',
      headers: await getAuthHeaders(),
    });
    if (!response.ok) throw new Error('Impossible de vider le cache');
    return response.json();
  },
};

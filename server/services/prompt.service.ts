import { Supplier } from '../types/Supplier';

export class PromptService {
  /**
   * Generates a precise, optimized prompt for scanPurchasePdf.
   * Stripped of redundant words to keep tokens minimal and accurate.
   */
  public static getScanPurchasePdfPrompt(text: string, suppliers: Supplier[]): string {
    const cleanText = text.trim();
    const cleanSuppliers = (suppliers || []).map((s) => ({ id: s.id, name: s.name }));

    return `Extract purchase invoice fields from the text.

Invoice Raw Text:
"""
${cleanText}
"""

Suppliers:
${JSON.stringify(cleanSuppliers)}

JSON schema required output:
- ref: string. Invoice reference number.
- date: string (format YYYY-MM-DD). Use today's date if absent.
- supplierId: string of matching supplier ID from list, or null.
- items: array of line items with description (string), quantity (number), and price (number).
- applyTax: boolean. Presence of TVA/Tax.
- taxRate: number. Tax rate percentage (e.g. 20, 14, 10, 7, 0). Default is 20 if present.
- subtotal: number. HT subtotal.
- total: number. TTC total.

Rules:
- Ignore footer boilerplate (ICE, bank accounts,capital, RC, IF, Patente).
- Ignore total lines as line items.
- Ensure quantity >= 1 and positive decimal prices.`;
  }

  /**
   * Generates a precise, optimized prompt for extractItems (Motcho Matrix).
   */
  public static getExtractItemsPrompt(promptText: string, exchangeRate: number): string {
    const cleanPrompt = promptText.trim();

    return `Parse international invoices for "Motcho" matching Excel logic.

Input:
"""
${cleanPrompt}
"""

Exchange Rate: ${exchangeRate}

Formulas to calculate:
1. price_markup_usd = prix_dollar * markup (1.365 or 1.30)
2. total_usd_with_ship = price_markup_usd + ship_usd
3. en_dirham = (total_usd_with_ship * exchangeRate) + diw_dh
4. qte_total = en_dirham * qte

JSON Schema constraints:
- vendor_name: string
- taux_change: number
- items: array of items with designation (string), qte (number), prix_dollar (number), price_markup_usd (number), ship_usd (number), diw_dh (number), en_dirham (number), qte_total (number).
- grand_total_overall: number. Sum of qte_total of items.`;
  }
}

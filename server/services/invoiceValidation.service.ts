import { InvoiceScanResult } from '../types/Invoice';
import { calculateSimilarity } from '../utils/similarity';

export interface ValidationSummary {
  success: boolean;
  confidence: number;
  warnings: string[];
  errors: string[];
}

export class InvoiceValidationService {
  /**
   * Performs all math, coherence, dates, and requirements checks.
   * Calculates a final deterministic confidence score based on the checks.
   */
  public static validateInvoice(data: Partial<InvoiceScanResult>): ValidationSummary {
    const warnings: string[] = [];
    const errors: string[] = [];
    let score = 100;

    const subtotal = Number(data.subtotal) || 0;
    const total = Number(data.total) || 0;
    const taxRate = Number(data.taxRate) || 0;
    const applyTax = data.applyTax !== false;

    // 1. Math check: HT + TVA vs TTC
    const calculatedTax = applyTax ? subtotal * (taxRate / 100) : 0;
    const expectedTotal = subtotal + calculatedTax;

    if (Math.abs(expectedTotal - total) > 0.5) {
      const diff = Math.abs(total - expectedTotal);
      warnings.push(
        `Écart mathématique: HT (${subtotal.toFixed(2)}) + TVA (${calculatedTax.toFixed(2)}) ne correspond pas au TTC (${total.toFixed(2)}). Écart de ${diff.toFixed(2)} DH.`
      );
      score -= 20;
    }

    // 2. Items sum vs subtotal HT
    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      let itemsSum = 0;
      for (const item of data.items) {
        const itemPrice = Number(item.price) || 0;
        const itemQty = Number(item.quantity) || 0;
        itemsSum += itemPrice * itemQty;

        if (itemPrice < 0 || itemQty < 0) {
          errors.push(
            `L'article "${item.description || 'Inconnu'}" contient une quantité ou un prix négatif.`
          );
          score -= 15;
        }
      }

      if (Math.abs(itemsSum - subtotal) > 0.5) {
        warnings.push(
          `Somme des articles (${itemsSum.toFixed(2)}) différente du sous-total HT saisi (${subtotal.toFixed(2)}).`
        );
        score -= 15;
      }
    } else {
      warnings.push("Aucun article n'a été extrait de la facture.");
      score -= 15;
    }

    // 3. Date validity check
    if (data.date) {
      const parsedDate = new Date(data.date);
      if (isNaN(parsedDate.getTime())) {
        errors.push(`Format de date invalide ou illisible: "${data.date}".`);
        score -= 10;
      } else if (parsedDate > new Date(Date.now() + 86400000)) {
        // 1 day future tolerance
        warnings.push(`La date de facture "${data.date}" est dans le futur.`);
        score -= 10;
      }
    } else {
      warnings.push('Date de facture manquante.');
      score -= 10;
    }

    // 4. Base requirements
    if (!data.ref || data.ref.trim() === '') {
      warnings.push('Numéro de référence de facture manquant.');
      score -= 10;
    }

    if (subtotal <= 0 || total <= 0) {
      errors.push('Les montants HT et TTC de la facture doivent être strictement positifs.');
      score -= 15;
    }

    // 5. Supplier check
    if (!data.supplierId) {
      warnings.push("Aucun fournisseur correspondant n'a été trouvé.");
      score -= 15;
    }

    // Bound the confidence score between 10 and 100
    const finalConfidence = Math.max(10, Math.min(100, score));

    return {
      success: errors.length === 0,
      confidence: finalConfidence,
      warnings,
      errors,
    };
  }

  /**
   * Helper to evaluate similarity matching of invoices for duplicate alerts.
   */
  public static checkSimilarityDuplicate(
    invoiceRef: string,
    invoiceDate: string,
    invoiceTotal: number,
    existingInvoices: Array<{ ref: string; date: string; total: number }>
  ): { isDuplicate: boolean; reason: string } {
    if (!invoiceRef) return { isDuplicate: false, reason: '' };

    const normRef = invoiceRef.trim().toLowerCase();

    for (const doc of existingInvoices) {
      const docRef = (doc.ref || '').trim().toLowerCase();
      const docDate = doc.date || '';
      const docTotal = Number(doc.total) || 0;

      const refScore = calculateSimilarity(normRef, docRef);
      const isDateMatch = invoiceDate && docDate === invoiceDate;
      const isTotalMatch = Math.abs(docTotal - invoiceTotal) < 0.1;

      if (refScore > 0.9 && isDateMatch && isTotalMatch) {
        return {
          isDuplicate: true,
          reason: `Doublon exact détecté (Facture similaire existante: Réf: ${doc.ref}, Date: ${doc.date}, Total: ${doc.total} DH)`,
        };
      }
    }

    return { isDuplicate: false, reason: '' };
  }
}

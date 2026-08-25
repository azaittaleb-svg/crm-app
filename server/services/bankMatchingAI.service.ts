import { calculateSimilarity } from '../utils/similarity';

export interface UnreconciledInvoice {
  id: string;
  refId: string;
  type: 'Vente' | 'Achat';
  clientOrSupplierName: string;
  amount: number; // Remaining amount to pay
  date: string;
}

export interface BankTransactionItem {
  id: string;
  date: string;
  label: string;
  partnerName: string;
  amount: number;
}

export interface BankMatchSuggestion {
  invoice: UnreconciledInvoice;
  score: number; // match rating out of 100
  discrepancies: string[];
  reconciliationAction: 'exact' | 'partial' | 'review';
}

export class BankMatchingAIService {
  /**
   * Generates matching suggestions between a bank transaction and list of unpaid documents.
   */
  public static matchTransaction(
    transaction: BankTransactionItem,
    unpaidInvoices: UnreconciledInvoice[]
  ): BankMatchSuggestion[] {
    const suggestions: BankMatchSuggestion[] = [];
    const txAmtAbs = Math.abs(transaction.amount);
    const txLabel = (transaction.label || '').toLowerCase();
    const txPartner = (transaction.partnerName || '').toLowerCase();

    for (const invoice of unpaidInvoices) {
      const invAmtAbs = Math.abs(invoice.amount);
      const invPartner = (invoice.clientOrSupplierName || '').toLowerCase();
      const invRef = (invoice.refId || '').toLowerCase();

      let score = 0;
      const discrepancies: string[] = [];

      // 1. Text overlap check (Supplier/Client Name)
      const nameSimilarity = calculateSimilarity(txPartner, invPartner);
      const labelSimilarity = calculateSimilarity(txLabel, invPartner);
      const bestNameMatch = Math.max(nameSimilarity, labelSimilarity);

      if (bestNameMatch > 0.8) {
        score += 40;
      } else if (bestNameMatch > 0.4) {
        score += 20;
      } else {
        discrepancies.push('Nom du tiers ne correspond pas étroitement.');
      }

      // 2. Reference Match Check
      if (invRef && txLabel.includes(invRef)) {
        score += 30;
      } else {
        discrepancies.push('Référence de facture manquante dans le libellé bancaire.');
      }

      // 3. Amount Matching check
      const amtDiff = Math.abs(txAmtAbs - invAmtAbs);
      let action: 'exact' | 'partial' | 'review' = 'review';

      if (amtDiff < 0.1) {
        score += 30;
        action = 'exact';
      } else if (txAmtAbs < invAmtAbs) {
        // Partial payment
        score += 15;
        action = 'partial';
        discrepancies.push(
          `Paiement partiel détecté: ${txAmtAbs.toFixed(2)} DH payés sur ${invAmtAbs.toFixed(2)} DH dus.`
        );
      } else {
        // Transaction exceeds invoice remaining amount
        action = 'review';
        discrepancies.push(
          `Surplus détecté: Le montant payé (${txAmtAbs.toFixed(2)} DH) dépasse le solde dû (${invAmtAbs.toFixed(2)} DH).`
        );
      }

      // 4. Date Proximity Check (15 days window)
      const txDateObj = new Date(transaction.date);
      const invDateObj = new Date(invoice.date);
      if (!isNaN(txDateObj.getTime()) && !isNaN(invDateObj.getTime())) {
        const daysDiff =
          Math.abs(txDateObj.getTime() - invDateObj.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff <= 5) {
          score += 10;
        } else if (daysDiff <= 15) {
          score += 5;
        } else {
          discrepancies.push(`Écart de date significatif (${Math.round(daysDiff)} jours d'écart).`);
        }
      }

      // Build suggestion if score passes minimum relevance threshold
      if (score >= 15) {
        suggestions.push({
          invoice,
          score: Math.min(100, score),
          discrepancies,
          reconciliationAction: action,
        });
      }
    }

    // Sort by descending match score
    return suggestions.sort((a, b) => b.score - a.score);
  }
}

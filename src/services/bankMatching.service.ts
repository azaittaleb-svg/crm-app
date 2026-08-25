import { Decimal } from 'decimal.js';

export interface BankTransaction {
  id: string;
  date: string;
  label: string;
  partnerName: string;
  amount: number;
  isReconciled: boolean;
}

export interface UnpaidDocument {
  id: string;
  refId: string;
  type: 'Vente' | 'Achat';
  clientOrSupplierName: string;
  amount: number; // Remaining amount to pay
  date: string;
  totalAmount: number;
  amountPaid: number;
}

export interface MatchSuggestion {
  invoice: UnpaidDocument;
  otherTransactions: BankTransaction[];
  score: number;
}

export interface MultiInvoiceMatchSuggestion {
  invoices: UnpaidDocument[];
  score: number;
}

export class BankMatchingService {
  /**
   * Evaluates if name1 and name2 resemble the same partner, stripping standard corporate suffixes and accents.
   */
  public static isSamePartner(name1: string, name2: string): boolean {
    if (!name1 || !name2) return false;

    const clean = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove accents
        .replace(/[^a-z0-9]/g, ' ') // keep only alphanumeric
        .replace(/\b(sarl|ste|sa|eurl|sasu|cie|etablissement|mr|mme|dr|client|fournisseur)\b/g, '')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0);

    const words1 = clean(name1);
    const words2 = clean(name2);

    if (words1.length === 0 || words2.length === 0) {
      const n1 = name1.toLowerCase().trim();
      const n2 = name2.toLowerCase().trim();
      return n1.includes(n2) || n2.includes(n1);
    }

    return words1.some((w) => words2.includes(w)) || words2.some((w) => words1.includes(w));
  }

  /**
   * Computes a text similarity match score between transaction label/partner and document partner.
   */
  public static calculateTextSimilarityScore(
    txLabel: string,
    txPartner: string,
    docPartner: string
  ): number {
    if (!docPartner) return 0;

    const cleanString = (str: string) => {
      return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(
          /\b(sarl|ste|sa|eurl|sasu|cie|etablissement|mr|mme|dr|client|fournisseur|virement|en|faveur|de|pour|facture|fac|reglement|versement|paiement|cheque|remise|prlv|prelevement|bancaire)\b/g,
          ' '
        )
        .trim()
        .split(/\s+/)
        .filter((word) => word.length >= 2);
    };

    const docWords = cleanString(docPartner);
    const txPartnerWords = cleanString(txPartner || '');
    const txLabelWords = cleanString(txLabel || '');

    if (docWords.length === 0) return 0;

    let score = 0;

    const normDocPartner = docPartner.toLowerCase().trim();
    const normTxPartner = (txPartner || '').toLowerCase().trim();
    const normTxLabel = (txLabel || '').toLowerCase().trim();

    // Exact partner match bonus
    if (normTxPartner && normDocPartner === normTxPartner) {
      score += 150;
    }

    // Substring match bonus
    if (
      normTxPartner &&
      (normTxPartner.includes(normDocPartner) || normDocPartner.includes(normTxPartner))
    ) {
      score += 100;
    }

    // Label mentions partner bonus
    if (normTxLabel && normTxLabel.includes(normDocPartner)) {
      score += 120;
    }

    // Word-by-word overlaps
    let matchingWordsCount = 0;
    docWords.forEach((dw) => {
      if (txPartnerWords.includes(dw) || txLabelWords.includes(dw)) {
        matchingWordsCount++;
      }
    });

    score += matchingWordsCount * 30;
    return score;
  }

  /**
   * Search for optimal single invoice match with up to 2 other pending transactions.
   */
  public static findBestSingleInvoiceMultiTxMatch(
    currentTx: BankTransaction,
    unreconciledTxs: BankTransaction[],
    unpaidDocs: UnpaidDocument[],
    tolerance: number = 0.05
  ): MatchSuggestion | null {
    const currentAmtAbs = Math.abs(currentTx.amount);
    const currentLabel = currentTx.label || '';
    const currentPartner = currentTx.partnerName || '';

    let bestSuggestion: MatchSuggestion | null = null;

    // Filter unreconciled transactions to match the same direction/sign as currentTx
    const matchingDirTxs = unreconciledTxs.filter(
      (t) =>
        t.id !== currentTx.id &&
        !t.isReconciled &&
        (currentTx.amount > 0 ? t.amount > 0 : t.amount < 0)
    );

    for (const docItem of unpaidDocs) {
      const docRemainingAbs = Math.abs(docItem.amount);
      const docName = docItem.clientOrSupplierName;

      // Base similarity score
      const baseScore = this.calculateTextSimilarityScore(currentLabel, currentPartner, docName);

      // Scenario 1: Current Tx + 1 Other Tx = 1 Invoice
      for (const otherTx of matchingDirTxs) {
        const otherAmtAbs = Math.abs(otherTx.amount);
        const diff = Math.abs(currentAmtAbs + otherAmtAbs - docRemainingAbs);

        if (diff < tolerance) {
          const otherScore = this.calculateTextSimilarityScore(
            otherTx.label || '',
            otherTx.partnerName || '',
            docName
          );
          const totalScore = baseScore + otherScore;

          if (!bestSuggestion || totalScore > bestSuggestion.score) {
            bestSuggestion = {
              invoice: docItem,
              otherTransactions: [otherTx],
              score: totalScore,
            };
          }
        }
      }

      // Scenario 2: Current Tx + 2 Other Txs = 1 Invoice
      for (let i = 0; i < matchingDirTxs.length; i++) {
        for (let j = i + 1; j < matchingDirTxs.length; j++) {
          const sumAmt =
            currentAmtAbs + Math.abs(matchingDirTxs[i].amount) + Math.abs(matchingDirTxs[j].amount);
          const diff = Math.abs(sumAmt - docRemainingAbs);

          if (diff < tolerance) {
            const scoreI = this.calculateTextSimilarityScore(
              matchingDirTxs[i].label || '',
              matchingDirTxs[i].partnerName || '',
              docName
            );
            const scoreJ = this.calculateTextSimilarityScore(
              matchingDirTxs[j].label || '',
              matchingDirTxs[j].partnerName || '',
              docName
            );
            const totalScore = baseScore + scoreI + scoreJ;

            if (!bestSuggestion || totalScore > bestSuggestion.score) {
              bestSuggestion = {
                invoice: docItem,
                otherTransactions: [matchingDirTxs[i], matchingDirTxs[j]],
                score: totalScore,
              };
            }
          }
        }
      }
    }

    return bestSuggestion;
  }

  /**
   * Search for optimal 1 Transaction to Multi-Invoices matching combinations.
   */
  public static findBestSingleTxMultiInvoiceMatch(
    currentTx: BankTransaction,
    unpaidDocs: UnpaidDocument[],
    tolerance: number = 0.05
  ): MultiInvoiceMatchSuggestion | null {
    const currentAmtAbs = Math.abs(currentTx.amount);
    const txLabel = currentTx.label || '';
    const txPartner = currentTx.partnerName || '';

    // Filter documents to match the transaction type (Vente for positive, Achat for negative)
    const combinationList = unpaidDocs.filter((d) => {
      if (currentTx.amount > 0) return d.type === 'Vente';
      return d.type === 'Achat';
    });

    let bestMultiInvoices: MultiInvoiceMatchSuggestion | null = null;

    // Check combinations of 2 invoices
    for (let i = 0; i < combinationList.length; i++) {
      for (let j = i + 1; j < combinationList.length; j++) {
        const combinedInvsSum =
          Math.abs(combinationList[i].amount) + Math.abs(combinationList[j].amount);
        const diff = Math.abs(combinedInvsSum - currentAmtAbs);

        if (diff < tolerance) {
          const scoreI = this.calculateTextSimilarityScore(
            txLabel,
            txPartner,
            combinationList[i].clientOrSupplierName
          );
          const scoreJ = this.calculateTextSimilarityScore(
            txLabel,
            txPartner,
            combinationList[j].clientOrSupplierName
          );
          const totalScore = scoreI + scoreJ;

          if (!bestMultiInvoices || totalScore > bestMultiInvoices.score) {
            bestMultiInvoices = {
              invoices: [combinationList[i], combinationList[j]],
              score: totalScore,
            };
          }
        }
      }
    }

    // Check combinations of 3 invoices (if 2 didn't yield a direct match)
    if (!bestMultiInvoices) {
      for (let i = 0; i < combinationList.length; i++) {
        for (let j = i + 1; j < combinationList.length; j++) {
          for (let k = j + 1; k < combinationList.length; k++) {
            const combinedInvsSum =
              Math.abs(combinationList[i].amount) +
              Math.abs(combinationList[j].amount) +
              Math.abs(combinationList[k].amount);
            const diff = Math.abs(combinedInvsSum - currentAmtAbs);

            if (diff < tolerance) {
              const scoreI = this.calculateTextSimilarityScore(
                txLabel,
                txPartner,
                combinationList[i].clientOrSupplierName
              );
              const scoreJ = this.calculateTextSimilarityScore(
                txLabel,
                txPartner,
                combinationList[j].clientOrSupplierName
              );
              const scoreK = this.calculateTextSimilarityScore(
                txLabel,
                txPartner,
                combinationList[k].clientOrSupplierName
              );
              const totalScore = scoreI + scoreJ + scoreK;

              if (!bestMultiInvoices || totalScore > bestMultiInvoices.score) {
                bestMultiInvoices = {
                  invoices: [combinationList[i], combinationList[j], combinationList[k]],
                  score: totalScore,
                };
              }
            }
          }
        }
      }
    }

    return bestMultiInvoices;
  }
}

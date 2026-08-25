import { Decimal } from 'decimal.js';

export interface InvoiceItem {
  type?: 'product' | 'section' | 'note';
  price?: number;
  unitPrice?: number;
  quantity: number;
  taxRate?: number; // e.g. 20 or 14 or 10 or 7
}

export class AccountingService {
  /**
   * Safely converts any input into a Decimal with 2 decimal rounding.
   */
  public static toDecimal(val: number | string | undefined | null): Decimal {
    if (val === undefined || val === null || isNaN(Number(val))) {
      return new Decimal(0);
    }
    return new Decimal(val).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  /**
   * Safely rounds any number to exactly 2 decimal places.
   */
  public static round(amount: number): number {
    return this.toDecimal(amount).toNumber();
  }

  /**
   * Formats a number to the Moroccan Dirham format: e.g. 1 250,00 DH
   */
  public static formatDH(amount: number | string | undefined | null): string {
    const decVal = this.toDecimal(amount);
    const numStr = decVal.toFixed(2);
    const parts = numStr.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${parts.join(',')} DH`;
  }

  /**
   * Calculates subtotal (HT) from a list of invoice/devis items.
   */
  public static calculateSubtotal(items: InvoiceItem[]): number {
    let totalHT = new Decimal(0);
    for (const item of items) {
      if (item.type && item.type !== 'product') continue;
      const price = new Decimal(item.price !== undefined ? item.price : item.unitPrice || 0);
      const qty = new Decimal(item.quantity || 0);
      totalHT = totalHT.plus(price.times(qty));
    }
    return totalHT.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  }

  /**
   * Calculates the TVA amount from subtotal and global VAT percentage (e.g. 20 for 20%).
   */
  public static calculateTvaAmount(subtotal: number, taxRateGlobal: number): number {
    const sub = this.toDecimal(subtotal);
    const rate = this.toDecimal(taxRateGlobal).div(100);
    return sub.times(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  }

  /**
   * Calculates total TTC (HT + TVA).
   */
  public static calculateTotalTTC(subtotal: number, tvaAmount: number): number {
    const sub = this.toDecimal(subtotal);
    const tva = this.toDecimal(tvaAmount);
    return sub.plus(tva).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  }

  /**
   * Computes comprehensive document totals including global tax rates and custom discounts.
   */
  public static calculateDocumentTotals(
    items: InvoiceItem[],
    taxRateGlobal: number,
    discountPercentage: number = 0
  ) {
    const subtotal = this.toDecimal(this.calculateSubtotal(items));

    // Apply discount if any
    let discountedSubtotal = subtotal;
    if (discountPercentage > 0) {
      const discountMult = new Decimal(1).minus(this.toDecimal(discountPercentage).div(100));
      discountedSubtotal = subtotal.times(discountMult);
    }

    const tvaAmount = discountedSubtotal.times(this.toDecimal(taxRateGlobal).div(100));
    const totalTTC = discountedSubtotal.plus(tvaAmount);

    return {
      subtotal: subtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      discountedSubtotal: discountedSubtotal.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      tvaAmount: tvaAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
      total: totalTTC.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
    };
  }

  /**
   * Calculates the remaining amount to be paid (reste à payer) with cent tolerance.
   */
  public static calculateRemainingAmount(total: number, amountPaid: number): number {
    const tot = this.toDecimal(total);
    const paid = this.toDecimal(amountPaid);
    const remaining = tot.minus(paid);
    if (remaining.abs().lessThan(0.05)) {
      return 0;
    }
    return remaining.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
  }

  /**
   * Validates if a document status is transitionable according to our business rules.
   * Allowed transitions:
   * - 'Brouillon' -> 'Valide' (or 'Validée')
   * - 'Brouillon' -> 'Annulée'
   * - 'Valide' (or 'Validée') -> 'Brouillon' (Reset to draft)
   * - 'Valide' (or 'Validée') -> 'Annulée'
   */
  public static isValidStatusTransition(currentStatus: string, targetStatus: string): boolean {
    const cur = currentStatus.toLowerCase();
    const tar = targetStatus.toLowerCase();

    if (cur === tar) return true;

    if (cur === 'brouillon') {
      return tar === 'valide' || tar === 'validée' || tar === 'annulée';
    }

    if (cur === 'valide' || cur === 'validée') {
      return tar === 'brouillon' || tar === 'annulée' || tar === 'payée';
    }

    if (cur === 'annulée') {
      return tar === 'brouillon';
    }

    return false;
  }
}

import { Decimal } from 'decimal.js';

export interface SupplierData {
  id?: string;
  name: string;
  ice?: string;
  email?: string;
  phone?: string;
  adresse?: string;
  ville?: string;
  ownerId: string;
}

export interface SupplierPurchase {
  id: string;
  type?: string;
  status?: string;
  total?: number;
  amountPaid?: number;
  paymentStatus?: string;
}

export class SupplierService {
  /**
   * Validates standard supplier details before database write.
   */
  public static validate(supplier: Partial<SupplierData>): { isValid: boolean; error?: string } {
    if (!supplier.name || supplier.name.trim() === '') {
      return { isValid: false, error: 'Le nom du fournisseur est obligatoire.' };
    }

    if (supplier.ice && supplier.ice.trim() !== '') {
      const cleanIce = supplier.ice.trim();
      // Moroccan ICE is 15 digits
      const isNum = /^\d+$/.test(cleanIce);
      if (cleanIce.length !== 15 || !isNum) {
        return {
          isValid: false,
          error: "L'ICE marocain du fournisseur doit comporter exactement 15 chiffres.",
        };
      }
    }

    if (supplier.email && supplier.email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(supplier.email.trim())) {
        return { isValid: false, error: "L'adresse email saisie est invalide." };
      }
    }

    return { isValid: true };
  }

  /**
   * Aggregates financial balances and purchase counts for a supplier.
   */
  public static calculateSupplierStats(purchases: SupplierPurchase[]) {
    // Filter out devis or cancelled documents
    const activePurchases = purchases.filter(
      (p) =>
        p.type?.toLowerCase() !== 'devis' &&
        p.status?.toLowerCase() !== 'annulée' &&
        p.status?.toLowerCase() !== 'annulee'
    );

    let totalPurchases = new Decimal(0);
    let totalPaid = new Decimal(0);

    for (const purch of activePurchases) {
      const total = new Decimal(Math.abs(purch.total || 0));
      totalPurchases = totalPurchases.plus(total);

      if (purch.amountPaid !== undefined) {
        totalPaid = totalPaid.plus(new Decimal(purch.amountPaid || 0));
      } else if (purch.paymentStatus === 'paid') {
        totalPaid = totalPaid.plus(total);
      }
    }

    const outstandingDette = totalPurchases.minus(totalPaid);

    return {
      totalPurchases: totalPurchases.toDecimalPlaces(2).toNumber(),
      totalPaid: totalPaid.toDecimalPlaces(2).toNumber(),
      outstandingDette: outstandingDette.toDecimalPlaces(2).toNumber(),
      purchaseCount: activePurchases.length,
      unpaidPurchaseCount: activePurchases.filter((purch) => {
        const remaining = new Decimal(Math.abs(purch.total || 0)).minus(
          new Decimal(purch.amountPaid || 0)
        );
        return remaining.greaterThan(0.05) && purch.paymentStatus !== 'paid';
      }).length,
    };
  }

  /**
   * Identifies if a supplier name is a potential duplicate.
   */
  public static isDuplicateName(existingNames: string[], nameToCheck: string): boolean {
    const clean = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();

    const target = clean(nameToCheck);
    if (!target) return false;

    return existingNames.some((existing) => clean(existing) === target);
  }
}

import { Decimal } from 'decimal.js';

export interface CustomerData {
  id?: string;
  name: string;
  ice?: string;
  email?: string;
  phone?: string;
  adresse?: string;
  ville?: string;
  ownerId: string;
}

export interface CustomerPurchase {
  id: string;
  type?: string;
  status?: string;
  total?: number;
  amountPaid?: number;
  paymentStatus?: string;
}

export class CustomerService {
  /**
   * Validates standard customer details before database write.
   */
  public static validate(customer: Partial<CustomerData>): { isValid: boolean; error?: string } {
    if (!customer.name || customer.name.trim() === '') {
      return { isValid: false, error: 'Le nom du client est obligatoire.' };
    }

    if (customer.ice && customer.ice.trim() !== '') {
      const cleanIce = customer.ice.trim();
      // Moroccan ICE is 15 digits
      const isNum = /^\d+$/.test(cleanIce);
      if (cleanIce.length !== 15 || !isNum) {
        return { isValid: false, error: "L'ICE marocain doit comporter exactement 15 chiffres." };
      }
    }

    if (customer.email && customer.email.trim() !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customer.email.trim())) {
        return { isValid: false, error: "L'adresse email saisie est invalide." };
      }
    }

    return { isValid: true };
  }

  /**
   * Aggregates financial balances and invoice counts for a customer.
   */
  public static calculateCustomerStats(purchases: CustomerPurchase[], creditNotes: any[] = []) {
    // Filter out devis and cancelled invoices
    const activeInvoices = purchases.filter(
      (p) =>
        p.type?.toLowerCase() !== 'devis' &&
        p.status?.toLowerCase() !== 'annulée' &&
        p.status?.toLowerCase() !== 'annulee'
    );

    let totalSales = new Decimal(0);
    let totalPaid = new Decimal(0);
    let totalDette = new Decimal(0);

    // Map invoices to their remaining amounts before intrinsic avoirs
    const invoiceStats = new Map<
      string,
      { total: Decimal; paid: Decimal; explicitCredit: Decimal; intrinsicAvoir: Decimal }
    >();

    for (const inv of activeInvoices) {
      const total = new Decimal(inv.total || 0);
      let paid = new Decimal(0);

      // Handle custom amount paid or fully paid flag
      if (inv.amountPaid !== undefined) {
        paid = new Decimal(inv.amountPaid || 0);
      } else if (inv.paymentStatus === 'paid' || inv.status === 'Payée') {
        paid = total;
      }

      // Handle explicitly applied credit notes
      const explicitCredit = new Decimal((inv as any).creditNotesTotal || 0);

      invoiceStats.set(inv.id, {
        total,
        paid,
        explicitCredit,
        intrinsicAvoir: new Decimal(0),
      });

      totalSales = totalSales.plus(total);
      totalPaid = totalPaid.plus(paid);
    }

    // Process Credit Notes (Avoirs)
    const validCreditNotes = creditNotes.filter(
      (cn) => cn.status === 'Validé' || cn.status === 'Utilisé'
    );

    let totalCreditNotes = new Decimal(0);
    let totalCreditUsed = new Decimal(0);
    let totalCreditClient = new Decimal(0);

    for (const cn of validCreditNotes) {
      const cnTotal = new Decimal(cn.total || 0);
      const explicitUsed = new Decimal(cn.amountUsed || 0); // Explicitly used on other invoices

      totalCreditNotes = totalCreditNotes.plus(cnTotal);
      totalCreditUsed = totalCreditUsed.plus(explicitUsed);

      // Calculate intrinsic usage: how much this Avoir automatically reduces its parent invoice
      let intrinsicUsed = new Decimal(0);
      if (cn.invoiceId && invoiceStats.has(cn.invoiceId)) {
        const invStats = invoiceStats.get(cn.invoiceId)!;
        // Remaining on invoice before this avoir
        const remainingInv = invStats.total
          .minus(invStats.paid)
          .minus(invStats.explicitCredit)
          .minus(invStats.intrinsicAvoir);

        if (remainingInv.greaterThan(0)) {
          // The avoir covers up to the remaining amount
          intrinsicUsed = Decimal.min(remainingInv, cnTotal);
          invStats.intrinsicAvoir = invStats.intrinsicAvoir.plus(intrinsicUsed);
        }
      }

      // The excess credit that belongs to the client (never negative)
      const excess = Decimal.max(0, cnTotal.minus(intrinsicUsed).minus(explicitUsed));
      if (excess.greaterThan(0)) {
        totalCreditClient = totalCreditClient.plus(excess);
      }
    }

    // Now calculate total debt (Dette Client)
    for (const stats of invoiceStats.values()) {
      const remaining = Decimal.max(
        0,
        stats.total.minus(stats.paid).minus(stats.explicitCredit).minus(stats.intrinsicAvoir)
      );
      if (remaining.greaterThan(0)) {
        totalDette = totalDette.plus(remaining);
      }
    }

    // Backward compatibility for existing outstandingBalance (will be equal to detteClient)
    const outstandingBalance = totalDette;

    return {
      totalSales: totalSales.toDecimalPlaces(2).toNumber(),
      totalPaid: totalPaid.toDecimalPlaces(2).toNumber(),
      outstandingBalance: outstandingBalance.toDecimalPlaces(2).toNumber(),
      totalCreditNotes: totalCreditNotes.toDecimalPlaces(2).toNumber(),
      totalCreditUsed: totalCreditUsed.toDecimalPlaces(2).toNumber(),
      availableCredit: totalCreditNotes.minus(totalCreditUsed).toDecimalPlaces(2).toNumber(),
      
      // New distinct fields
      detteClient: totalDette.toDecimalPlaces(2).toNumber(),
      creditClient: totalCreditClient.toDecimalPlaces(2).toNumber(),
      
      invoiceCount: activeInvoices.length,
      unpaidInvoiceCount: activeInvoices.filter((inv) => {
        const stats = invoiceStats.get(inv.id);
        if (!stats) return false;
        const remaining = stats.total
          .minus(stats.paid)
          .minus(stats.explicitCredit)
          .minus(stats.intrinsicAvoir);
        return remaining.greaterThan(0.05);
      }).length,
    };
  }

  /**
   * Identifies if a customer name is a potential duplicate.
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

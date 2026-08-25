export interface PurchaseBalanceParams {
  total?: number | string;
  amountPaid?: number | string;
  paymentStatus?: string;
  creditNotesTotal?: number | string;
}

export interface PurchaseBalanceResult {
  total: number;
  paid: number;
  credited: number;
  debt: number;
  percentPaid: number;
}

export function calculatePurchaseBalance(purchase: PurchaseBalanceParams): PurchaseBalanceResult {
  const total = Number(purchase.total) || 0;
  const credited = Number(purchase.creditNotesTotal) || 0;
  const paid =
    purchase.amountPaid !== undefined
      ? Number(purchase.amountPaid) || 0
      : purchase.paymentStatus === 'paid'
        ? total
        : 0;

  const debt = Math.max(0, total - paid - credited);
  const percentPaid = total > 0 ? (paid / total) * 100 : 100;

  return { total, paid, credited, debt, percentPaid };
}

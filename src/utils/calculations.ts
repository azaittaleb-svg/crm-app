export interface CalculableItem {
  type?: 'product' | 'section' | 'note';
  price?: number;
  unitPrice?: number;
  quantity: number;
  taxRate?: number;
}

/**
 * Standard rounding helper to prevent IEEE-754 binary floating point issues.
 * Rounds to exactly 2 decimal places.
 */
export const roundTo2Decimals = (num: number): number => {
  return Math.round((num + Number.EPSILON) * 100) / 100;
};

/**
 * Formats a number to the standard Moroccan Dirham currency format (e.g., 1 250,00 DH).
 */
export const formatDH = (amount: number | null | undefined): string => {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return '0,00 DH';
  }
  const rounded = roundTo2Decimals(amount);
  const parts = rounded.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${parts.join(',')} DH`;
};

/**
 * Standard tolerance when matching amounts (5 centimes / 0.05 DH)
 */
export const AMOUNT_TOLERANCE = 0.05;

/**
 * Checks if a document is fully paid based on total and amountPaid with standard tolerance.
 */
export const isFullyPaid = (total: number, amountPaid: number): boolean => {
  return roundTo2Decimals(total) - roundTo2Decimals(amountPaid) <= AMOUNT_TOLERANCE;
};

export const calculateSubtotal = (items: CalculableItem[]): number => {
  const rawSubtotal = items.reduce((acc, item) => {
    if (item.type && item.type !== 'product') return acc;
    const price = item.price !== undefined ? item.price : item.unitPrice || 0;
    return acc + price * item.quantity;
  }, 0);
  return roundTo2Decimals(rawSubtotal);
};

export const calculateTaxAmount = (subtotal: number, taxRateGlobal: number): number => {
  // taxRateGlobal is expected to be a percentage, e.g. 20 for 20%
  const rate = taxRateGlobal > 1 ? taxRateGlobal / 100 : taxRateGlobal;
  return roundTo2Decimals(subtotal * rate);
};

export const calculateTotal = (subtotal: number, taxAmount: number): number => {
  return roundTo2Decimals(subtotal + taxAmount);
};

export const calculateDocumentTotals = (items: CalculableItem[], taxRateGlobal: number) => {
  const subtotal = calculateSubtotal(items);
  const taxAmount = calculateTaxAmount(subtotal, taxRateGlobal);
  const total = calculateTotal(subtotal, taxAmount);
  return {
    subtotal: roundTo2Decimals(subtotal),
    taxAmount: roundTo2Decimals(taxAmount),
    total: roundTo2Decimals(total),
  };
};

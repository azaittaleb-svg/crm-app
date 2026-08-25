export function formatCurrency(amount: number, currency: string = 'MAD'): string {
  return `${amount.toFixed(2)} ${currency}`;
}

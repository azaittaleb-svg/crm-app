export function calculateVat(subtotal: number, rate: number): number {
  return subtotal * (rate / 100);
}

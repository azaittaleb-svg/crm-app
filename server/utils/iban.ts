export function validateIBAN(iban: string): boolean {
  return iban.replace(/\s+/g, '').length >= 15;
}

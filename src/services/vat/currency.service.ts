import { Decimal } from 'decimal.js';

export class VatCurrencyService {
  /**
   * Converts foreign currency amounts to Moroccan Dirhams (MAD) before computing VAT.
   * If the currency is already MAD, returns the original amount (or ensures scale is consistent).
   *
   * @param amountOriginal Amount in the source currency
   * @param currency ISO 3-letter currency code (e.g. "EUR", "USD", "MAD")
   * @param exchangeRate Exchange rate representing MAD per 1 unit of foreign currency (e.g., 10.82)
   * @returns Converted amount in MAD
   */
  public static convertToMAD(
    amountOriginal: Decimal,
    currency: string,
    exchangeRate: Decimal
  ): Decimal {
    const formattedCurrency = currency.trim().toUpperCase();
    if (formattedCurrency === 'MAD') {
      return amountOriginal;
    }

    // Convert to MAD: AmountTTC_Original * exchangeRate
    return amountOriginal.times(exchangeRate);
  }
}

import { Decimal } from 'decimal.js';

export class VatRoundingService {
  /**
   * Standardizes rounding to exactly 2 decimal places using the HALF_UP rounding mode (standard for Moroccan accounting).
   *
   * @param val Decimal input value
   * @returns Rounded Decimal value
   */
  public static round(val: Decimal): Decimal {
    return val.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  /**
   * Helper to initialize a clean Decimal from a string, number, or other Decimal.
   */
  public static toDecimal(val: number | string | Decimal): Decimal {
    return new Decimal(val);
  }
}

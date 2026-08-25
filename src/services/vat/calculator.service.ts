import { Decimal } from 'decimal.js';
import { VatOperation, VatResult, MoroccanVatRate, VatOperationDetail } from './types';
import { VatValidationService } from './validation.service';
import { VatRoundingService } from './rounding.service';
import { VatCurrencyService } from './currency.service';

export class VatCalculatorService {
  /**
   * Main calculation entrypoint. Validates inputs, converts currency,
   * handles credit notes/refunds, groups by rate, and computes net outcomes.
   *
   * @param rawOperations Unfiltered, unvalidated list of payment events
   * @param previousCredit Existing tax credit from previous periods (credit de TVA reportable)
   * @returns Comprehensive VatResult containing breakdowns, totals and itemized details
   */
  public static calculate(
    rawOperations: VatOperation[],
    previousCredit: number | string | Decimal = 0
  ): VatResult {
    // 1. Validate inputs and filter out cancelled/unpaid payments
    const validOperations = VatValidationService.validateBatch(rawOperations);
    const prevCreditDecimal = VatRoundingService.toDecimal(previousCredit);

    // Initialize groupings
    const baseHTByRate: Record<MoroccanVatRate, Decimal> = {
      20: new Decimal(0),
      14: new Decimal(0),
      10: new Decimal(0),
      7: new Decimal(0),
      0: new Decimal(0),
    };

    const vatCollectedByRate: Record<MoroccanVatRate, Decimal> = {
      20: new Decimal(0),
      14: new Decimal(0),
      10: new Decimal(0),
      7: new Decimal(0),
      0: new Decimal(0),
    };

    const vatDeductibleByRate: Record<MoroccanVatRate, Decimal> = {
      20: new Decimal(0),
      14: new Decimal(0),
      10: new Decimal(0),
      7: new Decimal(0),
      0: new Decimal(0),
    };

    let totalBaseHT = new Decimal(0);
    let totalCollected = new Decimal(0);
    let totalDeductible = new Decimal(0);

    const details: VatOperationDetail[] = [];

    // 2. Perform conversions and calculations
    for (const op of validOperations) {
      const isCreditNote = op.documentType === 'credit_note';
      // Credit notes subtract from cumulative monthly sales or purchases (generate negative VAT)
      const signMultiplier = isCreditNote ? new Decimal(-1) : new Decimal(1);

      // Convert original currency to MAD
      const ttcOriginal = op.amountTTC;
      const ttcMadRaw = VatCurrencyService.convertToMAD(ttcOriginal, op.currency, op.exchangeRate);
      const amountTTC_MAD = VatRoundingService.round(ttcMadRaw.times(signMultiplier));

      // Calculate HT and VAT
      let baseHT_MAD: Decimal;
      let vatAmount_MAD: Decimal;

      if (op.vatRate > 0) {
        const rateDecimal = new Decimal(op.vatRate).div(100);
        const htMadRaw = amountTTC_MAD.div(new Decimal(1).plus(rateDecimal));
        baseHT_MAD = VatRoundingService.round(htMadRaw);
        vatAmount_MAD = VatRoundingService.round(amountTTC_MAD.minus(baseHT_MAD));
      } else {
        // Exonerated, outside scope, or 0% rate
        baseHT_MAD = amountTTC_MAD;
        vatAmount_MAD = new Decimal(0);
      }

      // Populate details
      const detail: VatOperationDetail = {
        operationId: op.id,
        paymentId: op.paymentId,
        documentNumber: op.documentNumber,
        documentType: op.documentType,
        nature: op.nature,
        partnerName: op.partnerName,
        paymentDate: op.paymentDate,
        originalCurrency: op.currency,
        exchangeRate: op.exchangeRate,
        amountTTC_Original: ttcOriginal,
        amountTTC_MAD: amountTTC_MAD,
        baseHT_MAD: baseHT_MAD,
        vatAmount_MAD: vatAmount_MAD,
        vatRate: op.vatRate,
        recoverable: op.recoverable,
        isCreditNote: isCreditNote,
      };
      details.push(detail);

      // Accumulate totals and group by rates
      if (op.nature === 'sale') {
        // For Sales: calculate collected VAT
        baseHTByRate[op.vatRate] = baseHTByRate[op.vatRate].plus(baseHT_MAD);
        vatCollectedByRate[op.vatRate] = vatCollectedByRate[op.vatRate].plus(vatAmount_MAD);

        totalBaseHT = totalBaseHT.plus(baseHT_MAD);
        totalCollected = totalCollected.plus(vatAmount_MAD);
      } else {
        // For Purchases: calculate deductible VAT
        baseHTByRate[op.vatRate] = baseHTByRate[op.vatRate].plus(baseHT_MAD);
        totalBaseHT = totalBaseHT.plus(baseHT_MAD);

        if (op.recoverable) {
          vatDeductibleByRate[op.vatRate] = vatDeductibleByRate[op.vatRate].plus(vatAmount_MAD);
          totalDeductible = totalDeductible.plus(vatAmount_MAD);
        }
      }
    }

    // 3. Round aggregations to final 2 decimal places
    const finalTotalBaseHT = VatRoundingService.round(totalBaseHT);
    const finalTotalCollected = VatRoundingService.round(totalCollected);
    const finalTotalDeductible = VatRoundingService.round(totalDeductible);

    // Net VAT = Collected - Deductible - Previous Credit
    const netVATRaw = finalTotalCollected.minus(finalTotalDeductible).minus(prevCreditDecimal);
    const netVAT = VatRoundingService.round(netVATRaw);

    let vatToPay = new Decimal(0);
    let carryForwardCredit = new Decimal(0);

    if (netVAT.isPositive()) {
      vatToPay = netVAT;
    } else if (netVAT.isNegative()) {
      carryForwardCredit = netVAT.abs();
    }

    // Return the completed calculation structure
    return {
      baseHTByRate,
      vatCollectedByRate,
      vatDeductibleByRate,
      totalBaseHT: finalTotalBaseHT,
      totalCollected: finalTotalCollected,
      totalDeductible: finalTotalDeductible,
      previousCredit: prevCreditDecimal,
      netVAT,
      vatToPay,
      carryForwardCredit,
      details,
    };
  }
}

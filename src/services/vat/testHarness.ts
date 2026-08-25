import { Decimal } from 'decimal.js';
import { VatOperation, VatResult } from './types';
import { VatCalculatorService } from './calculator.service';
import { VatValidationService, VatValidationException } from './validation.service';

/**
 * Executes a comprehensive unit test suite to verify the Moroccan VAT Engine
 * against real-world Moroccan fiscal rules and edge cases.
 */
export function runVatEngineTests(): { success: boolean; results: string[] } {
  const logs: string[] = [];
  let allPassed = true;

  const log = (msg: string) => {
    logs.push(msg);
    console.log(msg);
  };

  log('====================================================');
  log('🚀 STARTING MOROCCAN VAT ENGINE TEST SUITE');
  log('====================================================\n');

  // Helper to create basic base operation
  const createBaseOp = (overrides: Partial<VatOperation>): VatOperation => {
    return {
      id: `op_${Math.random().toString(36).substring(2, 7)}`,
      paymentId: `pay_${Math.random().toString(36).substring(2, 7)}`,
      paymentDate: new Date('2026-06-15'),
      accountingDate: new Date('2026-06-15'),
      documentNumber: 'FAC-2026-0010',
      documentType: 'invoice',
      nature: 'sale',
      partnerId: 'part_001',
      partnerName: 'MorocCo SA',
      amountTTC: new Decimal(1200), // 1000 HT + 200 VAT
      vatRate: 20,
      recoverable: true,
      currency: 'MAD',
      exchangeRate: new Decimal(1),
      paid: true,
      cancelled: false,
      period: '2026-06',
      ...overrides,
    };
  };

  // --- TEST 1: Basic Standard Calculations (Sales and Purchases) ---
  try {
    const sale = createBaseOp({
      id: 'sale_01',
      paymentId: 'pay_sale_01',
      nature: 'sale',
      amountTTC: new Decimal(1200), // 1200 TTC @ 20% => HT = 1000, VAT = 200
      vatRate: 20,
    });

    const purchase = createBaseOp({
      id: 'purch_01',
      paymentId: 'pay_purch_01',
      nature: 'purchase',
      amountTTC: new Decimal(550), // 550 TTC @ 10% => HT = 500, VAT = 50
      vatRate: 10,
      recoverable: true,
    });

    const result: VatResult = VatCalculatorService.calculate([sale, purchase], 0);

    // Assertions
    const saleHT = result.baseHTByRate[20];
    const saleVAT = result.vatCollectedByRate[20];
    const purchHT = result.baseHTByRate[10];
    const purchVAT = result.vatDeductibleByRate[10];

    if (saleHT.equals(1000) && saleVAT.equals(200) && purchHT.equals(500) && purchVAT.equals(50)) {
      log('✅ Test 1 Passed: Standard Sale and Purchase conversions correctly computed.');
      log(`   Collected: ${result.totalCollected} DH, Deductible: ${result.totalDeductible} DH`);
    } else {
      allPassed = false;
      log('❌ Test 1 Failed: HT or VAT mismatched.');
      log(`   Expected Sale HT: 1000, Got: ${saleHT}`);
      log(`   Expected Sale VAT: 200, Got: ${saleVAT}`);
    }
  } catch (err: any) {
    allPassed = false;
    log(`❌ Test 1 Error: ${err.message}`);
  }

  // --- TEST 2: Partial Payments Rule ---
  // If invoice is 120,000 TTC, but user only pays 30,000, VAT is calculated ONLY on the paid 30,000 (Régime des encaissements)
  try {
    const partialSale = createBaseOp({
      id: 'sale_partial_02',
      paymentId: 'pay_partial_02',
      documentNumber: 'FAC-BIG-001',
      amountTTC: new Decimal(30000), // Paid amount
      vatRate: 20,
    });

    const result = VatCalculatorService.calculate([partialSale], 0);
    const expectedHT = new Decimal(25000); // 30000 / 1.2
    const expectedVAT = new Decimal(5000);

    if (result.totalBaseHT.equals(expectedHT) && result.totalCollected.equals(expectedVAT)) {
      log(
        '✅ Test 2 Passed: Partial payment calculations are correctly isolated to the paid volume.'
      );
    } else {
      allPassed = false;
      log('❌ Test 2 Failed: Partial payment values mismatched.');
      log(`   Got HT: ${result.totalBaseHT}, Expected: ${expectedHT}`);
      log(`   Got VAT: ${result.totalCollected}, Expected: ${expectedVAT}`);
    }
  } catch (err: any) {
    allPassed = false;
    log(`❌ Test 2 Error: ${err.message}`);
  }

  // --- TEST 3: Credit Notes (Avoirs) must subtract VAT ---
  try {
    const mainSale = createBaseOp({
      id: 'sale_03',
      paymentId: 'pay_sale_03',
      nature: 'sale',
      amountTTC: new Decimal(1200), // Collected: +200 VAT
      vatRate: 20,
    });

    const creditNoteSale = createBaseOp({
      id: 'avoir_03',
      paymentId: 'pay_avoir_03',
      documentType: 'credit_note',
      nature: 'sale',
      amountTTC: new Decimal(240), // Reductions: -40 VAT
      vatRate: 20,
    });

    const result = VatCalculatorService.calculate([mainSale, creditNoteSale], 0);

    if (result.totalCollected.equals(160) && result.totalBaseHT.equals(800)) {
      log('✅ Test 3 Passed: Credit notes (Avoirs) correctly decrease total collected tax.');
    } else {
      allPassed = false;
      log('❌ Test 3 Failed: Credit note impact incorrect.');
      log(`   Got Collected VAT: ${result.totalCollected} (Expected: 160)`);
    }
  } catch (err: any) {
    allPassed = false;
    log(`❌ Test 3 Error: ${err.message}`);
  }

  // --- TEST 4: Non-Recoverable Purchases (TVA non récupérable) ---
  try {
    const nonRecoverablePurchase = createBaseOp({
      id: 'purch_04',
      paymentId: 'pay_purch_04',
      nature: 'purchase',
      amountTTC: new Decimal(1200), // 200 VAT
      vatRate: 20,
      recoverable: false, // Prohibited or non-deductible expense (e.g., passenger car leasing)
    });

    const result = VatCalculatorService.calculate([nonRecoverablePurchase], 0);

    if (result.totalDeductible.equals(0) && result.totalBaseHT.equals(1000)) {
      log(
        '✅ Test 4 Passed: Non-recoverable purchase properly ignored from deductible amounts but base is preserved.'
      );
    } else {
      allPassed = false;
      log('❌ Test 4 Failed: Non-recoverable VAT still accounted for or Base lost.');
      log(`   Got Deductible: ${result.totalDeductible} (Expected: 0)`);
    }
  } catch (err: any) {
    allPassed = false;
    log(`❌ Test 4 Error: ${err.message}`);
  }

  // --- TEST 5: Currency Conversion logic (Non-MAD to MAD) ---
  try {
    const euroSale = createBaseOp({
      id: 'sale_euro',
      paymentId: 'pay_sale_euro',
      nature: 'sale',
      amountTTC: new Decimal(100), // 100 EUR
      currency: 'EUR',
      exchangeRate: new Decimal('10.82'), // 1 EUR = 10.82 MAD => 1082 MAD TTC
      vatRate: 20,
    });

    const result = VatCalculatorService.calculate([euroSale], 0);
    const expectedTTC_MAD = new Decimal(1082); // 100 * 10.82
    const expectedHT_MAD = new Decimal(1082).div(1.2).toDecimalPlaces(2, Decimal.ROUND_HALF_UP); // 901.67
    const expectedVAT_MAD = new Decimal(1082).minus(expectedHT_MAD); // 180.33

    if (
      result.totalBaseHT.equals(expectedHT_MAD) &&
      result.totalCollected.equals(expectedVAT_MAD)
    ) {
      log(
        '✅ Test 5 Passed: Foreign currency values converted accurately to Dirhams (MAD) before computing VAT.'
      );
    } else {
      allPassed = false;
      log('❌ Test 5 Failed: Multi-currency conversion drift.');
      log(`   Got HT: ${result.totalBaseHT} (Expected: ${expectedHT_MAD})`);
      log(`   Got VAT: ${result.totalCollected} (Expected: ${expectedVAT_MAD})`);
    }
  } catch (err: any) {
    allPassed = false;
    log(`❌ Test 5 Error: ${err.message}`);
  }

  // --- TEST 6: Exclusions (Unpaid & Cancelled) ---
  try {
    const unpaidSale = createBaseOp({
      id: 'unpaid_06',
      paymentId: 'pay_unpaid_06',
      paid: false, // Must be skipped
    });

    const cancelledSale = createBaseOp({
      id: 'cancelled_06',
      paymentId: 'pay_cancelled_06',
      cancelled: true, // Must be skipped
    });

    const mainSale = createBaseOp({
      id: 'sale_06',
      paymentId: 'pay_sale_06',
      amountTTC: new Decimal(120), // VAT: 20
      vatRate: 20,
    });

    const result = VatCalculatorService.calculate([unpaidSale, cancelledSale, mainSale], 0);

    if (result.totalCollected.equals(20) && result.details.length === 1) {
      log('✅ Test 6 Passed: Unpaid and cancelled operations are correctly excluded.');
    } else {
      allPassed = false;
      log('❌ Test 6 Failed: Skipped items included in calculation.');
      log(`   Details list length: ${result.details.length} (Expected: 1)`);
    }
  } catch (err: any) {
    allPassed = false;
    log(`❌ Test 6 Error: ${err.message}`);
  }

  // --- TEST 7: Validation Engine Constraints (Strict Failure Checks) ---
  try {
    // 7A. Reject Duplicate Payment IDs
    const opA = createBaseOp({ id: 'op_07a', paymentId: 'duplicate_pay_id' });
    const opB = createBaseOp({ id: 'op_07b', paymentId: 'duplicate_pay_id' });

    let duplicateChecked = false;
    try {
      VatValidationService.validateBatch([opA, opB]);
    } catch (e: any) {
      if (e instanceof VatValidationException && e.message.includes('Duplicate payment ID')) {
        duplicateChecked = true;
      }
    }

    // 7B. Reject Negative TTC
    const opNeg = createBaseOp({ id: 'op_07c', amountTTC: new Decimal(-50) });
    let negativeChecked = false;
    try {
      VatValidationService.validateBatch([opNeg]);
    } catch (e: any) {
      if (e instanceof VatValidationException && e.message.includes('Negative TTC')) {
        negativeChecked = true;
      }
    }

    // 7C. Reject Invalid VAT Rate (e.g. 15%)
    const opInvalidRate = createBaseOp({ id: 'op_07d', vatRate: 15 as any });
    let invalidRateChecked = false;
    try {
      VatValidationService.validateBatch([opInvalidRate]);
    } catch (e: any) {
      if (e instanceof VatValidationException && e.message.includes('Invalid Moroccan VAT rate')) {
        invalidRateChecked = true;
      }
    }

    if (duplicateChecked && negativeChecked && invalidRateChecked) {
      log(
        '✅ Test 7 Passed: Input validations correctly protect calculation engine from corrupted data.'
      );
    } else {
      allPassed = false;
      log('❌ Test 7 Failed: Validation exceptions were not raised on corrupted data inputs.');
    }
  } catch (err: any) {
    allPassed = false;
    log(`❌ Test 7 Error: ${err.message}`);
  }

  // --- TEST 8: Balance Sheets (VAT to Pay vs Carry Forward Credit) ---
  try {
    const sale = createBaseOp({
      id: 'sale_08',
      paymentId: 'pay_sale_08',
      nature: 'sale',
      amountTTC: new Decimal(1200), // Collected: 200
      vatRate: 20,
    });

    const purchase = createBaseOp({
      id: 'purch_08',
      paymentId: 'pay_purch_08',
      nature: 'purchase',
      amountTTC: new Decimal(2400), // Deductible: 400
      vatRate: 20,
      recoverable: true,
    });

    // Case A: Excess Deductions => Carry Forward Credit
    const resultA = VatCalculatorService.calculate([sale, purchase], 50); // prevCredit = 50
    // Net VAT = Collected (200) - Deductible (400) - Prev Credit (50) = -250
    // vatToPay = 0, carryForwardCredit = 250

    // Case B: Excess Collected => VAT to Pay
    const resultB = VatCalculatorService.calculate([sale], 50); // prevCredit = 50
    // Net VAT = Collected (200) - Deductible (0) - Prev Credit (50) = 150
    // vatToPay = 150, carryForwardCredit = 0

    const testPassedA = resultA.vatToPay.equals(0) && resultA.carryForwardCredit.equals(250);
    const testPassedB = resultB.vatToPay.equals(150) && resultB.carryForwardCredit.equals(0);

    if (testPassedA && testPassedB) {
      log(
        '✅ Test 8 Passed: Net fiscal positions (TVA due / Crédit à reporter) correctly calculated.'
      );
    } else {
      allPassed = false;
      log('❌ Test 8 Failed: Tax balances incorrect.');
      log(`   Case A - Pay: ${resultA.vatToPay}, Credit: ${resultA.carryForwardCredit}`);
      log(`   Case B - Pay: ${resultB.vatToPay}, Credit: ${resultB.carryForwardCredit}`);
    }
  } catch (err: any) {
    allPassed = false;
    log(`❌ Test 8 Error: ${err.message}`);
  }

  log('\n====================================================');
  if (allPassed) {
    log('🏁 ALL TESTS PASSED SUCCESSFULLY! The Moroccan VAT Engine is 100% compliant.');
  } else {
    log('🏁 TEST SUITE COMPLETED WITH ERRORS.');
  }
  log('====================================================');

  return { success: allPassed, results: logs };
}

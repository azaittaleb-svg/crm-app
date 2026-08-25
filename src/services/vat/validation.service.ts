import { VatOperation, MoroccanVatRate } from './types';

export class VatValidationException extends Error {
  constructor(
    message: string,
    public readonly operationId?: string
  ) {
    super(message);
    this.name = 'VatValidationException';
  }
}

export class VatValidationService {
  private static readonly VALID_RATES: Set<MoroccanVatRate> = new Set([20, 14, 10, 7, 0]);

  /**
   * Validates a batch of VatOperation records to protect against duplicate paymentIds,
   * corrupted decimals, invalid metadata, and cancelled/unpaid events.
   *
   * @param operations Batch of payments to validate
   * @returns List of active, valid operations ready for calculation
   * @throws VatValidationException if a critical rule is violated (e.g. duplicate payment ID, missing documents)
   */
  public static validateBatch(operations: VatOperation[]): VatOperation[] {
    const validOperations: VatOperation[] = [];
    const processedPaymentIds = new Set<string>();
    const processedOperationIds = new Set<string>();

    for (const op of operations) {
      // 1. Check uniqueness of Operation ID and Payment ID
      if (!op.id) {
        throw new VatValidationException('Missing operation ID.');
      }
      if (processedOperationIds.has(op.id)) {
        throw new VatValidationException(`Duplicate operation ID detected: "${op.id}"`, op.id);
      }
      processedOperationIds.add(op.id);

      if (!op.paymentId) {
        throw new VatValidationException(`Missing paymentId for operation "${op.id}"`, op.id);
      }
      if (processedPaymentIds.has(op.paymentId)) {
        throw new VatValidationException(`Duplicate payment ID detected: "${op.paymentId}"`, op.id);
      }
      processedPaymentIds.add(op.paymentId);

      // 2. Reject missing payment date
      if (!op.paymentDate || !(op.paymentDate instanceof Date) || isNaN(op.paymentDate.getTime())) {
        throw new VatValidationException(
          `Missing or invalid payment date for operation "${op.id}"`,
          op.id
        );
      }

      // 3. Reject missing partner name/ID
      if (!op.partnerId || !op.partnerName || op.partnerName.trim() === '') {
        throw new VatValidationException(
          `Missing partner credentials for operation "${op.id}"`,
          op.id
        );
      }

      // 4. Reject missing document identifiers
      if (!op.documentNumber || op.documentNumber.trim() === '') {
        throw new VatValidationException(
          `Missing document number (invoice/credit_note ref) for operation "${op.id}"`,
          op.id
        );
      }

      // 5. Reject invalid VAT rates
      if (!this.VALID_RATES.has(op.vatRate)) {
        throw new VatValidationException(
          `Invalid Moroccan VAT rate: ${op.vatRate}% for operation "${op.id}"`,
          op.id
        );
      }

      // 6. Reject negative TTC (refunds must be structured via credit_note with positive values, or correct documents)
      if (op.amountTTC.isNegative()) {
        throw new VatValidationException(
          `Negative TTC amount is prohibited. Use credit_notes for offsets: operation "${op.id}"`,
          op.id
        );
      }

      // 7. Ignore cancelled operations
      if (op.cancelled) {
        // Skip silently as requested by domain guidelines
        continue;
      }

      // 8. Ignore unpaid operations
      if (!op.paid) {
        // Skip silently as requested by domain guidelines
        continue;
      }

      validOperations.push(op);
    }

    return validOperations;
  }
}

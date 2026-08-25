import { Decimal } from 'decimal.js';

/**
 * Supported Moroccan VAT Rates
 * - 20%: Standard rate (General)
 * - 14%: Reduced rate (Transport, electricity, etc.)
 * - 10%: Reduced rate (Banking, hospitality, lawyers, etc.)
 * - 7%: Reduced rate (Water, pharmaceutical products, school supplies, etc.)
 * - 0%: Zero-rated (Exporters, certain agricultural equipment)
 * - Exempt: Out of scope or explicitly exempt without credit
 */
export type MoroccanVatRate = 20 | 14 | 10 | 7 | 0;

export type VatDocumentType = 'invoice' | 'credit_note';

export type VatOperationNature = 'sale' | 'purchase';

/**
 * Core interface representing a payment transaction input to the VAT Engine.
 * Following the "Régime des Encaissements", VAT is calculated ONLY when a payment is realized.
 */
export interface VatOperation {
  id: string; // Unique operation / transaction ID
  paymentId: string; // Payment transaction ID (references the bank/cash voucher)
  paymentDate: Date; // Realized date of the payment (exigibilité)
  accountingDate: Date; // Date of accounting entry
  documentNumber: string; // Original invoice or credit note reference (e.g., FV-2026-001)
  documentType: VatDocumentType;
  nature: VatOperationNature;
  partnerId: string; // Client or Supplier ID
  partnerName: string; // Name of the client or supplier
  amountTTC: Decimal; // Payment amount (including taxes) in the original currency
  vatRate: MoroccanVatRate; // The VAT percentage
  recoverable: boolean; // For purchases, indicates if VAT is deductible
  currency: string; // ISO Currency Code (e.g., 'MAD', 'EUR', 'USD')
  exchangeRate: Decimal; // Exchange rate relative to MAD (1 if currency is 'MAD')
  paid: boolean; // Flag indicating if payment is finalized
  cancelled: boolean; // Flag indicating if payment has been cancelled/voided
  period: string; // Reporting period (e.g., '2026-06')
}

/**
 * Breakdown of Base HT, VAT and TTC for a specific rate group
 */
export interface VatRateBreakdown {
  rate: MoroccanVatRate;
  baseHT: Decimal;
  vatAmount: Decimal;
  amountTTC: Decimal;
}

/**
 * Structure of the final VAT calculation result
 */
export interface VatResult {
  baseHTByRate: Record<MoroccanVatRate, Decimal>;
  vatCollectedByRate: Record<MoroccanVatRate, Decimal>;
  vatDeductibleByRate: Record<MoroccanVatRate, Decimal>;

  totalBaseHT: Decimal;
  totalCollected: Decimal;
  totalDeductible: Decimal;

  previousCredit: Decimal;
  netVAT: Decimal; // Total Collected - Total Deductible - Previous Credit
  vatToPay: Decimal; // Max(0, netVAT)
  carryForwardCredit: Decimal; // Max(0, -netVAT)

  details: VatOperationDetail[];
}

/**
 * Detail of each payment used in the calculation with its converted values
 */
export interface VatOperationDetail {
  operationId: string;
  paymentId: string;
  documentNumber: string;
  documentType: VatDocumentType;
  nature: VatOperationNature;
  partnerName: string;
  paymentDate: Date;
  originalCurrency: string;
  exchangeRate: Decimal;
  amountTTC_Original: Decimal;
  amountTTC_MAD: Decimal;
  baseHT_MAD: Decimal;
  vatAmount_MAD: Decimal;
  vatRate: MoroccanVatRate;
  recoverable: boolean;
  isCreditNote: boolean;
}

/**
 * Audit Trail schema for Firestore storage and reproducibility
 */
export interface VatAuditRecord {
  id: string; // Audit record unique ID
  calculationDate: Date;
  calculationPeriod: string; // Period analyzed (e.g., "2026-06")
  calculatedBy: string; // User identifier / email
  paymentIds: string[]; // Payment transaction IDs compiled
  invoiceIds: string[]; // Source invoice/document references included
  creditNotes: string[]; // Credit notes references included
  previousCredit: Decimal; // Credit carried from previous period
  generatedResult: {
    totalCollected: Decimal;
    totalDeductible: Decimal;
    netVAT: Decimal;
    vatToPay: Decimal;
    carryForwardCredit: Decimal;
  };
  rawOutputJson: string; // Full JSON string representation of VatResult for exact replication
}

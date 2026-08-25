import { z } from 'zod';

export const CreditNoteReasonSchema = z.enum([
  'Retour de marchandise',
  'Erreur de facturation',
  'Remise commerciale',
  'Annulation partielle',
  'Annulation totale',
  'Geste commercial',
  'Autre',
]);

export const CreditNoteStatusSchema = z.enum([
  'Brouillon',
  'Validé',
  'Utilisé',
  'Annulé',
]);

export const CreditNoteItemSchema = z.object({
  id: z.string().or(z.number()),
  description: z.string().min(1, 'Description requise'),
  quantity: z.number().min(0.01, 'Quantité doit être > 0'),
  unitPrice: z.number().min(0, 'Prix doit être >= 0'),
  taxRate: z.number().min(0).max(1), // e.g. 0.20
  subtotal: z.number(), // HT
  taxAmount: z.number(), // TVA
  total: z.number(), // TTC
});

export const CreditNoteSchema = z.object({
  ownerId: z.string(),
  clientId: z.string(),
  invoiceId: z.string(),
  invoiceRef: z.string(), // Reference of the original invoice
  refId: z.string().optional(), // Reference of the credit note (e.g. AV-2026-00001), optional until validated
  date: z.date(),
  reason: CreditNoteReasonSchema,
  status: CreditNoteStatusSchema,
  items: z.array(CreditNoteItemSchema).min(1, 'Au moins un article requis'),
  subtotal: z.number(), // Total HT
  taxAmount: z.number(), // Total TVA
  total: z.number(), // Total TTC
  amountUsed: z.number().default(0), // Amount of the credit note already used
  notes: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type CreditNoteReason = z.infer<typeof CreditNoteReasonSchema>;
export type CreditNoteStatus = z.infer<typeof CreditNoteStatusSchema>;
export type CreditNoteItem = z.infer<typeof CreditNoteItemSchema>;
export type CreditNote = z.infer<typeof CreditNoteSchema> & { id: string };

import { z } from 'zod';

export function isValidEmail(email: string): boolean {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
}

// Zod schema for send-email request
export const emailRequestSchema = z.object({
  to: z.string().email({ message: "Format d'adresse email invalide." }).max(255),
  subject: z
    .string()
    .max(150, { message: "Le sujet de l'email ne doit pas dépasser 150 caractères." })
    .optional(),
  body: z
    .string()
    .max(10000, { message: "Le corps de l'email ne doit pas dépasser 10000 caractères." })
    .optional(),
  attachmentName: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9_\-\.\s]+$/, { message: 'Nom de pièce jointe non autorisé.' })
    .optional(),
  pdfBase64: z
    .string()
    .max(15 * 1024 * 1024, { message: 'La taille de la pièce jointe dépasse la limite autorisée.' })
    .optional(),
});

// Zod schema for scan-purchase-pdf request
export const scanPurchasePdfSchema = z.object({
  text: z
    .string()
    .max(50000, { message: 'La taille du texte extrait dépasse la limite autorisée.' }),
  suppliers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().max(255),
      })
    )
    .max(200, { message: 'Le nombre de fournisseurs dépasse la limite autorisée.' }),
});

// Zod schema for extract-items request
export const extractItemsSchema = z.object({
  prompt: z.string().max(20000, { message: 'Le prompt dépasse la taille maximale autorisée.' }),
  exchangeRate: z.number().positive({ message: 'Le taux de change doit être un nombre positif.' }),
});

import { Request, Response, NextFunction } from 'express';
import { EmailService } from '../services/email.service';
import { emailRequestSchema } from '../utils/validator';
import { sanitizeString, sanitizeHtml } from '../utils/sanitizer';
import { logger } from '../utils/logger';

export class EmailController {
  static async sendEmail(req: Request, res: Response, next: NextFunction) {
    try {
      logger.info('Email request received');

      // 1. Zod input validation
      const parseResult = emailRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        logger.warn('Validation failed for sendEmail', parseResult.error.format());
        return res.status(400).json({
          error: 'Données de requête invalides.',
          details: parseResult.error.issues.map((err) => err.message),
        });
      }

      const { to, subject, body, attachmentName, pdfBase64 } = parseResult.data;

      // 2. Input sanitization to prevent XSS/Injections
      const safeTo = sanitizeString(to);
      const safeSubject = subject ? sanitizeString(subject, 150) : undefined;
      const safeBody = body ? sanitizeHtml(body, 10000) : undefined;
      const safeAttachmentName = attachmentName ? sanitizeString(attachmentName, 100) : undefined;

      // Double-check base64 if present - enforce correct prefix or trim to prevent exploit attempts
      let safePdfBase64 = pdfBase64;
      if (safePdfBase64) {
        safePdfBase64 = safePdfBase64.replace(/[^a-zA-Z0-9+/=,;:]/g, ''); // only allow base64 chars
      }

      logger.info(`Envoi d'email à ${safeTo.slice(0, 3)}***@***`);

      await EmailService.sendEmail({
        to: safeTo,
        subject: safeSubject,
        body: safeBody,
        attachmentName: safeAttachmentName,
        pdfBase64: safePdfBase64,
      });

      res.json({ success: true, message: 'Email envoyé avec succès !' });
    } catch (error: any) {
      logger.error('Error in sendEmail controller:', error);
      res.status(500).json({ error: error.message || "Impossible d'envoyer l'email." });
    }
  }
}

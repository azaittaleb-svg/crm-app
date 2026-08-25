import { Request, Response, NextFunction } from 'express';
import { GeminiService } from '../services/gemini.service';
import { scanPurchasePdfSchema, extractItemsSchema } from '../utils/validator';
import { sanitizeString } from '../utils/sanitizer';
import { logger } from '../utils/logger';

export class GeminiController {
  static async scanPurchasePdf(req: Request, res: Response, next: NextFunction) {
    try {
      logger.info('Gemini controller: parsing scanPurchasePdf request...');

      // 1. Validate inputs via Zod
      const parseResult = scanPurchasePdfSchema.safeParse(req.body);
      if (!parseResult.success) {
        logger.warn('Validation failed for scanPurchasePdf', parseResult.error.format());
        return res.status(400).json({
          error: 'Données de requête invalides.',
          details: parseResult.error.issues.map((err) => err.message),
        });
      }

      const { text, suppliers } = parseResult.data;

      // 2. Sanitize inputs (safe string content)
      const safeText = sanitizeString(text);

      const result = await GeminiService.scanPurchasePdf(safeText, suppliers);
      res.json(result);
    } catch (error: any) {
      logger.error('Gemini scan purchase PDF error:', error);
      res.status(500).json({ error: error.message || 'Impossible de numériser le document.' });
    }
  }

  static async extractItems(req: Request, res: Response, next: NextFunction) {
    try {
      logger.info('Gemini controller: parsing extractItems request...');

      // 1. Validate inputs via Zod
      const parseResult = extractItemsSchema.safeParse(req.body);
      if (!parseResult.success) {
        logger.warn('Validation failed for extractItems', parseResult.error.format());
        return res.status(400).json({
          error: 'Données de requête invalides.',
          details: parseResult.error.issues.map((err) => err.message),
        });
      }

      const { prompt, exchangeRate } = parseResult.data;

      // 2. Sanitize inputs
      const safePrompt = sanitizeString(prompt);

      const result = await GeminiService.extractItems(safePrompt, exchangeRate);
      res.json(result);
    } catch (error: any) {
      logger.error('Gemini extract items error:', error);
      res.status(500).json({ error: error.message || "Échec de l'extraction de données." });
    }
  }
}

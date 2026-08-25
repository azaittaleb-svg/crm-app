import { GoogleGenAI, Type } from '@google/genai';
import crypto from 'crypto';
import { geminiConfig } from '../config/gemini';
import { Supplier } from '../types/Supplier';
import { InvoiceScanResult } from '../types/Invoice';
import { ExtractedMotchoResult } from '../types/Gemini';
import { GEMINI_TIMEOUT_MS, MAX_PROMPT_LENGTH } from '../constants/app';
import { logger } from '../utils/logger';
import { OcrService } from './ocr.service';
import { PromptService } from './prompt.service';
import { InvoiceValidationService } from './invoiceValidation.service';

// Simple dynamic memory cache to prevent duplicate processing of identical text inputs
const apiCache = new Map<string, { timestamp: number; response: any }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes cache TTL
const MAX_CACHE_ENTRIES = 500;

export class GeminiService {
  private static getClient(): GoogleGenAI {
    if (!geminiConfig.apiKey) {
      throw new Error(
        "La clé d'API Gemini n'est pas configurée dans les variables d'environnement."
      );
    }
    return new GoogleGenAI({
      apiKey: geminiConfig.apiKey,
      httpOptions: {
        headers: {
          'User-Agent': geminiConfig.userAgent,
        },
      },
    });
  }

  /**
   * Clean expired cache entries and prevent memory leaks.
   */
  private static enforceCacheLimits(): void {
    const now = Date.now();
    for (const [key, val] of apiCache.entries()) {
      if (now - val.timestamp > CACHE_TTL_MS) {
        apiCache.delete(key);
      }
    }
    if (apiCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = apiCache.keys().next().value;
      if (oldestKey !== undefined) {
        apiCache.delete(oldestKey);
      }
    }
  }

  /**
   * Placeholder helper structure to implement easily per-user quotas in future versions.
   */
  private static async checkUserQuota(userId: string = 'default'): Promise<void> {
    logger.info(`Quota check invoked for user: ${userId}`);
  }

  /**
   * Helper to execute a promise with a timeout
   */
  private static withTimeout<T>(promise: Promise<T>, ms: number = GEMINI_TIMEOUT_MS): Promise<T> {
    let timerId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        reject(new Error(`La requête Gemini a expiré après ${ms / 1000} secondes.`));
      }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
    });
  }

  static async scanPurchasePdf(text: string, suppliers: Supplier[], userId?: string): Promise<any> {
    const startTime = Date.now();
    await this.checkUserQuota(userId);

    if (!text || text.trim().length === 0) {
      throw new Error('Le texte extrait de la facture est vide ou invalide.');
    }

    // Clean OCR text input
    const cleanedText = OcrService.cleanText(text);
    let processedText = cleanedText;

    if (processedText.length > MAX_PROMPT_LENGTH) {
      logger.warn(
        `Prompt length ${processedText.length} exceeds limit ${MAX_PROMPT_LENGTH}. Truncating.`
      );
      processedText = processedText.slice(0, MAX_PROMPT_LENGTH);
    }

    // Generate SHA-256 hash of parameters for caching
    const cacheInput = JSON.stringify({ processedText, suppliers: suppliers.map((s) => s.id) });
    const cacheKey = crypto.createHash('sha256').update(cacheInput).digest('hex');

    this.enforceCacheLimits();
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logger.info('Serving scanPurchasePdf response from cache...');
      return cached.response;
    }

    const ai = this.getClient();
    const prompt = PromptService.getScanPurchasePdfPrompt(processedText, suppliers);

    let attempts = 0;
    let responseText = '';

    while (attempts < 2) {
      attempts++;
      try {
        logger.info(`Sending scanPurchasePdf request to Gemini (Attempt ${attempts})...`);
        const apiCall = ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                ref: { type: Type.STRING },
                date: { type: Type.STRING },
                supplierId: { type: Type.STRING },
                applyTax: { type: Type.BOOLEAN },
                taxRate: { type: Type.NUMBER },
                subtotal: { type: Type.NUMBER },
                total: { type: Type.NUMBER },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      description: { type: Type.STRING },
                      quantity: { type: Type.NUMBER },
                      price: { type: Type.NUMBER },
                    },
                    required: ['description', 'quantity', 'price'],
                  },
                },
              },
              required: ['ref', 'date', 'applyTax', 'taxRate', 'subtotal', 'total', 'items'],
            },
          },
        });

        const response = await this.withTimeout(apiCall);
        if (response.text) {
          responseText = response.text;
          // Attempt to validate JSON structure immediately
          JSON.parse(responseText);
          break; // Break the retry loop if parsing is successful
        }
      } catch (error: any) {
        logger.warn(
          `scanPurchasePdf call failed or returned invalid JSON on attempt ${attempts}: ${error.message}`
        );
        if (attempts >= 2) {
          throw new Error(
            "Impossible de lire la réponse structurée retournée par l'intelligence artificielle après tentative de régénération."
          );
        }
      }
    }

    try {
      const parsedData: InvoiceScanResult = JSON.parse(responseText);

      // Normalise output fields using OCR service
      if (parsedData.date) {
        parsedData.date = OcrService.parseStandardDate(parsedData.date);
      }
      if (parsedData.ref) {
        parsedData.ref = parsedData.ref.trim();
      }

      // Mathematical, accounting and supplier validations
      const validationSummary = InvoiceValidationService.validateInvoice(parsedData);

      if (validationSummary.warnings.length > 0) {
        parsedData.validationErrors = validationSummary.warnings;
        logger.warn(
          `OCR Coherence Warning: Detected ${validationSummary.warnings.length} validation issues in scanned PDF`,
          validationSummary.warnings
        );
      }

      // Cost estimation logs
      const durationMs = Date.now() - startTime;
      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      const estimatedOutputTokens = Math.ceil(responseText.length / 4);
      const estimatedCostUsd =
        (estimatedInputTokens * 0.000075) / 1000 + (estimatedOutputTokens * 0.0003) / 1000;

      logger.info(
        `[GEMINI PERFORMANCE] scanPurchasePdf: Duration: ${durationMs}ms | Est. Input Tokens: ${estimatedInputTokens} | Est. Output Tokens: ${estimatedOutputTokens} | Est. Cost: $${estimatedCostUsd.toFixed(6)}`
      );

      // Combined backward-compatible output structure
      const finalResult = {
        // Main invoice fields at top-level for backward compatibility with React client code
        ref: parsedData.ref,
        date: parsedData.date,
        supplierId: parsedData.supplierId,
        applyTax: parsedData.applyTax,
        taxRate: parsedData.taxRate,
        subtotal: parsedData.subtotal,
        total: parsedData.total,
        items: parsedData.items,
        validationErrors: parsedData.validationErrors,

        // Unified Schema matching User requirement
        success: validationSummary.success,
        confidence: validationSummary.confidence,
        data: parsedData,
        warnings: validationSummary.warnings,
        errors: validationSummary.errors,
      };

      // Save to cache
      apiCache.set(cacheKey, { timestamp: Date.now(), response: finalResult });

      return finalResult;
    } catch (parseError) {
      logger.error('Failed to parse Gemini output as JSON', responseText);
      throw new Error(
        "Impossible de lire la réponse structurée retournée par l'intelligence artificielle."
      );
    }
  }

  static async extractItems(
    promptText: string,
    exchangeRate: number,
    userId?: string
  ): Promise<any> {
    const startTime = Date.now();
    await this.checkUserQuota(userId);

    if (!promptText || promptText.trim().length === 0) {
      throw new Error("Le prompt d'extraction de données est vide.");
    }

    // Clean text
    const cleanedPrompt = OcrService.cleanText(promptText);
    let processedPrompt = cleanedPrompt;

    if (processedPrompt.length > MAX_PROMPT_LENGTH) {
      logger.warn(
        `Prompt length ${processedPrompt.length} exceeds limit ${MAX_PROMPT_LENGTH}. Truncating.`
      );
      processedPrompt = processedPrompt.slice(0, MAX_PROMPT_LENGTH);
    }

    const cacheInput = JSON.stringify({ processedPrompt, exchangeRate });
    const cacheKey = crypto.createHash('sha256').update(cacheInput).digest('hex');

    this.enforceCacheLimits();
    const cached = apiCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      logger.info('Serving extractItems response from cache...');
      return cached.response;
    }

    const ai = this.getClient();
    const prompt = PromptService.getExtractItemsPrompt(processedPrompt, exchangeRate);

    const systemInstruction = `You are a precise data extraction expert. Your job is to parse international invoices for the vendor "Motcho" and return a perfectly structured JSON object matching the internal Excel sheet's exact mathematical logic to reach the overall grand total.

# Calculation Logic to Match Excel Exactly
For EVERY line item extracted, you must compute the values strictly following these exact formulas:

1. **price_markup_usd:** Extract or calculate the price after percentage markup as shown in the sheet. 
   *(Note: Calculate based on whether the row uses a 36.5% markup [multiplier 1.365] or 30% markup [multiplier 1.30] by checking the row context).*

2. **total_usd_with_ship:** 
   total_usd_with_ship = price_markup_usd + ship_usd

3. **en_dirham (Unit Cost display row):**
   en_dirham = (total_usd_with_ship * exchange_rate) + diw_dh

4. **qte_total (Line Total Cost in MAD - EXCEL LOGIC):**
   qte_total = en_dirham * qte
   *(Crucial: In this Excel setup, multiplying en_dirham by qte effectively multiplies the diw_dh by the quantity. You must follow this exactly to match the total).*

---

Return ONLY a valid JSON block following the provided schema. No introductory text.
Exchange Rate to use: ${exchangeRate}`;

    let attempts = 0;
    let responseText = '';

    while (attempts < 2) {
      attempts++;
      try {
        logger.info(`Sending extractItems request to Gemini (Attempt ${attempts})...`);
        const apiCall = ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: prompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                vendor_name: { type: Type.STRING },
                taux_change: { type: Type.NUMBER },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      designation: { type: Type.STRING },
                      qte: { type: Type.NUMBER },
                      prix_dollar: { type: Type.NUMBER },
                      price_markup_usd: { type: Type.NUMBER },
                      ship_usd: { type: Type.NUMBER },
                      diw_dh: { type: Type.NUMBER },
                      en_dirham: { type: Type.NUMBER },
                      qte_total: { type: Type.NUMBER },
                    },
                    required: ['designation', 'qte', 'prix_dollar'],
                  },
                },
                grand_total_overall: { type: Type.NUMBER },
              },
            },
          },
        });

        const response = await this.withTimeout(apiCall);
        if (response.text) {
          responseText = response.text;
          JSON.parse(responseText);
          break;
        }
      } catch (error: any) {
        logger.warn(
          `extractItems call failed or returned invalid JSON on attempt ${attempts}: ${error.message}`
        );
        if (attempts >= 2) {
          throw new Error(
            "Impossible de lire la réponse d'extraction structurée de l'IA après tentative de régénération."
          );
        }
      }
    }

    try {
      const parsedResult: ExtractedMotchoResult = JSON.parse(responseText);

      // Perform validation and estimate token sizes
      const durationMs = Date.now() - startTime;
      const estimatedInputTokens = Math.ceil(prompt.length / 4);
      const estimatedOutputTokens = Math.ceil(responseText.length / 4);
      const estimatedCostUsd =
        (estimatedInputTokens * 0.000075) / 1000 + (estimatedOutputTokens * 0.0003) / 1000;

      logger.info(
        `[GEMINI PERFORMANCE] extractItems: Duration: ${durationMs}ms | Est. Input Tokens: ${estimatedInputTokens} | Est. Output Tokens: ${estimatedOutputTokens} | Est. Cost: $${estimatedCostUsd.toFixed(6)}`
      );

      const finalResult = {
        // Main fields at top level for backward compatibility
        vendor_name: parsedResult.vendor_name,
        taux_change: parsedResult.taux_change,
        items: parsedResult.items,
        grand_total_overall: parsedResult.grand_total_overall,

        // Unified Schema
        success: true,
        confidence: 95,
        data: parsedResult,
        warnings: [],
        errors: [],
      };

      apiCache.set(cacheKey, { timestamp: Date.now(), response: finalResult });
      return finalResult;
    } catch (parseError) {
      logger.error('Failed to parse Gemini output as JSON for extractItems', responseText);
      throw new Error("Impossible de lire la réponse structurée d'extraction de l'IA.");
    }
  }
}

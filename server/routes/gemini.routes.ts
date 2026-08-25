import { Router } from 'express';
import { GeminiController } from '../controllers/gemini.controller';
import { geminiRateLimiter } from '../middleware/rateLimit';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/scan-purchase-pdf', authMiddleware, geminiRateLimiter, GeminiController.scanPurchasePdf);
router.post('/extract-items', authMiddleware, geminiRateLimiter, GeminiController.extractItems);

export default router;

import { Router } from 'express';
import { EmailController } from '../controllers/email.controller';
import { emailRateLimiter } from '../middleware/rateLimit';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.post('/send-email', authMiddleware, emailRateLimiter, EmailController.sendEmail);

export default router;

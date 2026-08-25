import rateLimit from 'express-rate-limit';
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_PUBLIC,
  RATE_LIMIT_MAX_GEMINI,
  RATE_LIMIT_MAX_EMAIL,
} from '../constants/app';

// General rate limiter for fallback / public routes
export const publicRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_PUBLIC,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Trop de requêtes effectuées depuis cette IP, veuillez réessayer plus tard.',
  },
});

// Stricter rate limiter for heavy AI/Gemini endpoints
export const geminiRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_GEMINI,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "Limite de requêtes d'analyse par intelligence artificielle atteinte. Veuillez patienter quelques minutes.",
  },
});

// Stricter rate limiter for SMTP/email sending to prevent spamming
export const emailRateLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_EMAIL,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error:
      "Limite d'envois d'emails atteinte. Veuillez patienter avant d'effectuer de nouveaux envois.",
  },
});

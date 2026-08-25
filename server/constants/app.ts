export const PORT = 3000;
export const MAX_FILE_SIZE = '10mb';
export const DEFAULT_HOST = '0.0.0.0';

// Rate limiting windows and limits
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_PUBLIC = 100; // 100 requests per window
export const RATE_LIMIT_MAX_AUTH = 300;
export const RATE_LIMIT_MAX_OCR = 10;
export const RATE_LIMIT_MAX_GEMINI = 15;
export const RATE_LIMIT_MAX_EMAIL = 10;

// PDF Upload settings
export const ALLOWED_MIME_TYPES = ['application/pdf'];
export const ALLOWED_EXTENSIONS = ['.pdf'];
export const MAX_PDF_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// Gemini AI thresholds
export const MAX_PROMPT_LENGTH = 10000; // characters
export const GEMINI_TIMEOUT_MS = 30000; // 30 seconds

// CORS domains
export const ALLOWED_CORS_ORIGINS = process.env.ALLOWED_CORS_ORIGINS
  ? process.env.ALLOWED_CORS_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

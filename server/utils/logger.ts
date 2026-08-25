/**
 * Centralized safe logger utility that filters out sensitive information
 * such as passwords, API keys, tokens, and overly large base64 contents.
 */

const SENSITIVE_KEYS = [
  'password',
  'pass',
  'secret',
  'token',
  'apikey',
  'api_key',
  'key',
  'firebase',
  'pdfbase64',
  'pdf_base64',
  'base64',
];

function maskSensitiveData(val: any): any {
  if (val === null || val === undefined) return val;

  if (val instanceof Error) {
    return {
      name: val.name,
      message: val.message,
      stack: val.stack,
      ...(val.cause ? { cause: maskSensitiveData(val.cause) } : {}),
    };
  }

  if (typeof val === 'string') {
    // Check if it looks like a base64 string
    if (
      val.length > 200 &&
      (val.includes(';base64,') || /^[a-zA-Z0-9+/=]+$/.test(val.slice(0, 50)))
    ) {
      return `[BASE64_DATA: ${val.length} chars]`;
    }
    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => maskSensitiveData(item));
  }

  if (typeof val === 'object') {
    const masked: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      const lowerKey = k.toLowerCase();
      if (SENSITIVE_KEYS.some((sk) => lowerKey.includes(sk))) {
        masked[k] = '[REDACTED_SENSITIVE_DATA]';
      } else {
        masked[k] = maskSensitiveData(v);
      }
    }
    return masked;
  }

  return val;
}

export const logger = {
  info: (message: string, ...args: any[]) => {
    const safeArgs = args.map((arg) => maskSensitiveData(arg));
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`, ...safeArgs);
  },
  warn: (message: string, ...args: any[]) => {
    const safeArgs = args.map((arg) => maskSensitiveData(arg));
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...safeArgs);
  },
  error: (message: string, ...args: any[]) => {
    const safeArgs = args.map((arg) => maskSensitiveData(arg));
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...safeArgs);
  },
  debug: (message: string, ...args: any[]) => {
    if (process.env.NODE_ENV !== 'production') {
      const safeArgs = args.map((arg) => maskSensitiveData(arg));
      console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...safeArgs);
    }
  },
};

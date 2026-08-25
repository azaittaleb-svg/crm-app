import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { appConfig } from '../config/app';

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  const isDev = appConfig.nodeEnv !== 'production';

  logger.error(`[EXPRESS ERRORHANDLER] Error in ${req.method} ${req.url}:`, err);

  const status = err.status || 500;

  // Safe user message
  let message = 'Une erreur interne du serveur est survenue.';

  if (err.expose || status < 500 || isDev) {
    message = err.message || message;
  }

  // Sanitize stack trace or internal details for production
  const errorResponse: { error: string; details?: any; stack?: string } = {
    error: message,
  };

  if (isDev) {
    errorResponse.details = err.details || null;
    errorResponse.stack = err.stack;
  }

  res.status(status).json(errorResponse);
}

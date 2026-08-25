import { Request, Response, NextFunction } from 'express';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { logger } from '../utils/logger';
import { appConfig } from '../config/app';

// Initialize firebase-admin if not already initialized
try {
  if (getApps().length === 0) {
    initializeApp({
      projectId: 'workflow-498809',
    });
  }
} catch (error) {
  logger.error('Error initializing firebase-admin in authMiddleware:', error);
}

export interface AuthenticatedRequest extends Request {
  user?: DecodedIdToken;
}

export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // In development mode, allow requests for developer convenience if unauthenticated
      if (appConfig.nodeEnv !== 'production') {
        return next();
      }
      logger.warn('Auth token missing or malformed');
      return res.status(401).json({ error: 'Accès non autorisé. Token de connexion manquant ou incorrect.' });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decodedToken = await getAuth().verifyIdToken(token);
      req.user = decodedToken;
    } catch (tokenErr: any) {
      if (appConfig.nodeEnv !== 'production') {
        return next();
      }
      throw tokenErr;
    }
    next();
  } catch (error: any) {
    if (appConfig.nodeEnv !== 'production') {
      return next();
    }
    logger.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Accès non autorisé. Session expirée ou jeton invalide.' });
  }
}




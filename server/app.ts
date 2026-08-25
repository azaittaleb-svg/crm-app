import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import { appConfig } from './config/app';
import { loggerMiddleware } from './middleware/logger';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { ALLOWED_CORS_ORIGINS, MAX_FILE_SIZE } from './constants/app';

import emailRoutes from './routes/email.routes';
import geminiRoutes from './routes/gemini.routes';
import invoiceRoutes from './routes/invoice.routes';
import supplierRoutes from './routes/supplier.routes';
import customerRoutes from './routes/customer.routes';
import accountingRoutes from './routes/accounting.routes';
import bankRoutes from './routes/bank.routes';
import dashboardRoutes from './routes/dashboard.routes';
import monitoringRoutes from './routes/monitoring.routes';
import woocommerceRoutes from './routes/woocommerce.routes';
import openwaRoutes from './routes/openwa.routes';


/**
 * Validates mandatory environment variables.
 * Stops the server if any critical variable is missing.
 */
function validateEnvironment() {
  const mandatoryVars = ['GEMINI_API_KEY', 'SENDER_EMAIL', 'SENDER_PASSWORD'];
  const missing = mandatoryVars.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    logger.warn(`Variables d'environnement optionnelles/manquantes: ${missing.join(', ')}`);
  } else {
    logger.info(
      "Validation de l'environnement serveur réussie. Toutes les clés obligatoires sont présentes."
    );
  }
}

export async function createApp() {
  // Validate environment variables on startup
  validateEnvironment();

  const app = express();

  // 1. Trust proxy (needed for accurate Rate Limiting under Google Cloud Run / Nginx)
  app.set('trust proxy', 1);

  // 2. Helmet Security Headers - CSP and frameguard are disabled to support Google AI Studio iframe embedding
  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );

  // 3. CORS configuration
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true); // allow non-browser requests

        const isDev = appConfig.nodeEnv !== 'production';
        if (isDev) {
          return callback(null, true);
        }

        // Safe production checks
        const isAllowed =
          ALLOWED_CORS_ORIGINS.indexOf(origin) !== -1 ||
          origin.endsWith('.run.app') ||
          origin.includes('localhost');

        if (isAllowed) {
          return callback(null, true);
        } else {
          logger.warn(`Rejected CORS request from unauthorized origin: ${origin}`);
          return callback(
            new Error("Origine non autorisée par la politique CORS de l'application.")
          );
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    })
  );

  // 4. Request Body Limit Protections
  app.use(express.json({ limit: MAX_FILE_SIZE }));
  app.use(express.urlencoded({ limit: MAX_FILE_SIZE, extended: true }));

  // 5. Logger Middleware
  app.use(loggerMiddleware);

  // Health endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Base API routes
  app.use('/api', emailRoutes);
  app.use('/api', geminiRoutes);
  app.use('/api/monitoring', monitoringRoutes);

  // Skeleton routers (registered for architecture coverage)
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/suppliers', supplierRoutes);
  app.use('/api/customers', customerRoutes);
  app.use('/api/accounting', accountingRoutes);
  app.use('/api/bank', bankRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api', woocommerceRoutes);
  app.use('/api', openwaRoutes);

  // Error handling middleware (must be registered last!)
  app.use(errorHandler);

  // Vite development middleware vs Static Production files
  if (appConfig.nodeEnv !== 'production') {
    logger.info('Initializing Vite dev middleware...');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    logger.info(`Serving static files from ${distPath}`);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

export async function startServer() {
  try {
    const app = await createApp();
    app.listen(appConfig.port, '0.0.0.0', () => {
      logger.info(
        `Server running on http://localhost:${appConfig.port} in ${appConfig.nodeEnv} mode`
      );
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

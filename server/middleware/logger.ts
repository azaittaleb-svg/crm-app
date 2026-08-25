import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { MonitoringService } from '../services/monitoring.service';

export function loggerMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationMs = diff[0] * 1e3 + diff[1] * 1e-6;
    const memoryUsedMb = process.memoryUsage().heapUsed / 1024 / 1024;

    // Ignore static asset requests or vite requests from flooding performance metrics
    if (
      !req.url.startsWith('/@') &&
      !req.url.startsWith('/node_modules') &&
      !req.url.startsWith('/src') &&
      !req.url.endsWith('.css') &&
      !req.url.endsWith('.ts') &&
      !req.url.endsWith('.tsx') &&
      !req.url.endsWith('.js') &&
      !req.url.endsWith('.ico')
    ) {
      MonitoringService.recordMetric({
        method: req.method,
        url: req.url,
        durationMs,
        statusCode: res.statusCode,
        memoryUsedMb,
      });

      logger.info(
        `${req.method} ${req.url} - Status: ${res.statusCode} - Time: ${durationMs.toFixed(2)}ms - Heap: ${memoryUsedMb.toFixed(2)}MB`
      );
    }
  });

  next();
}

import { Request, Response, NextFunction } from 'express';
import { MonitoringService } from '../services/monitoring.service';
import { CacheService } from '../services/cache.service';
import { logger } from '../utils/logger';

export class MonitoringController {
  public static getMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      const summary = MonitoringService.getMetricsSummary() as any;
      summary.cache = {
        enabled: CacheService.isEnabled(),
        size: CacheService.getSize(),
      };
      res.json(summary);
    } catch (error: any) {
      logger.error('Error retrieving metrics summary', error);
      res.status(500).json({ error: 'Impossible de charger les métriques de performance.' });
    }
  }

  public static clearMetrics(req: Request, res: Response, next: NextFunction) {
    try {
      MonitoringService.clearMetrics();
      res.json({ success: true, message: 'Les métriques de performance ont été réinitialisées.' });
    } catch (error: any) {
      logger.error('Error clearing metrics summary', error);
      res.status(500).json({ error: 'Impossible de réinitialiser les métriques de performance.' });
    }
  }

  public static toggleCache(req: Request, res: Response, next: NextFunction) {
    try {
      const { enabled } = req.body;
      CacheService.setEnabled(!!enabled);
      res.json({ success: true, enabled: CacheService.isEnabled() });
    } catch (error: any) {
      logger.error('Error toggling cache status', error);
      res.status(500).json({ error: "Impossible de modifier l'état du cache." });
    }
  }

  public static flushCache(req: Request, res: Response, next: NextFunction) {
    try {
      CacheService.clear();
      res.json({ success: true, message: 'Le cache global a été entièrement vidé.' });
    } catch (error: any) {
      logger.error('Error flushing cache', error);
      res.status(500).json({ error: 'Impossible de vider le cache.' });
    }
  }
}

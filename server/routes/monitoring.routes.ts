import { Router } from 'express';
import { MonitoringController } from '../controllers/monitoring.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.get('/metrics', MonitoringController.getMetrics);
router.post('/metrics/clear', authMiddleware, MonitoringController.clearMetrics);
router.post('/cache/toggle', authMiddleware, MonitoringController.toggleCache);
router.post('/cache/flush', authMiddleware, MonitoringController.flushCache);

export default router;

import { Request, Response } from 'express';
import { logger } from '../utils/logger';

export interface RequestMetric {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  durationMs: number;
  statusCode: number;
  memoryUsedMb: number;
}

export interface RouteStats {
  route: string;
  method: string;
  count: number;
  avgDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
}

export class MonitoringService {
  private static metricsLog: RequestMetric[] = [];
  private static maxLogSize = 500;
  private static routeAggregates = new Map<
    string,
    { count: number; totalDuration: number; min: number; max: number }
  >();

  /**
   * Records a request metric.
   */
  public static recordMetric(metric: Omit<RequestMetric, 'id' | 'timestamp'>): void {
    const newMetric: RequestMetric = {
      id: Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toISOString(),
      ...metric,
    };

    this.metricsLog.push(newMetric);

    // Limit log size to prevent memory leaks (Sliding Window pattern)
    if (this.metricsLog.length > this.maxLogSize) {
      this.metricsLog.shift();
    }

    // Update route aggregates
    const routeKey = `${metric.method} ${this.normalizeRoute(metric.url)}`;
    const current = this.routeAggregates.get(routeKey) || {
      count: 0,
      totalDuration: 0,
      min: Infinity,
      max: -Infinity,
    };

    current.count += 1;
    current.totalDuration += metric.durationMs;
    current.min = Math.min(current.min, metric.durationMs);
    current.max = Math.max(current.max, metric.durationMs);

    this.routeAggregates.set(routeKey, current);
  }

  /**
   * Helper to strip ID params or search queries from routes to group aggregates cleanly.
   */
  private static normalizeRoute(url: string): string {
    const pathOnly = url.split('?')[0];
    return pathOnly
      .replace(/\/[a-f0-9-]{36}(\/|$)/i, '/:id$1') // Matches standard Firestore UUID format
      .replace(/\/\d+(\/|$)/, '/:id$1'); // Matches numeric IDs
  }

  /**
   * Gets performance metrics summary.
   */
  public static getMetricsSummary() {
    const memoryUsage = process.memoryUsage();

    const aggregates: RouteStats[] = Array.from(this.routeAggregates.entries()).map(
      ([key, value]) => {
        const [method, route] = key.split(' ');
        return {
          route,
          method,
          count: value.count,
          avgDurationMs: Math.round((value.totalDuration / value.count) * 100) / 100,
          minDurationMs: value.min === Infinity ? 0 : Math.round(value.min * 100) / 100,
          maxDurationMs: value.max === -Infinity ? 0 : Math.round(value.max * 100) / 100,
        };
      }
    );

    return {
      system: {
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 100) / 100,
          heapTotalMb: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 100) / 100,
          heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 100) / 100,
          externalMb: Math.round((memoryUsage.external / 1024 / 1024) * 100) / 100,
        },
      },
      aggregates: aggregates.sort((a, b) => b.count - a.count),
      recentLogs: [...this.metricsLog].reverse().slice(0, 50),
    };
  }

  /**
   * Clear metrics.
   */
  public static clearMetrics(): void {
    this.metricsLog = [];
    this.routeAggregates.clear();
    logger.info('Performance monitoring metrics cleared.');
  }
}

import { logger } from '../utils/logger';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CacheService {
  private static store = new Map<string, CacheEntry<any>>();
  private static isCacheEnabled = true;

  /**
   * Toggle the cache globally.
   */
  public static setEnabled(enabled: boolean): void {
    this.isCacheEnabled = enabled;
    logger.info(`Global Cache system set to: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Check if cache is globally enabled.
   */
  public static isEnabled(): boolean {
    return this.isCacheEnabled;
  }

  /**
   * Get a cached value.
   * Signature and behavior modeled on Redis get() command for seamless enterprise integration.
   */
  public static async get<T>(key: string): Promise<T | null> {
    if (!this.isCacheEnabled) return null;

    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      logger.info(`Cache Key EXPIRED: ${key}`);
      this.store.delete(key);
      return null;
    }

    logger.info(`Cache HIT for Key: ${key}`);
    return entry.value as T;
  }

  /**
   * Set a value in the cache with a Time-To-Live (TTL) in milliseconds.
   * Signature and behavior modeled on Redis setex() command for seamless enterprise integration.
   */
  public static async set<T>(key: string, value: T, ttlMs: number = 5 * 60 * 1000): Promise<void> {
    if (!this.isCacheEnabled) return;

    const expiresAt = Date.now() + ttlMs;
    this.store.set(key, { value, expiresAt });

    // Prune cache if it grows too large (Sliding memory protection)
    if (this.store.size > 1000) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
  }

  /**
   * Remove a value from cache.
   * Modeled on Redis del() command.
   */
  public static async delete(key: string): Promise<boolean> {
    const deleted = this.store.delete(key);
    if (deleted) {
      logger.info(`Cache Key DELETED: ${key}`);
    }
    return deleted;
  }

  /**
   * Clear all cached values.
   * Modeled on Redis flushall() command.
   */
  public static async clear(): Promise<void> {
    this.store.clear();
    logger.info('Cache system FLUSHED completely.');
  }

  /**
   * Gets cached entries count.
   */
  public static getSize(): number {
    return this.store.size;
  }
}

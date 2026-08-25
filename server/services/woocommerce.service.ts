import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export class WooCommerceService {
  private url: string;
  private consumerKey: string;
  private consumerSecret: string;
  private cachedOrders: any[] | null = null;
  private lastFetchTime: number = 0;
  private CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes in-memory cache before incremental check
  private productPricesCache: Map<number, number> = new Map();
  private cacheFilePath: string;
  private syncInProgress: boolean = false;

  constructor() {
    this.url = (process.env.WOOCOMMERCE_URL || 'https://www.workstation.ma').replace(/\/+$/, '');
    this.consumerKey = (process.env.WOOCOMMERCE_CK || 'ck_96f37264477901d75558a91b7e7728f05c75e26f').trim();
    this.consumerSecret = (process.env.WOOCOMMERCE_CS || 'cs_39be241cb6b7bd572bef70bd47799e62bb2c59d8').trim();

    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (e) {
        logger.warn('Could not create data directory:', e);
      }
    }
    this.cacheFilePath = path.join(dataDir, 'woocommerce_orders.json');

    // Load persisted orders and price cache from disk on startup
    this.loadDiskCache();

    // Setup 1-hour background auto-sync timer
    setInterval(() => {
      logger.info('Auto-sync timer triggered: Running background incremental WooCommerce sync...');
      this.syncOrdersIncremental().catch((err) =>
        logger.warn('Error during background auto-sync:', err)
      );
    }, 60 * 60 * 1000);
  }

  private loadDiskCache() {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const fileData = fs.readFileSync(this.cacheFilePath, 'utf-8').trim();
        if (!fileData) return;
        const parsed = JSON.parse(fileData);
        if (parsed && Array.isArray(parsed.orders)) {
          this.cachedOrders = parsed.orders;
          this.lastFetchTime = parsed.lastFetchTime || Date.now();
          if (parsed.productPrices && typeof parsed.productPrices === 'object') {
            Object.entries(parsed.productPrices).forEach(([idStr, price]) => {
              this.productPricesCache.set(Number(idStr), Number(price));
            });
          }
          logger.info(`Loaded ${this.cachedOrders?.length || 0} WooCommerce orders from disk cache`);
        }
      }
    } catch (err) {
      logger.warn('Could not load WooCommerce orders disk cache:', err);
    }
  }

  private saveDiskCache() {
    try {
      const pricesObj: Record<number, number> = {};
      this.productPricesCache.forEach((val, key) => {
        pricesObj[key] = val;
      });
      const dataToSave = {
        orders: this.cachedOrders || [],
        lastFetchTime: this.lastFetchTime,
        productPrices: pricesObj,
      };
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(dataToSave, null, 2), 'utf-8');
      logger.info(`Saved ${this.cachedOrders?.length || 0} WooCommerce orders to disk cache`);
    } catch (err) {
      logger.warn('Could not save WooCommerce orders to disk cache:', err);
    }
  }

  async getOrders(forceRefresh: boolean = false) {
    const now = Date.now();

    // Serve from memory cache if very fresh and not forced
    if (!forceRefresh && this.cachedOrders && this.cachedOrders.length > 0 && (now - this.lastFetchTime) < this.CACHE_DURATION_MS) {
      logger.info('Returning WooCommerce orders from server cache');
      return this.cachedOrders;
    }

    if (this.syncInProgress) {
      logger.info('Sync already in progress, returning current cached orders');
      return this.cachedOrders || [];
    }

    this.syncInProgress = true;
    try {
      // If we already have cached orders and not forcing a full reset, do an incremental sync
      if (!forceRefresh && this.cachedOrders && this.cachedOrders.length > 0) {
        await this.syncOrdersIncremental();
      } else {
        // Full sync: Fetch orders starting from January 2026
        await this.syncOrdersFullFromJan2026();
      }
    } catch (error: any) {
      logger.warn('Error during WooCommerce orders sync. Fallback to cached orders.', error);
    } finally {
      this.syncInProgress = false;
    }

    return this.cachedOrders || [];
  }

  /**
   * Fetches orders created/modified incrementally since the latest order in cache
   */
  private async syncOrdersIncremental() {
    try {
      logger.info('Starting incremental WooCommerce orders fetch...');
      let latestDateISO: string | null = null;

      if (this.cachedOrders && this.cachedOrders.length > 0) {
        // Find newest order date
        let latestTimestamp = 0;
        this.cachedOrders.forEach((o) => {
          const dateStr = o.date_created_gmt || o.date_created || o.date_modified_gmt || o.date_modified;
          if (dateStr) {
            const t = new Date(dateStr).getTime();
            if (!isNaN(t) && t > latestTimestamp) {
              latestTimestamp = t;
            }
          }
        });
        if (latestTimestamp > 0) {
          // Go back 1 hour from latest timestamp to catch any overlapping status changes
          latestDateISO = new Date(latestTimestamp - 3600 * 1000).toISOString();
        }
      }

      const newOrders = await this.fetchOrdersFromApi(latestDateISO, 3); // max 3 pages for incremental
      if (newOrders && newOrders.length > 0) {
        logger.info(`Fetched ${newOrders.length} new/updated orders incrementally.`);
        await this.mergeAndEnrichOrders(newOrders);
      } else {
        logger.info('No new orders found during incremental sync.');
      }
      this.lastFetchTime = Date.now();
      this.saveDiskCache();
    } catch (err) {
      logger.warn('Incremental sync failed:', err);
    }
  }

  /**
   * Performs full historical fetch covering all orders starting from January 2026
   */
  private async syncOrdersFullFromJan2026() {
    try {
      logger.info('Starting full historical WooCommerce orders fetch from Jan 2026...');
      const jan2026 = new Date('2026-01-01T00:00:00.000Z');
      const afterISO = jan2026.toISOString();

      const fetchedOrders = await this.fetchOrdersFromApi(afterISO, 15); // fetch up to 15 pages (1500 orders)
      logger.info(`Fetched ${fetchedOrders.length} orders since Jan 2026.`);

      this.cachedOrders = [];
      await this.mergeAndEnrichOrders(fetchedOrders);
      this.lastFetchTime = Date.now();
      this.saveDiskCache();
    } catch (err) {
      logger.warn('Full sync from Jan 2026 failed:', err);
    }
  }

  /**
   * Helper to perform fetch with retry logic for 429 (Too Many Requests) & 5xx errors
   */
  private async fetchWithRetry(url: string, options: RequestInit, retries: number = 3, initialDelayMs: number = 1000): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await fetch(url, options);
        if (res.status === 429 || res.status >= 502) {
          logger.warn(`WooCommerce API returned status ${res.status} for ${url}. Attempt ${attempt + 1}/${retries + 1}`);
          if (attempt < retries) {
            const delay = initialDelayMs * Math.pow(2, attempt);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
        }
        return res;
      } catch (err) {
        if (attempt < retries) {
          const delay = initialDelayMs * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    return fetch(url, options);
  }

  /**
   * Helper to fetch order pages from WooCommerce API
   */
  private async fetchOrdersFromApi(afterISO: string | null = null, maxPages: number = 10): Promise<any[]> {
    const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
    const authQuery = `consumer_key=${encodeURIComponent(this.consumerKey)}&consumer_secret=${encodeURIComponent(this.consumerSecret)}`;

    let allOrders: any[] = [];

    for (let page = 1; page <= maxPages; page++) {
      let endpoint = `${this.url}/wp-json/wc/v3/orders?per_page=100&page=${page}&${authQuery}`;
      if (afterISO) {
        endpoint += `&after=${encodeURIComponent(afterISO)}`;
      }

      let response = await this.fetchWithRetry(endpoint, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 WooCommerce-App'
        }
      });

      if (!response.ok) {
        logger.warn(`WooCommerce API fetch page ${page} returned status ${response.status}`);
        break; // stop pagination if page fails
      }

      const pageOrders = await response.json();
      if (!Array.isArray(pageOrders) || pageOrders.length === 0) {
        break; // no more orders
      }

      allOrders = allOrders.concat(pageOrders);

      // If page has fewer than 100 items, we reached the end
      if (pageOrders.length < 100) {
        break;
      }

      // Small delay between page requests to avoid hitting rate limits
      await new Promise((r) => setTimeout(r, 200));
    }

    return allOrders;
  }

  /**
   * Upserts incoming orders into `cachedOrders` and enriches line items with purchase prices
   */
  private async mergeAndEnrichOrders(incomingOrders: any[]) {
    if (!this.cachedOrders) {
      this.cachedOrders = [];
    }

    const orderMap = new Map<number, any>();
    this.cachedOrders.forEach((o) => orderMap.set(o.id, o));
    incomingOrders.forEach((o) => orderMap.set(o.id, o));

    // Convert back to array sorted newest to oldest
    const mergedList = Array.from(orderMap.values()).sort((a, b) => {
      const da = new Date(a.date_created || a.date_created_gmt || 0).getTime();
      const db = new Date(b.date_created || b.date_created_gmt || 0).getTime();
      return db - da;
    });

    // Enrich line items with purchase prices
    try {
      await this.enrichOrdersPurchasePrices(mergedList);
    } catch (e) {
      logger.warn('Failed to enrich purchase prices during merge:', e);
    }

    this.cachedOrders = mergedList;
  }

  /**
   * Enriches line items with purchase price (VitPOS / ATUM Inventory / WC COG / Meta)
   */
  private async enrichOrdersPurchasePrices(orders: any[]) {
    const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
    const authQuery = `consumer_key=${encodeURIComponent(this.consumerKey)}&consumer_secret=${encodeURIComponent(this.consumerSecret)}`;

    const extractPurchasePrice = (p: any): number => {
      if (!p) return 0;
      const directKeys = [
        'purchase_price', 'atum_purchase_price', '_atum_purchase_price',
        '_purchase_price', 'cost_price', '_cost_price', 'cost', '_cost',
        'purchasePrice', 'costPrice', '_vpos_purchase_price', 'vpos_purchase_price',
        'wc_cog_item_cost', '_wc_cog_item_cost'
      ];
      for (const dk of directKeys) {
        if (p[dk] !== undefined && p[dk] !== null && p[dk] !== '') {
          const val = parseFloat(String(p[dk]));
          if (!isNaN(val) && val > 0) return val;
        }
      }
      if (p.atum_data && typeof p.atum_data === 'object') {
        const atumVal = parseFloat(String(p.atum_data.purchase_price || p.atum_data.purchasePrice || p.atum_data.cost || p.atum_data._atum_purchase_price || ''));
        if (!isNaN(atumVal) && atumVal > 0) return atumVal;
      }
      if (Array.isArray(p.meta_data)) {
        const metaMatch = p.meta_data.find((m: any) => {
          const k = (m.key || m.display_key || '').toLowerCase().trim();
          return (
            k === '_atum_purchase_price' ||
            k === 'atum_purchase_price' ||
            k === '_vpos_purchase_price' ||
            k === 'vpos_purchase_price' ||
            k === '_purchase_price' ||
            k === 'purchase_price' ||
            k === '_cost_price' ||
            k === 'cost_price' ||
            k === '_pos_purchase_price' ||
            k === 'pos_purchase_price' ||
            k === '_wc_cog_item_cost' ||
            k === '_product_cost' ||
            k === '_atum_cost' ||
            k === 'atum_cost' ||
            k === '_cost' ||
            k === 'cost' ||
            k.includes('purchase') ||
            k.includes('cost') ||
            k.includes('vpos') ||
            k.includes('atum')
          );
        });
        if (metaMatch && metaMatch.value !== undefined && metaMatch.value !== null && metaMatch.value !== '') {
          const val = parseFloat(String(metaMatch.value));
          if (!isNaN(val) && val > 0) return val;
        }
      }
      return 0;
    };

    // Collect missing parent IDs and missing variation IDs
    const missingParentIdsSet = new Set<number>();
    const parentIdsWithVariationsNeeded = new Set<number>();
    const variationToParentMap = new Map<number, number>();
    const allMissingIdsSet = new Set<number>();

    orders.forEach((o: any) => {
      (o.line_items || []).forEach((item: any) => {
        const directPrice = extractPurchasePrice(item);
        if (directPrice > 0) {
          item.purchase_price = directPrice;
          return;
        }

        if (item.variation_id && item.variation_id > 0) {
          if (!this.productPricesCache.has(item.variation_id) || this.productPricesCache.get(item.variation_id) === 0) {
            allMissingIdsSet.add(item.variation_id);
            if (item.product_id) {
              parentIdsWithVariationsNeeded.add(item.product_id);
              variationToParentMap.set(item.variation_id, item.product_id);
            }
          }
        }

        if (item.product_id && item.product_id > 0) {
          if (!this.productPricesCache.has(item.product_id) || this.productPricesCache.get(item.product_id) === 0) {
            missingParentIdsSet.add(item.product_id);
            allMissingIdsSet.add(item.product_id);
          }
        }
      });
    });

    // 1. Fetch missing parent products
    const missingParentIds = Array.from(missingParentIdsSet);
    if (missingParentIds.length > 0) {
      for (let i = 0; i < missingParentIds.length; i += 100) {
        const chunk = missingParentIds.slice(i, i + 100);
        const idsList = chunk.join(',');
        const prodEndpoint = `${this.url}/wp-json/wc/v3/products?include=${idsList}&per_page=100&${authQuery}`;

        try {
          const prodRes = await this.fetchWithRetry(prodEndpoint, {
            headers: {
              'Authorization': `Basic ${auth}`,
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WooCommerce-App'
            }
          });

          if (prodRes.ok) {
            const prods = await prodRes.json();
            if (Array.isArray(prods)) {
              prods.forEach((p: any) => {
                const price = extractPurchasePrice(p);
                if (price > 0) {
                  this.productPricesCache.set(p.id, price);
                }
              });
            }
          }
        } catch (err) {
          logger.warn('Failed to fetch parent products for pricing:', err);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    // 2. Fetch variations for parent products that have variation items
    if (parentIdsWithVariationsNeeded.size > 0) {
      for (const parentId of Array.from(parentIdsWithVariationsNeeded)) {
        try {
          const varEndpoint = `${this.url}/wp-json/wc/v3/products/${parentId}/variations?per_page=100&${authQuery}`;
          const varRes = await this.fetchWithRetry(varEndpoint, {
            headers: {
              'Authorization': `Basic ${auth}`,
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WooCommerce-App'
            }
          });
          if (varRes.ok) {
            const vars = await varRes.json();
            if (Array.isArray(vars)) {
              vars.forEach((v: any) => {
                const price = extractPurchasePrice(v);
                if (price > 0) {
                  this.productPricesCache.set(v.id, price);
                }
              });
            }
          }
        } catch (varErr) {
          logger.warn(`Could not fetch variations for parent product ${parentId}:`, varErr);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }

    // 3. Fallback for ATUM Inventory plugin REST API
    const stillMissingIds = Array.from(allMissingIdsSet).filter(
      id => !this.productPricesCache.has(id) || this.productPricesCache.get(id) === 0
    );

    if (stillMissingIds.length > 0) {
      for (let i = 0; i < stillMissingIds.length; i += 100) {
        const chunk = stillMissingIds.slice(i, i + 100);
        const atumIdsList = chunk.join(',');
        try {
          const atumEndpoint = `${this.url}/wp-json/atum/v1/products?include=${atumIdsList}&per_page=100&${authQuery}`;
          const atumRes = await fetch(atumEndpoint, {
            headers: {
              'Authorization': `Basic ${auth}`,
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WooCommerce-App'
            }
          });
          if (atumRes.ok) {
            const atumProds = await atumRes.json();
            if (Array.isArray(atumProds)) {
              atumProds.forEach((p: any) => {
                const price = extractPurchasePrice(p);
                if (price > 0) {
                  this.productPricesCache.set(p.id, price);
                }
              });
            }
          }
        } catch (atumErr) {
          logger.warn('ATUM products API fetch fallback failed:', atumErr);
        }
      }

      const atumMissingVarIds = stillMissingIds.filter(
        id => !this.productPricesCache.has(id) || this.productPricesCache.get(id) === 0
      );
      if (atumMissingVarIds.length > 0) {
        for (let i = 0; i < atumMissingVarIds.length; i += 100) {
          const chunk = atumMissingVarIds.slice(i, i + 100);
          try {
            const atumVarEndpoint = `${this.url}/wp-json/atum/v1/variations?include=${chunk.join(',')}&per_page=100&${authQuery}`;
            const atumVarRes = await fetch(atumVarEndpoint, {
              headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WooCommerce-App'
              }
            });
            if (atumVarRes.ok) {
              const atumVars = await atumVarRes.json();
              if (Array.isArray(atumVars)) {
                atumVars.forEach((v: any) => {
                  const price = extractPurchasePrice(v);
                  if (price > 0) {
                    this.productPricesCache.set(v.id, price);
                  }
                });
              }
            }
          } catch (atumVarErr) {
            logger.warn('ATUM variations API fetch fallback failed:', atumVarErr);
          }
        }
      }
    }

    // Attach purchase_price to line_items
    orders.forEach((o: any) => {
      (o.line_items || []).forEach((item: any) => {
        let purchasePrice = extractPurchasePrice(item);

        if (purchasePrice === 0) {
          if (item.variation_id && this.productPricesCache.has(item.variation_id)) {
            purchasePrice = this.productPricesCache.get(item.variation_id) || 0;
          } else if (item.product_id && this.productPricesCache.has(item.product_id)) {
            purchasePrice = this.productPricesCache.get(item.product_id) || 0;
          }
        }

        item.purchase_price = purchasePrice;
      });
    });
  }

  /**
   * Fetch live stock for a list of WooCommerce products / variations
   */
  async getProductStockList(items: Array<{ product_id: number; variation_id?: number }>) {
    const authQuery = `consumer_key=${this.consumerKey}&consumer_secret=${this.consumerSecret}`;
    const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
    const headers = {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WooCommerce-App'
    };

    const results: Record<string, {
      id: number;
      product_id: number;
      variation_id: number;
      name?: string;
      sku?: string;
      stock_quantity: number | null;
      stock_status: string;
      manage_stock: boolean;
      backorders_allowed?: boolean;
    }> = {};

    if (!items || !Array.isArray(items) || items.length === 0) return results;

    const simpleProductIds: number[] = [];
    const variationItems: Array<{ product_id: number; variation_id: number }> = [];

    items.forEach((it) => {
      const pId = Number(it.product_id) || 0;
      const vId = Number(it.variation_id) || 0;
      if (vId > 0) {
        variationItems.push({ product_id: pId, variation_id: vId });
      } else if (pId > 0) {
        if (!simpleProductIds.includes(pId)) {
          simpleProductIds.push(pId);
        }
      }
    });

    // 1. Fetch simple products in batch
    if (simpleProductIds.length > 0) {
      try {
        const prodUrl = `${this.url}/wp-json/wc/v3/products?include=${simpleProductIds.join(',')}&per_page=100&${authQuery}`;
        const res = await this.fetchWithRetry(prodUrl, { headers });
        if (res.ok) {
          const prods = await res.json();
          if (Array.isArray(prods)) {
            prods.forEach((p: any) => {
              const stockVal = p.stock_quantity !== null && p.stock_quantity !== undefined ? Number(p.stock_quantity) : null;
              const itemInfo = {
                id: p.id,
                product_id: p.id,
                variation_id: 0,
                name: p.name,
                sku: p.sku,
                stock_quantity: stockVal,
                stock_status: p.stock_status || (stockVal !== null && stockVal > 0 ? 'instock' : 'outofstock'),
                manage_stock: !!p.manage_stock,
                backorders_allowed: !!p.backorders_allowed,
              };
              results[`${p.id}_0`] = itemInfo;
              results[`${p.id}`] = itemInfo;
            });
          }
        }
      } catch (err) {
        logger.warn('Error fetching simple products stock:', err);
      }
    }

    // 2. Fetch variations individually or in parallel
    if (variationItems.length > 0) {
      await Promise.all(
        variationItems.map(async ({ product_id, variation_id }) => {
          try {
            let varUrl = `${this.url}/wp-json/wc/v3/products/${product_id}/variations/${variation_id}?${authQuery}`;
            let res = await this.fetchWithRetry(varUrl, { headers });
            if (!res.ok && product_id === 0) {
              varUrl = `${this.url}/wp-json/wc/v3/products/${variation_id}?${authQuery}`;
              res = await this.fetchWithRetry(varUrl, { headers });
            }
            if (res.ok) {
              const v = await res.json();
              const stockVal = v.stock_quantity !== null && v.stock_quantity !== undefined ? Number(v.stock_quantity) : null;
              const itemInfo = {
                id: v.id,
                product_id: product_id || v.parent_id || 0,
                variation_id: variation_id,
                name: v.name,
                sku: v.sku,
                stock_quantity: stockVal,
                stock_status: v.stock_status || (stockVal !== null && stockVal > 0 ? 'instock' : 'outofstock'),
                manage_stock: !!v.manage_stock,
                backorders_allowed: !!v.backorders_allowed,
              };
              results[`${product_id}_${variation_id}`] = itemInfo;
              results[`${variation_id}`] = itemInfo;
            }
          } catch (varErr) {
            logger.warn(`Error fetching variation ${variation_id} stock:`, varErr);
          }
        })
      );
    }

    return results;
  }
}



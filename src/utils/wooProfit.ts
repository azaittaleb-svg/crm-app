/**
 * Utility functions for WooCommerce profit calculations
 */

import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

const COST_OVERRIDDEN_STORAGE_KEY = 'woo_item_cost_overrides_v1';
const WOO_ORDER_NOTES_STORAGE_KEY = 'woo_order_notes_v1';
const WOO_REMINDERS_SENT_STORAGE_KEY = 'woo_reminders_sent_v1';

export type NotificationTemplateType =
  | 'demande_avance'
  | 'confirmation_virement'
  | 'commande_expediee'
  | 'recuperer_agence'
  | 'commande_annulee';

export interface SentLogItem {
  id?: string;
  sentAt: string;
  channel: 'email' | 'whatsapp' | 'mailto' | 'manual';
  avanceAmount?: string;
  templateType?: NotificationTemplateType;
}

export interface ReminderSentInfo {
  sentAt: string;
  channel: 'email' | 'whatsapp' | 'mailto' | 'manual';
  avanceAmount?: string;
  templateType?: NotificationTemplateType;
  history?: SentLogItem[];
}

export function getStoredRemindersSent(): Record<string, ReminderSentInfo> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(WOO_REMINDERS_SENT_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (e) {
    console.warn('Failed to load reminders sent from localStorage:', e);
  }
  return {};
}

export function setStoredRemindersSent(remindersMap: Record<string, ReminderSentInfo>) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(WOO_REMINDERS_SENT_STORAGE_KEY, JSON.stringify(remindersMap));
    }
  } catch (e) {
    console.warn('Failed to set stored reminders sent in localStorage:', e);
  }
}

export function saveReminderSent(
  orderId: string | number,
  channel: 'email' | 'whatsapp' | 'mailto' | 'manual' = 'manual',
  avanceAmount?: string,
  templateType: NotificationTemplateType = 'demande_avance'
) {
  const key = String(orderId);
  const newItem: SentLogItem = {
    id: String(Date.now()),
    sentAt: new Date().toISOString(),
    channel,
    avanceAmount,
    templateType,
  };

  let updatedInfo: ReminderSentInfo = {
    sentAt: newItem.sentAt,
    channel: newItem.channel,
    avanceAmount: newItem.avanceAmount,
    templateType: newItem.templateType,
    history: [newItem],
  };

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const reminders = getStoredRemindersSent();
      const existing = reminders[key];
      const existingHistory = existing?.history || [];

      let historyList = [...existingHistory];
      if (historyList.length === 0 && existing?.sentAt) {
        historyList.push({
          sentAt: existing.sentAt,
          channel: existing.channel,
          avanceAmount: existing.avanceAmount,
          templateType: existing.templateType || 'demande_avance',
        });
      }
      historyList.push(newItem);

      updatedInfo = {
        sentAt: newItem.sentAt,
        channel: newItem.channel,
        avanceAmount: newItem.avanceAmount,
        templateType: newItem.templateType,
        history: historyList,
      };

      reminders[key] = updatedInfo;
      localStorage.setItem(WOO_REMINDERS_SENT_STORAGE_KEY, JSON.stringify(reminders));
    }
  } catch (e) {
    console.warn('Failed to save reminder sent to localStorage:', e);
  }

  try {
    const settingsDocRef = doc(db, 'settings', 'woo_reminders');
    setDoc(settingsDocRef, {
      remindersMap: { [key]: updatedInfo },
      updatedAt: new Date().toISOString(),
    }, { merge: true }).catch((err) => console.warn('Firestore setDoc settings/woo_reminders error:', err));

    const docRef = doc(db, 'woo_reminders_sent', key);
    setDoc(docRef, {
      orderId: key,
      ...updatedInfo,
      updatedAt: new Date().toISOString(),
    }, { merge: true }).catch((err) => console.warn('Firestore setDoc reminder error:', err));
  } catch (err) {
    console.warn('Failed to sync reminder sent to Firestore:', err);
  }
}

export function deleteReminderSent(orderId: string | number) {
  const key = String(orderId);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const reminders = getStoredRemindersSent();
      delete reminders[key];
      localStorage.setItem(WOO_REMINDERS_SENT_STORAGE_KEY, JSON.stringify(reminders));
    }
  } catch (e) {
    console.warn('Failed to delete reminder sent from localStorage:', e);
  }

  try {
    const docRef = doc(db, 'woo_reminders_sent', key);
    deleteDoc(docRef).catch((err) => console.warn('Firestore deleteDoc reminder error:', err));
  } catch (err) {
    console.warn('Failed to delete reminder sent from Firestore:', err);
  }
}

export function getReminderSentInfo(orderId: string | number): ReminderSentInfo | null {
  if (!orderId) return null;
  const reminders = getStoredRemindersSent();
  return reminders[String(orderId)] || null;
}

// Manual Virement Confirmation Storage Utilities
export const WOO_MANUAL_VIREMENT_CONFIRMATIONS_KEY = 'woo_manual_virement_confirmations';

export interface ManualVirementInfo {
  isConfirmed: boolean;
  amount: number;
  confirmedAt: string;
}

export function getManualVirementConfirmations(): Record<string, ManualVirementInfo> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(WOO_MANUAL_VIREMENT_CONFIRMATIONS_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (e) {
    console.warn('Failed to load manual virement confirmations from localStorage:', e);
  }
  return {};
}

export function setStoredManualVirementConfirmations(map: Record<string, ManualVirementInfo>) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(WOO_MANUAL_VIREMENT_CONFIRMATIONS_KEY, JSON.stringify(map));
    }
  } catch (e) {
    console.warn('Failed to set manual virement confirmations in localStorage:', e);
  }
}

export function saveManualVirementConfirmation(orderId: string | number, isConfirmed: boolean, amount: number) {
  const key = String(orderId);
  const info: ManualVirementInfo = {
    isConfirmed,
    amount,
    confirmedAt: new Date().toISOString(),
  };

  try {
    const map = getManualVirementConfirmations();
    if (isConfirmed) {
      map[key] = info;
    } else {
      delete map[key];
    }
    setStoredManualVirementConfirmations(map);
  } catch (e) {
    console.warn('Failed to save manual virement confirmation:', e);
  }

  try {
    const docRef = doc(db, 'woo_manual_virements', key);
    if (isConfirmed) {
      setDoc(docRef, { orderId: key, ...info, updatedAt: new Date().toISOString() }, { merge: true }).catch((err) => console.warn('Firestore setDoc manual virement error:', err));
    } else {
      deleteDoc(docRef).catch((err) => console.warn('Firestore deleteDoc manual virement error:', err));
    }
  } catch (err) {
    console.warn('Failed to sync manual virement confirmation to Firestore:', err);
  }
}

export function getManualVirementConfirmationInfo(orderId: string | number): ManualVirementInfo | null {
  if (!orderId) return null;
  const map = getManualVirementConfirmations();
  return map[String(orderId)] || null;
}

export function getStoredOrderNotes(): Record<string, string> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(WOO_ORDER_NOTES_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (e) {
    console.warn('Failed to load order notes from localStorage:', e);
  }
  return {};
}

export function setStoredOrderNotes(notesMap: Record<string, string>) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.setItem(WOO_ORDER_NOTES_STORAGE_KEY, JSON.stringify(notesMap));
    }
  } catch (e) {
    console.warn('Failed to set stored order notes in localStorage:', e);
  }
}

export function saveOrderNote(orderId: string | number, note: string) {
  const key = String(orderId);
  const trimmed = note.trim();

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const notes = getStoredOrderNotes();
      if (trimmed) {
        notes[key] = trimmed;
      } else {
        delete notes[key];
      }
      localStorage.setItem(WOO_ORDER_NOTES_STORAGE_KEY, JSON.stringify(notes));
    }
  } catch (e) {
    console.warn('Failed to save order note to localStorage:', e);
  }

  try {
    const docRef = doc(db, 'woo_order_notes', key);
    if (trimmed) {
      setDoc(docRef, {
        orderId: key,
        note: trimmed,
        updatedAt: new Date().toISOString(),
      }, { merge: true }).catch((err) => console.warn('Firestore setDoc note error:', err));
    } else {
      deleteDoc(docRef).catch((err) => console.warn('Firestore deleteDoc note error:', err));
    }
  } catch (err) {
    console.warn('Failed to sync order note to Firestore:', err);
  }
}

export function getOrderNote(orderId: string | number, defaultCustomerNote?: string): string {
  if (!orderId) return defaultCustomerNote || '';
  const notes = getStoredOrderNotes();
  const stored = notes[String(orderId)];
  if (stored !== undefined) {
    return stored;
  }
  return defaultCustomerNote || '';
}

export function getStoredCostOverrides(): Record<string, number> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(COST_OVERRIDDEN_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (e) {
    console.warn('Failed to load cost overrides from localStorage:', e);
  }
  return {};
}

export function saveCostOverride(orderId: string | number, itemId: string | number, cost: number) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const overrides = getStoredCostOverrides();
      const key = `${orderId}_${itemId}`;
      if (cost >= 0) {
        overrides[key] = cost;
      } else {
        delete overrides[key];
      }
      localStorage.setItem(COST_OVERRIDDEN_STORAGE_KEY, JSON.stringify(overrides));
    }
  } catch (e) {
    console.warn('Failed to save cost override to localStorage:', e);
  }
}

export function getLineItemPurchasePrice(item: any, orderId?: string | number): number {
  if (!item) return 0;

  // 0. Check custom snapshot cost override for this order line item
  if (orderId && item?.id) {
    const overrides = getStoredCostOverrides();
    const key = `${orderId}_${item.id}`;
    if (overrides[key] !== undefined && !isNaN(Number(overrides[key]))) {
      return Number(overrides[key]);
    }
  }

  if (
    item.custom_purchase_price !== undefined &&
    item.custom_purchase_price !== null &&
    !isNaN(Number(item.custom_purchase_price))
  ) {
    return Number(item.custom_purchase_price);
  }

  if (
    item.purchase_price !== undefined &&
    item.purchase_price !== null &&
    !isNaN(Number(item.purchase_price)) &&
    Number(item.purchase_price) > 0
  ) {
    return Number(item.purchase_price);
  }

  const directKeys = [
    'atum_purchase_price', '_atum_purchase_price', 'purchase_price',
    '_purchase_price', 'cost_price', '_cost_price', 'cost', '_cost',
    'purchasePrice', 'costPrice'
  ];
  for (const k of directKeys) {
    if (item[k] !== undefined && item[k] !== null && !isNaN(Number(item[k])) && Number(item[k]) > 0) {
      return Number(item[k]);
    }
  }

  if (item.atum_data && typeof item.atum_data === 'object') {
    const atumVal = parseFloat(String(item.atum_data.purchase_price || item.atum_data.purchasePrice || item.atum_data.cost || ''));
    if (!isNaN(atumVal) && atumVal > 0) return atumVal;
  }

  // Check meta_data array on line_item
  if (Array.isArray(item.meta_data)) {
    const metaMatch = item.meta_data.find((m: any) => {
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
    if (
      metaMatch &&
      metaMatch.value !== undefined &&
      metaMatch.value !== null &&
      metaMatch.value !== ''
    ) {
      const val = parseFloat(String(metaMatch.value));
      if (!isNaN(val) && val > 0) return val;
    }
  }

  return 0;
}

export function getOrderDiscountAmount(order: any): number {
  if (!order) return 0;
  let discount = parseFloat(order.discount_total || '0') || 0;

  if (Array.isArray(order.fee_lines)) {
    for (const fee of order.fee_lines) {
      const name = (fee.name || fee.title || '').toLowerCase();
      const feeAmount = parseFloat(fee.total || '0') || 0;

      // Exclude COD deposit / partial balance fees
      const isCodFee =
        name.includes('cod balance') ||
        name.includes('due on delivery') ||
        name.includes('acompte') ||
        name.includes('solde');

      if (!isCodFee && feeAmount < 0) {
        discount += Math.abs(feeAmount);
      }
    }
  }

  return discount;
}

export function getLineItemEffectiveSelling(item: any, order?: any) {
  const itemQty = Math.max(1, Number(item?.quantity) || 1);
  const rawItemTotal = parseFloat(item?.total || item?.subtotal || item?.price || '0');

  if (!order || !Array.isArray(order.line_items) || order.line_items.length === 0) {
    const netUnitPrice = itemQty > 0 ? rawItemTotal / itemQty : 0;
    return {
      netTotalSelling: rawItemTotal,
      netUnitPrice,
    };
  }

  // Calculate sum of raw totals for all line items
  const sumItemsRawTotal = order.line_items.reduce((acc: number, li: any) => {
    return acc + parseFloat(li.total || li.subtotal || li.price || '0');
  }, 0);

  if (sumItemsRawTotal <= 0) {
    const netUnitPrice = itemQty > 0 ? rawItemTotal / itemQty : 0;
    return {
      netTotalSelling: rawItemTotal,
      netUnitPrice,
    };
  }

  // Calculate total discount/remise on order level (coupons + negative fee lines)
  const orderDiscount = getOrderDiscountAmount(order);

  // Net merchandise total for the order after discount
  const netOrderItemsTotal = Math.max(0, sumItemsRawTotal - orderDiscount);

  // Distribute discount across line items proportionally
  const ratio = netOrderItemsTotal / sumItemsRawTotal;
  const netTotalSelling = rawItemTotal * ratio;
  const netUnitPrice = itemQty > 0 ? netTotalSelling / itemQty : 0;

  return {
    netTotalSelling,
    netUnitPrice,
  };
}

export function isCancelledOrder(order: any): boolean {
  const status = (order?.status || '').toLowerCase().trim();
  return (
    status === 'cancelled' ||
    status === 'annulé' ||
    status === 'annule' ||
    status === 'failed' ||
    status === 'échoué' ||
    status === 'echoue' ||
    status === 'trash' ||
    status === 'refunded' ||
    status === 'remboursé' ||
    status === 'rembourse'
  );
}

export function isBundleChildItem(item: any): boolean {
  if (!item) return false;
  const rawTotal = parseFloat(item.total || item.subtotal || item.price || '0');
  if (rawTotal === 0) return true;

  if (Array.isArray(item.meta_data)) {
    return item.meta_data.some((m: any) => {
      const k = (m.key || m.display_key || '').toLowerCase().trim();
      return (
        k === '_bundled_by' ||
        k === 'bundled_by' ||
        k === '_woosb_parent_id' ||
        k === 'woosb_parent_id' ||
        k === '_bundle_cart_key' ||
        k === 'bundled_item_id' ||
        k === '_bundled_item_id' ||
        k.includes('bundled_by')
      );
    });
  }
  return false;
}

export function isBundleParentItem(item: any, hasChildrenInOrder: boolean = false): boolean {
  if (!item) return false;
  const rawTotal = parseFloat(item.total || item.subtotal || item.price || '0');
  if (rawTotal <= 0) return false;

  if (Array.isArray(item.meta_data)) {
    const isParentMeta = item.meta_data.some((m: any) => {
      const k = (m.key || m.display_key || '').toLowerCase().trim();
      return (
        k === '_bundled_items' ||
        k === 'bundled_items' ||
        k === '_woosb_ids' ||
        k === 'woosb_ids' ||
        k === 'smart_bundle' ||
        k.includes('bundle')
      );
    });
    if (isParentMeta) return true;
  }

  if (hasChildrenInOrder) return true;

  return false;
}

export function calculateOrderProfit(order: any) {
  const status = (order?.status || '').toLowerCase().trim();
  const isCancelled = isCancelledOrder(order);
  const isCompleted =
    !isCancelled &&
    (status === 'completed' ||
      status === 'terminé' ||
      status === 'termine' ||
      status === 'régularisé' ||
      status === 'regularise');

  let merchandiseSales = 0;
  let totalPurchaseCost = 0;
  let hasMissingCost = false;

  const lineItems = Array.isArray(order?.line_items) ? order.line_items : [];

  const hasBundleChildren = lineItems.some((item: any) => {
    const rawTotal = parseFloat(item.total || item.subtotal || item.price || '0');
    if (rawTotal === 0) return true;
    if (Array.isArray(item.meta_data)) {
      return item.meta_data.some((m: any) => {
        const k = (m.key || m.display_key || '').toLowerCase().trim();
        return k.includes('bundled_by') || k.includes('woosb_parent');
      });
    }
    return false;
  });

  const parentHasCost = lineItems.some((item: any) => {
    const isParent = isBundleParentItem(item, hasBundleChildren);
    return isParent && getLineItemPurchasePrice(item, order?.id) > 0;
  });

  if (lineItems.length > 0) {
    for (const item of lineItems) {
      const { netTotalSelling } = getLineItemEffectiveSelling(item, order);
      const qty = Math.max(1, Number(item.quantity) || 1);
      const unitCost = getLineItemPurchasePrice(item, order?.id);

      const isChild = isBundleChildItem(item);
      const isParent = isBundleParentItem(item, hasBundleChildren);

      if (unitCost <= 0) {
        if (!isParent || !hasBundleChildren) {
          if (!isChild || !parentHasCost) {
            hasMissingCost = true;
          }
        }
      }

      merchandiseSales += netTotalSelling;
      totalPurchaseCost += unitCost * qty;
    }
  } else {
    merchandiseSales = parseFloat(order?.total || '0') || 0;
    hasMissingCost = true;
  }

  if (totalPurchaseCost <= 0) {
    hasMissingCost = true;
  }

  const profit = isCancelled ? 0 : merchandiseSales - totalPurchaseCost;
  const margin = isCancelled || merchandiseSales <= 0 ? 0 : (profit / merchandiseSales) * 100;

  // Detect COD Deposit / Partial Payment
  let isCodDeposit = false;
  let codBalanceDue = 0;
  let depositPaidOnline = 0;

  if (Array.isArray(order?.fee_lines)) {
    for (const fee of order.fee_lines) {
      const name = (fee.name || fee.title || '').toLowerCase();
      const feeAmount = parseFloat(fee.total || '0');
      if (
        name.includes('cod balance') ||
        name.includes('due on delivery') ||
        name.includes('deposit') ||
        name.includes('acompte') ||
        name.includes('solde')
      ) {
        isCodDeposit = true;
        codBalanceDue += Math.abs(feeAmount);
      }
    }
  }

  const orderTotalPaid = parseFloat(order?.total || '0');
  if (isCodDeposit && codBalanceDue > 0) {
    depositPaidOnline = orderTotalPaid;
  }

  const orderDiscount = getOrderDiscountAmount(order);

  return {
    isCompleted,
    isCancelled,
    totalSelling: isCancelled ? 0 : merchandiseSales,
    totalPurchaseCost,
    hasMissingCost,
    orderDiscount,
    profit,
    margin,
    isCodDeposit,
    codBalanceDue,
    depositPaidOnline,
  };
}

export function getOrderFullTotal(order: any): {
  fullTotal: number;
  isDeposit: boolean;
  depositAmount: number;
  balanceDue: number;
} {
  if (!order) {
    return { fullTotal: 0, isDeposit: false, depositAmount: 0, balanceDue: 0 };
  }

  const rawTotal = parseFloat(order.total || '0') || 0;
  const shippingTotal = parseFloat(order.shipping_total || '0') || 0;

  let lineItemsTotal = 0;
  if (Array.isArray(order.line_items) && order.line_items.length > 0) {
    lineItemsTotal = order.line_items.reduce((acc: number, item: any) => {
      return acc + (parseFloat(item.total || item.subtotal || item.price || '0') || 0);
    }, 0);
  }

  const discount = getOrderDiscountAmount(order);
  const calculatedFullValue = Math.max(0, lineItemsTotal + shippingTotal - discount);

  let isCodDeposit = false;
  let codBalanceDue = 0;

  if (Array.isArray(order.fee_lines)) {
    for (const fee of order.fee_lines) {
      const name = (fee.name || fee.title || '').toLowerCase();
      const feeAmount = parseFloat(fee.total || '0');
      if (
        name.includes('cod balance') ||
        name.includes('due on delivery') ||
        name.includes('deposit') ||
        name.includes('acompte') ||
        name.includes('solde')
      ) {
        isCodDeposit = true;
        codBalanceDue += Math.abs(feeAmount);
      }
    }
  }

  if (isCodDeposit || (rawTotal > 0 && calculatedFullValue > rawTotal + 1)) {
    const fullTotal = calculatedFullValue > 0 ? calculatedFullValue : rawTotal + codBalanceDue;
    return {
      fullTotal,
      isDeposit: true,
      depositAmount: rawTotal,
      balanceDue: codBalanceDue > 0 ? codBalanceDue : Math.max(0, fullTotal - rawTotal),
    };
  }

  return {
    fullTotal: rawTotal > 0 ? rawTotal : calculatedFullValue,
    isDeposit: false,
    depositAmount: 0,
    balanceDue: 0,
  };
}

export function isOrderToday(order: any): boolean {
  const dateStr = order.date_created || order.date_completed || order.date_paid;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function isOrderInSelectedMonth(order: any, selectedMonthKey?: string): boolean {
  if (!selectedMonthKey || selectedMonthKey === 'all') {
    return true;
  }
  const dateStr = order.date_created || order.date_completed || order.date_paid;
  if (!dateStr) return false;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;

    if (selectedMonthKey === 'current') {
      const now = new Date();
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth()
      );
    }

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const yearMonth = `${year}-${month}`;
    return yearMonth === selectedMonthKey;
  } catch {
    return false;
  }
}

export function isOrderThisMonth(order: any): boolean {
  return isOrderInSelectedMonth(order);
}

const WOO_CACHE_STORAGE_KEY = 'woo_orders_cache_v1';

export function getStoredWooOrders(): any[] {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = localStorage.getItem(WOO_CACHE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    }
  } catch (e) {
    console.warn('Failed to load stored WooCommerce orders from localStorage:', e);
  }
  return [];
}

export function saveStoredWooOrders(orders: any[]) {
  try {
    if (typeof window !== 'undefined' && window.localStorage && Array.isArray(orders) && orders.length > 0) {
      localStorage.setItem(WOO_CACHE_STORAGE_KEY, JSON.stringify(orders));
    }
  } catch (e) {
    console.warn('Failed to save WooCommerce orders to localStorage:', e);
  }
}

export function calculateWooCommerceProfitStats(orders: any[] = [], selectedMonthKey?: string) {
  let todayProfit = 0;
  let monthProfit = 0;
  let todaySales = 0;
  let monthSales = 0;
  let todayCompletedCount = 0;
  let monthCompletedCount = 0;

  if (!Array.isArray(orders)) {
    return {
      todayProfit,
      monthProfit,
      todaySales,
      monthSales,
      todayCompletedCount,
      monthCompletedCount,
    };
  }

  for (const order of orders) {
    const { isCompleted, isCancelled, profit, totalSelling } = calculateOrderProfit(order);
    // Ignore cancelled or non-completed orders from profit & sales stats
    if (isCancelled || !isCompleted) continue;

    if (isOrderToday(order)) {
      todayProfit += profit;
      todaySales += totalSelling;
      todayCompletedCount++;
    }

    if (isOrderInSelectedMonth(order, selectedMonthKey)) {
      monthProfit += profit;
      monthSales += totalSelling;
      monthCompletedCount++;
    }
  }

  return {
    todayProfit,
    monthProfit,
    todaySales,
    monthSales,
    todayCompletedCount,
    monthCompletedCount,
  };
}

export function getDaysSinceOrder(dateCreatedStr?: string): { days: number; formattedText: string } {
  if (!dateCreatedStr) return { days: 0, formattedText: '-' };
  try {
    const createdDate = new Date(dateCreatedStr);
    if (isNaN(createdDate.getTime())) return { days: 0, formattedText: '-' };
    const now = new Date();
    const diffMs = now.getTime() - createdDate.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      if (diffHours <= 0) return { days: 0, formattedText: "À l'instant" };
      return { days: 0, formattedText: `${diffHours}h` };
    }
    return { days: diffDays, formattedText: `${diffDays}j` };
  } catch {
    return { days: 0, formattedText: '-' };
  }
}

export function isOrderOverdue(order: any, minDays: number = 2): boolean {
  if (!order || !order.id) return false;
  const statusLower = (order.status || '').toLowerCase();
  const isTerminal = ['completed', 'cancelled', 'refunded', 'failed', 'trash'].includes(statusLower);
  if (isTerminal) return false;
  const days = getDaysSinceOrder(order.date_created).days;
  return days >= minDays;
}

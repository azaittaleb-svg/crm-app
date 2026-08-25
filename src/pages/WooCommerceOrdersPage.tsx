import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ShoppingCart,
  ShoppingBag,
  RefreshCw,
  FileText,
  Search,
  Filter,
  Eye,
  ChevronLeft,
  ChevronRight,
  X,
  User,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Package,
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  Check,
  MoreVertical,
  Printer,
  Edit3,
  Lock,
  StickyNote,
  Save,
  Copy,
  MessageSquare,
  Building2,
  CheckCheck,
  Bell,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Plus,
  History,
  AlertTriangle,
  PackageCheck,
  Boxes,
  Receipt,
  Truck,
  ExternalLink,
  Scale,
  ArrowRight,
  ShieldCheck,
  Navigation,
  Activity,
} from 'lucide-react';
import { printTicket } from '../components/TicketPrint';
import { InvoiceData } from '../types';
import { useNotification } from '../context/NotificationContext';
import {
  collection,
  collectionGroup,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { backendService } from '../services/backendService';
import { useNavigate, useLocation } from 'react-router-dom';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { convertNumberToFrenchWords } from '../utils/numberToWords';
import { analyzeTrackingEvents } from '../utils/tracking';
import {
  subscribeToTrackingMap,
  saveOrderTracking,
  saveTrackingResultToDb,
  getTrackingResultFromDb,
  syncExistingTrackingToFirestore,
} from '../services/wooTracking.service';
import { WooTrackingTab, WooNotificationsTab } from '../components/woocommerce';
import {
  NotificationTemplateType,
  calculateOrderProfit,
  getLineItemPurchasePrice,
  getLineItemEffectiveSelling,
  calculateWooCommerceProfitStats,
  getOrderFullTotal,
  isOrderToday,
  isOrderInSelectedMonth,
  getStoredWooOrders,
  saveStoredWooOrders,
  saveCostOverride,
  getOrderNote,
  saveOrderNote,
  setStoredOrderNotes,
  saveReminderSent,
  getStoredRemindersSent,
  deleteReminderSent,
  getReminderSentInfo,
  setStoredRemindersSent,
  saveManualVirementConfirmation,
  getManualVirementConfirmations,
  setStoredManualVirementConfirmations,
  getManualVirementConfirmationInfo,
  ManualVirementInfo,
  hasOrderAvance,
} from '../utils/wooProfit';

export { hasOrderAvance, type NotificationTemplateType };

function getDaysSinceOrder(dateCreatedStr?: string): { days: number; formattedText: string } {
  if (!dateCreatedStr) return { days: 0, formattedText: '0j' };
  const created = new Date(dateCreatedStr);
  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - created.getTime());
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return { days, formattedText: `${days}j` };
}

function getTemplateLabel(type: NotificationTemplateType): string {
  switch (type) {
    case 'confirmation_virement':
      return 'Confirmation de virement';
    case 'commande_expediee':
      return 'Notification Expédiée';
    case 'recuperer_agence':
      return 'À récupérer à l\'agence';
    case 'commande_annulee':
      return 'Commande annulée';
    case 'demande_avance':
    default:
      return 'Demande d\'avance';
  }
}

function generateEmailSubject(
  order: any,
  type: NotificationTemplateType = 'demande_avance'
): string {
  if (!order) return '';
  const orderId = order.id;
  switch (type) {
    case 'confirmation_virement':
      return `Confirmation de virement reçu - Commande WooCommerce #${orderId}`;
    case 'commande_expediee':
      return `Votre commande #${orderId} a été expédiée !`;
    case 'recuperer_agence':
      return `Votre commande #${orderId} est disponible à l'agence`;
    case 'commande_annulee':
      return `Annulation de votre commande #${orderId}`;
    case 'demande_avance':
    default:
      return `Rappel de paiement de l'avance - Commande WooCommerce #${orderId}`;
  }
}

function generateEmailBody(
  order: any,
  avanceVal: string,
  type: NotificationTemplateType = 'demande_avance',
  extraDetail: string = ''
): string {
  if (!order) return '';
  const customerName = `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() || 'Cher client';
  const orderId = order.id;
  const fullTotalInfo = getOrderFullTotal(order);
  const totalOrder = fullTotalInfo.fullTotal > 0 ? fullTotalInfo.fullTotal : parseFloat(order.total || '0');
  const numericAmount = parseFloat(avanceVal || '0');

  const formattedAmount = numericAmount > 0 
    ? `${numericAmount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD` 
    : 'votre règlement';

  if (type === 'confirmation_virement') {
    const isFullPayment = numericAmount >= totalOrder && totalOrder > 0;
    const remainingBalance = totalOrder > numericAmount ? totalOrder - numericAmount : 0;

    let balanceText = '';
    if (isFullPayment) {
      balanceText = `Votre commande est désormais intégralement réglée (${totalOrder.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD).`;
    } else if (remainingBalance > 0) {
      balanceText = `Le solde restant de ${remainingBalance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD sera à régler à la livraison (Contre Remboursement).`;
    }

    return `Bonjour ${customerName},

Nous vous confirmons la bonne réception de votre virement bancaire d'un montant de : ${formattedAmount}.

Votre commande N° #${orderId} est désormais validée avec succès et transmise à notre équipe pour préparation et expédition dans les plus brefs délais.

${balanceText}

Nous vous remercions sincèrement pour votre confiance.

Cordialement,
Le service client & commercial`;
  }

  if (type === 'commande_expediee') {
    const trackingBlock = extraDetail.trim() 
      ? `Informations de livraison / Suivi : ${extraDetail.trim()}\n` 
      : '';
    return `Bonjour ${customerName},

Nous avons le plaisir de vous informer que votre commande N° #${orderId} a été expédiée avec succès !

${trackingBlock}Votre colis est en cours d'acheminement et vous sera livré dans les plus brefs délais.

Nous vous remercions pour votre confiance et votre fidélité.

Cordialement,
Le service client & commercial`;
  }

  if (type === 'recuperer_agence') {
    const trackingCode =
      order.tracking_number ||
      (order.meta_data && order.meta_data.find((m: any) => m.key === '_tracking_number')?.value) ||
      '';
    const trackingLine = trackingCode ? `📦 Numéro de suivi Amana / Barid : ${trackingCode}\n` : '';
    const agencyBlock = extraDetail.trim()
      ? `🏢 Agence de retrait : ${extraDetail.trim()}\n`
      : '';
    return `Bonjour ${customerName},

Nous vous informons que votre commande N° #${orderId} est arrivée et est actuellement disponible pour retrait à l'agence.

${trackingLine}${agencyBlock}
Vous pouvez vous présenter à l'agence muni(e) de votre pièce d'identité et de votre numéro de suivi pour récupérer votre colis.

Nous vous remercions pour votre confiance et restons à votre disposition pour toute information.

Cordialement,
Le service client & commercial`;
  }

  if (type === 'commande_annulee') {
    const reasonBlock = extraDetail.trim() 
      ? `Motif d'annulation : ${extraDetail.trim()}\n` 
      : '';
    return `Bonjour ${customerName},

Nous vous informons que votre commande N° #${orderId} a été annulée.

${reasonBlock}Si vous souhaitez obtenir plus d'informations ou passer une nouvelle commande, notre équipe reste à votre entière disposition.

Cordialement,
Le service client & commercial`;
  }

  // Default: demande_avance
  return `Bonjour ${customerName},

Nous vous remercions pour votre commande N° #${orderId} effectuée sur notre boutique.

Afin de pouvoir valider définitivement votre commande et procéder à son expédition, nous vous prions de bien vouloir effectuer le virement de l'avance requise d'un montant de : ${formattedAmount}.

Voici nos coordonnées bancaires pour effectuer le virement :

--------------------------------------------------
Banque : Chaabi
Numéro du compte (RIB) : 181 810 2111104426450005 42
--------------------------------------------------

Merci d'indiquer votre numéro de commande (#${orderId}) dans le motif du virement, et de nous envoyer le reçu / justificatif par retour de cet e-mail ou par WhatsApp pour accélérer le traitement.

Nous restons à votre entière disposition pour toute information complémentaire.

Cordialement,
Le service client & commercial`;
}

export default function WooCommerceOrdersPage() {
  const location = useLocation();
  const [orders, setOrders] = useState<any[]>(() => getStoredWooOrders());
  const [loading, setLoading] = useState<boolean>(() => getStoredWooOrders().length === 0);
  const [selectedOrders, setSelectedOrders] = useState<Set<number>>(new Set());
  const [importingType, setImportingType] = useState<'facture' | 'commande' | null>(null);
  const [importingSingleId, setImportingSingleId] = useState<{ id: number; type: 'facture' | 'commande' } | null>(null);
  const [showTodayProfitModal, setShowTodayProfitModal] = useState(false);
  const [showMonthProfitModal, setShowMonthProfitModal] = useState(false);
  const [activeDropdownId, setActiveDropdownId] = useState<number | null>(null);

  // Search & Filter state (Persisted in localStorage)
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState(() => {
    try {
      return localStorage.getItem('wc_filter_status') || 'all';
    } catch {
      return 'all';
    }
  });

  // Handle incoming navigation state (e.g. from Notification Center)
  useEffect(() => {
    if (location.state?.statusFilter) {
      setStatusFilter(location.state.statusFilter);
    } else if (location.state?.filterOverdue) {
      setStatusFilter('overdue_2d');
    }
    if (location.state?.openOrderId && orders.length > 0) {
      const target = orders.find((o) => o.id === location.state.openOrderId);
      if (target) {
        setActiveModalOrder(target);
      }
    }
  }, [location.state, orders]);
  const [monthFilter, setMonthFilter] = useState(() => {
    try {
      return localStorage.getItem('wc_filter_month') || 'all';
    } catch {
      return 'all';
    }
  });
  const [conversionFilter, setConversionFilter] = useState<'all' | 'unconverted' | 'commande' | 'facture'>(() => {
    try {
      return (localStorage.getItem('wc_filter_conversion') as any) || 'all';
    } catch {
      return 'all';
    }
  });
  const [costFilter, setCostFilter] = useState<'all' | 'missing' | 'defined'>(() => {
    try {
      return (localStorage.getItem('wc_filter_cost') as any) || 'all';
    } catch {
      return 'all';
    }
  });
  const [reminderFilter, setReminderFilter] = useState<'all' | 'sent' | 'not_sent'>(() => {
    try {
      return (localStorage.getItem('wc_filter_reminder') as any) || 'all';
    } catch {
      return 'all';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('wc_filter_status', statusFilter);
    } catch (e) {
      console.error(e);
    }
  }, [statusFilter]);

  useEffect(() => {
    try {
      localStorage.setItem('wc_filter_month', monthFilter);
    } catch (e) {
      console.error(e);
    }
  }, [monthFilter]);

  useEffect(() => {
    try {
      localStorage.setItem('wc_filter_conversion', conversionFilter);
    } catch (e) {
      console.error(e);
    }
  }, [conversionFilter]);

  useEffect(() => {
    try {
      localStorage.setItem('wc_filter_cost', costFilter);
    } catch (e) {
      console.error(e);
    }
  }, [costFilter]);

  useEffect(() => {
    try {
      localStorage.setItem('wc_filter_reminder', reminderFilter);
    } catch (e) {
      console.error(e);
    }
  }, [reminderFilter]);

  // Inline Snapshot Cost Override state
  const [editingItemId, setEditingItemId] = useState<number | string | null>(null);
  const [editingCostInput, setEditingCostInput] = useState<string>('');

  // Detail Modal state
  const [activeModalOrder, setActiveModalOrder] = useState<any | null>(null);
  const [modalTab, setModalTab] = useState<'details' | 'email_avance' | 'tracking'>('details');

  // Tracking State (Barid Al-Maghrib)
  const [trackingData, setTrackingData] = useState<any[] | null>(null);
  const [trackingSummary, setTrackingSummary] = useState<any | null>(null);
  const [trackingStep, setTrackingStep] = useState<number>(1);
  const [trackingLoading, setTrackingLoading] = useState<boolean>(false);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [trackingDirectUrl, setTrackingDirectUrl] = useState<string | null>(null);
  const [customTrackingInput, setCustomTrackingInput] = useState<string>('');
  const [showWebhookGuide, setShowWebhookGuide] = useState<boolean>(false);
  const [rawPasteText, setRawPasteText] = useState<string>('');
  const [showRawPaste, setShowRawPaste] = useState<boolean>(false);
  const [showAllTrackingRows, setShowAllTrackingRows] = useState<boolean>(false);
  const [trackingMeta, setTrackingMeta] = useState<{
    isFinished?: boolean;
    lastUpdated?: string;
    fromCache?: boolean;
    cacheStatus?: string;
    nextUpdateInMinutes?: number | null;
  } | null>(null);

  const formatTrackingRelative = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return formatDistanceToNow(d, { addSuffix: true, locale: fr });
    } catch {
      return '';
    }
  };

  // Persistent Map of Tracking Numbers by Order ID
  const [orderTrackingMap, setOrderTrackingMap] = useState<Record<string, string>>(() => {
    const defaultMap: Record<string, string> = {
      '115684': 'QB230944874MA',
      '115803': 'QB230944945MA',
      '115804': 'QB230944931MA',
      '115807': 'QB230944931MA',
      '115814': 'QB230944959MA',
      '115816': 'QB230944962MA',
      '115817': 'QB230944976MA',
      '115818': 'QB236428998MA',
      '115824': 'QB230944993MA',
      '115830': 'QB236428984MA',
      '115841': 'QB230942330MA',
      '115843': 'QB230942391MA',
      '115855': 'QB230942480MA',
      '115856': 'QB230942502MA',
      '115883': 'QB231919774MA',
      '115892': 'QB236425197MA',
      '115897': 'QB231919859MA',
      '116338': 'QB230909869MA',
      '116436': 'QB235304382MA',
      '116437': 'QB235304379MA',
      '116440': 'QB247139294MA',
      '116441': 'QB247139285MA',
    };
    try {
      const saved = localStorage.getItem('wc_order_tracking_map');
      if (saved) {
        const parsed = JSON.parse(saved);
        return { ...defaultMap, ...parsed };
      }
      return defaultMap;
    } catch {
      return defaultMap;
    }
  });

  // Real-time Firestore subscription + Server fallback for Tracking Map
  useEffect(() => {
    // 1. Initial sync of any existing tracking codes from server file into Firestore
    syncExistingTrackingToFirestore();

    // 2. Real-time Firestore subscription (syncs Preview <-> Local in real time)
    const unsubscribe = subscribeToTrackingMap((dbMap) => {
      setOrderTrackingMap((prev) => {
        const merged = { ...prev, ...dbMap };
        return merged;
      });
    });

    // 3. Fallback server API fetch
    fetch('/api/tracking/map')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === 'object') {
          setOrderTrackingMap((prev) => {
            const merged = { ...prev, ...data };
            try {
              localStorage.setItem('wc_order_tracking_map', JSON.stringify(merged));
            } catch (e) {
              console.error(e);
            }
            return merged;
          });
        }
      })
      .catch((err) => console.warn('Could not fetch server tracking map:', err));

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleSaveOrderTrackingNumber = (orderId: number | string, code: string) => {
    const cleanCode = code.trim().toUpperCase();
    const newMap = { ...orderTrackingMap, [orderId]: cleanCode };
    setOrderTrackingMap(newMap);

    // Persist in Firestore DB + localStorage + Server File
    saveOrderTracking(orderId, cleanCode).catch((e) =>
      console.warn('Error persisting tracking number:', e)
    );

    if (activeModalOrder && String(activeModalOrder.id) === String(orderId)) {
      activeModalOrder.tracking_number = cleanCode;
    }
    setCustomTrackingInput(cleanCode);
    if (cleanCode) {
      fetchTrackingData(cleanCode);
    }
  };

  const parseAndSetRawText = (text: string) => {
    if (!text || !text.trim()) return;
    try {
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        const parsed = JSON.parse(text);
        if (parsed.results) {
          setTrackingData(parsed.results);
          if (parsed.summary) setTrackingSummary(parsed.summary);
          if (parsed.currentStep) setTrackingStep(parsed.currentStep);
          setTrackingError(null);
          return;
        } else if (Array.isArray(parsed)) {
          setTrackingData(parsed);
          setTrackingError(null);
          return;
        }
      }

      const trackingInfo: any[] = [];
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      let currDate = '';

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(line)) {
          currDate = line;
        } else if (/^\d{2}:\d{2}(:\d{2})?$/.test(line)) {
          const timeVal = line;
          const locVal = i + 1 < lines.length ? lines[i + 1] : '-';
          const detVal = i + 2 < lines.length ? lines[i + 2] : locVal;

          trackingInfo.push({
            date: currDate || '-',
            heure: timeVal,
            localisation: locVal,
            details: detVal,
          });
        }
      }

      if (trackingInfo.length > 0) {
        setTrackingData(trackingInfo);
        setTrackingError(null);
        const analysis = analyzeTrackingEvents(trackingInfo);
        setTrackingStep(analysis.currentStep);
      }
    } catch (e) {
      console.warn('Failed to parse raw tracking text:', e);
    }
  };

  // Order Note state inside Order Detail Modal
  const [orderNoteInput, setOrderNoteInput] = useState<string>('');
  const [isEditingNote, setIsEditingNote] = useState<boolean>(false);

  // Email Template fields for Avance Reminder & Confirmation
  const [emailTemplateType, setEmailTemplateType] = useState<NotificationTemplateType>('demande_avance');
  const [extraDetailInput, setExtraDetailInput] = useState<string>('');
  const [emailSubjectInput, setEmailSubjectInput] = useState<string>('');
  const [emailBodyInput, setEmailBodyInput] = useState<string>('');
  const [emailAvanceAmount, setEmailAvanceAmount] = useState<string>('');
  const [copiedSubject, setCopiedSubject] = useState<boolean>(false);
  const [copiedBody, setCopiedBody] = useState<boolean>(false);
  const [copiedRib, setCopiedRib] = useState<boolean>(false);
  const [sendingDirectEmail, setSendingDirectEmail] = useState<boolean>(false);
  const [showTemplateText, setShowTemplateText] = useState<boolean>(false);
  const [showSendHistory, setShowSendHistory] = useState<boolean>(false);

  // Payment override for converted document / receipt
  const [docPaymentOverride, setDocPaymentOverride] = useState<'auto' | 'paid' | 'partial' | 'unpaid'>('auto');

  // Live Product Stock state for Order Modal
  const [productStockMap, setProductStockMap] = useState<Record<string, any>>({});
  const [isLoadingStock, setIsLoadingStock] = useState<boolean>(false);

  const fetchOrderProductsStock = (order: any) => {
    if (!order || !order.line_items || order.line_items.length === 0) {
      setProductStockMap({});
      setIsLoadingStock(false);
      return;
    }

    setIsLoadingStock(true);
    const items = order.line_items.map((item: any) => ({
      product_id: item.product_id || 0,
      variation_id: item.variation_id || 0,
    }));

    fetch('/api/woocommerce/products/stock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data === 'object') {
          setProductStockMap(data);
        }
      })
      .catch((err) => {
        console.warn('Failed to fetch product stock:', err);
      })
      .finally(() => {
        setIsLoadingStock(false);
      });
  };

  const fetchTrackingData = async (explicitCode?: string, forceRefresh = false) => {
    const code = (explicitCode !== undefined ? explicitCode : customTrackingInput) || activeModalOrder?.tracking_number || (activeModalOrder?.meta_data && activeModalOrder.meta_data.find((m: any) => m.key === '_tracking_number')?.value) || '';
    if (!code) {
      setTrackingError('Aucun code de suivi Barid Al-Maghrib / Amana configuré pour cette commande.');
      setTrackingData(null);
      setTrackingSummary(null);
      setTrackingDirectUrl(null);
      setTrackingMeta(null);
      return;
    }
    setTrackingLoading(true);
    setTrackingError(null);
    const directUrl = `https://www.barid.ma/bamb2cstorefront/fr/tracking/getdetailentrytracking?code=${encodeURIComponent(code.trim())}`;
    setTrackingDirectUrl(directUrl);

    const cleanCode = code.trim().toUpperCase();
    const cacheKey = `wc_track_${cleanCode}`;

    // Fast client-side & DB cache check (if not forced refresh)
    if (!forceRefresh) {
      try {
        let cachedData: any = null;
        const localCached = localStorage.getItem(cacheKey);
        if (localCached) {
          cachedData = JSON.parse(localCached);
        } else {
          cachedData = await getTrackingResultFromDb(cleanCode);
        }

        if (cachedData) {
          const isDone = cachedData.isFinished || cachedData.currentStep === 4;
          const elapsed = Date.now() - (cachedData.updatedAtMs || (cachedData.lastUpdated ? new Date(cachedData.lastUpdated).getTime() : 0));
          const TWO_HOURS = 2 * 60 * 60 * 1000;
          if (isDone || elapsed < TWO_HOURS) {
            setTrackingData(cachedData.results || []);
            setTrackingSummary(cachedData.summary || null);
            setTrackingStep(cachedData.currentStep || 1);
            setTrackingMeta({
              isFinished: isDone,
              lastUpdated: cachedData.lastUpdated,
              fromCache: true,
              cacheStatus: isDone ? 'completed_final' : 'active_within_2h',
              nextUpdateInMinutes: isDone ? null : Math.max(1, Math.round((TWO_HOURS - elapsed) / 60000)),
            });
            setTrackingLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn('Cache check warning:', err);
      }
    }

    try {
      const forceQuery = forceRefresh ? '&force=true' : '';
      const res = await fetch(`/api/track?code=${encodeURIComponent(cleanCode)}${forceQuery}`);
      const data = await res.json();

      const events = Array.isArray(data?.historique_details)
        ? data.historique_details
        : Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data?.events)
        ? data.events
        : Array.isArray(data)
        ? data
        : [];

      const summary = data?.summary || (data?.informations_commande ? {
        poids: data.informations_commande.poids_du_colis || '-',
        produit: data.informations_commande.produit || '-',
        crbt: data.informations_commande.montant_crbt || 'Sans',
        depart: data.informations_commande.position_de_depart || '-',
        arrivee: data.informations_commande.position_d_arrivee || '-',
      } : null);

      const step = data?.currentStep || 1;
      const isFinished = !!data?.isFinished || step === 4;
      const lastUpdated = data?.lastUpdated || new Date().toISOString();

      if (events.length > 0) {
        setTrackingData(events);
        setTrackingSummary(summary);
        setTrackingStep(step);
        setTrackingError(null);
        setTrackingMeta({
          isFinished,
          lastUpdated,
          fromCache: !!data?.fromCache,
          cacheStatus: data?.cacheStatus,
          nextUpdateInMinutes: data?.nextUpdateInMinutes,
        });

        // Save into Firestore DB and LocalStorage for cross-device instant retrieval
        saveTrackingResultToDb(cleanCode, {
          code: cleanCode,
          summary,
          results: events,
          currentStep: step,
          isFinished,
          lastUpdated,
          updatedAtMs: Date.now(),
        }).catch((e) => console.warn('Could not save tracking to DB:', e));
      } else {
        setTrackingData(null);
        setTrackingSummary(null);
        setTrackingMeta(null);
        if (data?.directUrl) {
          setTrackingDirectUrl(data.directUrl);
        }
        setTrackingError(data?.error || data?.message || 'Aucune information disponible pour ce numéro actuellement.');
      }
    } catch (err: any) {
      setTrackingError(err.message || 'Erreur lors de la récupération du suivi.');
      setTrackingData(null);
      setTrackingSummary(null);
      setTrackingMeta(null);
    } finally {
      setTrackingLoading(false);
    }
  };

  const handleParseRawTrackingText = async () => {
    if (!rawPasteText.trim()) {
      showToast('Veuillez coller le texte ou HTML du suivi Barid Al-Maghrib.', 'error');
      return;
    }
    const code =
      customTrackingInput ||
      activeModalOrder?.tracking_number ||
      orderTrackingMap[String(activeModalOrder?.id)] ||
      orderTrackingMap[activeModalOrder?.id] ||
      (activeModalOrder?.meta_data &&
        activeModalOrder.meta_data.find((m: any) => m.key === '_tracking_number')?.value) ||
      '';
    if (!code) {
      showToast('Veuillez d\'abord renseigner le code de suivi (ex: QB230944826MA).', 'error');
      return;
    }
    setTrackingLoading(true);
    try {
      const cleanCode = code.trim().toUpperCase();
      const res = await fetch('/api/tracking/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: cleanCode, text: rawPasteText.trim() }),
      });
      const data = await res.json();
      if (data.success && data.results?.length > 0) {
        setTrackingData(data.results);
        setTrackingSummary(data.summary || null);
        setTrackingStep(data.currentStep || 1);
        setTrackingError(null);
        setTrackingMeta({
          isFinished: !!data.isFinished,
          lastUpdated: data.lastUpdated || new Date().toISOString(),
          fromCache: false,
        });
        setRawPasteText('');
        setShowRawPaste(false);
        showToast('Données de suivi analysées et enregistrées avec succès !', 'success');

        // Cache in Firestore DB & localStorage
        saveTrackingResultToDb(cleanCode, {
          code: cleanCode,
          summary: data.summary,
          results: data.results,
          currentStep: data.currentStep,
          isFinished: data.isFinished,
          lastUpdated: data.lastUpdated,
          updatedAtMs: Date.now(),
        }).catch((e) => console.warn('Could not save parsed tracking to DB:', e));
      } else {
        showToast(data.error || 'Impossible d\'extraire les étapes du texte collé.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du traitement du texte.', 'error');
    } finally {
      setTrackingLoading(false);
    }
  };

  useEffect(() => {
    if (activeModalOrder) {
      setModalTab('details');
      setDocPaymentOverride('auto');
      fetchOrderProductsStock(activeModalOrder);
      const saved = getOrderNote(activeModalOrder.id, activeModalOrder.customer_note);
      setOrderNoteInput(saved);
      setIsEditingNote(false);

      // Reset tracking state and set initial code
      setTrackingData(null);
      setTrackingLoading(false);
      setTrackingError(null);
      setTrackingMeta(null);
      const initCode =
        orderTrackingMap[String(activeModalOrder.id)] ||
        orderTrackingMap[activeModalOrder.id] ||
        activeModalOrder.tracking_number ||
        (activeModalOrder.meta_data && activeModalOrder.meta_data.find((m: any) => m.key === '_tracking_number')?.value) ||
        '';
      setCustomTrackingInput(initCode);
      if (initCode) {
        fetchTrackingData(initCode);
      }

      // Auto-detect deposit / advance amount
      const avanceInfo = hasOrderAvance(activeModalOrder);
      const fullTotalInfo = getOrderFullTotal(activeModalOrder);
      const fullTotal = fullTotalInfo.fullTotal > 0 ? fullTotalInfo.fullTotal : parseFloat(activeModalOrder.total || '0');
      const strAvance = avanceInfo.amount > 0 ? String(avanceInfo.amount) : String(fullTotal);
      setEmailAvanceAmount(strAvance);
      setExtraDetailInput('');
      setEmailTemplateType('demande_avance');
      setEmailSubjectInput(generateEmailSubject(activeModalOrder, 'demande_avance'));
      setEmailBodyInput(generateEmailBody(activeModalOrder, strAvance, 'demande_avance', ''));
    } else {
      setOrderNoteInput('');
      setIsEditingNote(false);
      setModalTab('details');
      setDocPaymentOverride('auto');
      setProductStockMap({});
      setIsLoadingStock(false);
      setExtraDetailInput('');
      setTrackingData(null);
      setTrackingLoading(false);
      setTrackingError(null);
      setCustomTrackingInput('');
      setShowAllTrackingRows(false);
    }
  }, [activeModalOrder]);

  // Synchronize tracking code whenever orderTrackingMap updates from Firestore
  useEffect(() => {
    if (activeModalOrder) {
      const codeFromMap =
        orderTrackingMap[String(activeModalOrder.id)] ||
        orderTrackingMap[activeModalOrder.id] ||
        '';
      if (codeFromMap && !customTrackingInput) {
        setCustomTrackingInput(codeFromMap);
        fetchTrackingData(codeFromMap);
      }
    }
  }, [orderTrackingMap, activeModalOrder]);

  useEffect(() => {
    if (modalTab === 'tracking' && activeModalOrder) {
      const code =
        customTrackingInput ||
        orderTrackingMap[String(activeModalOrder.id)] ||
        orderTrackingMap[activeModalOrder.id] ||
        activeModalOrder.tracking_number ||
        (activeModalOrder.meta_data && activeModalOrder.meta_data.find((m: any) => m.key === '_tracking_number')?.value) ||
        '';
      if (code) {
        if (!customTrackingInput) {
          setCustomTrackingInput(code);
        }
        if (!trackingData && !trackingLoading && !trackingError) {
          fetchTrackingData(code);
        }
      }
    }
  }, [modalTab, activeModalOrder, customTrackingInput, orderTrackingMap]);

  const handleSelectTemplateType = (
    type: NotificationTemplateType,
    overrideExtra?: string
  ) => {
    setEmailTemplateType(type);
    if (!activeModalOrder) return;

    let extra = overrideExtra !== undefined ? overrideExtra : extraDetailInput;
    if (type === 'recuperer_agence' && !extra) {
      if (trackingData && trackingData.length > 0) {
        const latest = trackingData[0];
        const loc = latest.localisation || latest.evenementLocalisation || (trackingSummary?.arrivee && trackingSummary.arrivee !== '-' ? trackingSummary.arrivee : '');
        if (loc && loc !== '-') {
          extra = loc;
          setExtraDetailInput(loc);
        }
      }
    }

    const avanceInfo = hasOrderAvance(activeModalOrder);
    const fullTotalInfo = getOrderFullTotal(activeModalOrder);
    const totalOrder = fullTotalInfo.fullTotal > 0 ? fullTotalInfo.fullTotal : parseFloat(activeModalOrder.total || '0');

    let defaultAmt = emailAvanceAmount;
    if (type === 'confirmation_virement') {
      defaultAmt = String(totalOrder);
      setDocPaymentOverride('paid');
    } else if (type === 'demande_avance') {
      defaultAmt = avanceInfo.amount > 0 ? String(avanceInfo.amount) : String(totalOrder);
      setDocPaymentOverride('partial');
    } else {
      defaultAmt = '0';
    }

    setEmailAvanceAmount(defaultAmt);
    setEmailSubjectInput(generateEmailSubject(activeModalOrder, type));
    setEmailBodyInput(generateEmailBody(activeModalOrder, defaultAmt, type, extra));
  };

  const handleExtraDetailChange = (val: string) => {
    setExtraDetailInput(val);
    if (!activeModalOrder) return;
    setEmailBodyInput(generateEmailBody(activeModalOrder, emailAvanceAmount, emailTemplateType, val));
  };

  const handleChangeAvanceAmount = (newVal: string) => {
    setEmailAvanceAmount(newVal);
    if (!activeModalOrder) return;
    setEmailBodyInput(generateEmailBody(activeModalOrder, newVal, emailTemplateType, extraDetailInput));
  };

  const handleCopySubject = () => {
    navigator.clipboard.writeText(emailSubjectInput);
    setCopiedSubject(true);
    showToast('Sujet copié dans le presse-papier', 'success');
    setTimeout(() => setCopiedSubject(false), 2000);
  };

  const handleCopyBody = () => {
    navigator.clipboard.writeText(emailBodyInput);
    setCopiedBody(true);
    showToast('Message copié dans le presse-papier', 'success');
    setTimeout(() => setCopiedBody(false), 2000);
  };

  const handleCopyRib = () => {
    navigator.clipboard.writeText('181 810 2111104426450005 42');
    setCopiedRib(true);
    showToast('RIB Chaabi copié dans le presse-papier', 'success');
    setTimeout(() => setCopiedRib(false), 2000);
  };

  const handleOpenMailto = async () => {
    if (!activeModalOrder?.billing?.email) {
      showToast("Cette commande n'a pas d'adresse e-mail renseignée", 'error');
      return;
    }
    const mailtoUrl = `mailto:${activeModalOrder.billing.email}?subject=${encodeURIComponent(
      emailSubjectInput
    )}&body=${encodeURIComponent(emailBodyInput)}`;
    saveReminderSent(activeModalOrder.id, 'mailto', emailAvanceAmount, emailTemplateType);
    setOrders((prev) => [...prev]);
    await handleAutoSyncReceipt(true);
    showToast(`${getTemplateLabel(emailTemplateType)} marqué(e) comme envoyé(e) & Reçu mis à jour`, 'success');
    window.open(mailtoUrl, '_blank');
  };

  const handleAutoSyncReceipt = async (silent = false) => {
    if (!activeModalOrder) return;
    try {
      await createDocumentsForOrders([activeModalOrder], 'commande');
      if (!silent) {
        showToast(`Reçu pour la commande #${activeModalOrder.id} mis à jour avec succès en base (${emailAvanceAmount} DH) !`, 'success');
      }
    } catch (err) {
      console.error('Error auto-syncing receipt:', err);
    }
  };

  const handleOpenWhatsApp = async () => {
    const rawPhone = activeModalOrder?.billing?.phone || '';
    if (!rawPhone) {
      showToast("Cette commande n'a pas de numéro de téléphone renseigné", 'error');
      return;
    }
    const cleanNum = rawPhone.replace(/[^0-9]/g, '');
    if (/^0[58]/.test(cleanNum) || /^(212|00212)[58]/.test(cleanNum) || /^[58][0-9]{8}$/.test(cleanNum)) {
      showToast('Le numéro de cette commande est un numéro fixe (05...), impossible d\'envoyer par WhatsApp.', 'error');
      return;
    }
    let cleaned = rawPhone.replace(/\D/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '212' + cleaned.substring(1);
    }
    const messageText = `*${emailSubjectInput}*\n\n${emailBodyInput}`;
    showToast('Envoi du message WhatsApp en cours...', 'info');
    
    import('../services/whatsappService').then(({ sendWhatsAppMessage }) => {
      sendWhatsAppMessage(cleaned, messageText).then(async (result) => {
        if (result.success) {
          saveReminderSent(activeModalOrder.id, 'whatsapp', emailAvanceAmount, emailTemplateType);
          setOrders((prev) => [...prev]);
          // Auto-sync receipt
          await handleAutoSyncReceipt(true);
          showToast(`${getTemplateLabel(emailTemplateType)} envoyé(e) via WhatsApp & Reçu synchronisé`, 'success');
        } else {
          showToast('Erreur WhatsApp: ' + result.error, 'error');
        }
      });
    });
  };

  const handleSendDirectEmail = async () => {
    if (!activeModalOrder?.billing?.email) {
      showToast("Cette commande n'a pas d'adresse e-mail renseignée", 'error');
      return;
    }
    setSendingDirectEmail(true);
    try {
      await backendService.sendEmail({
        to: activeModalOrder.billing.email,
        subject: emailSubjectInput,
        body: emailBodyInput.replace(/\n/g, '<br>'),
      });
      saveReminderSent(activeModalOrder.id, 'email', emailAvanceAmount, emailTemplateType);
      setOrders((prev) => [...prev]);

      // Auto-sync receipt
      await handleAutoSyncReceipt(true);

      showToast(`E-mail de ${getTemplateLabel(emailTemplateType).toLowerCase()} envoyé avec succès à ${activeModalOrder.billing.email} & Reçu mis à jour !`, 'success');
    } catch (err: any) {
      console.error('Error sending direct email:', err);
      showToast(err?.message || "Impossible d'envoyer l'e-mail.", 'error');
    } finally {
      setSendingDirectEmail(false);
    }
  };

  const handleToggleReminderManual = async () => {
    if (!activeModalOrder) return;
    const existing = getReminderSentInfo(activeModalOrder.id);
    if (existing) {
      deleteReminderSent(activeModalOrder.id);
      showToast('Statut de communication réinitialisé', 'info');
    } else {
      saveReminderSent(activeModalOrder.id, 'manual', emailAvanceAmount, emailTemplateType);
      await handleAutoSyncReceipt(true);
      showToast('Commande marquée comme envoyée manuellement & Reçu mis à jour', 'success');
    }
    setOrders((prev) => [...prev]);
  };

  const handleSaveOrderNote = () => {
    if (activeModalOrder) {
      saveOrderNote(activeModalOrder.id, orderNoteInput);
      showToast('Note de la commande enregistrée avec succès', 'success');
      setIsEditingNote(false);
      setOrders([...orders]);
    }
  };

  const handleDeleteOrderNote = () => {
    if (activeModalOrder) {
      saveOrderNote(activeModalOrder.id, '');
      setOrderNoteInput('');
      setIsEditingNote(true);
      showToast('Note supprimée', 'info');
      setOrders([...orders]);
    }
  };

  const handleSaveCostOverride = (orderId: number | string, itemId: number | string) => {
    const cost = parseFloat(editingCostInput);
    if (!isNaN(cost) && cost >= 0) {
      saveCostOverride(orderId, itemId, cost);
      showToast(`Prix d'achat Snapshot sauvegardé (${cost.toFixed(2)} DH)`, 'success');
      setEditingItemId(null);
      setEditingCostInput('');
      setOrders([...orders]);
    } else {
      showToast("Veuillez saisir un montant d'achat valide", 'error');
    }
  };

  const wooProfitStats = useMemo(
    () => calculateWooCommerceProfitStats(orders, monthFilter),
    [orders, monthFilter]
  );

  const todayCompletedOrders = useMemo(() => {
    return orders.filter((order) => {
      const profitStats = calculateOrderProfit(order);
      return profitStats.isCompleted && !profitStats.isCancelled && isOrderToday(order);
    });
  }, [orders]);

  const selectedMonthCompletedOrders = useMemo(() => {
    if (monthFilter === 'all') return [];
    return orders.filter((order) => {
      const profitStats = calculateOrderProfit(order);
      return profitStats.isCompleted && !profitStats.isCancelled && isOrderInSelectedMonth(order, monthFilter);
    });
  }, [orders, monthFilter]);

  // Compute available months dynamically starting from January 2026 up to current month
  const availableMonths = useMemo(() => {
    const monthsMap = new Map<string, string>();

    // Always include all months from January 2026 up to current month
    const start2026 = new Date(2026, 0, 1);
    const now = new Date();
    const cursor = new Date(start2026);

    while (
      cursor <= now ||
      (cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth())
    ) {
      const key = format(cursor, 'yyyy-MM');
      const formattedLabel = format(cursor, 'MMMM yyyy', { locale: fr });
      const label = formattedLabel.charAt(0).toUpperCase() + formattedLabel.slice(1);
      monthsMap.set(key, label);
      cursor.setMonth(cursor.getMonth() + 1);
    }

    // Include any additional months present in fetched orders
    orders.forEach((order) => {
      const dateStr = order.date_created || order.date_completed || order.date_paid;
      if (dateStr) {
        try {
          const d = new Date(dateStr);
          if (!isNaN(d.getTime())) {
            const key = format(d, 'yyyy-MM');
            if (!monthsMap.has(key)) {
              const formattedLabel = format(d, 'MMMM yyyy', { locale: fr });
              const label = formattedLabel.charAt(0).toUpperCase() + formattedLabel.slice(1);
              monthsMap.set(key, label);
            }
          }
        } catch {
          // ignore
        }
      }
    });

    const sortedKeys = Array.from(monthsMap.keys()).sort((a, b) => b.localeCompare(a));
    return sortedKeys.map((key) => ({
      value: key,
      label: monthsMap.get(key)!,
    }));
  }, [orders]);

  const currentMonthName = useMemo(() => {
    const now = new Date();
    const formattedLabel = format(now, 'MMMM yyyy', { locale: fr });
    return formattedLabel.charAt(0).toUpperCase() + formattedLabel.slice(1);
  }, []);

  const selectedMonthLabel = useMemo(() => {
    if (monthFilter === 'all') return 'Tous les mois';
    if (monthFilter === 'current') return currentMonthName;
    const found = availableMonths.find((m) => m.value === monthFilter);
    return found ? found.label : monthFilter;
  }, [monthFilter, availableMonths, currentMonthName]);

  // Converted WooCommerce orders map from Firestore: orderId -> list of { type, refId, id, clientId }
  const [convertedMap, setConvertedMap] = useState<
    Record<string, Array<{ type: string; refId: string; id: string; clientId: string }>>
  >({});

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const { showToast } = useNotification();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Listen to existing converted WooCommerce orders in Firestore
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(
      collectionGroup(db, 'purchases'),
      (snapshot) => {
        const map: Record<string, Array<{ type: string; refId: string; id: string; clientId: string }>> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (data.ownerId && data.ownerId !== user.uid) return;

          let wooId =
            data.wooCommerceOrderId !== undefined && data.wooCommerceOrderId !== null
              ? String(data.wooCommerceOrderId)
              : '';

          if (!wooId && data.refId) {
            const match = String(data.refId).match(/^(?:CMD|FC)-WC-(\d+)/i);
            if (match) wooId = match[1];
          }
          if (!wooId && data.description) {
            const match = String(data.description).match(/Commande WooCommerce #(\d+)/i);
            if (match) wooId = match[1];
          }

          if (wooId) {
            if (!map[wooId]) {
              map[wooId] = [];
            }
            const pathParts = docSnap.ref.path.split('/').filter(Boolean);
            const clientsIndex = pathParts.indexOf('clients');
            const cId = data.clientId || (clientsIndex !== -1 ? pathParts[clientsIndex + 1] : pathParts[1]);

            map[wooId].push({
              type: data.type || (data.refId?.startsWith('FC') ? 'facture' : 'commande'),
              refId: data.refId || docSnap.id,
              id: docSnap.id,
              clientId: cId,
            });
          }
        });
        setConvertedMap(map);
      },
      (error) => {
        console.warn('Error reading converted WooCommerce orders:', error);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Real-time listener for WooCommerce order notes and reminders stored in Firestore
  useEffect(() => {
    if (!user) return;

    const notesCol = collection(db, 'woo_order_notes');
    const unsubscribeNotes = onSnapshot(
      notesCol,
      (snapshot) => {
        const remoteNotes: Record<string, string> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.orderId && data.note) {
            remoteNotes[String(data.orderId)] = data.note;
          }
        });
        setStoredOrderNotes(remoteNotes);
        setOrders((prev) => [...prev]);
      },
      (error) => {
        console.warn('Error listening to woo_order_notes from Firestore:', error);
      }
    );

    const remindersCol = collection(db, 'woo_reminders_sent');
    const unsubscribeReminders = onSnapshot(
      remindersCol,
      (snapshot) => {
        const remoteReminders: Record<string, any> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.orderId && data.sentAt) {
            remoteReminders[String(data.orderId)] = {
              sentAt: data.sentAt,
              channel: data.channel || 'manual',
              avanceAmount: data.avanceAmount || '',
              templateType: data.templateType || 'demande_avance',
              history: Array.isArray(data.history) ? data.history : [],
            };
          }
        });
        setStoredRemindersSent(remoteReminders);
        setOrders((prev) => [...prev]);
      },
      (error) => {
        console.warn('Error listening to woo_reminders_sent from Firestore:', error);
      }
    );

    const manualVirementsCol = collection(db, 'woo_manual_virements');
    const unsubscribeManualVirements = onSnapshot(
      manualVirementsCol,
      (snapshot) => {
        const remoteMap: Record<string, ManualVirementInfo> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.orderId && data.isConfirmed) {
            remoteMap[String(data.orderId)] = {
              isConfirmed: true,
              amount: data.amount || 0,
              confirmedAt: data.confirmedAt || data.updatedAt || new Date().toISOString(),
            };
          }
        });
        setStoredManualVirementConfirmations(remoteMap);
        setOrders((prev) => [...prev]);
      },
      (error) => {
        console.warn('Error listening to woo_manual_virements from Firestore:', error);
      }
    );

    return () => {
      unsubscribeNotes();
      unsubscribeReminders();
      unsubscribeManualVirements();
    };
  }, [user]);

  // Check if order has manual virement confirmed
  const checkIsVirementConfirmed = (orderId: number | string): boolean => {
    const info = getManualVirementConfirmationInfo(orderId);
    return !!(info && info.isConfirmed);
  };

  const getManualVirementInfo = (orderId: number | string): ManualVirementInfo | null => {
    return getManualVirementConfirmationInfo(orderId);
  };

  // Toggle virement confirmation
  const toggleVirementConfirmation = (orderId: number | string, isCurrentlyConfirmed: boolean) => {
    if (!isCurrentlyConfirmed) {
      let amt = parseFloat(emailAvanceAmount) || 0;
      if (amt <= 0 && activeModalOrder) {
        const avanceInfo = hasOrderAvance(activeModalOrder);
        const fullTotalInfo = getOrderFullTotal(activeModalOrder);
        const totalOrder = fullTotalInfo.fullTotal > 0 ? fullTotalInfo.fullTotal : parseFloat(activeModalOrder.total || '0');
        amt = avanceInfo.amount > 0 ? avanceInfo.amount : totalOrder;
      }
      saveManualVirementConfirmation(orderId, true, amt);

      if (activeModalOrder) {
        const fullTotalInfo = getOrderFullTotal(activeModalOrder);
        const totalOrder = fullTotalInfo.fullTotal > 0 ? fullTotalInfo.fullTotal : parseFloat(activeModalOrder.total || '0');
        if (amt >= totalOrder && totalOrder > 0) {
          setDocPaymentOverride('paid');
        } else if (amt > 0) {
          setDocPaymentOverride('partial');
        }
      }

      showToast(`Commande #${orderId} : Virement/Acompte de ${amt} MAD marqué comme REÇU !`, 'success');
    } else {
      saveManualVirementConfirmation(orderId, false, 0);
      setDocPaymentOverride('auto');
      showToast(`Confirmation virement décochée pour la commande #${orderId}`, 'info');
    }
    setOrders((prev) => [...prev]);
  };

  const [fetchError, setFetchError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const isFetchingRef = useRef(false);
  const lastFetchTimestampRef = useRef<number>(0);

  const fetchOrders = async (forceRefresh: boolean = false) => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      if (orders.length === 0 || forceRefresh) {
        setLoading(true);
      }
      setFetchError(null);
      const url = forceRefresh ? '/api/woocommerce/orders?refresh=true' : '/api/woocommerce/orders';
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 429) {
          console.warn('Rate limited (429) when fetching WooCommerce orders.');
          if (orders.length > 0) {
            showToast('Serveur WooCommerce très sollicité. Utilisation du cache local.', 'info');
            return;
          }
        }
        const errorJson = await response.json().catch(() => ({}));
        const msg = errorJson.error || errorJson.message || `Erreur du serveur (${response.status})`;
        throw new Error(msg);
      }
      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error("Format de réponse invalide (session expirée ou erreur réseau). Veuillez rafraîchir la page.");
      }
      if (Array.isArray(data) && data.length > 0) {
        setOrders(data);
        saveStoredWooOrders(data);
        const now = new Date();
        setLastSyncTime(now);
        lastFetchTimestampRef.current = now.getTime();
      } else {
        if (!orders || orders.length === 0) setOrders([]);
      }
    } catch (error: any) {
      console.error('Error fetching orders:', error);
      const errorMessage = error?.message || 'Erreur lors de la récupération des commandes';
      if (!orders || orders.length === 0) {
        setFetchError(errorMessage);
      }
      showToast(errorMessage, 'error');
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    fetchOrders();

    // 1-hour auto-refresh interval
    const intervalId = setInterval(() => {
      fetchOrders();
    }, 60 * 60 * 1000);

    // Re-fetch when window gains focus ONLY if at least 5 minutes passed since last sync
    const handleFocus = () => {
      const now = Date.now();
      if (now - lastFetchTimestampRef.current > 5 * 60 * 1000) {
        fetchOrders();
      }
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  // Helper function to map WooCommerce payment method to human-readable string
  const mapWooPaymentMethod = (order: any): string => {
    const method = (order.payment_method || '').toLowerCase().trim();
    const title = (order.payment_method_title || '').toLowerCase().trim();

    if (
      method === 'cod' ||
      method.includes('cash') ||
      method.includes('espece') ||
      title.includes('livraison') ||
      title.includes('espèces') ||
      title.includes('especes') ||
      title.includes('cash') ||
      title.includes('cod')
    ) {
      return 'Espèces à la livraison';
    }

    if (
      method === 'bacs' ||
      method.includes('virement') ||
      method.includes('bank') ||
      title.includes('virement') ||
      title.includes('bank') ||
      title.includes('bacs')
    ) {
      return 'Virement Bancaire';
    }

    if (
      method === 'cheque' ||
      method.includes('cheque') ||
      title.includes('chèque') ||
      title.includes('cheque')
    ) {
      return 'Chèque Bancaire';
    }

    if (order.payment_method_title && order.payment_method_title.trim()) {
      return order.payment_method_title.trim();
    }

    return 'Virement Bancaire';
  };

  // Helper function to get short payment code (COD, VIR, CHQ) and badge styling for WooCommerce table
  const getWooPaymentCodeInfo = (order: any): { code: string; fullText: string; colorClass: string } => {
    const method = (order.payment_method || '').toLowerCase().trim();
    const title = (order.payment_method_title || '').toLowerCase().trim();

    if (
      method === 'cod' ||
      method.includes('cash') ||
      method.includes('espece') ||
      title.includes('livraison') ||
      title.includes('espèces') ||
      title.includes('especes') ||
      title.includes('cash') ||
      title.includes('cod')
    ) {
      return {
        code: 'COD',
        fullText: 'Espèces à la livraison',
        colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20',
      };
    }

    if (
      method === 'bacs' ||
      method.includes('virement') ||
      method.includes('bank') ||
      title.includes('virement') ||
      title.includes('bank') ||
      title.includes('bacs')
    ) {
      return {
        code: 'VIR',
        fullText: 'Virement Bancaire',
        colorClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20',
      };
    }

    if (
      method === 'cheque' ||
      method.includes('cheque') ||
      title.includes('chèque') ||
      title.includes('cheque')
    ) {
      return {
        code: 'CHQ',
        fullText: 'Chèque Bancaire',
        colorClass: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/20',
      };
    }

    const shortCode = order.payment_method ? order.payment_method.toUpperCase().slice(0, 4) : 'VIR';
    return {
      code: shortCode,
      fullText: order.payment_method_title || 'Paiement',
      colorClass: 'bg-slate-100 text-[#566a7f] border-slate-200 dark:bg-[#323249] dark:text-[#dbdade] dark:border-[#434460]/40',
    };
  };

  // Overdue count (+2 days and not terminal)
  const overdueOrdersCount = useMemo(() => {
    return orders.filter((o) => {
      const isTerminal = ['completed', 'cancelled', 'refunded', 'failed', 'trash'].includes((o.status || '').toLowerCase());
      if (isTerminal) return false;
      const days = getDaysSinceOrder(o.date_created).days;
      return days >= 2;
    }).length;
  }, [orders]);

  // Filter orders based on search query, status filter, month filter, and conversion filter
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Status filter (including overdue +2d filter)
      if (statusFilter === 'overdue_2d') {
        const isTerminal = ['completed', 'cancelled', 'refunded', 'failed', 'trash'].includes((order.status || '').toLowerCase());
        const daysAgo = getDaysSinceOrder(order.date_created).days;
        if (isTerminal || daysAgo < 2) return false;
      } else if (statusFilter !== 'all' && order.status !== statusFilter) {
        return false;
      }

      // Month filter
      if (monthFilter !== 'all') {
        const dateStr = order.date_created || order.date_completed || order.date_paid;
        if (!dateStr) return false;
        try {
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) return false;
          if (monthFilter === 'current') {
            const now = new Date();
            if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) {
              return false;
            }
          } else {
            const orderMonthKey = format(d, 'yyyy-MM');
            if (orderMonthKey !== monthFilter) return false;
          }
        } catch {
          return false;
        }
      }

      // Conversion filter
      if (conversionFilter !== 'all') {
        const conversions = convertedMap[String(order.id)] || [];
        if (conversionFilter === 'unconverted' && conversions.length > 0) return false;
        if (conversionFilter === 'commande' && !conversions.some((c) => c.type === 'commande')) return false;
        if (conversionFilter === 'facture' && !conversions.some((c) => c.type === 'facture')) return false;
      }

      // Cost filter
      if (costFilter !== 'all') {
        const profitStats = calculateOrderProfit(order);
        const hasMissingCost = profitStats.hasMissingCost || profitStats.totalPurchaseCost <= 0;
        if (costFilter === 'missing' && !hasMissingCost) return false;
        if (costFilter === 'defined' && hasMissingCost) return false;
      }

      // Reminder filter
      if (reminderFilter !== 'all') {
        const isSent = !!getReminderSentInfo(order.id);
        if (reminderFilter === 'sent' && !isSent) return false;
        if (reminderFilter === 'not_sent' && isSent) return false;
      }

      // Search query
      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase().trim();
      const orderIdStr = String(order.id);
      const firstName = order.billing?.first_name?.toLowerCase() || '';
      const lastName = order.billing?.last_name?.toLowerCase() || '';
      const company = order.billing?.company?.toLowerCase() || '';
      const email = order.billing?.email?.toLowerCase() || '';
      const phone = order.billing?.phone?.toLowerCase() || '';
      const city = order.billing?.city?.toLowerCase() || '';
      const orderNote = getOrderNote(order.id, order.customer_note).toLowerCase();
      const customerNote = (order.customer_note || '').toLowerCase();

      return (
        orderIdStr.includes(q) ||
        firstName.includes(q) ||
        lastName.includes(q) ||
        company.includes(q) ||
        email.includes(q) ||
        phone.includes(q) ||
        city.includes(q) ||
        orderNote.includes(q) ||
        customerNote.includes(q)
      );
    });
  }, [orders, searchQuery, statusFilter, monthFilter, conversionFilter, costFilter, reminderFilter, convertedMap]);

  // Reset page on search or filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, monthFilter, conversionFilter, costFilter, reminderFilter]);

  // Pagination math
  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / itemsPerPage));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredOrders.slice(start, start + itemsPerPage);
  }, [filteredOrders, currentPage]);

  const handleSelectAllOnPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pageIds = paginatedOrders.map((o) => o.id);
      setSelectedOrders((prev) => new Set([...Array.from(prev), ...pageIds]));
    } else {
      const pageIdsSet = new Set(paginatedOrders.map((o) => o.id));
      setSelectedOrders((prev) => new Set(Array.from(prev).filter((id) => !pageIdsSet.has(id))));
    }
  };

  const isAllOnPageSelected =
    paginatedOrders.length > 0 && paginatedOrders.every((o) => selectedOrders.has(o.id));

  const handleSelectOrder = (id: number) => {
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedOrders(newSelected);
  };

  // Helper function to calculate payment status & amount paid for documents
  const computeDocumentPayment = (order: any, subtotal: number) => {
    if (emailTemplateType === 'demande_avance') {
      return { paymentStatus: 'pending', amountPaid: 0 };
    }

    // Confirmation virement mode: strict mathematical calculation from emailAvanceAmount
    const paidVal = parseFloat(emailAvanceAmount) || 0;
    const finalPaid = Math.min(paidVal, subtotal);

    if (finalPaid >= subtotal && subtotal > 0) {
      return { paymentStatus: 'paid', amountPaid: subtotal };
    } else if (finalPaid > 0) {
      return { paymentStatus: 'partial', amountPaid: finalPaid };
    } else {
      return { paymentStatus: 'pending', amountPaid: 0 };
    }
  };

  // Helper function to create document (facture or commande) for a list of order objects
  const createDocumentsForOrders = async (
    ordersList: any[],
    targetType: 'facture' | 'commande'
  ) => {
    if (!user || ordersList.length === 0) return;

    for (const order of ordersList) {
      // 1. Chercher ou créer le client
      const clientName =
        `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() ||
        order.billing?.company ||
        'Client WooCommerce';

      let clientId = '';
      const clientsRef = collection(db, 'clients');
      const q = query(clientsRef, where('name', '==', clientName), where('ownerId', '==', user.uid));
      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        clientId = querySnapshot.docs[0].id;
      } else {
        // Créer nouveau client
        const newClient = await addDoc(clientsRef, {
          ownerId: user.uid,
          name: clientName,
          phone: order.billing?.phone || null,
          email: order.billing?.email || null,
          addressLine1: order.billing?.address_1 || null,
          addressLine2: order.billing?.address_2 || null,
          city: order.billing?.city || null,
          createdAt: serverTimestamp(),
        });
        clientId = newClient.id;
      }

      // 2. Préparer les articles
      const items = (order.line_items || []).map((item: any) => ({
        id: `item-${Date.now()}-${Math.random()}`,
        description: item.name,
        quantity: item.quantity,
        price: parseFloat(item.price) || (item.quantity > 0 ? parseFloat(item.subtotal) / item.quantity : 0),
        tax: 0,
      }));

      // 3. Propriétés selon le type
      const orderTotalInfo = getOrderFullTotal(order);
      const subtotal = orderTotalInfo.fullTotal > 0 ? orderTotalInfo.fullTotal : (parseFloat(order.total) || 0);
      const refId = targetType === 'facture' ? `FC-WC-${order.id}` : `CMD-WC-${order.id}`;
      const modeReglement = mapWooPaymentMethod(order);

      const { paymentStatus, amountPaid } = computeDocumentPayment(order, subtotal);

      // Check if document with refId already exists in purchases
      const existingRefQuery = query(
        collectionGroup(db, 'purchases'),
        where('ownerId', '==', user.uid),
        where('refId', '==', refId)
      );
      const existingSnap = await getDocs(existingRefQuery);

      if (!existingSnap.empty) {
        // Update existing document in Firestore
        const docToUpdate = existingSnap.docs[0];
        await updateDoc(docToUpdate.ref, {
          items: items,
          subtotal: subtotal,
          total: subtotal,
          paymentStatus: paymentStatus,
          amountPaid: amountPaid,
          mode_reglement: modeReglement,
          description: `Commande WooCommerce #${order.id}`,
          amountInWords: convertNumberToFrenchWords(subtotal),
          wooCommerceOrderId: order.id,
          type: targetType,
          clientId: clientId,
          refId: refId,
          updatedAt: serverTimestamp(),
        });
      } else {
        // Create new document in Firestore
        await addDoc(collection(db, 'clients', clientId, 'purchases'), {
          ownerId: user.uid,
          clientId: clientId,
          type: targetType,
          refId: refId,
          conditions_paiement: 'À réception',
          mode_reglement: modeReglement,
          items: items,
          description: `Commande WooCommerce #${order.id}`,
          price: items.length > 0 ? items[0].price : 0,
          quantity: items.reduce((acc: number, item: any) => acc + item.quantity, 0),
          subtotal: subtotal,
          taxAmount: 0,
          taxRate: 0,
          total: subtotal,
          paymentStatus: paymentStatus,
          amountPaid: amountPaid,
          dueDate: new Date(),
          date: serverTimestamp(),
          status: targetType === 'facture' ? 'Brouillon' : 'Validée',
          wooCommerceOrderId: order.id,
          amountInWords: convertNumberToFrenchWords(subtotal),
        });
      }
    }
  };

  const importSelectedOrders = async (targetType: 'facture' | 'commande') => {
    if (selectedOrders.size === 0 || !user) return;

    setImportingType(targetType);
    try {
      const ordersToImport = orders.filter((o) => selectedOrders.has(o.id));
      await createDocumentsForOrders(ordersToImport, targetType);

      if (targetType === 'facture') {
        showToast(`${ordersToImport.length} facture(s) créée(s) avec succès !`, 'success');
        navigate('/facturation');
      } else {
        showToast(`${ordersToImport.length} commande(s) créée(s) avec succès !`, 'success');
        navigate('/purchases');
      }
    } catch (error) {
      console.error('Import error:', error);
      showToast("Erreur lors de l'importation des commandes", 'error');
    } finally {
      setImportingType(null);
      setSelectedOrders(new Set());
    }
  };

  const handleCreateSingleDocument = async (order: any, targetType: 'facture' | 'commande') => {
    if (!user) return;

    setImportingSingleId({ id: order.id, type: targetType });
    try {
      await createDocumentsForOrders([order], targetType);
      setActiveModalOrder(null);

      if (targetType === 'facture') {
        showToast(`Facture / Reçu pour la commande #${order.id} généré avec succès !`, 'success');
        navigate('/facturation');
      } else {
        showToast(`Commande #${order.id} mise à jour / transférée avec succès !`, 'success');
        navigate('/purchases');
      }
    } catch (error) {
      console.error('Import single error:', error);
      showToast("Erreur lors du transfert de la commande", 'error');
    } finally {
      setImportingSingleId(null);
    }
  };

  const handlePrintOrderTicket = (order: any) => {
    try {
      const clientName =
        `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() ||
        order.billing?.company ||
        'CLIENT WOOCOMMERCE';

      const orderTotalInfo = getOrderFullTotal(order);
      const subtotal = orderTotalInfo.fullTotal > 0 ? orderTotalInfo.fullTotal : (parseFloat(order.total) || 0);

      const { paymentStatus, amountPaid } = computeDocumentPayment(order, subtotal);

      const invoiceItems = (order.line_items || []).map((item: any, idx: number) => ({
        id: item.id || idx,
        description: item.name,
        quantity: item.quantity,
        unitPrice: parseFloat(item.price) || (item.quantity > 0 ? parseFloat(item.subtotal) / item.quantity : 0),
      }));

      const ticketData: InvoiceData = {
        type: 'COMMANDE',
        number: `WC-${order.id}`,
        date: order.date_created
          ? format(new Date(order.date_created), 'dd/MM/yyyy HH:mm', { locale: fr })
          : new Date().toLocaleDateString('fr-FR'),
        validity: '',
        paymentTerms: 'À réception',
        modeReglement: mapWooPaymentMethod(order),
        client: {
          name: clientName,
          addressLine1: order.billing?.address_1 || '',
          city: order.billing?.city || '',
          phone: order.billing?.phone || '',
          ice: '',
        },
        items: invoiceItems,
        taxRate: 0,
        subtotal: subtotal,
        total: subtotal,
        amountPaid: amountPaid,
        paymentStatus: paymentStatus as any,
        notes: [order.customer_note, getOrderNote(order.id)].filter(Boolean).join('\n') || undefined,
      };

      printTicket(ticketData);
      showToast(`Impression du ticket pour la commande #${order.id} lancée`, 'success');
    } catch (error) {
      console.error('Error printing ticket:', error);
      showToast("Erreur lors de l'impression du ticket", 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20">
            <CheckCircle2 size={13} />
            Terminée
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-sky-50 text-sky-600 border border-sky-100 dark:bg-sky-500/10 dark:text-sky-400 dark:border-sky-500/20">
            <Clock size={13} />
            En cours
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
            <AlertCircle size={13} />
            En attente
          </span>
        );
      case 'on-hold':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-50 text-amber-600 border border-amber-100 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20">
            <Clock size={13} />
            En attente paiement
          </span>
        );
      case 'cancelled':
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-rose-50 text-rose-600 border border-rose-100 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20">
            <XCircle size={13} />
            {status === 'cancelled' ? 'Annulée' : 'Échouée'}
          </span>
        );
      case 'refunded':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-purple-50 text-purple-600 border border-purple-100 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20">
            <RefreshCw size={13} />
            Remboursée
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-300">
            {status}
          </span>
        );
    }
  };

  return (
    <div className="w-full py-6 md:py-10">
      {/* Top Profit Summary Header for WooCommerce - Attached Sneat Style */}
      <div className="mb-5 bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-[#dbdade]/70 dark:divide-[#434460]/40 grid grid-cols-1 sm:grid-cols-3 overflow-hidden shadow-2xs">
        {/* Card 1: Profit Today */}
        <div
          onClick={() => setShowTodayProfitModal(true)}
          className="p-4 md:p-5 flex items-center justify-between text-left cursor-pointer transition-all hover:bg-emerald-50/50 dark:hover:bg-emerald-500/10 group relative"
          title="Cliquer pour voir le détail des bénéfices d'aujourd'hui"
        >
          <div className="flex items-center gap-3.5 w-full">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 font-bold text-lg group-hover:scale-105 transition-transform">
              +
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                  Bénéfice Journée
                </span>
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                  <Eye size={12} /> Détails
                </span>
              </div>
              <div className="text-xl font-mono font-extrabold text-emerald-700 dark:text-emerald-300 mt-0.5">
                +{wooProfitStats.todayProfit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                <span className="text-xs font-sans">MAD</span>
              </div>
              <span className="text-[11px] text-[#a1acb8]">
                {wooProfitStats.todayCompletedCount} commande{wooProfitStats.todayCompletedCount > 1 ? 's' : ''} terminée{wooProfitStats.todayCompletedCount > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Card 2: Profit This Month / Selected Month */}
        <div
          onClick={() => {
            if (monthFilter !== 'all') {
              setShowMonthProfitModal(true);
            }
          }}
          className={`p-4 md:p-5 flex items-center justify-between text-left transition-all ${
            monthFilter !== 'all'
              ? 'cursor-pointer hover:bg-purple-50/50 dark:hover:bg-purple-500/10 group relative'
              : ''
          }`}
          title={monthFilter !== 'all' ? `Cliquer pour voir le détail des bénéfices (${selectedMonthLabel})` : undefined}
        >
          <div className="flex items-center gap-3.5 w-full">
            <div className={`w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 font-bold text-lg ${
              monthFilter !== 'all' ? 'group-hover:scale-105 transition-transform' : ''
            }`}>
              ★
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between gap-1">
                <span className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300 block">
                  Bénéfice {monthFilter === 'all' ? 'du Mois' : `(${selectedMonthLabel})`}
                </span>
                {monthFilter !== 'all' && (
                  <span className="text-[10px] font-semibold text-purple-600 dark:text-purple-300 bg-purple-100/70 dark:bg-purple-500/20 px-2 py-0.5 rounded-full flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                    <Eye size={12} /> Détails
                  </span>
                )}
              </div>
              <div className="text-xl font-mono font-extrabold text-purple-700 dark:text-purple-300 mt-0.5">
                +{wooProfitStats.monthProfit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                <span className="text-xs font-sans">MAD</span>
              </div>
              <span className="text-[11px] text-[#a1acb8]">
                {wooProfitStats.monthCompletedCount} commande{wooProfitStats.monthCompletedCount > 1 ? 's' : ''} terminée{wooProfitStats.monthCompletedCount > 1 ? 's' : ''}
              </span>
            </div>
          </div>
        </div>

        {/* Card 3: Month Sales */}
        <div className="p-4 md:p-5 flex items-center justify-between text-left">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-lg bg-slate-100 dark:bg-[#323249] text-[#696cff] flex items-center justify-center shrink-0">
              <ShoppingBag size={20} />
            </div>
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#a1acb8] block">
                Ventes Terminées
              </span>
              <div className="text-xl font-mono font-bold text-[#435971] dark:text-[#dbdade] mt-0.5">
                {wooProfitStats.monthSales.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                <span className="text-xs font-sans">MAD</span>
              </div>
              <span className="text-[11px] text-[#a1acb8]">
                Statut "Terminée" uniquement
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Card container with Search, Filters, Table and Pagination */}
      <div className="sneat-table-container w-full overflow-hidden mb-8 bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg shadow-xs">
        {/* Filter bar */}
        <div className="p-3.5 md:p-4 border-b border-[#dbdade]/70 dark:border-[#434460]/40 flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-center justify-between bg-white dark:bg-[#2b2c40]">
          {/* Search box & Overdue Quick Filter */}
          <div className="flex items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1">
              <Search
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8e9baa] dark:text-[#a1acb8]"
              />
              <input
                type="text"
                placeholder="Rechercher par N°, Nom, Email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-9 py-2 bg-[#f8f9fa] dark:bg-[#232333] border border-[#e8eaed] dark:border-[#434460]/40 rounded-lg text-sm font-sans text-[#566a7f] dark:text-[#dbdade] placeholder-[#9ca3af] focus:outline-none focus:border-[#696cff] focus:bg-white dark:focus:bg-[#232333] transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a1acb8] hover:text-[#566a7f]"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            {/* Quick Overdue Filter Badge */}
            {overdueOrdersCount > 0 && (
              <button
                type="button"
                onClick={() => setStatusFilter(statusFilter === 'overdue_2d' ? 'all' : 'overdue_2d')}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer shadow-2xs shrink-0 select-none ${
                  statusFilter === 'overdue_2d'
                    ? 'bg-rose-600 text-white shadow-xs ring-2 ring-rose-300 dark:ring-rose-900'
                    : 'bg-rose-50 hover:bg-rose-100/90 text-rose-700 border border-rose-200/80 dark:bg-rose-950/40 dark:hover:bg-rose-900/50 dark:text-rose-300 dark:border-rose-800/80'
                }`}
                title="Filtrer : Afficher uniquement les commandes de plus de 2 jours non terminées"
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
                </span>
                <span className="whitespace-nowrap">{overdueOrdersCount} en retard (+2j)</span>
              </button>
            )}
          </div>

          {/* Status, Month, Conversion & Cost Filters + Refresh Icon */}
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-between lg:justify-end">
            {/* WooCommerce Status Filter */}
            <div className="flex-1 sm:flex-initial min-w-[145px]">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full py-2 px-3 bg-[#f8f9fa] dark:bg-[#232333] border border-[#e8eaed] dark:border-[#434460]/40 rounded-lg text-sm font-sans text-[#566a7f] dark:text-[#dbdade] focus:outline-none focus:border-[#696cff] focus:bg-white dark:focus:bg-[#232333] transition-all cursor-pointer"
              >
                <option value="all">Tous les statuts</option>
                {overdueOrdersCount > 0 && (
                  <option value="overdue_2d" className="font-bold text-rose-600">
                    🚨 En retard +2j ({overdueOrdersCount})
                  </option>
                )}
                <option value="completed">Terminée (Completed)</option>
                <option value="processing">En cours (Processing)</option>
                <option value="pending">En attente (Pending)</option>
                <option value="on-hold">En attente paiement (On-hold)</option>
                <option value="cancelled">Annulée (Cancelled)</option>
                <option value="refunded">Remboursée (Refunded)</option>
                <option value="failed">Échouée (Failed)</option>
              </select>
            </div>

            {/* Month Filter */}
            <div className="flex-1 sm:flex-initial min-w-[160px]">
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="w-full py-2 px-3 bg-[#f8f9fa] dark:bg-[#232333] border border-[#e8eaed] dark:border-[#434460]/40 rounded-lg text-sm font-sans text-[#566a7f] dark:text-[#dbdade] focus:outline-none focus:border-[#696cff] focus:bg-white dark:focus:bg-[#232333] transition-all cursor-pointer"
              >
                <option value="all">Tous les mois (Global)</option>
                <option value="current">Mois en cours ({currentMonthName})</option>
                {availableMonths.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Conversion Filter */}
            <div className="flex-1 sm:flex-initial min-w-[150px]">
              <select
                value={conversionFilter}
                onChange={(e) => setConversionFilter(e.target.value as any)}
                className="w-full py-2 px-3 bg-[#f8f9fa] dark:bg-[#232333] border border-[#e8eaed] dark:border-[#434460]/40 rounded-lg text-sm font-sans text-[#566a7f] dark:text-[#dbdade] focus:outline-none focus:border-[#696cff] focus:bg-white dark:focus:bg-[#232333] transition-all cursor-pointer"
              >
                <option value="all">Tous les transferts</option>
                <option value="unconverted">Non convertis uniquement</option>
                <option value="commande">Convertis en Commande</option>
                <option value="facture">Convertis en Facture</option>
              </select>
            </div>

            {/* Cost Filter */}
            <div className="flex-1 sm:flex-initial min-w-[140px]">
              <select
                value={costFilter}
                onChange={(e) => setCostFilter(e.target.value as any)}
                className="w-full py-2 px-3 bg-[#f8f9fa] dark:bg-[#232333] border border-[#e8eaed] dark:border-[#434460]/40 rounded-lg text-sm font-sans text-[#566a7f] dark:text-[#dbdade] focus:outline-none focus:border-[#696cff] focus:bg-white dark:focus:bg-[#232333] transition-all cursor-pointer"
              >
                <option value="all">Tous les coûts</option>
                <option value="missing">⚠️ Coût non défini (0 MAD)</option>
                <option value="defined">Coût d'achat renseigné</option>
              </select>
            </div>


            {/* Refresh Icon Button at the far right */}
            <button
              onClick={() => fetchOrders(true)}
              disabled={loading || !!importingType}
              title={lastSyncTime ? `Actualiser les commandes (Dernière synchro: ${lastSyncTime.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})` : "Actualiser les commandes"}
              className="p-2 bg-[#f8f9fa] dark:bg-[#232333] text-[#566a7f] dark:text-[#a1acb8] border border-[#e8eaed] dark:border-[#434460]/40 rounded-lg hover:bg-slate-100 dark:hover:bg-[#323249] hover:text-[#696cff] transition-all cursor-pointer shrink-0 flex items-center justify-center min-w-[38px] h-[38px]"
            >
              <RefreshCw size={17} className={loading ? 'animate-spin text-[#696cff]' : ''} />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-slate-100/70 dark:bg-[#323249] border-b border-[#dbdade]/70 dark:border-[#434460]/40 text-[11px] uppercase tracking-widest font-bold text-[#566a7f] dark:text-[#a3a4cc] select-none h-12">
                <th className="py-3 px-4 text-center w-12">
                  <input
                    type="checkbox"
                    className="w-4 h-4 text-[#696cff] border-[#dbdade] rounded focus:ring-[#696cff] cursor-pointer"
                    checked={isAllOnPageSelected}
                    onChange={handleSelectAllOnPage}
                  />
                </th>
                <th className="py-3 px-5 text-left">N° Commande</th>
                <th className="py-3 px-5 text-left">Client</th>
                <th className="py-3 px-5 text-left">Date</th>
                <th className="py-3 px-3 text-center" title="Temps écoulé depuis la création de la commande (en jours)">Délai</th>
                <th className="py-3 px-5 text-left">Paiement</th>
                <th className="py-3 px-5 text-left">Statut</th>
                <th className="py-3 px-5 text-right">Total</th>
                <th className="py-3 px-5 text-right">Bénéfice</th>
                <th className="py-3 px-5 text-center">Actions</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[#a1acb8]">
                    <div className="flex flex-col items-center justify-center">
                      <RefreshCw size={30} className="animate-spin mb-3 text-[#696cff]" />
                      <p className="text-sm font-medium">Chargement des commandes depuis WooCommerce...</p>
                    </div>
                  </td>
                </tr>
              ) : fetchError ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center">
                    <div className="flex flex-col items-center justify-center max-w-md mx-auto p-4 bg-rose-50 dark:bg-rose-500/10 rounded-lg border border-rose-200 dark:border-rose-500/20 text-rose-600 dark:text-rose-400">
                      <AlertCircle size={32} className="mb-2" />
                      <p className="text-sm font-bold mb-1">Erreur de connexion WooCommerce</p>
                      <p className="text-xs mb-3 text-rose-500 dark:text-rose-300">{fetchError}</p>
                      <button
                        onClick={() => fetchOrders(true)}
                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <RefreshCw size={14} /> Réessayer
                      </button>
                    </div>
                  </td>
                </tr>
              ) : paginatedOrders.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-[#a1acb8]">
                    Aucune commande trouvée
                  </td>
                </tr>
              ) : (
                paginatedOrders.map((order) => {
                  const clientName =
                    `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() ||
                    order.billing?.company ||
                    'Client sans nom';

                  const clientInitials = clientName
                    ? clientName
                        .split(' ')
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((n: string) => n[0])
                        .join('')
                        .toUpperCase()
                    : '?';

                  const isSelected = selectedOrders.has(order.id);
                  const conversions = convertedMap[String(order.id)] || [];
                  const hasCommande = conversions.some((c) => c.type === 'commande');
                  const hasFacture = conversions.some((c) => c.type === 'facture');
                  const mappedPayment = mapWooPaymentMethod(order);
                  const profitStats = calculateOrderProfit(order);
                  const orderTotalInfo = getOrderFullTotal(order);
                  const hasMissingCost = profitStats.hasMissingCost || profitStats.totalPurchaseCost <= 0;
                  const orderNote = getOrderNote(order.id, order.customer_note);
                  const reminderInfo = getReminderSentInfo(order.id);

                  // Delay / Overdue calculation (+2 days and not terminal)
                  const daysAgo = getDaysSinceOrder(order.date_created).days;
                  const isTerminal =
                    profitStats.isCompleted ||
                    profitStats.isCancelled ||
                    ['completed', 'cancelled', 'refunded', 'failed', 'trash'].includes((order.status || '').toLowerCase());
                  const isOverdue = !isTerminal && daysAgo >= 2;
                  const isCriticalOverdue = !isTerminal && daysAgo >= 3;

                  return (
                    <tr
                      key={order.id}
                      className={`border-b border-[#dbdade]/70 dark:border-[#434460]/40 transition-all duration-200 group cursor-pointer h-[72px] ${
                        isSelected ? 'bg-[#696cff]/5 dark:bg-[#696cff]/10' : ''
                      } ${
                        isOverdue
                          ? isCriticalOverdue
                            ? 'border-l-4 border-l-rose-500 bg-rose-50/25 dark:bg-rose-950/20 hover:bg-gradient-to-r hover:from-rose-100/90 hover:via-rose-50/80 hover:to-white dark:hover:from-rose-950/60 dark:hover:via-rose-900/40 dark:hover:to-[#2b2c40] hover:border-l-[6px] hover:border-l-rose-600 dark:hover:border-l-rose-400 hover:shadow-md'
                            : 'border-l-4 border-l-amber-500 bg-amber-50/20 dark:bg-amber-950/15 hover:bg-gradient-to-r hover:from-amber-100/90 hover:via-amber-50/80 hover:to-white dark:hover:from-amber-950/60 dark:hover:via-amber-900/40 dark:hover:to-[#2b2c40] hover:border-l-[6px] hover:border-l-amber-600 dark:hover:border-l-amber-400 hover:shadow-md'
                          : hasMissingCost
                          ? 'hover:bg-orange-50/80 dark:hover:bg-orange-950/30 hover:border-l-4 hover:border-l-orange-400'
                          : 'hover:bg-[#f5f5f9]/40 dark:hover:bg-[#232333]/30'
                      }`}
                      onClick={() => setActiveModalOrder(order)}
                    >
                      <td className="px-4 text-center w-12" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          className="w-4 h-4 text-[#696cff] border-[#dbdade] rounded focus:ring-[#696cff] cursor-pointer"
                          checked={isSelected}
                          onChange={() => handleSelectOrder(order.id)}
                        />
                      </td>

                      <td className="px-5">
                        <div className="flex items-center gap-1.5">
                          {/* Blinking attention pulse for overdue orders */}
                          {isOverdue && (
                            <span
                              className="relative flex h-2.5 w-2.5 shrink-0"
                              title={`⚠️ Attention : Commande non terminée depuis ${daysAgo} jour(s)`}
                            >
                              <span
                                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                                  isCriticalOverdue ? 'bg-rose-400' : 'bg-amber-400'
                                }`}
                              ></span>
                              <span
                                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                                  isCriticalOverdue ? 'bg-rose-500' : 'bg-amber-500'
                                }`}
                              ></span>
                            </span>
                          )}

                          <span
                            className={`font-mono font-bold text-sm ${
                              isOverdue
                                ? isCriticalOverdue
                                  ? 'text-rose-700 dark:text-rose-300 font-black'
                                  : 'text-amber-800 dark:text-amber-300 font-black'
                                : 'text-[#696cff] dark:text-[#b1b4ff]'
                            }`}
                          >
                            #{order.id}
                          </span>

                          {/* Discrete Indicator Icons with Tooltips */}
                          {hasMissingCost && !profitStats.isCancelled && (
                            <span
                              className="p-1 text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-950/30 rounded cursor-help inline-flex items-center justify-center transition-colors"
                              title="Prix d'achat non renseigné ou égal à 0 MAD"
                            >
                              <AlertCircle size={14} />
                            </span>
                          )}

                          {orderNote && (
                            <span
                              className="p-1 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 rounded cursor-help inline-flex items-center justify-center transition-colors"
                              title={`Note : ${orderNote}`}
                            >
                              <StickyNote size={14} />
                            </span>
                          )}

                          {reminderInfo && (
                            <span
                              className={`p-1 rounded cursor-help inline-flex items-center justify-center transition-colors ${
                                reminderInfo.templateType === 'confirmation_virement'
                                  ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40'
                                  : 'text-purple-600 hover:bg-purple-50 dark:text-purple-400 dark:hover:bg-purple-950/40'
                              }`}
                              title={`${
                                reminderInfo.templateType === 'confirmation_virement' ? 'Confirmation' : 'Rappel'
                              } envoyé le ${format(new Date(reminderInfo.sentAt), 'dd/MM/yyyy à HH:mm', { locale: fr })} (${reminderInfo.channel})`}
                            >
                              <CheckCheck size={14} />
                            </span>
                          )}

                          {hasCommande && (
                            <span
                              className="p-1 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40 rounded cursor-help inline-flex items-center justify-center transition-colors"
                              title="Converti en Bon de Commande / BL"
                            >
                              <FileText size={14} />
                            </span>
                          )}

                          {hasFacture && (
                            <span
                              className="p-1 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40 rounded cursor-help inline-flex items-center justify-center transition-colors"
                              title="Converti en Facture"
                            >
                              <Receipt size={14} />
                            </span>
                          )}
                        </div>

                        {/* Amana Tracking Code Badge */}
                        {(() => {
                          const trackingCode =
                            order.tracking_number ||
                            orderTrackingMap[String(order.id)] ||
                            orderTrackingMap[order.id] ||
                            (order.meta_data &&
                              order.meta_data.find(
                                (m: any) =>
                                  m.key === '_tracking_number' ||
                                  m.key === 'tracking_number' ||
                                  m.key === '_amana_tracking'
                              )?.value) ||
                            '';
                          if (!trackingCode) return null;

                          return (
                            <div
                              className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-indigo-50/90 dark:bg-[#323249] text-[#696cff] dark:text-[#b1b4ff] border border-indigo-200/80 dark:border-indigo-800/60 text-[10px] font-mono font-bold"
                              title={`Suivi Amana / Barid : ${trackingCode}`}
                            >
                              <Truck size={11} className="shrink-0" />
                              <span>{trackingCode}</span>
                            </div>
                          );
                        })()}
                      </td>

                      <td className="px-5">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-slate-100 dark:bg-[#323450] text-[#696cff] dark:text-[#b1b4ff] ring-4 ring-[#696cff]/10 rounded-full flex items-center justify-center shrink-0 font-extrabold text-[11px] uppercase transition-transform duration-300 group-hover:scale-105 shadow-3xs">
                            {clientInitials}
                          </div>
                          <div className="flex flex-col">
                            <h4 className="font-bold text-[#222222] dark:text-[#dbdade] text-[14px] tracking-tight group-hover:text-[#696cff] transition-colors">
                              {clientName.toUpperCase()}
                            </h4>
                            <span className="text-[11px] text-[#a1acb8] font-sans truncate max-w-[180px]">
                              {order.billing?.email || 'Sans email'}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="px-5 whitespace-nowrap">
                        <span className="text-[13px] text-[#435971] dark:text-[#dbdade] font-medium font-mono">
                          {order.date_created
                            ? format(new Date(order.date_created), 'dd MMM yyyy HH:mm', { locale: fr })
                            : '-'}
                        </span>
                      </td>

                      <td className="px-3 text-center whitespace-nowrap">
                        {(() => {
                          if (isTerminal) {
                            return <span className="text-[#a1acb8] text-xs font-mono">-</span>;
                          }

                          if (daysAgo === 0) {
                            return (
                              <span
                                className="inline-flex items-center justify-center min-w-[34px] px-2 py-0.5 rounded-full text-xs font-mono border bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20 font-bold"
                                title="Commande créée aujourd'hui (en attente)"
                              >
                                0j
                              </span>
                            );
                          }

                          if (daysAgo === 1) {
                            return (
                              <span
                                className="inline-flex items-center justify-center min-w-[34px] px-2 py-0.5 rounded-full text-xs font-mono border bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-bold"
                                title="En attente depuis 1 jour"
                              >
                                1j
                              </span>
                            );
                          }

                          // Overdue >= 2 days
                          return (
                            <span
                              className={`inline-flex items-center gap-1 min-w-[38px] px-2.5 py-0.5 rounded-full text-xs font-mono font-black border transition-transform group-hover:scale-105 ${
                                isCriticalOverdue
                                  ? 'bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/80 dark:text-rose-300 dark:border-rose-800 animate-pulse ring-2 ring-rose-400/30 shadow-2xs'
                                  : 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-800 animate-pulse ring-2 ring-amber-400/30 shadow-2xs'
                              }`}
                              title={`⚠️ Attention : commande non terminée depuis ${daysAgo} jour(s)`}
                            >
                              <Clock
                                size={11}
                                className="animate-spin text-current shrink-0"
                                style={{ animationDuration: '3s' }}
                              />
                              <span>{daysAgo}j</span>
                            </span>
                          );
                        })()}
                      </td>

                      <td className="px-5 whitespace-nowrap">
                        {(() => {
                          const paymentInfo = getWooPaymentCodeInfo(order);
                          return (
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono font-extrabold border ${paymentInfo.colorClass}`}
                              title={paymentInfo.fullText}
                            >
                              {paymentInfo.code}
                            </span>
                          );
                        })()}
                      </td>

                      <td className="px-5">{getStatusBadge(order.status)}</td>

                      <td className="px-5 text-right font-mono text-sm">
                        <div className="font-bold text-[#222222] dark:text-white">
                          {orderTotalInfo.fullTotal.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          <span className="text-xs font-sans text-[#a1acb8]">MAD</span>
                        </div>
                        {orderTotalInfo.isDeposit && (
                          <div className="text-[10px] text-blue-600 dark:text-blue-400 font-sans font-normal mt-0.5">
                            (Acompte : {orderTotalInfo.depositAmount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD)
                          </div>
                        )}
                      </td>

                      <td className="px-5 text-right font-mono text-sm">
                        {profitStats.isCancelled ? (
                          <span className="text-[#a1acb8] font-normal">-</span>
                        ) : (
                          <div>
                            <span
                              className={`font-bold ${
                                profitStats.profit > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : profitStats.profit < 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-[#566a7f] dark:text-[#a1acb8]'
                              }`}
                            >
                              {profitStats.profit > 0 ? '+' : ''}
                              {profitStats.profit.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              <span className="text-xs font-sans font-normal text-[#a1acb8]">MAD</span>
                            </span>
                            {hasMissingCost && (
                              <div
                                className="text-[10px] text-orange-500/90 dark:text-orange-400 font-sans font-normal mt-0.5 flex items-center justify-end gap-0.5"
                                title="Prix d'achat non renseigné ou égal à 0 MAD"
                              >
                                <AlertCircle size={10} />
                                Coût non défini
                              </div>
                            )}
                          </div>
                        )}
                      </td>

                      <td className="px-5 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="relative inline-block text-left">
                          <button
                            onClick={() => setActiveDropdownId(activeDropdownId === order.id ? null : order.id)}
                            className="p-1.5 text-[#566a7f] dark:text-[#a1acb8] hover:bg-slate-100 dark:hover:bg-[#323249] hover:text-[#696cff] dark:hover:text-[#696cff] rounded-lg transition-colors cursor-pointer"
                            title="Actions"
                          >
                            <MoreVertical size={18} />
                          </button>

                          {activeDropdownId === order.id && (
                            <>
                              {/* Backdrop to dismiss dropdown on click outside */}
                              <div
                                className="fixed inset-0 z-20"
                                onClick={() => setActiveDropdownId(null)}
                              />

                              <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-[#2b2c40] border border-[#dbdade]/80 dark:border-[#434460]/60 rounded-xl shadow-lg z-30 py-1.5 text-left animate-in fade-in zoom-in-95 duration-100">
                                <button
                                  onClick={() => {
                                    setActiveDropdownId(null);
                                    setActiveModalOrder(order);
                                  }}
                                  className="w-full px-3.5 py-2 text-xs font-semibold text-[#566a7f] dark:text-[#dbdade] hover:bg-slate-50 dark:hover:bg-[#323249] flex items-center gap-2.5 transition-colors cursor-pointer"
                                >
                                  <Eye size={15} className="text-[#696cff]" />
                                  <span>Voir détails</span>
                                </button>

                                {!['cancelled', 'refunded', 'failed', 'trash'].includes((order.status || '').toLowerCase()) && (
                                  <>
                                    <button
                                      onClick={() => {
                                        setActiveDropdownId(null);
                                        handleCreateSingleDocument(order, 'commande');
                                  }}
                                  disabled={importingSingleId?.id === order.id}
                                  className="w-full px-3.5 py-2 text-xs font-semibold text-[#566a7f] dark:text-[#dbdade] hover:bg-slate-50 dark:hover:bg-[#323249] flex items-center justify-between gap-2.5 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  <div className="flex items-center gap-2.5">
                                    {importingSingleId?.id === order.id && importingSingleId.type === 'commande' ? (
                                      <RefreshCw size={15} className="animate-spin text-emerald-600" />
                                    ) : (
                                      <ShoppingBag size={15} className="text-emerald-600" />
                                    )}
                                    <span>Créer commande</span>
                                  </div>
                                  {hasCommande && (
                                    <span className="text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 px-1.5 py-0.5 rounded-full font-bold">
                                      Créée
                                    </span>
                                  )}
                                </button>

                                <button
                                  onClick={() => {
                                    setActiveDropdownId(null);
                                    handleCreateSingleDocument(order, 'facture');
                                  }}
                                  disabled={importingSingleId?.id === order.id}
                                  className="w-full px-3.5 py-2 text-xs font-semibold text-[#566a7f] dark:text-[#dbdade] hover:bg-slate-50 dark:hover:bg-[#323249] flex items-center justify-between gap-2.5 transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  <div className="flex items-center gap-2.5">
                                    {importingSingleId?.id === order.id && importingSingleId.type === 'facture' ? (
                                      <RefreshCw size={15} className="animate-spin text-indigo-600" />
                                    ) : (
                                      <FileText size={15} className="text-indigo-600" />
                                    )}
                                    <span>Créer facture</span>
                                  </div>
                                  {hasFacture && (
                                    <span className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 px-1.5 py-0.5 rounded-full font-bold">
                                      Créée
                                    </span>
                                  )}
                                </button>

                                <button
                                  onClick={() => {
                                    setActiveDropdownId(null);
                                    handlePrintOrderTicket(order);
                                  }}
                                  className="w-full px-3.5 py-2 text-xs font-semibold text-[#566a7f] dark:text-[#dbdade] hover:bg-slate-50 dark:hover:bg-[#323249] flex items-center gap-2.5 transition-colors cursor-pointer border-t border-slate-100 dark:border-[#434460]/40 mt-1 pt-2"
                                >
                                  <Printer size={15} className="text-amber-600 dark:text-amber-400" />
                                  <span>Imprimer ticket</span>
                                </button>
                              </>
                            )}

                                {(() => {
                                  const isReminderSent = !!reminderInfo;
                                  return (
                                    <button
                                      onClick={() => {
                                        setActiveDropdownId(null);
                                        if (isReminderSent) {
                                          deleteReminderSent(order.id);
                                          showToast('Statut de rappel réinitialisé', 'info');
                                        } else {
                                          saveReminderSent(order.id, 'manual');
                                          showToast('Commande marquée comme "Rappel envoyé"', 'success');
                                        }
                                        setOrders((prev) => [...prev]);
                                      }}
                                      className="w-full px-3.5 py-2 text-xs font-semibold text-[#566a7f] dark:text-[#dbdade] hover:bg-slate-50 dark:hover:bg-[#323249] flex items-center justify-between gap-2.5 transition-colors cursor-pointer border-t border-slate-100 dark:border-[#434460]/40 mt-1 pt-2"
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <CheckCheck size={15} className={isReminderSent ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400'} />
                                        <span>Rappel d'avance</span>
                                      </div>
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                                        isReminderSent
                                          ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
                                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                                      }`}>
                                        {isReminderSent ? 'Envoyé' : 'Non envoyé'}
                                      </span>
                                    </button>
                                  );
                                })()}
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        {!loading && filteredOrders.length > 0 && (
          <div className="px-5 py-3.5 border-t border-[#dbdade]/70 dark:border-[#434460]/40 flex flex-col lg:flex-row items-center justify-between gap-4 bg-white dark:bg-[#2b2c40]">
            {/* Left: Items per page selector */}
            <div className="flex items-center gap-2 text-xs text-[#566a7f] dark:text-[#a1acb8] whitespace-nowrap shrink-0">
              <span>Afficher</span>
              <select
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="py-1 px-2.5 bg-slate-100/80 dark:bg-[#232333] border border-slate-200/80 dark:border-[#434460]/60 rounded-md text-xs font-semibold text-[#566a7f] dark:text-white focus:outline-none focus:border-[#696cff] cursor-pointer"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={25}>25</option>
                <option value={40}>40</option>
              </select>
              <span>/ page</span>
            </div>

            {/* Center: Count info */}
            <div className="text-xs text-[#566a7f] dark:text-[#a1acb8] whitespace-nowrap shrink-0">
              Affichage de{' '}
              <span className="font-semibold text-[#566a7f] dark:text-white">
                {Math.min((currentPage - 1) * itemsPerPage + 1, filteredOrders.length)}
              </span>{' '}
              à{' '}
              <span className="font-semibold text-[#566a7f] dark:text-white">
                {Math.min(currentPage * itemsPerPage, filteredOrders.length)}
              </span>{' '}
              sur <span className="font-semibold text-[#566a7f] dark:text-white">{filteredOrders.length}</span> commandes
            </div>

            {/* Right: Pagination Controls */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="w-8 h-8 flex items-center justify-center rounded-md border border-[#dbdade] dark:border-[#434460] text-[#a1acb8] hover:bg-slate-100 dark:hover:bg-[#323249] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                title="Page précédente"
              >
                <ChevronLeft size={16} />
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((page) => {
                    return (
                      page === 1 ||
                      page === totalPages ||
                      Math.abs(page - currentPage) <= 1
                    );
                  })
                  .map((page, idx, arr) => {
                    const prevPage = arr[idx - 1];
                    const showEllipsis = prevPage && page - prevPage > 1;

                    return (
                      <React.Fragment key={page}>
                        {showEllipsis && (
                          <span className="px-1 text-xs text-[#a1acb8]">...</span>
                        )}
                        <button
                          onClick={() => setCurrentPage(page)}
                          className={`w-8 h-8 flex items-center justify-center text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                            currentPage === page
                              ? 'bg-[#696cff] text-white shadow-2xs'
                              : 'text-[#566a7f] dark:text-[#a1acb8] hover:bg-slate-100 dark:hover:bg-[#323249]'
                          }`}
                        >
                          {page}
                        </button>
                      </React.Fragment>
                    );
                  })}
              </div>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="w-8 h-8 flex items-center justify-center rounded-md border border-[#dbdade] dark:border-[#434460] text-[#a1acb8] hover:bg-slate-100 dark:hover:bg-[#323249] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                title="Page suivante"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Order Detail Modal */}
      {activeModalOrder && (
        <div
          onClick={() => setActiveModalOrder(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-black/50 backdrop-blur-xs overflow-y-auto"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-[#2b2c40] rounded-xl shadow-xl border border-[#dbdade]/70 dark:border-[#434460]/40 w-full max-w-5xl h-[88vh] max-h-[850px] min-h-[620px] overflow-hidden flex flex-col my-auto"
          >
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-[#dbdade]/70 dark:border-[#434460]/40 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50 dark:bg-[#232333]/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-[#696cff]/10 text-[#696cff]">
                    <ShoppingCart size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-lg font-bold text-[#566a7f] dark:text-white">
                        Commande #{activeModalOrder.id}
                      </h2>
                      {getStatusBadge(activeModalOrder.status)}
                    </div>
                    <p className="text-xs text-[#a1acb8] mt-0.5 flex items-center gap-2 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar size={13} />
                        {activeModalOrder.date_created
                          ? format(new Date(activeModalOrder.date_created), 'dd MMMM yyyy à HH:mm', {
                              locale: fr,
                            })
                          : ''}
                      </span>
                      {activeModalOrder.status !== 'completed' && activeModalOrder.status !== 'cancelled' && (() => {
                        const delayInfo = getDaysSinceOrder(activeModalOrder.date_created);
                        const isOverdue = delayInfo.days >= 2;
                        return (
                          <span
                            className={`text-[11px] font-mono px-2 py-0.5 rounded-full flex items-center gap-1 border ${
                              isOverdue
                                ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800 font-bold animate-pulse'
                                : 'bg-slate-100 dark:bg-[#323249] text-[#566a7f] dark:text-[#dbdade] border-[#dbdade]/50 dark:border-[#434460]/40'
                            }`}
                          >
                            <Clock size={11} className={isOverdue ? 'animate-spin' : ''} />
                            Délai : {delayInfo.formattedText} {isOverdue ? '(En retard)' : ''}
                          </span>
                        );
                      })()}
                    </p>
                  </div>
                </div>

                {/* Header Tracking Box */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 bg-indigo-50/90 dark:bg-[#323249] px-3 py-1.5 rounded-xl border border-indigo-200/90 dark:border-indigo-800/80">
                    <Truck size={16} className="text-[#696cff] shrink-0" />
                    <span className="text-xs font-bold text-[#566a7f] dark:text-white hidden sm:inline">Nº Suivi Barid:</span>
                    <input
                      type="text"
                      value={
                        customTrackingInput ||
                        orderTrackingMap[String(activeModalOrder.id)] ||
                        orderTrackingMap[activeModalOrder.id] ||
                        ''
                      }
                      onChange={(e) => setCustomTrackingInput(e.target.value)}
                      placeholder="Ex: QB230944826MA"
                      className="px-2.5 py-1 text-xs font-mono font-bold border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-[#2b2c40] text-[#222222] dark:text-white focus:outline-none focus:border-[#696cff] w-36 sm:w-44"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleSaveOrderTrackingNumber(
                            activeModalOrder.id,
                            customTrackingInput ||
                              orderTrackingMap[String(activeModalOrder.id)] ||
                              orderTrackingMap[activeModalOrder.id] ||
                              ''
                          );
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        handleSaveOrderTrackingNumber(
                          activeModalOrder.id,
                          customTrackingInput ||
                            orderTrackingMap[String(activeModalOrder.id)] ||
                            orderTrackingMap[activeModalOrder.id] ||
                            ''
                        )
                      }
                      className="px-3 py-1 rounded-lg text-xs font-bold bg-[#696cff] hover:bg-[#5f61e6] text-white transition-colors cursor-pointer shrink-0 shadow-2xs"
                    >
                      حفظ الكود
                    </button>
                  </div>

                  <button
                    onClick={() => setActiveModalOrder(null)}
                    className="p-1.5 text-[#a1acb8] hover:text-[#566a7f] dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-[#323249] transition-colors cursor-pointer"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Modal Sub-Header Tabs */}
              {(() => {
                const statusLower = (activeModalOrder.status || '').toLowerCase();
                const isTerminated = ['completed', 'cancelled', 'refunded', 'failed', 'trash'].includes(statusLower);
                const isVirementConfirmed = checkIsVirementConfirmed(activeModalOrder.id);
                const avanceInfo = hasOrderAvance(activeModalOrder);
                const reminderInfo = getReminderSentInfo(activeModalOrder.id);

                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-2 bg-slate-50/50 dark:bg-[#232333]/50 border-b border-[#dbdade]/70 dark:border-[#434460]/40">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setModalTab('details')}
                        className={`pb-2.5 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
                          modalTab === 'details'
                            ? 'border-[#696cff] text-[#696cff]'
                            : 'border-transparent text-[#a1acb8] hover:text-[#566a7f] dark:hover:text-white'
                        }`}
                      >
                        <FileText size={15} />
                        Détails de la commande
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalTab('email_avance')}
                        className={`pb-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                          modalTab === 'email_avance'
                            ? 'border-[#696cff] text-[#696cff]'
                            : 'border-transparent text-[#a1acb8] hover:text-[#566a7f] dark:hover:text-white'
                        }`}
                      >
                        <Bell size={15} />
                        <span>Notifications Client</span>
                        {reminderInfo && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            Envoyé
                          </span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => setModalTab('tracking')}
                        className={`pb-2.5 px-4 text-xs font-bold border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
                          modalTab === 'tracking'
                            ? 'border-[#696cff] text-[#696cff]'
                            : 'border-transparent text-[#a1acb8] hover:text-[#566a7f] dark:hover:text-white'
                        }`}
                      >
                        <Truck size={15} />
                        <span>Suivi Colis (Amana / Barid)</span>
                      </button>
                    </div>

                    {/* Checkbox Virement Reçu directly in header */}
                    {!isTerminated && (
                      <label className={`mb-1.5 flex items-center gap-2 cursor-pointer select-none px-3 py-1 rounded-lg border transition-all ${
                        isVirementConfirmed
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                          : 'bg-white text-[#222222] dark:bg-[#2b2c40] dark:text-white border-slate-300 dark:border-[#434460] hover:border-[#696cff]'
                      }`}>
                        <input
                          type="checkbox"
                          checked={isVirementConfirmed}
                          onChange={() => toggleVirementConfirmation(activeModalOrder.id, isVirementConfirmed)}
                          className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                        />
                        <span className="text-xs font-bold flex items-center gap-1.5">
                          <span>✅ Virement / Acompte Reçu</span>
                          {isVirementConfirmed && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-extrabold bg-emerald-600 text-white shadow-2xs">
                              Confirmé
                            </span>
                          )}
                        </span>
                      </label>
                    )}
                  </div>
                );
              })()}

              {/* Modal Content - Tab: Details */}
              {modalTab === 'details' && (
                <div className="flex-1 min-h-0 p-6 overflow-y-auto space-y-6">
                {/* Converted Status Banner inside Modal if previously converted */}
                {(() => {
                  const conversions = convertedMap[String(activeModalOrder.id)] || [];
                  if (conversions.length === 0) return null;

                  return (
                    <div className="px-3 py-2 rounded-lg bg-emerald-50/80 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 flex flex-wrap items-center gap-2 text-xs">
                      <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span className="font-bold text-emerald-800 dark:text-emerald-300">
                        Commande transférée :
                      </span>
                      {conversions.map((conv) => (
                        <span
                          key={conv.id}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono font-bold bg-white dark:bg-[#2b2c40] border border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300 shadow-2xs"
                        >
                          {conv.type === 'facture' ? <FileText size={13} /> : <ShoppingBag size={13} />}
                          {conv.type === 'facture' ? 'Facture' : 'Commande'} #{conv.refId}
                        </span>
                      ))}
                    </div>
                  );
                })()}

                {/* Customer Info Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Billing Details */}
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-[#434460]/40">
                    <h3 className="text-xs font-bold text-[#222222] dark:text-[#dbdade] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <User size={14} className="text-[#696cff]" />
                      Facturation & Client
                    </h3>
                    <div className="space-y-1.5 text-sm text-[#222222] dark:text-[#d5d5e2]">
                      <p className="font-bold text-base text-[#222222] dark:text-white">
                        {`${activeModalOrder.billing?.first_name || ''} ${
                          activeModalOrder.billing?.last_name || ''
                        }`.trim() || 'Client sans nom'}
                      </p>
                      {activeModalOrder.billing?.company && (
                        <p className="text-xs text-slate-600 dark:text-[#a1acb8] font-medium">
                          Société : {activeModalOrder.billing.company}
                        </p>
                      )}
                      {activeModalOrder.billing?.email && (
                        <p className="flex items-center gap-2 text-xs text-[#222222] dark:text-[#d5d5e2] font-medium">
                          <Mail size={13} className="text-[#696cff]" />
                          {activeModalOrder.billing.email}
                        </p>
                      )}
                      {activeModalOrder.billing?.phone && (
                        <p className="flex items-center gap-2 text-xs text-[#222222] dark:text-[#d5d5e2] font-medium">
                          <Phone size={13} className="text-[#696cff]" />
                          {activeModalOrder.billing.phone}
                        </p>
                      )}
                      {(activeModalOrder.billing?.address_1 || activeModalOrder.billing?.city) && (
                        <p className="flex items-start gap-2 text-xs pt-1.5 border-t border-slate-200/60 dark:border-[#434460]/40 mt-2 text-[#222222] dark:text-[#d5d5e2] font-medium">
                          <MapPin size={13} className="text-[#696cff] mt-0.5 shrink-0" />
                          <span>
                            {[
                              activeModalOrder.billing?.address_1,
                              activeModalOrder.billing?.address_2,
                              activeModalOrder.billing?.city,
                              activeModalOrder.billing?.postcode,
                              activeModalOrder.billing?.country,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Payment & Shipping Details */}
                  <div className="p-4 rounded-lg bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-[#434460]/40">
                    <h3 className="text-xs font-bold text-[#222222] dark:text-[#dbdade] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <CreditCard size={14} className="text-[#696cff]" />
                      Paiement & Livraison
                    </h3>
                    <div className="space-y-2 text-sm text-[#222222] dark:text-[#d5d5e2]">
                      <div>
                        <span className="text-xs font-semibold text-slate-600 dark:text-[#a1acb8]">Mode de règlement détecté :</span>
                        <p className="font-bold text-[#696cff] text-base">
                          {mapWooPaymentMethod(activeModalOrder)}
                        </p>
                        {activeModalOrder.payment_method_title && (
                          <p className="text-xs text-slate-500 dark:text-[#a1acb8]">
                            Intitulé Woo : {activeModalOrder.payment_method_title} ({activeModalOrder.payment_method})
                          </p>
                        )}
                      </div>



                      {/* Progression de livraison Stepper (affiché uniquement si un code de suivi est présent) */}
                      {(() => {
                        const trackingCode =
                          customTrackingInput ||
                          activeModalOrder.tracking_number ||
                          orderTrackingMap[String(activeModalOrder.id)] ||
                          orderTrackingMap[activeModalOrder.id] ||
                          (activeModalOrder.meta_data &&
                            activeModalOrder.meta_data.find(
                              (m: any) =>
                                m.key === '_tracking_number' ||
                                m.key === 'tracking_number' ||
                                m.key === '_amana_tracking'
                            )?.value) ||
                          '';

                        if (trackingCode && trackingCode.trim()) {
                          const trackingAnalysis = analyzeTrackingEvents(trackingData || []);
                          const currentStepNumber = trackingStep || trackingAnalysis.currentStep || 1;

                          return (
                            <div className="pt-2.5 border-t border-slate-200/60 dark:border-[#434460]/40 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-slate-600 dark:text-[#a1acb8] flex items-center gap-1.5">
                                  <Truck size={13} className="text-[#696cff]" />
                                  Progression de livraison :
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#383952] text-slate-600 dark:text-slate-300 font-semibold">
                                    {trackingCode}
                                  </span>
                                  <span className="text-[11px] font-bold text-[#696cff] dark:text-indigo-300 font-mono">
                                    Étape {currentStepNumber} / 4
                                  </span>
                                </div>
                              </div>

                              {/* Progress track & nodes */}
                              <div className="relative pt-1 pb-0.5">
                                {/* Background line */}
                                <div className="absolute top-4 sm:top-4.5 left-5 right-5 h-1 bg-slate-200/80 dark:bg-[#383952] rounded-full z-0" />

                                {/* Filled active line */}
                                <div
                                  className="absolute top-4 sm:top-4.5 left-5 h-1 bg-emerald-500 rounded-full transition-all duration-500 z-0"
                                  style={{
                                    width: `calc(${((Math.min(Math.max(currentStepNumber, 1), 4) - 1) / 3) * 100}% - 8px)`,
                                  }}
                                />

                                <div className="grid grid-cols-4 gap-1 relative z-10">
                                  {[
                                    { step: 1, label: 'Pris en charge', desc: 'Dépôt', icon: Package },
                                    { step: 2, label: 'Acheminement', desc: 'Transit', icon: Truck },
                                    {
                                      step: 3,
                                      label: trackingAnalysis.step3Label || 'Distribution',
                                      desc: trackingAnalysis.step3Desc || 'Tournée',
                                      icon: trackingAnalysis.isAgencyPickup ? MapPin : Navigation,
                                    },
                                    { step: 4, label: 'Livré', desc: 'Client', icon: CheckCircle2 },
                                  ].map((s) => {
                                    const isDone = currentStepNumber >= s.step;
                                    const isCurrent = currentStepNumber === s.step;
                                    const StepIcon = s.icon;

                                    return (
                                      <div key={s.step} className="flex flex-col items-center text-center group">
                                        <div
                                          className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 ${
                                            isCurrent
                                              ? 'bg-[#696cff] text-white ring-3 ring-[#696cff]/20 shadow-xs scale-105'
                                              : isDone
                                              ? 'bg-emerald-500 text-white ring-2 ring-emerald-500/20 shadow-xs'
                                              : 'bg-white dark:bg-[#323249] text-slate-400 border-2 border-slate-200 dark:border-[#434460]'
                                          }`}
                                        >
                                          <StepIcon size={13} />
                                        </div>
                                        <span
                                          className={`mt-1 text-[10px] sm:text-[11px] font-bold leading-tight transition-colors ${
                                            isCurrent
                                              ? 'text-[#696cff]'
                                              : isDone
                                              ? 'text-[#566a7f] dark:text-[#dbdade]'
                                              : 'text-slate-400 dark:text-slate-500'
                                          }`}
                                        >
                                          {s.label}
                                        </span>
                                        <span className="text-[9px] text-[#a1acb8] hidden sm:block">
                                          {s.desc}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Cache / Status / Auto-refresh sub-bar */}
                              <div className="pt-2 flex items-center justify-between text-[11px] text-[#566a7f] dark:text-[#a1acb8] border-t border-slate-100 dark:border-[#434460]/40">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {trackingMeta?.isFinished || currentStepNumber === 4 ? (
                                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                                      <CheckCircle2 size={12} className="shrink-0" />
                                      Suivi finalisé (Livré)
                                    </span>
                                  ) : trackingAnalysis.isAgencyPickup ? (
                                    <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold truncate">
                                      <MapPin size={12} className="shrink-0" />
                                      À récupérer en agence
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400 font-medium truncate">
                                      <Clock size={11} className="shrink-0 text-[#696cff]" />
                                      {trackingMeta?.lastUpdated
                                        ? `Mis à jour ${formatTrackingRelative(trackingMeta.lastUpdated)}`
                                        : 'En cours'}
                                      <span className="hidden sm:inline text-slate-400 dark:text-slate-500">• Auto 2h</span>
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => fetchTrackingData(trackingCode, true)}
                                    disabled={trackingLoading}
                                    title="Actualiser maintenant le suivi Barid"
                                    className="inline-flex items-center gap-1 text-[10px] font-bold text-[#696cff] hover:text-[#5f61e6] hover:underline cursor-pointer disabled:opacity-50"
                                  >
                                    <RefreshCw size={11} className={trackingLoading ? 'animate-spin' : ''} />
                                    <span>{trackingLoading ? 'Actualisation...' : 'Actualiser'}</span>
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => setModalTab('tracking')}
                                    className="text-[10px] font-bold text-slate-500 hover:text-[#696cff] hover:underline cursor-pointer"
                                  >
                                    Détails &rarr;
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        // Si aucun code de suivi n'est configuré, afficher l'adresse de livraison standard si présente
                        if (activeModalOrder.shipping?.address_1) {
                          return (
                            <div className="pt-2 border-t border-slate-200/60 dark:border-[#434460]/40">
                              <span className="text-xs font-semibold text-slate-600 dark:text-[#a1acb8]">Adresse de livraison :</span>
                              <p className="text-xs font-medium text-[#222222] dark:text-white mt-0.5">
                                {[
                                  `${activeModalOrder.shipping?.first_name || ''} ${activeModalOrder.shipping?.last_name || ''}`.trim(),
                                  activeModalOrder.shipping?.address_1,
                                  activeModalOrder.shipping?.city,
                                  activeModalOrder.shipping?.country,
                                ]
                                  .filter(Boolean)
                                  .join(', ')}
                              </p>
                            </div>
                          );
                        }

                        return null;
                      })()}
                    </div>
                  </div>
                </div>



                {/* Items Table with VitPOS Purchase Price & Profit */}
                <div>
                  <h3 className="text-xs font-bold text-[#222222] dark:text-[#dbdade] uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <Package size={14} className="text-[#696cff]" />
                    Produits commandés ({activeModalOrder.line_items?.length || 0})
                  </h3>

                  <div className="border border-slate-200/60 dark:border-[#434460]/40 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                      <thead className="bg-[#f8f9fa] dark:bg-[#232333] text-xs font-bold text-[#222222] dark:text-[#dbdade] uppercase border-b border-slate-200/60 dark:border-[#434460]/40">
                        <tr>
                          <th className="py-2.5 px-4">Produit</th>
                          <th className="py-2.5 px-4 text-center">Qté</th>
                          <th className="py-2.5 px-4 text-right">Prix Vente</th>
                          <th className="py-2.5 px-4 text-right">Prix Achat</th>
                          <th className="py-2.5 px-4 text-right">Total Vente</th>
                          <th className="py-2.5 px-4 text-right">Bénéfice</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-[#434460]/40 text-sm text-[#222222] dark:text-[#d5d5e2]">
                        {(activeModalOrder.line_items || []).map((item: any) => {
                          const { netTotalSelling, netUnitPrice } = getLineItemEffectiveSelling(item, activeModalOrder);
                          const purchasePrice = getLineItemPurchasePrice(item, activeModalOrder.id);
                          const itemTotalSelling = netTotalSelling;
                          const itemTotalCost = purchasePrice * (Number(item.quantity) || 1);
                          const itemProfit = itemTotalSelling - itemTotalCost;

                          return (
                            <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-[#323249]/30">
                              <td className="py-3 px-4">
                                <div className="font-bold text-sm text-[#222222] dark:text-white">{item.name}</div>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                  {item.sku && (
                                    <span className="text-xs font-mono font-medium text-slate-500 dark:text-[#a1acb8]">
                                      SKU: {item.sku}
                                    </span>
                                  )}

                                  {(() => {
                                    const key1 = `${item.product_id}_${item.variation_id || 0}`;
                                    const key2 = `${item.variation_id || item.product_id}`;
                                    const stockInfo = productStockMap[key1] || productStockMap[key2];

                                    if (isLoadingStock) {
                                      return <span className="text-[11px] text-slate-400 animate-pulse">Vérification stock...</span>;
                                    }

                                    if (!stockInfo) return null;

                                    if (stockInfo.stock_quantity !== null && stockInfo.stock_quantity !== undefined) {
                                      const qty = Number(stockInfo.stock_quantity);
                                      if (qty <= 0) {
                                        return (
                                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/30 px-1.5 py-0.5 rounded border border-rose-200/60 dark:border-rose-800/50">
                                            <AlertCircle size={10} />
                                            Stock: 0 (Rupture)
                                          </span>
                                        );
                                      }
                                      if (qty <= 3) {
                                        return (
                                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1.5 py-0.5 rounded border border-amber-200/60 dark:border-amber-800/50">
                                            <AlertTriangle size={10} />
                                            Stock restant: {qty}
                                          </span>
                                        );
                                      }
                                      return (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-1.5 py-0.5 rounded border border-emerald-200/60 dark:border-emerald-800/50">
                                          <PackageCheck size={10} />
                                          Stock restant: {qty}
                                        </span>
                                      );
                                    }

                                    if (stockInfo.stock_status === 'instock') {
                                      return (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                          <PackageCheck size={10} />
                                          En stock
                                        </span>
                                      );
                                    }
                                    if (stockInfo.stock_status === 'outofstock') {
                                      return (
                                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                                          <AlertCircle size={10} />
                                          Rupture
                                        </span>
                                      );
                                    }
                                    return null;
                                  })()}
                                </div>
                              </td>
                              <td className="py-3 px-4 text-center font-bold text-[#222222] dark:text-white">
                                {item.quantity}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-[#222222] dark:text-white">
                                {netUnitPrice.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </td>
                              <td className="py-3 px-4 text-right font-mono">
                                {editingItemId === item.id ? (
                                  <div className="flex items-center justify-end gap-1.5">
                                    <input
                                      type="number"
                                      step="0.01"
                                      value={editingCostInput}
                                      onChange={(e) => setEditingCostInput(e.target.value)}
                                      className="w-24 px-2 py-1 text-xs border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500 rounded bg-white dark:bg-[#2b2c40] text-[#566a7f] dark:text-[#dbdade]"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => handleSaveCostOverride(activeModalOrder.id, item.id)}
                                      className="p-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded cursor-pointer"
                                      title="Enregistrer le coût Snapshot"
                                    >
                                      <Check size={13} />
                                    </button>
                                    <button
                                      onClick={() => setEditingItemId(null)}
                                      className="p-1 bg-slate-200 hover:bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-200 rounded cursor-pointer"
                                      title="Annuler"
                                    >
                                      <X size={13} />
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-end gap-1.5 group">
                                    <span className="text-amber-600 dark:text-amber-400 font-medium">
                                      {purchasePrice > 0
                                        ? `${purchasePrice.toLocaleString('fr-FR', {
                                            minimumFractionDigits: 2,
                                            maximumFractionDigits: 2,
                                          })} MAD`
                                        : '0.00 MAD'}
                                    </span>
                                    <button
                                      onClick={() => {
                                        setEditingItemId(item.id);
                                        setEditingCostInput(purchasePrice.toString());
                                      }}
                                      className="p-1 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer"
                                      title="Ajuster le prix d'achat Snapshot pour cette commande"
                                    >
                                      <Edit3 size={13} />
                                    </button>
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-[#696cff]">
                                {itemTotalSelling.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </td>
                              <td className={`py-3 px-4 text-right font-mono font-bold ${
                                itemProfit > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : itemProfit < 0
                                  ? 'text-rose-500 dark:text-rose-400'
                                  : 'text-[#566a7f] dark:text-[#a1acb8]'
                              }`}>
                                {itemProfit > 0 ? '+' : ''}
                                {itemProfit.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Financial Summary & Profit Section */}
                {(() => {
                  const orderProfitData = calculateOrderProfit(activeModalOrder);
                  return (
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-4 p-4 rounded-lg bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-[#434460]/40">
                        <div className="w-full sm:flex-1 space-y-3">
                          {/* Note Interne / Remarque Commande */}
                          {activeModalOrder.customer_note && (
                            <div className="text-xs">
                              <span className="font-bold text-[#566a7f] dark:text-white">Note du client (WooCommerce) :</span>
                              <p className="italic text-[#566a7f] dark:text-[#d5d5e2] mt-0.5">
                                "{activeModalOrder.customer_note}"
                              </p>
                            </div>
                          )}

                          {/* Note Interne / Remarque Commande */}
                          {!isEditingNote && orderNoteInput.trim() !== '' ? (
                            <div className="p-3 rounded-lg bg-white dark:bg-[#2b2c40] border border-slate-200/80 dark:border-[#434460]/60 space-y-1.5 shadow-2xs">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-[#566a7f] dark:text-[#dbdade] uppercase tracking-wider flex items-center gap-1.5">
                                  <StickyNote size={13} className="text-[#696cff]" />
                                  Note / Remarque Interne
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setIsEditingNote(true)}
                                    className="px-2 py-0.5 text-[11px] text-[#696cff] hover:bg-[#696cff]/10 rounded font-medium transition-colors cursor-pointer flex items-center gap-1"
                                  >
                                    <Edit3 size={11} />
                                    Modifier
                                  </button>
                                  <button
                                    onClick={handleDeleteOrderNote}
                                    className="px-2 py-0.5 text-[11px] text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded font-medium transition-colors cursor-pointer flex items-center gap-1"
                                    title="Supprimer la note"
                                  >
                                    <X size={11} />
                                  </button>
                                </div>
                              </div>
                              <p className="text-xs text-[#566a7f] dark:text-[#d5d5e2] whitespace-pre-wrap leading-relaxed font-normal">
                                {orderNoteInput}
                              </p>
                            </div>
                          ) : isEditingNote ? (
                            <div className="p-3 rounded-lg bg-white dark:bg-[#2b2c40] border border-slate-200/80 dark:border-[#434460]/60 space-y-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-bold text-[#566a7f] dark:text-[#dbdade] uppercase tracking-wider flex items-center gap-1.5">
                                  <StickyNote size={13} className="text-[#696cff]" />
                                  Note / Remarque Interne
                                </span>
                                <button
                                  onClick={() => setIsEditingNote(false)}
                                  className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                >
                                  Annuler
                                </button>
                              </div>
                              <textarea
                                rows={2}
                                value={orderNoteInput}
                                onChange={(e) => setOrderNoteInput(e.target.value)}
                                placeholder="Saisissez une note ou remarque pour cette commande..."
                                className="w-full px-3 py-1.5 text-xs border border-slate-200 dark:border-[#434460]/60 rounded bg-slate-50 dark:bg-[#232333] text-[#566a7f] dark:text-[#dbdade] focus:outline-none focus:ring-2 focus:ring-[#696cff]/40 resize-y"
                              />
                              <div className="flex justify-end">
                                <button
                                  onClick={handleSaveOrderNote}
                                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold bg-[#696cff] hover:bg-[#5f61e6] text-white shadow-2xs transition-colors cursor-pointer"
                                >
                                  <Save size={12} />
                                  Enregistrer
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div>
                              <button
                                onClick={() => setIsEditingNote(true)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-dashed border-slate-300 dark:border-[#434460] text-[#696cff] hover:bg-[#696cff]/10 transition-colors cursor-pointer"
                              >
                                <Plus size={14} />
                                + Note / Remarque
                              </button>
                            </div>
                          )}
                        </div>

                        <div className="w-full sm:w-80 md:w-[350px] space-y-2.5 text-xs text-[#222222] dark:text-[#d5d5e2]">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-700 dark:text-[#a1acb8] font-medium">Coût d'Achat Total :</span>
                            <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                              {orderProfitData.totalPurchaseCost.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              MAD
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-xs">
                            <span className="text-slate-700 dark:text-[#a1acb8] font-medium">Sous-total Ventes (Marchandises) :</span>
                            <span className="font-mono font-bold text-[#222222] dark:text-white">
                              {orderProfitData.totalSelling.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              MAD
                            </span>
                          </div>

                          {parseFloat(activeModalOrder.shipping_total || '0') > 0 && (
                            <div className="flex justify-between items-center text-xs">
                              <span className="text-slate-700 dark:text-[#a1acb8] font-medium">Frais de livraison :</span>
                              <span className="font-mono font-bold text-[#222222] dark:text-white">
                                {parseFloat(activeModalOrder.shipping_total).toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </span>
                            </div>
                          )}

                          {orderProfitData.orderDiscount > 0 && (
                            <div className="flex justify-between items-center text-xs text-rose-600 dark:text-rose-400 font-semibold">
                              <span>Remise / Déduction :</span>
                              <span className="font-mono">
                                -
                                {orderProfitData.orderDiscount.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </span>
                            </div>
                          )}

                          <div className="flex justify-between items-baseline pt-2.5 border-t border-slate-200/80 dark:border-[#434460]/60 text-[#222222] dark:text-white">
                            <span className="font-extrabold text-xs whitespace-nowrap text-[#222222] dark:text-white">Total Valeur Commande :</span>
                            <div className="text-right">
                              <span className="font-mono text-base font-extrabold text-[#696cff] block">
                                {(
                                  orderProfitData.isCodDeposit && orderProfitData.codBalanceDue > 0
                                    ? orderProfitData.totalSelling + parseFloat(activeModalOrder.shipping_total || '0')
                                    : parseFloat(activeModalOrder.total || '0')
                                ).toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </span>
                              {orderProfitData.isCodDeposit && (
                                <span className="block text-[10px] font-semibold text-blue-600 dark:text-blue-400 mt-0.5">
                                  (Dont Acompte : {orderProfitData.depositPaidOnline.toFixed(2)} MAD)
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Bénéfice Net integrated cleanly under Total Valeur Commande */}
                          <div className="flex justify-between items-center pt-2.5 mt-1 border-t border-dashed border-slate-200 dark:border-[#434460]/60">
                            <div className="flex items-center gap-1.5">
                              <span className="font-extrabold text-xs text-[#222222] dark:text-[#dbdade]">Bénéfice Net :</span>
                              {orderProfitData.isCompleted ? (
                                <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                                  Réalisé ({orderProfitData.margin.toFixed(1)}%)
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                                  Estimé ({orderProfitData.margin.toFixed(1)}%)
                                </span>
                              )}
                            </div>
                            <span
                              className={`font-mono text-lg font-extrabold tracking-tight ${
                                orderProfitData.isCancelled
                                  ? 'text-slate-400'
                                  : orderProfitData.isCompleted
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-amber-700 dark:text-amber-400'
                              }`}
                            >
                              {orderProfitData.isCancelled
                                ? '0,00 MAD'
                                : `${orderProfitData.profit >= 0 ? '+' : ''}${orderProfitData.profit.toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })} MAD`}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              )}

              {/* Modal Content - Tab: Notifications Client */}
              {modalTab === 'email_avance' && (
                <WooNotificationsTab
                  activeModalOrder={activeModalOrder}
                  emailTemplateType={emailTemplateType}
                  extraDetailInput={extraDetailInput}
                  emailSubjectInput={emailSubjectInput}
                  emailBodyInput={emailBodyInput}
                  emailAvanceAmount={emailAvanceAmount}
                  copiedSubject={copiedSubject}
                  copiedBody={copiedBody}
                  copiedRib={copiedRib}
                  sendingDirectEmail={sendingDirectEmail}
                  showTemplateText={showTemplateText}
                  showSendHistory={showSendHistory}
                  setShowSendHistory={setShowSendHistory}
                  setShowTemplateText={setShowTemplateText}
                  setEmailSubjectInput={setEmailSubjectInput}
                  setEmailBodyInput={setEmailBodyInput}
                  handleSelectTemplateType={handleSelectTemplateType}
                  handleExtraDetailChange={handleExtraDetailChange}
                  handleChangeAvanceAmount={handleChangeAvanceAmount}
                  handleOpenWhatsApp={handleOpenWhatsApp}
                  handleSendDirectEmail={handleSendDirectEmail}
                  handleCopySubject={handleCopySubject}
                  handleCopyBody={handleCopyBody}
                  handleCopyRib={handleCopyRib}
                  showToast={showToast}
                  setOrders={setOrders}
                />
              )}

              {/* Modal Content - Tab: Suivi Colis (Barid Al-Maghrib / Amana) */}
              {modalTab === 'tracking' && (
                <WooTrackingTab
                  trackingLoading={trackingLoading}
                  trackingError={trackingError}
                  trackingData={trackingData}
                  trackingSummary={trackingSummary}
                  trackingStep={trackingStep}
                  trackingDirectUrl={trackingDirectUrl}
                  trackingMeta={trackingMeta}
                  customTrackingInput={customTrackingInput}
                  showAllTrackingRows={showAllTrackingRows}
                  setShowAllTrackingRows={setShowAllTrackingRows}
                  showRawPaste={showRawPaste}
                  setShowRawPaste={setShowRawPaste}
                  rawPasteText={rawPasteText}
                  setRawPasteText={setRawPasteText}
                  fetchTrackingData={fetchTrackingData}
                  handleParseRawTrackingText={handleParseRawTrackingText}
                  handleSelectTemplateType={handleSelectTemplateType}
                  setModalTab={setModalTab}
                />
              )}

              {/* Modal Footer Actions */}
              <div className="px-6 py-4 border-t border-[#dbdade]/70 dark:border-[#434460]/40 bg-slate-50/50 dark:bg-[#232333]/50 flex flex-wrap justify-between items-center gap-3">
                <button
                  onClick={() => setActiveModalOrder(null)}
                  className="px-4 py-2 border border-[#dbdade] dark:border-[#434460] rounded-lg text-sm text-[#566a7f] dark:text-[#a1acb8] hover:bg-slate-100 dark:hover:bg-[#323249] transition-colors cursor-pointer font-medium"
                >
                  Fermer
                </button>

                {(() => {
                  const statusLower = (activeModalOrder.status || '').toLowerCase();
                  const isCancelledOrTerminated = ['cancelled', 'refunded', 'failed', 'trash'].includes(statusLower);

                  if (isCancelledOrTerminated) {
                    return null;
                  }

                  return (
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        onClick={() => handlePrintOrderTicket(activeModalOrder)}
                        className="flex items-center gap-2 px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-all shadow-2xs cursor-pointer"
                      >
                        <Printer size={15} />
                        Imprimer Ticket
                      </button>

                      <button
                        onClick={() => handleCreateSingleDocument(activeModalOrder, 'commande')}
                        disabled={importingSingleId?.id === activeModalOrder.id}
                        className="flex items-center gap-2 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
                      >
                        {importingSingleId?.id === activeModalOrder.id && importingSingleId.type === 'commande' ? (
                          <RefreshCw size={15} className="animate-spin" />
                        ) : (
                          <ShoppingBag size={15} />
                        )}
                        Générer / Mettre à jour Commande
                      </button>

                      <button
                        onClick={() => handleCreateSingleDocument(activeModalOrder, 'facture')}
                        disabled={importingSingleId?.id === activeModalOrder.id}
                        className="flex items-center gap-2 px-3.5 py-2 bg-[#696cff] hover:bg-[#5f61e6] text-white text-xs font-bold rounded-lg transition-all shadow-2xs disabled:opacity-50 cursor-pointer"
                      >
                        {importingSingleId?.id === activeModalOrder.id && importingSingleId.type === 'facture' ? (
                          <RefreshCw size={15} className="animate-spin" />
                        ) : (
                          <FileText size={15} />
                        )}
                        Générer / Mettre à jour Facture
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Modal: Details Bénéfice Journée (Aujourd'hui) */}
        {showTodayProfitModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade] dark:border-[#434460] rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden my-8">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-[#dbdade]/70 dark:border-[#434460]/40 flex items-center justify-between bg-emerald-50/50 dark:bg-emerald-500/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-lg shrink-0">
                    +
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-emerald-800 dark:text-emerald-300">
                      Détail du Bénéfice Journée (Aujourd'hui)
                    </h3>
                    <p className="text-xs text-[#566a7f] dark:text-[#a1acb8]">
                      Synthèse des commandes terminées aujourd'hui avec le détail des prix et bénéfices
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowTodayProfitModal(false)}
                  className="p-1.5 rounded-lg text-[#a1acb8] hover:text-[#566a7f] hover:bg-slate-200/50 dark:hover:bg-[#323249] transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Summary KPIs inside modal */}
              <div className="p-5 border-b border-[#dbdade]/70 dark:border-[#434460]/40 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50/50 dark:bg-[#232333]/30">
                <div className="p-3.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
                  <span className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-wider block">Total Bénéfice</span>
                  <span className="text-lg font-mono font-extrabold text-emerald-600 dark:text-emerald-400">
                    +{wooProfitStats.todayProfit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD
                  </span>
                </div>
                <div className="p-3.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
                  <span className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-wider block">Total Ventes</span>
                  <span className="text-lg font-mono font-extrabold text-[#566a7f] dark:text-[#dbdade]">
                    {wooProfitStats.todaySales.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD
                  </span>
                </div>
                <div className="p-3.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
                  <span className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-wider block">Commandes Terminées</span>
                  <span className="text-lg font-mono font-extrabold text-[#696cff]">
                    {todayCompletedOrders.length} commande{todayCompletedOrders.length > 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Table of today's completed orders */}
              <div className="p-6 max-h-[60vh] overflow-y-auto">
                {todayCompletedOrders.length === 0 ? (
                  <div className="py-12 text-center text-[#a1acb8]">
                    <ShoppingBag size={36} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">Aucune commande terminée aujourd'hui</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100/70 dark:bg-[#323249] text-[11px] font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#a1acb8] border-b border-[#dbdade]/70 dark:border-[#434460]/40">
                          <th className="py-3 px-4">N° Commande</th>
                          <th className="py-3 px-4">Client</th>
                          <th className="py-3 px-4">Date & Heure</th>
                          <th className="py-3 px-4 text-right">Total Vente</th>
                          <th className="py-3 px-4 text-right">Coût d'Achat</th>
                          <th className="py-3 px-4 text-right">Bénéfice</th>
                          <th className="py-3 px-4 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#dbdade]/70 dark:divide-[#434460]/40 text-xs">
                        {todayCompletedOrders.map((order) => {
                          const profitStats = calculateOrderProfit(order);
                          const clientName =
                            `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() ||
                            order.billing?.company ||
                            'Client Inconnu';
                          const dateStr = order.date_created || order.date_completed || order.date_paid;
                          const formattedDate = dateStr ? format(new Date(dateStr), 'dd/MM/yyyy HH:mm', { locale: fr }) : '-';

                          return (
                            <tr
                              key={order.id}
                              className="hover:bg-slate-50/80 dark:hover:bg-[#323249]/50 transition-colors"
                            >
                              <td className="py-3 px-4 font-mono font-bold text-[#696cff]">
                                #{order.id}
                              </td>
                              <td className="py-3 px-4 font-medium text-[#566a7f] dark:text-[#dbdade]">
                                <div>{clientName}</div>
                                {order.billing?.city && (
                                  <div className="text-[11px] text-[#a1acb8]">{order.billing.city}</div>
                                )}
                              </td>
                              <td className="py-3 px-4 text-[#566a7f] dark:text-[#a1acb8] whitespace-nowrap">
                                {formattedDate}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-[#566a7f] dark:text-[#dbdade]">
                                {profitStats.totalSelling.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-[#566a7f] dark:text-[#a1acb8]">
                                {profitStats.totalPurchaseCost.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                                {profitStats.hasMissingCost && (
                                  <div className="text-[10px] text-amber-500 font-sans">⚠️ Incomplet</div>
                                )}
                              </td>
                              <td className={`py-3 px-4 text-right font-mono font-bold ${
                                profitStats.profit > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : profitStats.profit < 0
                                  ? 'text-rose-500'
                                  : 'text-[#566a7f]'
                              }`}>
                                {profitStats.profit > 0 ? '+' : ''}
                                {profitStats.profit.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </td>
                              <td className="py-3 px-4 text-center">
                                <button
                                  onClick={() => {
                                    setShowTodayProfitModal(false);
                                    setActiveModalOrder(order);
                                  }}
                                  className="p-1.5 text-[#696cff] hover:bg-[#696cff]/10 rounded-lg transition-colors cursor-pointer"
                                  title="Voir détails de la commande"
                                >
                                  <Eye size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-[#dbdade]/70 dark:border-[#434460]/40 bg-slate-50/50 dark:bg-[#232333]/50 flex justify-end">
                <button
                  onClick={() => setShowTodayProfitModal(false)}
                  className="px-4 py-2 bg-slate-200 dark:bg-[#323249] text-[#566a7f] dark:text-[#dbdade] hover:bg-slate-300 dark:hover:bg-[#434460] text-sm font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Details Bénéfice du Mois Sélectionné */}
        {showMonthProfitModal && monthFilter !== 'all' && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade] dark:border-[#434460] rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden my-8">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-[#dbdade]/70 dark:border-[#434460]/40 flex items-center justify-between bg-purple-50/50 dark:bg-purple-500/5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold text-lg shrink-0">
                    ★
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-purple-800 dark:text-purple-300">
                      Détail du Bénéfice ({selectedMonthLabel})
                    </h3>
                    <p className="text-xs text-[#566a7f] dark:text-[#a1acb8]">
                      Synthèse des commandes terminées pour {selectedMonthLabel} avec le détail des prix et bénéfices
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowMonthProfitModal(false)}
                  className="p-1.5 rounded-lg text-[#a1acb8] hover:text-[#566a7f] hover:bg-slate-200/50 dark:hover:bg-[#323249] transition-colors cursor-pointer"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Summary KPIs inside modal */}
              <div className="p-5 border-b border-[#dbdade]/70 dark:border-[#434460]/40 grid grid-cols-1 sm:grid-cols-3 gap-4 bg-slate-50/50 dark:bg-[#232333]/30">
                <div className="p-3.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
                  <span className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-wider block">Total Bénéfice</span>
                  <span className="text-lg font-mono font-extrabold text-purple-600 dark:text-purple-400">
                    +{wooProfitStats.monthProfit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD
                  </span>
                </div>
                <div className="p-3.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
                  <span className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-wider block">Total Ventes</span>
                  <span className="text-lg font-mono font-extrabold text-[#566a7f] dark:text-[#dbdade]">
                    {wooProfitStats.monthSales.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD
                  </span>
                </div>
                <div className="p-3.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
                  <span className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-wider block">Commandes Terminées</span>
                  <span className="text-lg font-mono font-extrabold text-[#696cff]">
                    {selectedMonthCompletedOrders.length} commande{selectedMonthCompletedOrders.length > 1 ? 's' : ''}
                  </span>
                </div>
              </div>

              {/* Table of selected month's completed orders */}
              <div className="p-6 max-h-[60vh] overflow-y-auto">
                {selectedMonthCompletedOrders.length === 0 ? (
                  <div className="py-12 text-center text-[#a1acb8]">
                    <ShoppingBag size={36} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm font-medium">Aucune commande terminée pour {selectedMonthLabel}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-100/70 dark:bg-[#323249] text-[11px] font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#a1acb8] border-b border-[#dbdade]/70 dark:border-[#434460]/40">
                          <th className="py-3 px-4">N° Commande</th>
                          <th className="py-3 px-4">Client</th>
                          <th className="py-3 px-4">Date & Heure</th>
                          <th className="py-3 px-4 text-right">Total Vente</th>
                          <th className="py-3 px-4 text-right">Coût d'Achat</th>
                          <th className="py-3 px-4 text-right">Bénéfice</th>
                          <th className="py-3 px-4 text-center">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#dbdade]/70 dark:divide-[#434460]/40 text-xs">
                        {selectedMonthCompletedOrders.map((order) => {
                          const profitStats = calculateOrderProfit(order);
                          const clientName =
                            `${order.billing?.first_name || ''} ${order.billing?.last_name || ''}`.trim() ||
                            order.billing?.company ||
                            'Client Inconnu';
                          const dateStr = order.date_created || order.date_completed || order.date_paid;
                          const formattedDate = dateStr ? format(new Date(dateStr), 'dd/MM/yyyy HH:mm', { locale: fr }) : '-';

                          return (
                            <tr
                              key={order.id}
                              className="hover:bg-slate-50/80 dark:hover:bg-[#323249]/50 transition-colors"
                            >
                              <td className="py-3 px-4 font-mono font-bold text-[#696cff]">
                                #{order.id}
                              </td>
                              <td className="py-3 px-4 font-medium text-[#566a7f] dark:text-[#dbdade]">
                                <div>{clientName}</div>
                                {order.billing?.city && (
                                  <div className="text-[11px] text-[#a1acb8]">{order.billing.city}</div>
                                )}
                              </td>
                              <td className="py-3 px-4 text-[#566a7f] dark:text-[#a1acb8] whitespace-nowrap">
                                {formattedDate}
                              </td>
                              <td className="py-3 px-4 text-right font-mono font-bold text-[#566a7f] dark:text-[#dbdade]">
                                {profitStats.totalSelling.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </td>
                              <td className="py-3 px-4 text-right font-mono text-[#566a7f] dark:text-[#a1acb8]">
                                {profitStats.totalPurchaseCost.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                                {profitStats.hasMissingCost && (
                                  <div className="text-[10px] text-amber-500 font-sans">⚠️ Incomplet</div>
                                )}
                              </td>
                              <td className={`py-3 px-4 text-right font-mono font-bold ${
                                profitStats.profit > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : profitStats.profit < 0
                                  ? 'text-rose-500'
                                  : 'text-[#566a7f]'
                              }`}>
                                {profitStats.profit > 0 ? '+' : ''}
                                {profitStats.profit.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                MAD
                              </td>
                              <td className="py-3 px-4 text-center">
                                <button
                                  onClick={() => {
                                    setShowMonthProfitModal(false);
                                    setActiveModalOrder(order);
                                  }}
                                  className="p-1.5 text-[#696cff] hover:bg-[#696cff]/10 rounded-lg transition-colors cursor-pointer"
                                  title="Voir détails de la commande"
                                >
                                  <Eye size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="px-6 py-4 border-t border-[#dbdade]/70 dark:border-[#434460]/40 bg-slate-50/50 dark:bg-[#232333]/50 flex justify-end">
                <button
                  onClick={() => setShowMonthProfitModal(false)}
                  className="px-4 py-2 bg-slate-200 dark:bg-[#323249] text-[#566a7f] dark:text-[#dbdade] hover:bg-slate-300 dark:hover:bg-[#434460] text-sm font-medium rounded-lg transition-colors cursor-pointer"
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

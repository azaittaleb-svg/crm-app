import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { backendService } from '../services/backendService';
import {
  collectionGroup,
  collection,
  onSnapshot,
  doc,
  writeBatch,
  getDocs,
  query,
  where,
  addDoc,
  updateDoc,
  getDoc,
  serverTimestamp,
  deleteField,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { Link, useNavigate } from 'react-router-dom';
import { invoiceService } from '../services/invoiceService';
import html2pdf from 'html2pdf.js';
import { generatePDF, getPDFBase64 } from '../utils/pdfGenerator';
import { mapDocToInvoiceData } from '../utils/invoiceMapper';
import { convertNumberToFrenchWords } from '../utils/numberToWords';
import { COMPANY_INFO } from '../constants';
import { InvoicePrint } from '../components/InvoicePrint';
import { DeliveryNotePrint } from '../components/DeliveryNotePrint';
import { mapDocToDeliveryNoteData } from '../utils/deliveryNoteMapper';
import { InvoiceData } from '../types';
import { PurchaseXlsxModal } from '../components/PurchaseXlsxModal';
import { isLandlinePhone, isWhatsAppEligiblePhone } from '../services/whatsappService';
import {
  Plus,
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  FileText,
  Eye,
  Pencil,
  Coins,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ArrowUpDown,
  MessageSquare,
  Users,
  User,
  CreditCard,
  Copy,
  Check,
  X,
  RefreshCw,
  Printer,
  Settings,
  ChevronDown,
  Send,
  MoreVertical,
  Clock,
  FileSpreadsheet,
  Truck,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const parseToDate = (dateVal: any): Date | null => {
  if (!dateVal) return null;
  if (typeof dateVal.toDate === 'function') {
    return dateVal.toDate();
  }
  if (typeof dateVal.toMillis === 'function') {
    return new Date(dateVal.toMillis());
  }
  if (dateVal instanceof Date) {
    return dateVal;
  }
  if (typeof dateVal === 'object' && typeof dateVal.seconds === 'number') {
    return new Date(dateVal.seconds * 1000);
  }
  const parsed = new Date(dateVal);
  if (isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

export const getInvoiceStatus = (item: any): 'Brouillon' | 'Valide' | 'Annulée' => {
  if (!item) return 'Brouillon';
  const rawStatus =
    item.status || (item.refId && item.refId !== 'Brouillon' ? 'Valide' : 'Brouillon');
  if (rawStatus === 'Validée' || rawStatus === 'Valide') {
    return 'Valide';
  }
  if (rawStatus === 'Annulée') {
    return 'Annulée';
  }
  return 'Brouillon';
};

export default function FacturationPage() {
  const [allPurchases, setAllPurchases] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [clientsMap, setClientsMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState(() => localStorage.getItem('fact_filter_search') || '');
  const [activeTab, setActiveTab] = useState<
    'all' | 'draft' | 'paid' | 'partial' | 'past_due' | 'sent' | 'debtors' | 'exclu_compta'
  >(() => {
    const val = localStorage.getItem('fact_filter_activeTab');
    return (val as any) || 'all';
  });
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'highest' | 'lowest' | 'debt'>(() => {
    const val = localStorage.getItem('fact_filter_sortBy');
    return (val as any) || 'recent';
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const val = localStorage.getItem('fact_filter_pageSize');
    return val ? Number(val) : 10;
  });
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<string[]>([]);
  const [openActionDropdownId, setOpenActionDropdownId] = useState<string | null>(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [datePeriodFilter, setDatePeriodFilter] = useState<string>(
    () => localStorage.getItem('fact_filter_datePeriodFilter') || 'all'
  );
  const [dateYearFilter, setDateYearFilter] = useState<string>(
    () => localStorage.getItem('fact_filter_dateYearFilter') || 'all'
  );
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);

  // Persist filter states to localStorage
  useEffect(() => {
    localStorage.setItem('fact_filter_search', search);
  }, [search]);

  useEffect(() => {
    localStorage.setItem('fact_filter_activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('fact_filter_sortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('fact_filter_pageSize', String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    localStorage.setItem('fact_filter_datePeriodFilter', datePeriodFilter);
  }, [datePeriodFilter]);

  useEffect(() => {
    localStorage.setItem('fact_filter_dateYearFilter', dateYearFilter);
  }, [dateYearFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeTab, datePeriodFilter, dateYearFilter]);

  // State for recording quick payment
  const [selectedInvoice, setSelectedInvoice] = useState<any | null>(null);
  const [quickPaymentAmount, setQuickPaymentAmount] = useState('');
  const [isSavingPayment, setIsSavingPayment] = useState(false);

  // States for gap recycling / override validation modal (Odoo style)
  const [validatingInvoice, setValidatingInvoice] = useState<any | null>(null);
  const [customRefNum, setCustomRefNum] = useState('');
  const [loadingValidation, setLoadingValidation] = useState(false);
  const [missingSequences, setMissingSequences] = useState<string[]>([]);

  // State for sequential queue bulk printing
  const [printingQueue, setPrintingQueue] = useState<any[]>([]);
  const [printingBLQueue, setPrintingBLQueue] = useState<any[]>([]);

  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;

    // Fetch clients
    const unsubscribeClients = onSnapshot(
      query(collection(db, 'clients'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        const clientList = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setClients(clientList);

        const newMap: Record<string, string> = {};
        snapshot.forEach((doc) => {
          newMap[doc.id] = doc.data().name || 'Client Inconnu';
        });
        setClientsMap(newMap);
      }
    );

    // Fetch purchases
    const unsubscribePurchases = onSnapshot(
      collectionGroup(db, 'purchases'),
      (snapshot) => {
        const data = snapshot.docs
          .map((doc) => {
            const dataObj = doc.data() as any;
            const pathParts = doc.ref.path.split('/').filter(Boolean);
            const clientsIndex = pathParts.indexOf('clients');
            const parentId = doc.ref.parent?.parent?.id;
            const parentPath = doc.ref.parent?.parent?.parent?.id;
            const clientId =
              dataObj.clientId ||
              parentId ||
              (clientsIndex !== -1 ? pathParts[clientsIndex + 1] : pathParts[1]) ||
              '';

            const isClientPurchase =
              parentPath === 'clients' ||
              clientsIndex !== -1 ||
              doc.ref.path.startsWith('clients/') ||
              doc.ref.path.includes('/clients/');

            return {
              id: doc.id,
              ...dataObj,
              clientId,
              isClientPurchase,
            } as any;
          })
          .filter(
            (p) =>
              p.isClientPurchase &&
              (!p.ownerId || p.ownerId === user.uid)
          );

        setAllPurchases(data);
      },
      (error) => {
        console.warn('Erreur chargement purchases Facturation:', error);
      }
    );

    return () => {
      unsubscribeClients();
      unsubscribePurchases();
    };
  }, [user]);

  // Compute factures chronologically for dynamic formatting reference if missing and validated
  const facturesListWithRefs = useMemo(() => {
    const rawFactures = allPurchases.filter((p) => p.type === 'facture');
    rawFactures.sort((a, b) => {
      const dateA = a.date?.toMillis
        ? a.date.toMillis()
        : a.date instanceof Date
          ? a.date.getTime()
          : 0;
      const dateB = b.date?.toMillis
        ? b.date.toMillis()
        : b.date instanceof Date
          ? b.date.getTime()
          : 0;
      return dateA - dateB;
    });

    let validatedCount = 0;
    return rawFactures.map((item) => {
      const status = item.status || (item.refId ? 'Validée' : 'Brouillon');
      let assignedRef = item.refId;
      if (status !== 'Brouillon') {
        validatedCount++;
        assignedRef = item.refId || `INV/2026/${String(validatedCount).padStart(5, '0')}`;
      } else {
        assignedRef = 'Brouillon';
      }
      return {
        ...item,
        status,
        refId: assignedRef,
      };
    });
  }, [allPurchases]);

  // Synchronize and persist calculated refIds back to Firestore for permanent non-shifting
  // ONLY for validated invoices!
  useEffect(() => {
    if (!user || allPurchases.length === 0 || facturesListWithRefs.length === 0) return;

    const facturesMissing = allPurchases.filter((p) => {
      const status = p.status || (p.refId ? 'Validée' : 'Brouillon');
      return p.type === 'facture' && !p.refId && status === 'Validée';
    });
    if (facturesMissing.length > 0) {
      const batch = writeBatch(db);
      let count = 0;
      facturesMissing.forEach((item) => {
        const calculated = facturesListWithRefs.find((r) => r.id === item.id);
        if (calculated && calculated.refId && calculated.refId !== 'Brouillon' && item.clientId) {
          const docRef = doc(db, 'clients', item.clientId, 'purchases', item.id);
          batch.update(docRef, { refId: calculated.refId, status: 'Validée' });
          count++;
        }
      });
      if (count > 0) {
        batch
          .commit()
          .then(() => console.log(`Persisted ${count} facture refIds.`))
          .catch((err) => console.error('Error migrating facture static references:', err));
      }
    }
  }, [allPurchases, facturesListWithRefs, user]);

  // Process sorting & filtering
  const filteredFactures = useMemo(() => {
    let list = facturesListWithRefs.filter((p) => {
      const clientName = clientsMap[p.clientId] || 'Client Inconnu';
      const matchQuery =
        p.description.toLowerCase().includes(search.toLowerCase()) ||
        clientName.toLowerCase().includes(search.toLowerCase()) ||
        p.refId.toLowerCase().includes(search.toLowerCase());

      if (!matchQuery) return false;

      const total = Number(p.total) || 0;
      const isPaid = p.paymentStatus === 'paid';
      const paid = p.amountPaid !== undefined ? Number(p.amountPaid) || 0 : isPaid ? total : 0;
      const remaining = total - paid;

      let tabMatch = true;
      if (activeTab === 'draft') tabMatch = p.status === 'Brouillon';
      else if (activeTab === 'paid')
        tabMatch = remaining <= 0.05 && p.status !== 'Brouillon' && p.status !== 'Annulée';
      else if (activeTab === 'partial')
        tabMatch =
          remaining > 0.05 && paid > 0 && p.status !== 'Brouillon' && p.status !== 'Annulée';
      else if (activeTab === 'past_due')
        tabMatch =
          remaining > 0.05 && paid <= 0 && p.status !== 'Brouillon' && p.status !== 'Annulée';
      else if (activeTab === 'sent')
        tabMatch = (p.sent === true || p.status === 'Envoyée') && p.status !== 'Annulée';
      else if (activeTab === 'debtors')
        tabMatch = remaining > 0.05 && p.status !== 'Brouillon' && p.status !== 'Annulée';
      else if (activeTab === 'exclu_compta')
        tabMatch = !!(p.excludeFromAccounting || clientsMap[p.clientId] && clients.find(c => c.id === p.clientId)?.excludeFromAccounting);

      if (!tabMatch) return false;

      if (datePeriodFilter !== 'all') {
        const d = parseToDate(p.date);
        if (!d) return false;

        const m = d.getMonth() + 1;
        const q = Math.ceil(m / 3);

        if (datePeriodFilter.startsWith('month:')) {
          if (m !== parseInt(datePeriodFilter.split(':')[1])) return false;
        } else if (datePeriodFilter.startsWith('quarter:')) {
          if (q !== parseInt(datePeriodFilter.split(':')[1])) return false;
        }
      }

      if (dateYearFilter !== 'all') {
        const d = parseToDate(p.date);
        if (!d) return false;

        const y = d.getFullYear();

        if (y !== parseInt(dateYearFilter)) return false;
      }

      return true;
    });

    list.sort((a, b) => {
      const totalA = Number(a.total) || 0;
      const totalB = Number(b.total) || 0;
      const paysA =
        a.amountPaid !== undefined
          ? Number(a.amountPaid) || 0
          : a.paymentStatus === 'paid'
            ? totalA
            : 0;
      const paysB =
        b.amountPaid !== undefined
          ? Number(b.amountPaid) || 0
          : b.paymentStatus === 'paid'
            ? totalB
            : 0;
      const debtA = totalA - paysA;
      const debtB = totalB - paysB;

      const dateA = a.date?.toMillis ? a.date.toMillis() : 0;
      const dateB = b.date?.toMillis ? b.date.toMillis() : 0;

      if (sortBy === 'oldest') {
        const parseRef = (ref: string) => {
          if (!ref || ref === 'Brouillon') return 999999999; // Put drafts at the bottom if oldest
          const match = ref.match(/\d+$/);
          return match ? parseInt(match[0], 10) : 0;
        };
        const numA = parseRef(a.refId);
        const numB = parseRef(b.refId);
        if (numA !== numB && numA !== 999999999 && numB !== 999999999) {
          return numA - numB;
        }
        return dateA - dateB;
      }
      if (sortBy === 'highest') return totalB - totalA;
      if (sortBy === 'lowest') return totalA - totalB;
      if (sortBy === 'debt') return debtB - debtA;

      // Default: recent -> newest first, descending numbers (largest at top, smallest at bottom)
      const parseRefDesc = (ref: string) => {
        if (!ref || ref === 'Brouillon') return 999999999; // Drafts at the very top
        const match = ref.match(/\d+$/);
        return match ? parseInt(match[0], 10) : 0;
      };
      const numADesc = parseRefDesc(a.refId);
      const numBDesc = parseRefDesc(b.refId);
      if (numADesc !== numBDesc) {
        return numBDesc - numADesc; // big to small (Descending sequence)
      }
      return dateB - dateA;
    });

    return list;
  }, [
    facturesListWithRefs,
    clientsMap,
    search,
    activeTab,
    sortBy,
    datePeriodFilter,
    dateYearFilter,
  ]);

  // Comprehensive analytics
  const stats = useMemo(() => {
    let volumeFacture = 0;
    let tresorerieEncaissee = 0;
    let invoicesCount = 0;
    const filteredClientIds = new Set<string>();

    filteredFactures.forEach((f) => {
      const fStatus = getInvoiceStatus(f);
      if (fStatus === 'Annulée' || fStatus === 'Brouillon') return;

      const total = Number(f.total) || 0;
      const isPaid = f.paymentStatus === 'paid';
      const paid = f.amountPaid !== undefined ? Number(f.amountPaid) || 0 : isPaid ? total : 0;

      const isCreditNote = f.refId?.startsWith('RINV/');
      if (isCreditNote) {
        volumeFacture -= total;
        tresorerieEncaissee -= paid;
      } else {
        volumeFacture += total;
        tresorerieEncaissee += paid;
      }
      invoicesCount++;
      if (f.clientId) {
        filteredClientIds.add(f.clientId);
      }
    });

    const creancesActives = volumeFacture - tresorerieEncaissee;
    const recoveryRate = volumeFacture > 0 ? (tresorerieEncaissee / volumeFacture) * 100 : 0;
    const clientCount = filteredClientIds.size;

    return {
      volumeFacture,
      tresorerieEncaissee,
      creancesActives,
      invoicesCount,
      recoveryRate,
      clientCount,
    };
  }, [filteredFactures]);

  const totalEntries = filteredFactures.length;
  const totalPages = Math.ceil(totalEntries / pageSize) || 1;
  const paginatedFactures = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredFactures.slice(startIndex, startIndex + pageSize);
  }, [filteredFactures, currentPage, pageSize]);

  const entryStart = totalEntries === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const entryEnd = Math.min(currentPage * pageSize, totalEntries);

  const isAllSelected =
    paginatedFactures.length > 0 &&
    paginatedFactures.every((s) => selectedInvoiceIds.includes(s.id));
  const isSomeSelected =
    paginatedFactures.length > 0 &&
    paginatedFactures.some((s) => selectedInvoiceIds.includes(s.id)) &&
    !isAllSelected;
  const isEverythingSelected = useMemo(() => {
    return (
      filteredFactures.length > 0 &&
      filteredFactures.every((s) => selectedInvoiceIds.includes(s.id))
    );
  }, [filteredFactures, selectedInvoiceIds]);

  const handleSelectEverything = () => {
    const allIds = filteredFactures.map((s) => s.id);
    setSelectedInvoiceIds(allIds);
  };

  const handleClearAllSelection = () => {
    setSelectedInvoiceIds([]);
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pageIds = paginatedFactures.map((s) => s.id);
      setSelectedInvoiceIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = paginatedFactures.map((s) => s.id);
      setSelectedInvoiceIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    }
  };

  const [isBulkDropdownOpen, setIsBulkDropdownOpen] = useState(false);

  // Email dispatch states
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailingInvoice, setEmailingInvoice] = useState<any>(null);

  const getMessageTemplate = (type: string, docId: string, total: string, clientName: string) => {
    switch (type) {
      case 'devis':
        return `Bonjour ${clientName},\n\nVotre devis ${docId} d'un montant de ${total} DH attend votre validation.\n\nN'hésitez pas à nous contacter si vous avez des questions.\n\nCordialement.`;
      case 'facture':
        return `Bonjour ${clientName},\n\nVeuillez trouver ci-joint votre facture ${docId} d'un montant de ${total} DH de Advanced IT.\n\nCordialement.`;
      case 'commande':
      default:
        return `Bonjour ${clientName},\n\nVotre commande ${docId} d'un montant de ${total} DH est confirmée.\n\nCordialement.`;
    }
  };

  const handleBulkSend = async () => {
    const selected = facturesListWithRefs.filter((f) => selectedInvoiceIds.includes(f.id));
    if (selected.length === 0) {
      showToast('Veuillez sélectionner une facture à envoyer.', 'error');
      return;
    }
    if (selected.length > 1) {
      showToast("Veuillez sélectionner une seule facture pour l'envoi par email.", 'error');
      return;
    }

    const invoice = selected[0];
    const clientName = clientsMap[invoice.clientId] || 'Client';
    const clientObj = clients.find((c) => c.id === invoice.clientId);
    setEmailingInvoice(invoice);
    setEmailTo(clientObj?.email || '');
    const computedRefId = invoice.refId || 'Brouillon';
    setEmailSubject(`Votre facture - ${computedRefId}`);
    const totalFormatted = Number(invoice.total || 0).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    setEmailBody(getMessageTemplate('facture', computedRefId, totalFormatted, clientName));
    setShowEmailModal(true);
  };

  const handleSendEmail = async () => {
    if (!emailTo) {
      showToast('Veuillez saisir une adresse email.', 'error');
      return;
    }
    setSendingEmail(true);
    try {
      const element = document.getElementById('hidden-pdf-content');
      if (!element) {
        throw new Error("L'élément de facture est introuvable.");
      }

      const computedRefId = emailingInvoice.refId || 'Brouillon';
      const pType = emailingInvoice.type || 'facture';

      const pdfBase64 = await getPDFBase64(element, { filename: `${pType}_${computedRefId}.pdf` });

      await backendService.sendEmail({
        to: emailTo,
        subject: emailSubject,
        body: emailBody.replace(/\n/g, '<br>'),
        attachmentName: `${pType}_${computedRefId}.pdf`,
        pdfBase64,
      });

      showToast('Email envoyé avec succès !', 'success');
      setShowEmailModal(false);
      setEmailingInvoice(null);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Impossible d'envoyer l'email.", 'error');
    } finally {
      setSendingEmail(false);
    }
  };

  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const handleSendWhatsApp = async () => {
    if (!emailingInvoice) return;
    const clientObj = clients.find((c) => c.id === emailingInvoice.clientId);
    const phone = clientObj?.phone || '';
    if (!phone) {
      showToast("Ce client n'a pas de numéro de téléphone renseigné.", 'error');
      return;
    }
    if (isLandlinePhone(phone)) {
      showToast("Le numéro de ce client est une ligne fixe (05...), impossible d'envoyer par WhatsApp.", 'error');
      return;
    }
    setSendingWhatsApp(true);
    try {
      showToast('Envoi du message WhatsApp via OpenWA...', 'info');
      const { sendWhatsAppMessage } = await import('../services/whatsappService');
      const res = await sendWhatsAppMessage(phone, emailBody);
      if (res.success) {
        showToast('Facture envoyée par WhatsApp avec succès.', 'success');
        setShowEmailModal(false);
        setEmailingInvoice(null);
      } else {
        showToast('Erreur WhatsApp: ' + res.error, 'error');
      }
    } catch (err: any) {
      showToast(err.message || "Erreur lors de l'envoi WhatsApp.", 'error');
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const handleBulkPay = async () => {
    if (!user) return;
    const selectedInvoices = facturesListWithRefs.filter((f) => selectedInvoiceIds.includes(f.id));
    confirm({
      title: 'Enregistrer le règlement en masse ?',
      message: `Voulez-vous marquer comme entièrement réglées les ${selectedInvoices.length} factures sélectionnées ?`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          let paidCount = 0;
          for (const inv of selectedInvoices) {
            const total = Number(inv.total) || 0;
            const paid = inv.amountPaid !== undefined ? Number(inv.amountPaid) || 0 : 0;
            const remaining = total - paid;
            if (remaining > 0.05) {
              paidCount++;
              const paymentRef = doc(collection(db, 'clients', inv.clientId, 'payments'));
              batch.set(paymentRef, {
                ownerId: user.uid,
                clientId: inv.clientId,
                purchaseId: inv.id,
                amount: remaining,
                date: new Date(),
                method: 'Virement',
                note: 'Règlement en masse',
                createdAt: new Date(),
              });
              const purchaseRef = doc(db, 'clients', inv.clientId, 'purchases', inv.id);
              batch.update(purchaseRef, {
                amountPaid: total,
                paymentStatus: 'paid',
                paymentDate: new Date(),
              });
            }
          }
          await batch.commit();
          showToast(`Succès ! ${paidCount} factures ont été soldées et réglées.`, 'success');
          setSelectedInvoiceIds([]);
        } catch (err) {
          console.error(err);
          showToast('Erreur lors du paiement en masse', 'error');
        }
      },
    });
  };

  useEffect(() => {
    if (printingQueue.length === 0) return;

    const timer = setTimeout(async () => {
      const element = document.getElementById('hidden-pdf-content');
      if (!element) {
        console.error('hidden-pdf-content template element not found in DOM');
        setPrintingQueue([]);
        return;
      }

      const filename =
        printingQueue.length === 1
          ? `facture_${printingQueue[0].refId || 'Brouillon'}.pdf`
          : `Export_${printingQueue.length}_factures.pdf`;

      try {
        await generatePDF(element, { filename });
        showToast(
          printingQueue.length === 1 ? `PDF généré avec succès` : `PDF groupé généré avec succès`,
          'success'
        );
      } catch (err) {
        console.error('Error generating grouped PDF', err);
        showToast(`Erreur lors de la génération du PDF`, 'error');
      }

      setPrintingQueue([]);
      setSelectedInvoiceIds([]);
    }, 450);

    return () => clearTimeout(timer);
  }, [printingQueue]);

  useEffect(() => {
    if (printingBLQueue.length === 0) return;

    const timer = setTimeout(async () => {
      const element = document.getElementById('hidden-bl-pdf-content');
      if (!element) {
        console.error('hidden-bl-pdf-content template element not found in DOM');
        setPrintingBLQueue([]);
        return;
      }

      const firstDoc = printingBLQueue[0];
      const clientObj = clients.find((c) => c.id === firstDoc.clientId) || {
        name: clientsMap[firstDoc.clientId] || 'Client',
      };
      const blData = mapDocToDeliveryNoteData(firstDoc, clientObj);
      const cleanRef = (blData.blNumber || firstDoc.refId || 'BL').replace(/[/\\?%*:|"<>]/g, '_');
      const filename =
        printingBLQueue.length === 1
          ? `BL_${cleanRef}.pdf`
          : `Export_${printingBLQueue.length}_BLs.pdf`;

      try {
        await generatePDF(element, { filename });
        showToast(
          printingBLQueue.length === 1
            ? `Bon de livraison PDF généré avec succès`
            : `BL groupés générés avec succès`,
          'success'
        );
      } catch (err) {
        console.error('Error generating BL PDF', err);
        showToast(`Erreur lors de la génération du BL PDF`, 'error');
      }

      setPrintingBLQueue([]);
    }, 450);

    return () => clearTimeout(timer);
  }, [printingBLQueue, clients, clientsMap]);

  const handleBulkPrint = () => {
    const selected = facturesListWithRefs.filter((f) => selectedInvoiceIds.includes(f.id));
    if (selected.length === 0) {
      showToast('Veuillez sélectionner au moins une facture à imprimer.', 'error');
      return;
    }
    showToast(`Génération du PDF groupé pour ${selected.length} facture(s) lancée...`, 'success');
    setPrintingQueue(selected);
  };

  const handlePrintSingle = (invoice: any) => {
    setPrintingQueue([invoice]);
    showToast(`Préparation du PDF en cours...`, 'success');
  };

  const handlePrintBLSingle = (invoice: any) => {
    setPrintingBLQueue([invoice]);
    showToast(`Préparation du Bon de Livraison (BL) en cours...`, 'success');
  };

  const handleDeleteSingle = async (f: any) => {
    if (!user) return;
    const status = getInvoiceStatus(f);
    if (status === 'Valide') {
      showToast(
        `Sécurisation Odoo : Seules les factures Brouillon ou Annulées peuvent être supprimées.`,
        'error'
      );
      return;
    }

    confirm({
      title: 'Supprimer cette facture ?',
      message: `Voulez-vous supprimer définitivement la facture ${f.refId || 'Brouillon'} et tous ses règlements associés ? (Sécurisation Odoo respectée)`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          const paymentsSnap = await getDocs(
            query(
              collection(db, 'clients', f.clientId, 'payments'),
              where('purchaseId', '==', f.id),
              where('ownerId', '==', user.uid)
            )
          );
          paymentsSnap.forEach((d) => batch.delete(d.ref));
          batch.delete(doc(db, 'clients', f.clientId, 'purchases', f.id));
          if (f.parent_id) {
            batch.update(doc(db, 'clients', f.clientId, 'purchases', f.parent_id), { child_id: deleteField() });
          }
          await batch.commit();
          showToast(`La facture a été supprimée avec succès.`, 'success');
        } catch (err) {
          console.error(err);
          showToast('Erreur lors de la suppression de la facture', 'error');
        }
      },
    });
  };

  const handleBulkDuplicate = async () => {
    if (!user) return;
    const selectedInvoices = facturesListWithRefs.filter((f) => selectedInvoiceIds.includes(f.id));
    confirm({
      title: 'Dupliquer les factures ?',
      message: `Voulez-vous dupliquer les ${selectedInvoices.length} factures sélectionnées en état de Brouillon ?`,
      onConfirm: async () => {
        try {
          for (const f of selectedInvoices) {
            await addDoc(collection(db, 'clients', f.clientId, 'purchases'), {
              ownerId: user.uid,
              clientId: f.clientId,
              type: 'facture',
              conditions_paiement: f.conditions_paiement || 'Paiement immédiat',
              items: f.items || [],
              description: f.description || '',
              price: f.price || 0,
              quantity: f.quantity || 0,
              subtotal: f.subtotal || 0,
              taxAmount: f.taxAmount || 0,
              taxRate: f.taxRate || 0,
              total: f.total || 0,
              paymentStatus: 'credit',
              amountPaid: 0,
              dueDate: f.dueDate || null,
              date: new Date(),
              notes: (f.notes ? f.notes + '\n' : '') + `Dupliqué en masse depuis l'original`,
              notesList: [...(f.notesList || []), `Dupliqué en masse depuis l'original`],
              refId: null,
              status: 'Brouillon',
            });
          }
          showToast(
            `Excellent ! ${selectedInvoices.length} factures dupliquées en statut Brouillon.`,
            'success'
          );
          setSelectedInvoiceIds([]);
        } catch (error) {
          console.error(error);
          showToast('Erreur lors de la duplication en masse', 'error');
        }
      },
    });
  };

  const handleBulkExportCSV = () => {
    const selected = facturesListWithRefs.filter((f) => selectedInvoiceIds.includes(f.id));
    const headers = ['ID,Numero,Client,Date,Total,Reste,Statut,Lien Justificatif'];
    const rows = selected.map((f) => {
      const clientName = clientsMap[f.clientId] || 'Client Inconnu';
      const total = Number(f.total) || 0;
      const paid = f.amountPaid || 0;
      const remaining = (total - paid).toFixed(2);
      const status = getInvoiceStatus(f);

      let safeAttachment = 'Aucun justificatif rattaché';
      if (f.attachmentUrl) {
        if (f.attachmentUrl.startsWith('data:')) {
          const origin = window.location.origin;
          const route = `/download/vente/${f.clientId}/${f.id}`;
          safeAttachment = `${origin}${route}`;
        } else {
          safeAttachment = f.attachmentUrl;
        }
      }

      return `"${f.id}","${f.refId || 'Brouillon'}","${clientName.replace(/"/g, '""')}","${f.date?.toDate()?.toLocaleDateString() || ''}","${total}","${remaining}","${status}","${safeAttachment}"`;
    });
    const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `export_factures_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`${selected.length} factures exportées avec succès !`, 'success');
  };

  const handleBulkDelete = async () => {
    if (!user) return;
    const selectedInvoices = facturesListWithRefs.filter((f) => selectedInvoiceIds.includes(f.id));
    const nonDeletable = selectedInvoices.filter((f) => {
      const status = getInvoiceStatus(f);
      return status === 'Valide';
    });

    if (nonDeletable.length > 0) {
      showToast(
        `Sécurisation Odoo : Seules les factures Brouillon ou Annulées peuvent être supprimées (${nonDeletable.length} factures sélectionnées sont Validées).`,
        'error'
      );
      return;
    }

    confirm({
      title: 'Supprimer les factures sélectionnées ?',
      message: `Voulez-vous supprimer définitivement ces ${selectedInvoices.length} factures et leurs règlements associés ? (Sécurisation Odoo respectée : aucune facture Valide ne sera supprimée)`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          for (const f of selectedInvoices) {
            const paymentsSnap = await getDocs(
              query(
                collection(db, 'clients', f.clientId, 'payments'),
                where('purchaseId', '==', f.id),
                where('ownerId', '==', user.uid)
              )
            );
            paymentsSnap.forEach((d) => batch.delete(d.ref));
            batch.delete(doc(db, 'clients', f.clientId, 'purchases', f.id));
            if (f.parent_id) {
              batch.update(doc(db, 'clients', f.clientId, 'purchases', f.parent_id), { child_id: deleteField() });
            }
          }
          await batch.commit();
          showToast(`${selectedInvoices.length} factures supprimées avec succès`, 'success');
          setSelectedInvoiceIds([]);
        } catch (err) {
          console.error(err);
          showToast('Erreur lors de la suppression en masse', 'error');
        }
      },
    });
  };

  const handleBulkCancel = async () => {
    if (!user) return;
    const selectedInvoices = facturesListWithRefs.filter((f) => selectedInvoiceIds.includes(f.id));
    if (selectedInvoices.length === 0) {
      showToast('Veuillez sélectionner au moins une facture à annuler.', 'error');
      return;
    }

    const invalidInvoices = selectedInvoices.filter((f) => {
      const status = getInvoiceStatus(f);
      return status !== 'Brouillon' && status !== 'Valide';
    });

    if (invalidInvoices.length > 0) {
      showToast(
        `Seules les factures à l'état de 'Brouillon' ou 'Validée' peuvent être annulées (${invalidInvoices.length} factures non éligibles).`,
        'error'
      );
      return;
    }

    confirm({
      title: 'Annuler les factures sélectionnées ?',
      message: `Voulez-vous annuler ces ${selectedInvoices.length} factures sélectionnées ? Elles seront figées en lecture seule.`,
      onConfirm: async () => {
        try {
          await Promise.all(
            selectedInvoices.map((f) => invoiceService.cancelInvoice(f.clientId, f.id))
          );
          showToast(`${selectedInvoices.length} facture(s) annulée(s) avec succès.`, 'success');
          setSelectedInvoiceIds([]);
        } catch (err: any) {
          console.error(err);
          showToast(err?.message || "Erreur lors de l'annulation en masse.", 'error');
        }
      },
    });
  };

  const handleBulkResetToDraft = async () => {
    if (!user) return;
    const selectedInvoices = facturesListWithRefs.filter((f) => selectedInvoiceIds.includes(f.id));
    if (selectedInvoices.length === 0) {
      showToast('Veuillez sélectionner au moins une facture à remettre en brouillon.', 'error');
      return;
    }

    const invalidInvoices = selectedInvoices.filter((f) => {
      const status = getInvoiceStatus(f);
      return status !== 'Valide' && status !== 'Annulée';
    });

    if (invalidInvoices.length > 0) {
      showToast(
        `Seules les factures validées ou annulées peuvent être remises en brouillon (${invalidInvoices.length} factures non éligibles).`,
        'error'
      );
      return;
    }

    confirm({
      title: 'Remettre en brouillon ?',
      message: `Voulez-vous remettre en brouillon ces ${selectedInvoices.length} factures sélectionnées ? Leurs numéros officiels actuels seront conservés.`,
      onConfirm: async () => {
        try {
          await Promise.all(
            selectedInvoices.map((f) => invoiceService.resetToDraft(f.clientId, f.id))
          );
          showToast(
            `${selectedInvoices.length} facture(s) remise(s) en état Brouillon.`,
            'success'
          );
          setSelectedInvoiceIds([]);
        } catch (err: any) {
          console.error(err);
          showToast(err?.message || 'Erreur lors de la remise en brouillon en masse.', 'error');
        }
      },
    });
  };

  // Handle Quick Payment
  const handleQuickPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;

    const amountToPay = parseFloat(quickPaymentAmount);
    if (!amountToPay || isNaN(amountToPay) || amountToPay <= 0) {
      showToast('Veuillez saisir un montant de paiement valide.', 'error');
      return;
    }

    const total = Number(selectedInvoice.total) || 0;
    const isPaid = selectedInvoice.paymentStatus === 'paid';
    const currentPaid =
      selectedInvoice.amountPaid !== undefined
        ? Number(selectedInvoice.amountPaid) || 0
        : isPaid
          ? total
          : 0;
    const balanceRemaining = total - currentPaid;

    if (amountToPay > balanceRemaining + 0.01) {
      showToast(
        `Le montant dépasse le solde restant dû (${balanceRemaining.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH).`,
        'error'
      );
      return;
    }

    setIsSavingPayment(true);
    try {
      const batch = writeBatch(db);

      // 1. Create client payment record
      const paymentRef = doc(collection(db, 'clients', selectedInvoice.clientId, 'payments'));
      batch.set(paymentRef, {
        ownerId: user.uid,
        clientId: selectedInvoice.clientId,
        purchaseId: selectedInvoice.id,
        amount: amountToPay,
        date: new Date(),
        notes: `Paiement d'acompte sur Facture ${selectedInvoice.refId}`,
        createdAt: new Date(),
      });

      // 2. Update invoice's paid progress
      const newPaid = Number((currentPaid + amountToPay).toFixed(2));
      const newStatus = newPaid >= total - 0.05 ? 'paid' : 'credit';

      const invoiceRef = doc(
        db,
        'clients',
        selectedInvoice.clientId,
        'purchases',
        selectedInvoice.id
      );
      const updateData: any = {
        amountPaid: newPaid,
        paymentStatus: newStatus,
      };
      if (newStatus === 'paid') {
        updateData.paymentDate = new Date();
      }
      batch.update(invoiceRef, updateData);

      await batch.commit();
      showToast(
        `Excellent ! Paiement de ${amountToPay.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH enregistré.`,
        'success'
      );
      setSelectedInvoice(null);
      setQuickPaymentAmount('');
    } catch (err) {
      console.error(err);
      showToast("Une erreur s'est produite lors de l'encaissement.", 'error');
    } finally {
      setIsSavingPayment(false);
    }
  };

  const handleValidateInvoice = async (invoice: any) => {
    try {
      const status =
        invoice.status ||
        (invoice.refId && invoice.refId !== 'Brouillon' ? 'Validée' : 'Brouillon');
      if (status !== 'Brouillon') {
        showToast("Seules les factures en état 'Brouillon' peuvent être validées.", 'error');
        return;
      }

      if (!user) return;
      let proposed = invoice.refId;
      if (!proposed || proposed === 'Brouillon') {
        proposed = await invoiceService.getProposedInvoiceNumber(user.uid);
      } else {
        // Check if existing proposed number is already taken (to avoid stale draft numbers)
        try {
          const qRef = collection(db, 'sequences');
          const uniqueRegistryRef = doc(qRef, `ref_${user.uid}_${proposed}`);
          const snap = await getDoc(uniqueRegistryRef);
          if (snap.exists() && snap.data()?.purchaseId !== invoice.id) {
            proposed = await invoiceService.getProposedInvoiceNumber(user.uid);
          }
        } catch (e) {
          console.warn('Could not check unique registry:', e);
        }
      }
      // Auto-correct the proposed number if it's lagging behind the ACTUAL history and compute holes
      let missing: string[] = [];
      if (proposed) {
        const match = proposed.match(/^(.*?)(\d+)([^0-9]*)$/);
        if (match) {
          const prefix = match[1];
          const numStr = match[2];
          const len = numStr.length;
          const suffix = match[3];

          let actualMaxExisting = 0;
          let actualMinExisting = Number.MAX_SAFE_INTEGER;
          const existingNums = new Set<number>();
          facturesListWithRefs.forEach((f) => {
            const fStatus =
              f.status || (f.refId && f.refId !== 'Brouillon' ? 'Validée' : 'Brouillon');
            if (
              (fStatus === 'Valide' || fStatus === 'Validée' || fStatus === 'Annulée') &&
              f.refId
            ) {
              if (f.refId.startsWith(prefix) && f.refId.endsWith(suffix)) {
                const subStr = f.refId.substring(prefix.length, f.refId.length - suffix.length);
                if (/^\d+$/.test(subStr)) {
                  const n = parseInt(subStr, 10);
                  existingNums.add(n);
                  if (n > actualMaxExisting) actualMaxExisting = n;
                  if (n < actualMinExisting) actualMinExisting = n;
                }
              }
            }
          });

          // Force proposed to be exactly actualMaxExisting + 1 (strict sequential)
          const correctNext = actualMaxExisting + 1;
          proposed = `${prefix}${String(correctNext).padStart(len, '0')}${suffix}`;

          // Compute missing holes strictly between 1 and correctNext - 1
          if (existingNums.size > 0) {
            for (let i = 1; i < correctNext; i++) {
              if (!existingNums.has(i)) {
                missing.push(`${prefix}${String(i).padStart(len, '0')}${suffix}`);
                if (missing.length >= 30) break; // limit to 30 to avoid UI clutter
              }
            }
          }
        }
      }

      // Automatically determine the legal date from the draft's "Date d'Émission"
      let invoiceDateToUse: Date;
      if (invoice.date) {
        invoiceDateToUse =
          typeof invoice.date.toDate === 'function'
            ? invoice.date.toDate()
            : new Date(invoice.date);
      } else {
        invoiceDateToUse = new Date();
      }

      // If no sequence holes are detected, bypass modal step completely & validate directly!
      if (missing.length === 0) {
        setLoadingValidation(true);
        try {
          const confirmedNo = await invoiceService.validateInvoice(
            invoice.clientId,
            invoice.id,
            proposed,
            invoiceDateToUse
          );
          showToast(`Excellent ! Facture validée sous le numéro : ${confirmedNo}`, 'success');
        } catch (error: any) {
          console.error(error);
          showToast(error?.message || 'Erreur lors de la validation.', 'error');
        } finally {
          setLoadingValidation(false);
        }
        return;
      }

      // Holes/Gaps exist: Show modal warning for choice/override
      setCustomRefNum(proposed);
      setMissingSequences(missing);
      setValidatingInvoice(invoice);
    } catch (err: any) {
      console.error('FATAL ERROR IN INVOICE NUMBER FETCHING:', err);
      showToast('Impossible de charger le numéro proposé. ' + err?.message, 'error');
    }
  };

  const handleConfirmValidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validatingInvoice || !user) return;

    setLoadingValidation(true);
    try {
      let invoiceDateToUse: Date;
      if (validatingInvoice.date) {
        invoiceDateToUse =
          typeof validatingInvoice.date.toDate === 'function'
            ? validatingInvoice.date.toDate()
            : new Date(validatingInvoice.date);
      } else {
        invoiceDateToUse = new Date();
      }

      const confirmedNo = await invoiceService.validateInvoice(
        validatingInvoice.clientId,
        validatingInvoice.id,
        customRefNum,
        invoiceDateToUse
      );
      showToast(`Excellent ! Facture validée sous le numéro : ${confirmedNo}`, 'success');
      setValidatingInvoice(null);
      setCustomRefNum('');
    } catch (error: any) {
      console.error(error);
      showToast(error?.message || 'Erreur lors de la validation.', 'error');
    } finally {
      setLoadingValidation(false);
    }
  };

  const handleCancelInvoice = async (invoice: any) => {
    try {
      const status =
        invoice.status ||
        (invoice.refId && invoice.refId !== 'Brouillon' ? 'Validée' : 'Brouillon');
      if (status !== 'Brouillon' && status !== 'Valide' && status !== 'Validée') {
        showToast(
          "Seule une facture à l'état de 'Brouillon' ou 'Validée' peut être annulée.",
          'error'
        );
        return;
      }

      confirm({
        title: 'Annuler cette facture ?',
        message:
          "La facture sera définitivement annulée. Elle conservera l'état de Brouillon annulé.",
        onConfirm: async () => {
          try {
            await invoiceService.cancelInvoice(invoice.clientId, invoice.id);
            showToast('La facture a été annulée.', 'success');
          } catch (error: any) {
            console.error(error);
            showToast(error?.message || "Erreur lors de l'annulation.", 'error');
          }
        },
      });
    } catch (err) {
      console.error(err);
      showToast("Une erreur s'est produite.", 'error');
    }
  };

  const handleResetToDraft = async (invoice: any) => {
    try {
      const status =
        invoice.status ||
        (invoice.refId && invoice.refId !== 'Brouillon' ? 'Validée' : 'Brouillon');
      if (status !== 'Validée' && status !== 'Valide' && status !== 'Annulée') {
        showToast(
          'Seules les factures officiellement validées ou annulées peuvent être remises en brouillon.',
          'error'
        );
        return;
      }

      confirm({
        title: 'Remettre en Brouillon ?',
        message:
          'En remettant cette facture en état Brouillon, son numéro officiel actuel sera conservé. Elle pourra être modifiée puis re-validée.',
        onConfirm: async () => {
          try {
            await invoiceService.resetToDraft(invoice.clientId, invoice.id);
            showToast('La facture a été remise en état Brouillon.', 'success');
          } catch (error: any) {
            console.error(error);
            showToast(error?.message || 'Erreur lors de la remise en brouillon.', 'error');
          }
        },
      });
    } catch (err) {
      console.error(err);
      showToast("Une erreur s'est produite.", 'error');
    }
  };

  const handleDuplicate = async (f: any) => {
    if (!user) return;
    confirm({
      title: 'Dupliquer la facture ?',
      message: `Voulez-vous créer une copie exacte de cette facture sous l'état Brouillon ?`,
      onConfirm: async () => {
        try {
          // Add duplicated document in Draft state with NULL refId and reset amountPaid
          const docRef = await addDoc(collection(db, 'clients', f.clientId, 'purchases'), {
            ownerId: user.uid,
            clientId: f.clientId,
            type: 'facture',
            conditions_paiement: f.conditions_paiement || 'Paiement immédiat',
            items: f.items || [],
            description: f.description || '',
            price: f.price || 0,
            quantity: f.quantity || 0,
            subtotal: f.subtotal || 0,
            taxAmount: f.taxAmount || 0,
            taxRate: f.taxRate || 0,
            total: f.total || 0,
            paymentStatus: 'credit',
            amountPaid: 0,
            dueDate: f.dueDate || null,
            date: new Date(), // Today is the duplication date
            notes: (f.notes ? f.notes + '\n' : '') + `Dupliqué depuis l'original`,
            notesList: [...(f.notesList || []), `Dupliqué depuis l'original`],
            refId: null,
            status: 'Brouillon',
          });

          showToast('Facture dupliquée avec succès en statut Brouillon !', 'success');
          navigate(`/purchase/${f.clientId}/${docRef.id}`);
        } catch (error) {
          console.error(error);
          showToast('Erreur lors de la duplication', 'error');
          handleFirestoreError(error, OperationType.CREATE, 'purchases');
        }
      },
    });
  };

  const getAvatarStyle = (name: string) => {
    const char = name ? name.trim().charAt(0).toUpperCase() : '?';
    const colors: Record<string, { bg: string; text: string; ring: string }> = {
      A: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        ring: 'ring-[#696cff]/10',
      },
      B: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        ring: 'ring-[#696cff]/10',
      },
      C: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        ring: 'ring-[#696cff]/10',
      },
      D: {
        bg: 'bg-transparent',
        text: 'text-[#ff3e1d] dark:text-[#ff3e1d]',
        ring: 'ring-[#ff3e1d]/10',
      },
      E: {
        bg: 'bg-transparent',
        text: 'text-[#ff3e1d] dark:text-[#ff3e1d]',
        ring: 'ring-[#ff3e1d]/10',
      },
      F: { bg: 'bg-transparent', text: 'text-fuchsia-600', ring: 'ring-fuchsia-100/50' },
      G: { bg: 'bg-transparent', text: 'text-violet-600', ring: 'ring-violet-100/50' },
      H: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        ring: 'ring-[#696cff]/10',
      },
      I: {
        bg: 'bg-transparent',
        text: 'text-[#03c3ec] dark:text-[#03c3ec]',
        ring: 'ring-cyan-100/50',
      },
      J: {
        bg: 'bg-transparent',
        text: 'text-[#4fb922] dark:text-[#71dd37]',
        ring: 'ring-[#71dd37]/10',
      },
      K: {
        bg: 'bg-transparent',
        text: 'text-[#4fb922] dark:text-[#71dd37]',
        ring: 'ring-[#71dd37]/10',
      },
      L: {
        bg: 'bg-transparent',
        text: 'text-[#ffab00] dark:text-[#ffab00]',
        ring: 'ring-[#ffab00]/10',
      },
      M: {
        bg: 'bg-transparent',
        text: 'text-[#ffab00] dark:text-[#ffab00]',
        ring: 'ring-[#ffab00]/10',
      },
      N: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        ring: 'ring-[#696cff]/10',
      },
      O: {
        bg: 'bg-transparent',
        text: 'text-[#ffab00] dark:text-[#ffab00]',
        ring: 'ring-[#ffab00]/10',
      },
      P: {
        bg: 'bg-transparent',
        text: 'text-[#ff3e1d] dark:text-[#ff3e1d]',
        ring: 'ring-[#ff3e1d]/10',
      },
      Q: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        ring: 'ring-[#696cff]/10',
      },
      R: {
        bg: 'bg-transparent',
        text: 'text-[#697a8d] dark:text-[#a3a4cc]',
        ring: 'ring-[#697a8d]/10',
      },
      S: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        ring: 'ring-[#696cff]/10',
      },
      T: {
        bg: 'bg-transparent',
        text: 'text-[#03c3ec] dark:text-[#03c3ec]',
        ring: 'ring-[#03c3ec]/10',
      },
      U: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        ring: 'ring-[#696cff]/10',
      },
      V: {
        bg: 'bg-transparent',
        text: 'text-[#4fb922] dark:text-[#71dd37]',
        ring: 'ring-[#71dd37]/10',
      },
      W: {
        bg: 'bg-transparent',
        text: 'text-[#ff3e1d] dark:text-[#ff3e1d]',
        ring: 'ring-[#ff3e1d]/10',
      },
      Y: {
        bg: 'bg-transparent',
        text: 'text-[#697a8d] dark:text-[#a3a4cc]',
        ring: 'ring-[#697a8d]/10',
      },
      Z: {
        bg: 'bg-transparent',
        text: 'text-[#4fb922] dark:text-[#71dd37]',
        ring: 'ring-[#71dd37]/10',
      },
    };
    return colors[char] || { bg: 'bg-slate-50', text: 'text-[#697a8d]', ring: 'ring-[#697a8d]/10' };
  };

  return (
    <div className="w-full py-4 space-y-6 select-none relative bg-transparent">
      {/* Core Analytics Banner - Sneat KPI Card Style */}
      <div className="w-full bg-[#ffffff] dark:bg-[#2b2c40] border border-[#eceef1] dark:border-[#434460]/60 rounded-xl shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:shadow-none overflow-hidden mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Clients */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40]">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Clients
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="text-2xl font-bold tracking-tight text-[#222222] dark:text-[#dbdade] font-sans">
                  {stats.clientCount}
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span>Clients uniques</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <User size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 2: Volume Facturé (Invoices) */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t-0 md:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Invoices
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#222222] dark:text-[#dbdade]">
                  {stats.volumeFacture.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-[#222222] dark:text-[#eceeff]">
                  {stats.invoicesCount}
                </span>
                <span>
                  Facture{stats.invoicesCount > 1 ? 's' : ''} émise
                  {stats.invoicesCount > 1 ? 's' : ''}
                </span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <FileText size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 3: Trésorerie Encaissée (Paid) */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Paid
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#4fb922] dark:text-[#71dd37]">
                  {stats.tresorerieEncaissee.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-[#4fb922] dark:text-[#71dd37]">
                  {stats.recoveryRate.toFixed(1)}%
                </span>
                <span>Récupéré</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <Coins size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 4: Créances Actives (Balance Due) */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 md:border-l lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Balance Due
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#ff3e1d]">
                  {stats.creancesActives.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium mt-1">
                <span>Crédits restants</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <AlertCircle size={22} className="stroke-[2.2]" />
            </div>
          </div>
        </div>
      </div>

      {/* Unified filters and tables boxes */}
      <div className="sneat-table-container w-full overflow-visible mb-8">
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* ==========================================
                 SNEAT STYLE - EN-TÊTE FACTURATION (TABS)
                 ========================================== */

              /* Table Control Header Bar (Search & Tabs / Bulk Selection swap) */
              .table-nav {
                  position: relative;
                  min-height: 76px;
                  border-bottom: 1px solid #d9dee3;
                  background: #ffffff;
                  overflow: visible;
                  display: flex;
                  align-items: center;
                  border-top-left-radius: 8px;
                  border-top-right-radius: 8px;
              }
              .dark .table-nav {
                  border-bottom-color: rgba(67, 68, 96, 0.4);
                  background: #2b2c40;
              }

              /* VIEW A: Standard Header with original Tabs navigation */
              .nav-default-view {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  padding: 16px 24px;
                  width: 100%;
                  min-height: 76px;
                  transition: transform 0.2s ease, opacity 0.2s ease;
              }

              /* VIEW B: Dynamic Checked Items Bulk Bar view */
              .nav-selection-view {
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  min-height: 76px;
                  background: #ffffff;
                  display: flex;
                  align-items: center;
                  gap: 12px;
                  padding: 16px 24px;
                  transform: translateY(-100%);
                  opacity: 0;
                  transition: transform 0.2s ease, opacity 0.2s ease;
                  border-top-left-radius: 8px;
                  border-top-right-radius: 8px;
                  pointer-events: none;
              }
              .dark .nav-selection-view {
                  background: #2b2c40;
              }

              /* State Triggers for Bulk Actions Bar */
              .table-nav.has-selection .nav-default-view {
                  transform: translateY(100%);
                  opacity: 0;
                  pointer-events: none;
              }

              .table-nav.has-selection .nav-selection-view {
                  transform: translateY(0);
                  opacity: 1;
                  pointer-events: auto;
              }

              /* Original Tabs Layout styled like Sneat Admin */
              .tabs { 
                  display: flex; 
                  gap: 6px; 
              }

              .tab-btn {
                  padding: 8px 16px; 
                  font-size: 14px; 
                  font-weight: 500;
                  border-radius: 0.375rem; 
                  border: none; 
                  cursor: pointer; 
                  color: #697a8d; 
                  background: transparent;
                  transition: all 0.15s ease;
                  font-family: "Public Sans", -apple-system, sans-serif;
              }
              .dark .tab-btn {
                  color: #a3a4cc;
              }

              .tab-btn:hover {
                  background-color: #f5f5f9;
                  color: #566a7f;
              }
              .dark .tab-btn:hover {
                  background-color: #323249;
                  color: #dbdade;
              }

              /* Active Tab with Sneat Indigo Accent + Box Shadow */
              .tab-btn.active { 
                  background-color: #696cff; 
                  color: #ffffff; 
                  box-shadow: 0 0.125rem 0.25rem rgba(105, 108, 255, 0.4);
                  font-weight: 600;
              }
              .dark .tab-btn.active {
                  background-color: #696cff;
                  color: #ffffff;
                  box-shadow: 0 0.125rem 0.25rem rgba(105, 108, 255, 0.4);
              }

              /* Sneat Styled Search Input (Filtrer) */
              .search-input {
                  padding: 8px 14px;
                  font-size: 14px;
                  color: #435971;
                  border: 1px solid #d9dee3;
                  border-radius: 0.375rem;
                  width: 220px;
                  outline: none;
                  transition: border-color 0.15s ease-in-out;
                  background-color: #ffffff;
                  font-family: "Public Sans", -apple-system, sans-serif;
              }
              .dark .search-input {
                  background-color: #232333;
                  border-color: rgba(67, 68, 96, 0.4);
                  color: #dbdade;
              }

              .search-input:focus {
                  border-color: #696cff;
                  box-shadow: 0 0 0 0.2rem rgba(105, 108, 255, 0.1);
              }

              /* Bulk Buttons Style (Sneat secondary light gray) */
              .action-bar-btn {
                  background-color: #eceef1;
                  border: none;
                  color: #435971;
                  padding: 8px 16px;
                  border-radius: 0.375rem;
                  font-size: 13.5px;
                  font-weight: 500;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  transition: all 0.2s ease;
              }
              .dark .action-bar-btn {
                  background-color: #323249;
                  color: #a3a4cc;
              }

              .action-bar-btn:hover {
                  background-color: #e1e4e8;
                  color: #233446;
              }
              .dark .action-bar-btn:hover {
                  background-color: #3c3d5a;
                  color: #dbdade;
              }

              /* Counter Badge (Success Green Capsule) */
              .counter-badge {
                  background-color: #e8fadf;
                  border: 1px solid #71dd37;
                  color: #71dd37;
                  font-size: 13px;
                  font-weight: 600;
                  padding: 6px 14px;
                  border-radius: 0.375rem;
                  display: flex;
                  align-items: center;
                  gap: 10px;
              }
              .dark .counter-badge {
                  background-color: rgba(113, 221, 55, 0.12);
                  border-color: rgba(113, 221, 55, 0.2);
                  color: #71dd37;
              }

              .counter-close { 
                  cursor: pointer; 
                  font-weight: bold; 
              }

              /* ==========================================
                 SNEAT STYLE - REAL TABLE STYLING
                 ========================================== */
              .sneat-table-container {
                  background: #ffffff;
                  border: 1px solid #eceef1;
                  border-radius: 8px;
                  box-shadow: 0 2px 6px rgba(67, 89, 113, 0.12);
                  overflow: hidden;
              }
              .dark .sneat-table-container {
                  background: #2b2c40;
                  border-color: rgba(67, 68, 96, 0.4);
                  box-shadow: none;
              }

              /* Table structure */
              .sneat-table {
                  width: 100%;
                  border-collapse: collapse;
                  font-family: "Public Sans", -apple-system, sans-serif;
                  text-align: left;
              }

              /* Header style with uppercase, small bold font */
              .sneat-table thead tr {
                  background-color: #ffffff;
                  border-bottom: 1px solid #d9dee3;
              }
              .dark .sneat-table thead tr {
                  background-color: #2b2c40;
                  border-bottom-color: rgba(67, 68, 96, 0.4);
              }

              .sneat-table thead th {
                  font-size: 11.5px;
                  font-weight: 600;
                  text-transform: uppercase;
                  color: #566a7f;
                  padding: 14px 20px;
                  letter-spacing: 0.8px;
              }
              .dark .sneat-table thead th {
                  color: #a3afbb;
              }

              /* Row styles */
              .sneat-table tbody tr {
                  border-bottom: 1px solid #eceef1;
                  background-color: #ffffff;
                  transition: background-color 0.15s ease;
              }
              .dark .sneat-table tbody tr {
                  border-bottom-color: rgba(67, 68, 96, 0.4);
                  background-color: #2b2c40;
              }

              .sneat-table tbody tr:hover {
                  background-color: #f5f5f9;
              }
              .dark .sneat-table tbody tr:hover {
                  background-color: #323249;
              }

              .sneat-table tbody tr.selected {
                  background-color: rgba(105, 108, 255, 0.08);
              }
              .dark .sneat-table tbody tr.selected:hover {
                  background-color: rgba(105, 108, 255, 0.12);
              }

              /* Table cell styles */
              .sneat-table tbody td {
                  padding: 14px 20px;
                  font-size: 14px;
                  color: #566a7f;
                  vertical-align: middle;
              }
              .dark .sneat-table tbody td {
                  color: #dbdade;
              }

              /* Invoice Number styling */
              .sneat-invoice-link {
                  color: #696cff;
                  font-weight: 600;
                  text-decoration: none;
                  transition: color 0.15s ease;
              }
              .sneat-invoice-link:hover {
                  color: #5f61e6;
                  text-decoration: underline;
              }

              /* Pagination container stuck directly below table */
              .sneat-pagination-bar {
                  display: flex;
                  flex-wrap: wrap;
                  justify-content: space-between;
                  align-items: center;
                  padding: 16px 24px;
                  background-color: #ffffff;
                  border-top: 1px solid #eceef1;
                  margin-top: 0 !important;
              }
              .dark .sneat-pagination-bar {
                  background-color: #2b2c40;
                  border-top-color: rgba(67, 68, 96, 0.4);
              }

              .sneat-pagination-control {
                  display: flex;
                  gap: 6px;
                  align-items: center;
              }

              .sneat-pag-btn {
                  width: 32px;
                  height: 32px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background-color: #f5f5f9;
                  border: none;
                  color: #697a8d;
                  font-size: 13px;
                  font-weight: 500;
                  border-radius: 4px;
                  cursor: pointer;
                  transition: all 0.15s ease;
              }
              .dark .sneat-pag-btn {
                  background-color: #323249;
                  color: #a3a4cc;
              }

              .sneat-pag-btn:hover:not(:disabled) {
                  background-color: #eceef1;
                  color: #566a7f;
              }
              .dark .sneat-pag-btn:hover:not(:disabled) {
                  background-color: #3c3d5a;
                  color: #dbdade;
              }

              .sneat-pag-btn.active {
                  background-color: #696cff;
                  color: #ffffff;
                  box-shadow: 0 0.125rem 0.25rem rgba(105, 108, 255, 0.4);
              }

              .sneat-pag-btn:disabled {
                  opacity: 0.4;
                  cursor: not-allowed;
              }
            `,
          }}
        />

        <div className={`table-nav ${selectedInvoiceIds.length > 0 ? 'has-selection' : ''}`}>
          {/* VIEW A: Standard Filters */}
          <div className="nav-default-view flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full gap-4">
            {/* Left Side: Entries Selector + Create Invoice Button conforming to Sneat placement */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
              <span className="text-sm font-medium text-[#8592a3] dark:text-[#a3afbb]">Show</span>
              <div className="relative">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 pl-3 pr-8 py-1.5 rounded-[6px] text-sm font-semibold text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none focus:border-[#696cff] w-20 text-left h-[38px] transition-all"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <ChevronDown
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8592a3] pointer-events-none"
                  size={13}
                  strokeWidth={2.5}
                />
              </div>

              {/* Create Invoice Button - directly inline with Show Entries dropdown on the left */}
              <Link
                to="/add-purchase?type=facture"
                className="bg-[#696cff] hover:bg-[#5f61e6] active:bg-[#5f61e6] text-white px-4 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm shadow-[0_2px_4px_0_rgba(105,108,255,0.4)] hover:shadow-[0_4px_8px_0_rgba(105,108,255,0.4)] cursor-pointer whitespace-nowrap ml-2 sm:ml-3"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span>Create Invoice</span>
              </Link>

              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100/80 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30 px-4 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm cursor-pointer whitespace-nowrap ml-2"
              >
                <FileSpreadsheet size={16} strokeWidth={2.5} />
                <span>Importer Odoo</span>
              </button>
            </div>

            {/* Right Side Actions Group (Search + Status Filter + Sort) */}
            <div className="flex items-center gap-3 flex-wrap md:flex-nowrap justify-end">
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Invoice"
                  className="search-input w-[180px] md:w-[200px] h-[38px]"
                />
              </div>

              <div className="relative text-left min-w-[170px]">
                <button
                  type="button"
                  onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
                  className="w-full appearance-none bg-[#f1f1f5] dark:bg-[#232333] border-none rounded-t-[4px] border-b border-transparent pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none flex items-center justify-between transition-all tracking-wide h-[38px]"
                >
                  <span className="truncate">
                    {(() => {
                      if (datePeriodFilter === 'all' && dateYearFilter === 'all') {
                        return 'Date de facturation';
                      }
                      let label = '';
                      if (datePeriodFilter !== 'all') {
                        if (datePeriodFilter.startsWith('month:')) {
                          const mNum = parseInt(datePeriodFilter.split(':')[1]);
                          const monthsFr = [
                            'janvier',
                            'février',
                            'mars',
                            'avril',
                            'mai',
                            'juin',
                            'juillet',
                            'août',
                            'septembre',
                            'octobre',
                            'novembre',
                            'décembre',
                          ];
                          label += monthsFr[mNum - 1];
                        } else if (datePeriodFilter.startsWith('quarter:')) {
                          label += 'T' + datePeriodFilter.split(':')[1];
                        }
                      }
                      if (dateYearFilter !== 'all') {
                        if (label) {
                          label += ` ${dateYearFilter}`;
                        } else {
                          label = dateYearFilter;
                        }
                      }
                      return label;
                    })()}
                  </span>
                  <ChevronDown
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8592a3]"
                    size={15}
                    strokeWidth={2.2}
                  />
                </button>

                {isDateDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsDateDropdownOpen(false)}
                    />
                    <div className="absolute top-full right-0 mt-1 bg-white dark:bg-[#2c2d42] border border-[#d9dee3] dark:border-[#434460]/40 rounded-b-md shadow-lg w-[320px] z-50 py-3 flex flex-col font-sans">
                      {/* Close / Header */}
                      <div className="px-4 pb-2 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                          Filtrer par date
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setDatePeriodFilter('all');
                            setDateYearFilter('all');
                            setIsDateDropdownOpen(false);
                          }}
                          className="text-[11px] font-semibold text-[#696cff] hover:underline cursor-pointer"
                        >
                          Toutes les dates
                        </button>
                      </div>

                      {/* Section Months */}
                      <div className="px-4 pt-3">
                        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                          Mois
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[
                            { val: 1, label: 'Jan' },
                            { val: 2, label: 'Fév' },
                            { val: 3, label: 'Mar' },
                            { val: 4, label: 'Avr' },
                            { val: 5, label: 'Mai' },
                            { val: 6, label: 'Juin' },
                            { val: 7, label: 'Juil' },
                            { val: 8, label: 'Août' },
                            { val: 9, label: 'Sept' },
                            { val: 10, label: 'Oct' },
                            { val: 11, label: 'Nov' },
                            { val: 12, label: 'Déc' },
                          ].map((item) => {
                            const targetVal = `month:${item.val}`;
                            const isSelected = datePeriodFilter === targetVal;
                            return (
                              <button
                                key={item.val}
                                type="button"
                                onClick={() => {
                                  setDatePeriodFilter(isSelected ? 'all' : targetVal);
                                }}
                                className={`py-1 text-center text-xs rounded-md transition-all cursor-pointer border ${
                                  isSelected
                                    ? 'bg-[#696cff] text-white border-[#696cff] font-semibold shadow-xs'
                                    : 'bg-slate-50 dark:bg-[#232333] hover:bg-slate-100 dark:hover:bg-[#2e2f47] text-slate-700 dark:text-slate-300 border-transparent text-[11px]'
                                }`}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Section Quarters */}
                      <div className="px-4 pt-3">
                        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                          Trimestres
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {[1, 2, 3, 4].map((q) => {
                            const targetVal = `quarter:${q}`;
                            const isSelected = datePeriodFilter === targetVal;
                            return (
                              <button
                                key={q}
                                type="button"
                                onClick={() => {
                                  setDatePeriodFilter(isSelected ? 'all' : targetVal);
                                }}
                                className={`py-1 text-center text-xs rounded-md transition-all cursor-pointer border ${
                                  isSelected
                                    ? 'bg-[#696cff] text-white border-[#696cff] font-semibold shadow-xs'
                                    : 'bg-slate-50 dark:bg-[#232333] hover:bg-slate-100 dark:hover:bg-[#2e2f47] text-slate-700 dark:text-slate-300 border-transparent text-[11px]'
                                }`}
                              >
                                T{q}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Section Years */}
                      <div className="px-4 pt-3 pb-2">
                        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                          Années
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {['2021', '2022', '2023', '2024', '2025', '2026', '2027', '2028'].map((y) => {
                            const isSelected = dateYearFilter === y;
                            return (
                              <button
                                key={y}
                                type="button"
                                onClick={() => {
                                  setDateYearFilter(isSelected ? 'all' : y);
                                }}
                                className={`py-1 text-center text-xs rounded-md transition-all cursor-pointer border ${
                                  isSelected
                                    ? 'bg-[#696cff] text-white border-[#696cff] font-semibold shadow-xs'
                                    : 'bg-slate-50 dark:bg-[#232333] hover:bg-slate-100 dark:hover:bg-[#2e2f47] text-slate-700 dark:text-slate-300 border-transparent text-[11px]'
                                }`}
                              >
                                {y}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Footer Close Button */}
                      <div className="mt-2 px-4 pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                        <button
                          type="button"
                          onClick={() => setIsDateDropdownOpen(false)}
                          className="px-4 py-1.5 bg-[#696cff] hover:bg-[#5f61e6] text-white font-semibold text-xs rounded-md shadow-xs transition-all cursor-pointer"
                        >
                          Appliquer
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Status Dropdown conforming to Sneat list styling with neutral border */}
              <div className="relative text-left min-w-[170px]">
                <button
                  id="invoice-status-dropdown-btn"
                  type="button"
                  onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                  className="w-full appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none flex items-center justify-between shadow-xs transition-all tracking-wide h-[38px] hover:border-[#696cff] focus:border-[#696cff] active:border-[#696cff]"
                >
                  <span className="truncate">
                    {activeTab === 'all' && 'Invoice Status'}
                    {activeTab === 'draft' && 'Draft'}
                    {activeTab === 'paid' && 'Paid'}
                    {activeTab === 'partial' && 'Partial Payment'}
                    {activeTab === 'past_due' && 'Past Due'}
                    {activeTab === 'sent' && 'Sent'}
                    {activeTab === 'debtors' && 'Past Due'}
                    {activeTab === 'exclu_compta' && 'Exclu Compta'}
                  </span>
                  <ChevronDown
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8592a3]"
                    size={15}
                    strokeWidth={2.2}
                  />
                </button>

                {isStatusDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsStatusDropdownOpen(false)}
                    />
                    <div className="absolute top-[110%] right-0 bg-white dark:bg-[#2c2d42] border border-[#d9dee3] dark:border-[#434460]/40 rounded-lg shadow-md min-w-[190px] z-50 py-1 flex flex-col font-sans">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('all');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'all' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Invoice Status
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('draft');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'draft' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Draft
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('paid');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'paid' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Paid
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('partial');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'partial' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Partial Payment
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('past_due');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'past_due' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Past Due
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('sent');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'sent' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Sent
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('exclu_compta');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'exclu_compta' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Exclu Compta
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* VIEW B: Bulk Actions */}
          <div className="nav-selection-view">
            <button
              className="action-bar-btn flex items-center gap-1.5"
              onClick={() => setSelectedInvoiceIds([])}
            >
              <span>{selectedInvoiceIds.length} sélectionné(s)</span>
              <span className="text-lg leading-none">&times;</span>
            </button>

            {/* Option to select the rest of the matching entries if page is checked */}
            {isAllSelected &&
              !isEverythingSelected &&
              filteredFactures.length > paginatedFactures.length && (
                <button
                  type="button"
                  onClick={handleSelectEverything}
                  className="action-bar-btn flex items-center gap-1.5"
                >
                  Sélectionner les {filteredFactures.length} éléments
                </button>
              )}

            {isEverythingSelected && filteredFactures.length > paginatedFactures.length && (
              <button
                type="button"
                onClick={handleClearAllSelection}
                className="action-bar-btn flex items-center gap-1.5"
              >
                Annuler la sélection
              </button>
            )}

            <div className="relative">
              <button
                onClick={() => setIsBulkDropdownOpen(!isBulkDropdownOpen)}
                className="action-bar-btn flex items-center gap-1.5"
              >
                <Settings size={15} strokeWidth={2.2} />
                <span>Actions</span>
                <span className="text-[10px]">▼</span>
              </button>
              {isBulkDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsBulkDropdownOpen(false)}
                  />
                  <div className="absolute top-[110%] left-0 bg-white dark:bg-[#2b2c40] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] shadow-[0_4px_12px_rgba(67,89,113,0.12)] w-[180px] z-50 py-1.5 flex flex-col">
                    <button
                      onClick={() => {
                        handleBulkCancel();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#ff3e1d] hover:bg-[#ffe1e1] dark:hover:bg-[#4b2e2e]/50 font-semibold cursor-pointer flex items-center gap-2"
                    >
                      <AlertCircle size={14} />
                      Annuler la sélection
                    </button>
                    <button
                      onClick={() => {
                        handleBulkResetToDraft();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#ffab00] hover:bg-[#fff7e6] dark:hover:bg-[#4b3e2e]/50 font-medium cursor-pointer flex items-center gap-2"
                    >
                      <RefreshCw size={14} />
                      Remettre en brouillon
                    </button>
                    <hr className="border-[#eceef1] dark:border-[#434460]/40 my-1" />
                    <button
                      onClick={() => {
                        handleBulkDuplicate();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#566a7f] dark:text-[#dbdade] hover:bg-[#f5f5f9] dark:hover:bg-[#323249] font-medium cursor-pointer flex items-center gap-2"
                    >
                      Dupliquer
                    </button>
                    <button
                      onClick={() => {
                        handleBulkExportCSV();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#566a7f] dark:text-[#dbdade] hover:bg-[#f5f5f9] dark:hover:bg-[#323249] font-medium cursor-pointer flex items-center gap-2"
                    >
                      Exporter XLSX
                    </button>
                    <hr className="border-[#eceef1] dark:border-[#434460]/40 my-1" />
                    <button
                      onClick={() => {
                        handleBulkDelete();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#ff3e1d] hover:bg-[#ffe1e1] dark:hover:bg-[#4b2e2e]/50 font-semibold cursor-pointer flex items-center gap-2"
                    >
                      Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Invoices List table */}
        <AnimatePresence mode="wait">
          {filteredFactures.length === 0 ? (
            <motion.div key="empty" className="py-20 text-center bg-white dark:bg-[#2b2c40]">
              <FileText className="w-12 h-12 text-[#dbdade]/30 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-[#566a7f] dark:text-[#dbdade]">
                Aucune facture émise
              </h3>
              <p className="text-xs text-[#a1acb8] mt-1">
                Créez directement des factures ou convertissez des bons de commandes.
              </p>
            </motion.div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="bg-white dark:bg-[#2b2c40] border-b border-[#dbdade]/70 dark:border-[#434460]/40 text-[11px] uppercase tracking-widest font-black text-[#566a7f] dark:text-[#a3a4cc] select-none h-12">
                      <th className="py-3 px-4 text-center w-12">
                        <input
                          type="checkbox"
                          className="w-4 h-4 text-[#696cff] border-[#dbdade] rounded focus:ring-[#696cff] cursor-pointer"
                          checked={isAllSelected}
                          ref={(input) => {
                            if (input) {
                              input.indeterminate = isSomeSelected;
                            }
                          }}
                          onChange={handleSelectAll}
                        />
                      </th>
                      <th className="py-3 px-6 text-left">N° Facture</th>
                      <th className="py-3 px-6 text-left">Client</th>
                      <th className="py-3 px-6 text-left">Émission</th>
                      <th className="py-3 px-6 text-right">Reste / Total</th>
                      <th className="py-3 px-6 text-left">Recouvrement</th>
                      <th className="py-3 px-6 text-left">Statut</th>
                      <th className="py-3 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedFactures.map((f, idx) => {
                      const isLastRows =
                        idx >= paginatedFactures.length - 2 && paginatedFactures.length > 3;
                      const clientName = clientsMap[f.clientId] || 'Client Inconnu';
                      const total = Number(f.total) || 0;
                      const paid =
                        f.amountPaid !== undefined
                          ? Number(f.amountPaid) || 0
                          : f.paymentStatus === 'paid'
                            ? total
                            : 0;
                      const debt = total - paid;
                      const percentPaid = total > 0 ? (paid / total) * 100 : 100;
                      const invoiceStatus = getInvoiceStatus(f);
                      const avatar = getAvatarStyle(clientName);
                      const initials = clientName
                        ? clientName
                            .split(' ')
                            .slice(0, 2)
                            .map((n: string) => n[0])
                            .join('')
                        : '?';

                      return (
                        <tr
                          key={f.id + "_" + idx}
                          className={`border-b border-[#dbdade]/70 dark:border-[#434460]/40 h-[72px] transition-colors group cursor-pointer ${
                            invoiceStatus === 'Annulée'
                              ? 'bg-rose-100/40 dark:bg-rose-950/25 hover:bg-rose-100/70 dark:hover:bg-rose-950/45'
                              : invoiceStatus === 'Brouillon'
                                ? 'bg-amber-100/40 dark:bg-amber-950/20 hover:bg-amber-100/70 dark:hover:bg-amber-950/40'
                                : 'bg-white dark:bg-[#2b2c40] hover:bg-[#f5f5f9]/40 dark:hover:bg-[#232333]/30'
                          }`}
                          onClick={() => navigate(`/purchase/${f.clientId}/${f.id}`)}
                        >
                          <td
                            className="px-4 text-center w-12"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className="w-4 h-4 text-[#696cff] border-[#dbdade] rounded focus:ring-[#696cff] cursor-pointer"
                              checked={selectedInvoiceIds.includes(f.id)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (checked) {
                                  setSelectedInvoiceIds((prev) => [...prev, f.id]);
                                } else {
                                  setSelectedInvoiceIds((prev) => prev.filter((id) => id !== f.id));
                                }
                              }}
                            />
                          </td>

                          <td className="px-6">
                            <span className="font-mono font-bold text-sm text-[#696cff] dark:text-[#b1b4ff]">
                              {invoiceStatus === 'Brouillon'
                                ? f.refId && f.refId !== 'Brouillon'
                                  ? `${f.refId} (Brouillon)`
                                  : 'Brouillon'
                                : f.refId || 'N/A'}
                            </span>
                          </td>

                          <td className="px-6">
                            <div className="flex items-center gap-4">
                              {/* Status Indicator left ribbon */}
                              <div className="w-1 flex justify-center shrink-0">
                                {invoiceStatus === 'Brouillon' ? (
                                  <div className="w-[3px] h-[32px] bg-[#ffab00] rounded-full" />
                                ) : invoiceStatus === 'Annulée' ? (
                                  <div className="w-[3px] h-[32px] bg-slate-300 dark:bg-slate-600 rounded-full" />
                                ) : debt > 0.05 ? (
                                  <div className="w-[3px] h-[32px] bg-[#ff3e1d] rounded-full" />
                                ) : (
                                  <div className="w-[3px] h-[32px] bg-[#4fb922] rounded-full" />
                                )}
                              </div>

                              <div className="flex items-center gap-3.5">
                                <div
                                  className={`w-9 h-9 ${avatar.bg} ${avatar.text} ring-4 ${avatar.ring} rounded-full flex items-center justify-center shrink-0 font-extrabold text-[11px] uppercase transition-transform duration-300 group-hover:scale-105 shadow-3xs`}
                                >
                                  {initials}
                                </div>
                                <div className="flex flex-col">
                                  <h4
                                    className="font-bold text-[#222222] dark:text-[#dbdade] text-[14px] tracking-tight group-hover:text-[#696cff] transition-colors flex items-center gap-1.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigate(`/client/${f.clientId}`);
                                    }}
                                  >
                                    {clientName.toUpperCase()}
                                    <ChevronRight
                                      size={14}
                                      className="text-[#a1acb8] group-hover:text-[#696cff] transition-colors"
                                    />
                                  </h4>
                                  <span className="text-[10px] text-[#a1acb8] font-mono leading-none mt-1">
                                    #{f.id.slice(0, 8).toUpperCase()}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-[13px] text-[#435971] dark:text-[#dbdade] font-bold font-mono">
                                {f.date
                                  ?.toDate()
                                  ?.toLocaleDateString('fr-FR', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  }) || '---'}
                              </span>
                              <span className="text-[10px] text-[#a1acb8] font-black uppercase mt-1">
                                Date de règlement:{' '}
                                {f.dueDate
                                  ? f.dueDate
                                      .toDate()
                                      ?.toLocaleDateString('fr-FR', {
                                        day: '2-digit',
                                        month: 'short',
                                      })
                                  : 'Immédiate'}
                              </span>
                            </div>
                          </td>

                          <td className="px-6 text-right whitespace-nowrap">
                            <div className="flex flex-col items-end">
                              <span className="font-mono font-black text-[15px] text-[#435971] dark:text-[#dbdade] tracking-tight">
                                {total.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                <span className="text-[11px] font-sans font-extrabold ml-1">
                                  DH
                                </span>
                              </span>
                              {debt > 0.05 ? (
                                <span className="text-[11px] font-mono font-bold text-[#ff3e1d] dark:text-[#ff3e1d] tracking-normal mt-1 block">
                                  -
                                  {debt.toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  DH
                                </span>
                              ) : (
                                <span className="text-[11px] font-black text-[#71dd37] dark:text-[#71dd37] uppercase tracking-wider mt-1 block">
                                  PAYÉ
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="px-6">
                            <div className="flex flex-col items-center min-w-[140px] space-y-1.5">
                              <div className="flex justify-between w-full text-[10px] font-mono font-bold text-[#a1acb8]">
                                <span>{percentPaid.toFixed(0)}%</span>
                                <span>
                                  {paid.toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  DH
                                </span>
                              </div>
                              <div className="w-full bg-[#f5f5f9] dark:bg-[#232333]/50 h-1.5 rounded-full overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${percentPaid}%` }}
                                  className={`h-full transition-all duration-500 ${percentPaid === 100 ? 'bg-[#71dd37]' : 'bg-[#696cff]'}`}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="px-6 whitespace-nowrap">
                            {invoiceStatus === 'Brouillon' ? (
                              <span className="inline-flex items-center gap-1.5 text-[#ffab00] dark:text-orange-400 text-[11px] font-extrabold uppercase tracking-wide">
                                <Clock size={13} className="shrink-0" /> Brouillon
                              </span>
                            ) : invoiceStatus === 'Annulée' ? (
                              <span className="inline-flex items-center gap-1.5 text-slate-400 dark:text-slate-500 text-[11px] font-extrabold uppercase tracking-wide line-through">
                                <X size={13} className="shrink-0" /> Annulée
                              </span>
                            ) : percentPaid >= 99.9 ? (
                              <span className="inline-flex items-center gap-1.5 text-[#4fb922] dark:text-[#71dd37] text-[11px] font-extrabold uppercase tracking-wide">
                                <CheckCircle2 size={13} className="shrink-0" /> Régularisée
                              </span>
                            ) : percentPaid > 0.1 ? (
                              <span className="inline-flex items-center gap-1.5 text-orange-400 text-[11px] font-extrabold uppercase tracking-wide font-sans">
                                <Coins size={13} className="shrink-0" /> Partiel
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[#ff3e1d] text-[11px] font-extrabold uppercase tracking-wide">
                                <AlertCircle size={13} className="shrink-0" /> Impayée
                              </span>
                            )}
                          </td>

                          <td className="px-6 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="relative inline-block text-left">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenActionDropdownId(
                                    openActionDropdownId === f.id ? null : f.id
                                  )
                                }
                                className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#323249] rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                title="Actions"
                              >
                                <MoreVertical size={16} />
                              </button>

                              {openActionDropdownId === f.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setOpenActionDropdownId(null)}
                                  />
                                  <div
                                    className={`absolute right-full mr-2 ${isLastRows ? 'bottom-0' : 'top-0'} bg-white dark:bg-[#2c2d42] border border-[#d9dee3] dark:border-[#434460]/40 rounded-lg shadow-md min-w-[170px] z-50 py-1 flex flex-col font-sans text-left`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        navigate(`/purchase/${f.clientId}/${f.id}`);
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                    >
                                      <Eye size={14} />
                                      <span>Détails</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        navigate(
                                          `/edit-purchase/${f.clientId}/${f.id}?type=facture`
                                        );
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                    >
                                      <Pencil size={14} />
                                      <span>Modifier</span>
                                    </button>

                                    {invoiceStatus === 'Brouillon' && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionDropdownId(null);
                                          handleValidateInvoice(f);
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-950/20 flex items-center gap-2 cursor-pointer font-semibold"
                                      >
                                        <CheckCircle2 size={14} />
                                        <span>Valider</span>
                                      </button>
                                    )}

                                    {invoiceStatus === 'Valide' && debt > 0.05 && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionDropdownId(null);
                                          setSelectedInvoice(f);
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 flex items-center gap-2 cursor-pointer font-semibold"
                                      >
                                        <Coins size={14} />
                                        <span>Enregistrer paiement</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        handlePrintSingle(f);
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                    >
                                      <Printer size={14} />
                                      <span>Téléch. PDF</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        handlePrintBLSingle(f);
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/20 flex items-center gap-2 cursor-pointer font-semibold"
                                    >
                                      <Truck size={14} />
                                      <span>Créer BL PDF</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        handleDuplicate(f);
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                    >
                                      <Copy size={14} />
                                      <span>Dupliquer</span>
                                    </button>

                                    {(invoiceStatus === 'Valide' ||
                                      invoiceStatus === 'Annulée') && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionDropdownId(null);
                                          handleResetToDraft(f);
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/20 flex items-center gap-2 cursor-pointer font-semibold"
                                      >
                                        <RefreshCw size={14} />
                                        <span>Remettre en brouillon</span>
                                      </button>
                                    )}

                                    {(invoiceStatus === 'Brouillon' ||
                                      invoiceStatus === 'Valide') && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionDropdownId(null);
                                          handleCancelInvoice(f);
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2 cursor-pointer font-semibold"
                                      >
                                        <X size={14} />
                                        <span>Annuler la facture</span>
                                      </button>
                                    )}

                                    <hr className="border-[#eceef1] dark:border-[#434460]/40 my-1" />

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        handleDeleteSingle(f);
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 flex items-center gap-2 cursor-pointer font-bold"
                                    >
                                      <Trash2 size={14} />
                                      <span>Supprimer</span>
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Responsive Mobile Layout cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:hidden gap-4 mt-4 p-5">
                {paginatedFactures.map((f, idx) => {
                  const clientName = clientsMap[f.clientId] || 'Client Inconnu';
                  const total = Number(f.total) || 0;
                  const paid = f.amountPaid !== undefined ? Number(f.amountPaid) || 0 : 0;
                  const debt = total - paid;
                  const percentPaid = total > 0 ? (paid / total) * 100 : 100;
                  const invoiceStatus = getInvoiceStatus(f);

                  return (
                    <div
                      key={f.id + "_" + idx}
                      className={`border p-5 rounded-lg flex flex-col justify-between gap-4 cursor-pointer transition-all ${
                        invoiceStatus === 'Annulée'
                          ? 'bg-rose-100/30 border-rose-200 hover:bg-rose-100/60 hover:border-rose-300 dark:bg-rose-950/25 dark:border-rose-950/50 hover:dark:bg-rose-950/45 dark:hover:border-rose-800/60'
                          : invoiceStatus === 'Brouillon'
                            ? 'bg-amber-100/30 border-amber-200 hover:bg-amber-100/60 hover:border-amber-300 dark:bg-amber-950/20 dark:border-amber-950/50 hover:dark:bg-amber-950/40 dark:hover:border-amber-800/60'
                            : 'bg-white dark:bg-[#2b2c40] border-[#eceef1] dark:border-[#434460]/40 hover:border-[#696cff]'
                      }`}
                      onClick={() => navigate(`/purchase/${f.clientId}/${f.id}`)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {invoiceStatus === 'Brouillon' ? (
                            <div className="flex flex-col gap-0.5 items-start">
                              {f.refId && f.refId !== 'Brouillon' ? (
                                <>
                                  <span className="font-mono font-bold text-xs text-orange-600 px-2.5 py-1">
                                    {f.refId}
                                  </span>
                                  <span className="font-semibold text-[10px] text-orange-400 pl-1 uppercase tracking-wider">
                                    (Brouillon)
                                  </span>
                                </>
                              ) : (
                                <span className="font-mono font-bold text-xs text-orange-500 px-2.5 py-1">
                                  Brouillon
                                </span>
                              )}
                            </div>
                          ) : invoiceStatus === 'Annulée' ? (
                            <span className="font-mono font-bold text-xs text-rose-500 px-2.5 py-1">
                              {f.refId || 'N/A'} (Annulée)
                            </span>
                          ) : (
                            <span className="font-mono font-bold text-xs text-emerald-600 px-2.5 py-1">
                              {f.refId || 'N/A'}
                            </span>
                          )}
                          <div>
                            <h4 className="font-bold text-[#566a7f] dark:text-[#dbdade] text-sm">
                              {clientName}
                            </h4>
                            <span className="text-[10px] text-[#a1acb8] font-mono block">
                              Facturé le: {f.date?.toDate()?.toLocaleDateString('fr-FR')}
                            </span>
                          </div>
                        </div>
                        {debt <= 0.05 ? (
                          <span className="bg-emerald-50 text-emerald-600 px-2 rounded font-bold text-[9px] uppercase border border-emerald-100">
                            Réglé
                          </span>
                        ) : (
                          <span className="bg-rose-50 text-rose-500 px-2 rounded font-bold text-[9px] uppercase border border-rose-100">
                            Dû
                          </span>
                        )}
                      </div>

                      <div className="bg-slate-50 dark:bg-[#323249] p-3 rounded space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400 font-bold uppercase text-[9px]">
                            Total Facturé
                          </span>
                          <span className="font-mono font-bold text-slate-900 dark:text-white">
                            {total.toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            DH
                          </span>
                        </div>
                        {debt > 0.05 && (
                          <div className="flex justify-between text-rose-500 font-bold">
                            <span className="uppercase text-[9px]">Créance restante</span>
                            <span className="font-mono">
                              {debt.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              DH
                            </span>
                          </div>
                        )}
                      </div>

                      <div
                        className="flex items-center justify-between gap-2 border-t border-slate-100 dark:border-[#434460]/40 pt-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1.5">
                          {invoiceStatus === 'Brouillon' && (
                            <button
                              onClick={() => handleValidateInvoice(f)}
                              className="bg-purple-50 text-purple-600 px-2.5 py-1 rounded font-black text-[9px] uppercase border border-purple-100 hover:bg-purple-600 hover:text-white transition-all flex items-center gap-1 cursor-pointer"
                            >
                              Valider
                            </button>
                          )}
                          {invoiceStatus === 'Valide' && debt > 0.05 && (
                            <button
                              onClick={() => setSelectedInvoice(f)}
                              className="bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded font-bold text-[10px] uppercase border border-emerald-100 hover:bg-emerald-600 hover:text-white transition-all flex items-center gap-1"
                            >
                              Payer
                            </button>
                          )}
                          {invoiceStatus === 'Valide' && (
                            <button
                              onClick={() => handleCancelInvoice(f)}
                              className="bg-rose-50 text-rose-500 px-2 py-1 rounded font-black text-[9px] uppercase border border-rose-100 hover:bg-rose-600 hover:text-white transition-all cursor-pointer"
                              title="Annuler la facture"
                            >
                              Annuler
                            </button>
                          )}
                          {invoiceStatus === 'Annulée' && (
                            <button
                              onClick={() => handleResetToDraft(f)}
                              className="bg-orange-50 text-orange-600 px-2 py-1 bg-clip-padding rounded font-black text-[9px] uppercase border border-orange-100 hover:bg-orange-600 hover:text-white transition-all cursor-pointer"
                              title="Remettre en Brouillon"
                            >
                              Brouillon
                            </button>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleDuplicate(f)}
                            className="text-[#a1acb8] hover:text-[#566a7f] dark:hover:text-[#dbdade] p-1 rounded hover:bg-slate-100 dark:hover:bg-[#323249] cursor-pointer"
                            title="Dupliquer"
                          >
                            <Copy size={16} />
                          </button>
                          <Link
                            to={`/purchase/${f.clientId}/${f.id}`}
                            className="text-[#a1acb8] hover:text-[#566a7f] dark:hover:text-[#dbdade] p-1"
                          >
                            <Eye size={16} />
                          </Link>
                          {invoiceStatus === 'Brouillon' && (
                            <Link
                              to={`/edit-purchase/${f.clientId}/${f.id}?type=facture`}
                              className="text-[#a1acb8] hover:text-[#566a7f] dark:hover:text-[#dbdade] p-1"
                            >
                              <Pencil size={16} />
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* PAGINATION CONTROLS STUCK TO TABLE */}
              {filteredFactures.length > 0 && (
                <div className="sneat-pagination-bar">
                  <div className="flex items-center gap-2 whitespace-nowrap shrink-0 text-[#697a8d] dark:text-[#a3a4cc]">
                    <span>Afficher</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="bg-[#ffffff] dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] py-1 px-2.5 text-xs font-semibold text-[#435971] dark:text-[#dbdade] focus:border-[#696cff] cursor-pointer outline-none w-auto inline-block"
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                    <span>lignes par page</span>
                  </div>

                  <div className="whitespace-nowrap shrink-0 text-[#697a8d] dark:text-[#a3a4cc]">
                    Affichage de {entryStart}-{entryEnd} sur {totalEntries} factures
                  </div>

                  <div className="sneat-pagination-control">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="sneat-pag-btn"
                      title="Précédent"
                    >
                      <ChevronLeft size={16} />
                    </button>

                    <div className="flex gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                        if (
                          totalPages > 5 &&
                          page !== 1 &&
                          page !== totalPages &&
                          Math.abs(page - currentPage) > 1
                        ) {
                          if (page === 2 && currentPage > 3)
                            return (
                              <span key="dots1" className="px-1 text-[#a1acb8] dark:text-[#707194]">
                                ...
                              </span>
                            );
                          if (page === totalPages - 1 && currentPage < totalPages - 2)
                            return (
                              <span key="dots2" className="px-1 text-[#a1acb8] dark:text-[#707194]">
                                ...
                              </span>
                            );
                          return null;
                        }
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`sneat-pag-btn ${currentPage === page ? 'active' : ''}`}
                          >
                            {page}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="sneat-pag-btn"
                      title="Suivant"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Quick Payment Modal Popover (inspired by sleek cockpit design) */}
      <AnimatePresence>
        {selectedInvoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs select-none">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-205 shadow-xl w-full max-w-md p-6 overflow-hidden mx-4"
            >
              <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white text-base">
                    Enregistrer Règlement
                  </h3>
                  <p className="text-xs text-slate-400 font-medium font-mono mt-1">
                    Facture: {selectedInvoice.refId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedInvoice(null)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  ✖
                </button>
              </div>

              <form onSubmit={handleQuickPaymentSubmit} className="mt-4 space-y-4">
                <div className="bg-emerald-50/20 p-4 rounded-md border border-emerald-100 flex justify-between text-xs">
                  <div>
                    <span className="text-slate-400 font-bold block uppercase text-[9px]">
                      Solde Dû
                    </span>
                    <span className="font-mono font-bold text-slate-800 dark:text-white text-sm mt-1 block">
                      {(
                        Number(selectedInvoice.total) -
                        (selectedInvoice.amountPaid !== undefined
                          ? Number(selectedInvoice.amountPaid) || 0
                          : 0)
                      ).toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 font-bold block uppercase text-[9px]">
                      Total Facturé
                    </span>
                    <span className="font-mono text-slate-800 dark:text-white font-semibold text-sm mt-1 block">
                      {Number(selectedInvoice.total).toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </span>
                  </div>
                </div>

                <div className="space-y-1.5 text-left">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                    Montant Reçu (DH)
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    autoFocus
                    value={quickPaymentAmount}
                    onChange={(e) => setQuickPaymentAmount(e.target.value)}
                    placeholder="Saisir montant reçu..."
                    className="w-full border border-slate-200 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none p-3 rounded font-mono font-bold text-slate-900 transition-all text-sm"
                  />
                </div>

                <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setSelectedInvoice(null)}
                    className="border border-slate-200 hover:bg-slate-100 px-4 py-2 rounded text-xs font-bold uppercase transition-all cursor-pointer text-slate-500"
                  >
                    Fermer
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingPayment}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded text-xs font-bold uppercase transition-all cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                  >
                    {isSavingPayment ? 'Enregistrement...' : 'Confirmer'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manual Override & Gap Recycling Invoice Validation Modal */}
      <AnimatePresence>
        {validatingInvoice && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs select-none">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-205 shadow-xl w-full max-w-md p-6 overflow-hidden mx-4 text-left"
            >
              <div className="flex justify-between items-start border-b border-slate-100 pb-3">
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-white text-base">
                    Valider la Facture
                  </h3>
                  <p className="text-xs text-slate-400 font-medium mt-1">
                    Passage de l'état <strong className="text-orange-500">Brouillon</strong> à
                    l'état officiel <strong className="text-emerald-500">Valide</strong>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setValidatingInvoice(null)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  ✖
                </button>
              </div>

              <form onSubmit={handleConfirmValidation} className="mt-4 space-y-4">
                <div className="bg-orange-50/70 text-orange-600 border border-orange-100 p-4 rounded-md text-xs space-y-1 bg-clip-padding">
                  <p className="font-bold uppercase tracking-wider text-[9px] mb-1">
                    Règles de Numérotation Légale :
                  </p>
                  <p>Un numéro séquentiel unique officiel est automatiquement calculé.</p>
                  <p>
                    Vous pouvez <strong className="underline">surcharger ce numéro</strong>{' '}
                    ci-dessous si vous souhaitez recycler des trous de numérotation d'anciennes
                    factures supprimées.
                  </p>
                </div>

                <div className="space-y-1.5 text-left">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                    Numéro Officiel Assigné
                  </label>
                  <input
                    type="text"
                    required
                    value={customRefNum}
                    onChange={(e) => setCustomRefNum(e.target.value.toUpperCase())}
                    placeholder="Ex: FAC-2026-0001..."
                    className="w-full border border-slate-250 focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none p-3 rounded font-mono font-bold text-slate-900 dark:text-white transition-all text-sm uppercase tracking-wider"
                  />
                  <p className="text-[10px] text-slate-400 font-medium">
                    Contrôle d'unicité automatique à la validation.
                  </p>
                </div>

                {missingSequences.length > 0 && (
                  <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 p-3 rounded-md">
                    <p className="font-bold text-[10px] text-red-600 dark:text-red-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                      ⚠️ Trous de numérotation détectés
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {missingSequences.map((seq, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setCustomRefNum(seq)}
                          className="px-2 py-1 bg-white dark:bg-[#32334b] border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-[10px] font-mono font-bold rounded hover:bg-red-600 hover:text-white dark:hover:bg-red-500 dark:hover:text-white transition-colors cursor-pointer"
                        >
                          {seq}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 justify-end pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setValidatingInvoice(null)}
                    className="border border-slate-200 hover:bg-slate-100 px-4 py-2 rounded text-xs font-bold uppercase transition-all cursor-pointer text-slate-500"
                  >
                    Brouillon
                  </button>
                  <button
                    type="submit"
                    disabled={loadingValidation}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded text-xs font-bold uppercase transition-all cursor-pointer flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                  >
                    {loadingValidation ? 'Séquencement...' : 'Confirmer la validation'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Hidden container for print template rendering (for pdf generation) */}
      <div
        style={{
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          width: '794px',
          overflow: 'hidden',
        }}
      >
        {(() => {
          if (printingQueue.length === 0 && !emailingInvoice) return null;

          const targets = emailingInvoice ? [emailingInvoice] : printingQueue;

          return (
            <div style={{ position: 'absolute', top: '-9999px', left: '-9999px', zIndex: -9999 }}>
              <div
                id="hidden-pdf-content"
                style={{ background: 'white', display: 'flex', flexDirection: 'column' }}
              >
                {targets.map((invoice, idx) => {
                  const client = clients.find((c) => c.id === invoice.clientId);
                  const clientName = client
                    ? client.name
                    : clientsMap[invoice.clientId] || 'Client Inconnu';
                  const safeClient = client || {
                    name: clientName,
                    addressLine1: '',
                    city: '',
                    city_ma: '',
                    phone: '',
                    ice: '',
                  };

                  const formattedInvoice = mapDocToInvoiceData(invoice, safeClient);

                  return (
                    <div
                      key={invoice.id + "_" + idx}
                      style={{
                        width: '210mm',
                        height: '297mm',
                        pageBreakAfter: idx < targets.length - 1 ? 'always' : 'auto',
                      }}
                    >
                      <InvoicePrint data={formattedInvoice} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {(() => {
          if (printingBLQueue.length === 0) return null;

          return (
            <div style={{ position: 'absolute', top: '-9999px', left: '-9999px', zIndex: -9999 }}>
              <div
                id="hidden-bl-pdf-content"
                style={{ background: 'white', display: 'flex', flexDirection: 'column' }}
              >
                {printingBLQueue.map((invoice, idx) => {
                  const client = clients.find((c) => c.id === invoice.clientId);
                  const clientName = client
                    ? client.name
                    : clientsMap[invoice.clientId] || 'Client Inconnu';
                  const safeClient = client || {
                    name: clientName,
                    addressLine1: '',
                    city: '',
                    city_ma: '',
                    phone: '',
                    ice: '',
                  };

                  const blData = mapDocToDeliveryNoteData(invoice, safeClient);

                  return (
                    <div
                      key={(invoice.id || 'bl') + '_' + idx}
                      style={{
                        width: '210mm',
                        height: '297mm',
                        pageBreakAfter: idx < printingBLQueue.length - 1 ? 'always' : 'auto',
                      }}
                    >
                      <DeliveryNotePrint data={blData} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>
      {/* Email Dispatch Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#2b2c40] rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 border border-slate-200/60 dark:border-[#434460]">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100 dark:border-[#434460]/60 bg-slate-50/50 dark:bg-[#232333]">
              <div>
                <h3 className="text-sm font-bold text-[#435971] dark:text-[#dbdade]">
                  Envoyer le document
                </h3>
                <p className="text-xs text-[#a1acb8] mt-0.5">Par email avec pièce jointe PDF</p>
              </div>
              <button
                onClick={() => {
                  setShowEmailModal(false);
                  setEmailingInvoice(null);
                }}
                className="p-2 text-[#a1acb8] hover:text-[#696cff] dark:hover:text-[#696cff] hover:bg-[#696cff]/10 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-5 overflow-y-auto max-h-[60vh]">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-[#a1acb8] uppercase tracking-wider">
                  Email Destinataire :
                </label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="contact@entreprise.ma"
                  className="w-full h-10 px-3 border border-[#d9dee3] dark:border-[#434460] rounded-lg text-[13px] text-[#435971] dark:text-[#dbdade] bg-white dark:bg-[#232333] focus:border-[#696cff] focus:ring-1 focus:ring-[#696cff] outline-none transition-all"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-[#a1acb8] uppercase tracking-wider">
                  Objet :
                </label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Objet de l'email"
                  className="w-full h-10 px-3 border border-[#d9dee3] dark:border-[#434460] rounded-lg text-[13px] text-[#435971] dark:text-[#dbdade] bg-white dark:bg-[#232333] focus:border-[#696cff] focus:ring-1 focus:ring-[#696cff] outline-none transition-all"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black text-[#a1acb8] uppercase tracking-wider">
                  Message :
                </label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full p-3 border border-[#d9dee3] dark:border-[#434460] rounded-lg text-[13px] text-[#435971] dark:text-[#dbdade] bg-white dark:bg-[#232333] focus:border-[#696cff] focus:ring-1 focus:ring-[#696cff] outline-none transition-all min-h-[120px] resize-y"
                ></textarea>
              </div>

              <div className="bg-indigo-50/50 dark:bg-indigo-500/10 rounded-lg p-3.5 border border-indigo-100/50 flex gap-3">
                <div className="w-8 h-8 rounded-full bg-white dark:bg-indigo-500/20 flex items-center justify-center shrink-0 shadow-sm">
                  <FileText size={16} className="text-indigo-500" />
                </div>
                <div className="flex flex-col justify-center text-xs text-[#566a7f] dark:text-[#707194] leading-relaxed">
                  <span>
                    Un fichier PDF de haute qualité sera automatiquement généré et joint à cet
                    email.
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100 dark:border-[#434460]/60 bg-slate-50/50 dark:bg-[#232333]">
              <button
                onClick={() => {
                  setShowEmailModal(false);
                  setEmailingInvoice(null);
                }}
                disabled={sendingEmail || sendingWhatsApp}
                className="h-9 px-5 border border-[#d9dee3] dark:border-[#434460] text-[#697a8d] dark:text-[#a3a4cc] rounded-lg text-[13px] font-bold uppercase tracking-wider hover:bg-slate-100 dark:hover:bg-[#434460]/60 transition-colors disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                disabled={sendingEmail || sendingWhatsApp}
                onClick={handleSendWhatsApp}
                className="h-9 px-4 bg-[#25D366] text-white rounded-lg text-[13px] font-bold uppercase tracking-wider hover:bg-[#22bf5b] transition-colors shadow-sm disabled:opacity-70 flex items-center gap-2 cursor-pointer"
                title="Envoyer directement via OpenWA"
              >
                {sendingWhatsApp ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Envoi WhatsApp...
                  </>
                ) : (
                  <>
                    <MessageSquare size={15} />
                    WhatsApp (OpenWA)
                  </>
                )}
              </button>
              <button
                disabled={sendingEmail || sendingWhatsApp}
                onClick={handleSendEmail}
                className="h-9 px-5 bg-[#696cff] text-white rounded-lg text-[13px] font-bold uppercase tracking-wider hover:bg-[#5f61e6] transition-colors shadow-sm disabled:opacity-70 flex items-center gap-2 cursor-pointer"
              >
                {sendingEmail ? (
                  <>
                    <svg
                      className="animate-spin h-3.5 w-3.5 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Envoi en cours...
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    Envoyer l'Email
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <PurchaseXlsxModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingClients={clients}
        ownerId={user?.uid || ''}
        showToast={showToast}
      />
    </div>
  );
}

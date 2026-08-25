import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { CommandesXlsxModal } from '../components/CommandesXlsxModal';
import * as XLSX from 'xlsx';
import {
  collectionGroup,
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  writeBatch,
  getDocs,
  query,
  where,
  deleteField,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { Link, useNavigate } from 'react-router-dom';
import html2pdf from 'html2pdf.js';
import { generatePDF } from '../utils/pdfGenerator';
import { mapDocToInvoiceData } from '../utils/invoiceMapper';
import { InvoicePrint } from '../components/InvoicePrint';
import { TicketPrint, printTicket } from '../components/TicketPrint';
import { InvoiceData } from '../types';
import { usePurchasesData } from "../hooks/usePurchasesData";
import { calculatePurchaseBalance } from "../utils/balanceUtils";
import { isWhatsAppEligiblePhone, isLandlinePhone } from "../services/whatsappService";
import {
  Plus,
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Package,
  ShoppingBag,
  User,
  Eye,
  Pencil,
  Coins,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ArrowUpDown,
  MessageSquare,
  ArrowUpRight,
  Scale,
  Users,
  ChevronDown,
  FileText,
  Printer,
  Copy,
  Settings,
  Clock,
  MoreVertical,
  Send,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function PurchasesPage() {
  const [search, setSearch] = useState(() => localStorage.getItem('purch_filter_search') || '');
  const [activeTab, setActiveTab] = useState<'all' | 'debtors' | 'paid' | 'exclu_compta'>(() => {
    const val = localStorage.getItem('purch_filter_activeTab');
    return (val as any) || 'all';
  });
  const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'highest' | 'lowest' | 'debt'>(() => {
    const val = localStorage.getItem('purch_filter_sortBy');
    return (val as any) || 'recent';
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const val = localStorage.getItem('purch_filter_pageSize');
    return val ? Number(val) : 10;
  });
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<string[]>([]);
  const [isBulkDropdownOpen, setIsBulkDropdownOpen] = useState(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [openActionDropdownId, setOpenActionDropdownId] = useState<string | null>(null);

  // State for sequential queue bulk printing
  const [printingQueue, setPrintingQueue] = useState<any[]>([]);

  // Persist filter states to localStorage
  useEffect(() => {
    localStorage.setItem('purch_filter_search', search);
  }, [search]);

  useEffect(() => {
    localStorage.setItem('purch_filter_activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('purch_filter_sortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('purch_filter_pageSize', String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeTab]);

  const { user } = useAuth();
  const { purchases, clients, clientsMap } = usePurchasesData(user);
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);


  // Filter for 'commande' type documents and un-typed legacy documents, and assign chronological refs
  const commandesListWithRefs = useMemo(() => {
    const rawCommandes = purchases.filter((p) => !p.type || p.type === 'commande');
    rawCommandes.sort((a, b) => {
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

    return rawCommandes.map((item, index) => ({
      ...item,
      refId: item.refId || `C${String(index + 1).padStart(5, '0')}`,
    }));
  }, [purchases]);

  // Valid invoices to determine dynamic 'Converti' status
  const validInvoiceIds = useMemo(() => {
    return new Set(
      purchases
        .filter(
          (p) =>
            p.type === 'facture' &&
            p.status !== 'Annulée' &&
            p.status !== 'Annulé'
        )
        .map((p) => p.id)
    );
  }, [purchases]);

  // Synchronize and persist calculated refIds back to Firestore for permanent non-shifting
  useEffect(() => {
    if (!user || purchases.length === 0 || commandesListWithRefs.length === 0) return;

    const commandesMissing = purchases.filter(
      (p) => (!p.type || p.type === 'commande') && !p.refId
    );
    if (commandesMissing.length > 0) {
      const batch = writeBatch(db);
      let count = 0;
      commandesMissing.forEach((item) => {
        const calculated = commandesListWithRefs.find((r) => r.id === item.id);
        if (calculated && calculated.refId && item.clientId) {
          const docRef = doc(db, 'clients', item.clientId, 'purchases', item.id);
          batch.update(docRef, { refId: calculated.refId });
          count++;
        }
      });
      if (count > 0) {
        batch
          .commit()
          .then(() => console.log(`Persisted ${count} commande refIds.`))
          .catch((err) => console.error('Error migrating commande static references:', err));
      }
    }
  }, [purchases, commandesListWithRefs, user]);

  // Clients initials visual pastels
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
          ? `${printingQueue[0].type || 'commande'}_${printingQueue[0].refId || printingQueue[0].id.substring(0, 8)}.pdf`
          : `Export_${printingQueue.length}_documents.pdf`;

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
      setSelectedPurchaseIds([]);
    }, 450);

    return () => clearTimeout(timer);
  }, [printingQueue]);

  // WhatsApp Relancer Link Builder
  const sendWhatsAppRelance = (purchase: any) => {
    return import('../services/whatsappService').then(({ sendWhatsAppMessage }) => {
      const matchedClient = clients.find((c: any) => c.id === purchase.clientId) ;
      if (!matchedClient || !matchedClient.phone) return { success: false, error: 'Numéro introuvable' };

      if (isLandlinePhone(matchedClient.phone)) {
        return { success: false, error: 'Numéro fixe (05...) non compatible avec WhatsApp' };
      }

      let cleanPhone = matchedClient.phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
      if (!cleanPhone.startsWith('+')) {
        if (cleanPhone.startsWith('0')) {
          cleanPhone = '212' + cleanPhone.slice(1);
        }
      } else {
        cleanPhone = cleanPhone.replace('+', '');
      }

      const { total, debt } = calculatePurchaseBalance(purchase);
      const dateFormatted = purchase.date?.toDate()?.toLocaleDateString('fr-FR') || 'récente';

      const text = `Bonjour ${matchedClient.name},\n\nSauf erreur de notre part, la transaction du *${dateFormatted}* pour un montant total de *${total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH* présente encore un solde dû de *${debt.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH*.\n\nMerci de bien vouloir procéder à son paiement au plus vite.\n\nCordialement.`;
      return sendWhatsAppMessage(cleanPhone, text);
    });
  };

  // Convert Commande/Order to Invoice
  const handleConvertToInvoice = async (purchase: any) => {
    confirm({
      title: 'Générer la Facture ?',
      message: `Voulez-vous générer une facture de vente officielle à partir du BC ${purchase.refId || 'C00xxx'} ?`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);

          // 1. Create target document of type 'facture'
          const invoiceRef = doc(collection(db, 'clients', purchase.clientId, 'purchases'));
          const invoiceId = invoiceRef.id;

          const invoiceData = {
            ownerId: purchase.ownerId,
            clientId: purchase.clientId,
            items: purchase.items || [],
            description: purchase.description || '',
            price: purchase.price || 0,
            quantity: purchase.quantity || 0,
            subtotal: purchase.subtotal || 0,
            taxAmount: purchase.taxAmount || 0,
            taxRate: purchase.taxRate || 0,
            total: purchase.total || 0,
            paymentStatus: purchase.paymentStatus || 'credit',
            amountPaid: purchase.amountPaid || 0,
            date: new Date(), // Conversion date
            parent_id: purchase.id,
            type: 'facture',
            conditions_paiement: purchase.conditions_paiement || 'Paiement à la livraison',
            notes: `Mise en facturation de la commande ${purchase.refId || 'C00xxx'}.`,
            notesList: [`Mise en facturation de la commande ${purchase.refId || 'C00xxx'}.`],
          };

          batch.set(invoiceRef, invoiceData);

          // 2. Link child to parent
          const orderRef = doc(db, 'clients', purchase.clientId, 'purchases', purchase.id);
          batch.update(orderRef, { child_id: invoiceId });

          // 3. Migrate any existing payments to point to the invoice so they are tracked under Billing
          const paymentsSnap = await getDocs(
            query(
              collection(db, 'clients', purchase.clientId, 'payments'),
              where('purchaseId', '==', purchase.id),
              where('ownerId', '==', user.uid)
            )
          );
          paymentsSnap.forEach((doc) => {
            batch.update(doc.ref, { purchaseId: invoiceId });
          });

          await batch.commit();
          showToast('Facture générée avec succès et paiements rattachés !', 'success');
          navigate('/facturation');
        } catch (err) {
          console.error(err);
          showToast('Erreur lors de la génération de la facture', 'error');
        }
      },
    });
  };

  // Convert selected purchases to invoices
  const handleBulkConvertToFacture = async () => {
    const selectedPurchases = purchases.filter((p) => selectedPurchaseIds.includes(p.id));
    if (selectedPurchases.length === 0) return;

    const netToConvert = selectedPurchases.filter(
      (p) => !(p.child_id && validInvoiceIds.has(p.child_id))
    );

    if (netToConvert.length === 0) {
      showToast('Toutes les commandes sélectionnées ont déjà des factures associées.', 'error');
      return;
    }

    confirm({
      title: 'Facturer les commandes sélectionnées ?',
      message: `Voulez-vous générer des factures provisoires pour les ${netToConvert.length} commande(s) non encore facturée(s) ?`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);

          for (const purchase of netToConvert) {
            const invoiceRef = doc(collection(db, 'clients', purchase.clientId, 'purchases'));
            const invoiceId = invoiceRef.id;

            const invoiceData = {
              ownerId: purchase.ownerId,
              clientId: purchase.clientId,
              items: purchase.items || [],
              description: purchase.description || '',
              price: purchase.price || 0,
              quantity: purchase.quantity || 0,
              subtotal: purchase.subtotal || 0,
              taxAmount: purchase.taxAmount || 0,
              taxRate: purchase.taxRate || 0,
              total: purchase.total || 0,
              paymentStatus: purchase.paymentStatus || 'credit',
              amountPaid: purchase.amountPaid || 0,
              date: new Date(),
              parent_id: purchase.id,
              type: 'facture',
              conditions_paiement: purchase.conditions_paiement || 'Paiement à la livraison',
              notes: `Mise en facturation de la commande ${purchase.refId || 'C00xxx'}.`,
              notesList: [`Mise en facturation de la commande ${purchase.refId || 'C00xxx'}.`],
            };

            batch.set(invoiceRef, invoiceData);

            const orderRef = doc(db, 'clients', purchase.clientId, 'purchases', purchase.id);
            batch.update(orderRef, { child_id: invoiceId });

            // Migrate payments
            const paymentsSnap = await getDocs(
              query(
                collection(db, 'clients', purchase.clientId, 'payments'),
                where('purchaseId', '==', purchase.id),
                where('ownerId', '==', user.uid)
              )
            );
            paymentsSnap.forEach((doc) => {
              batch.update(doc.ref, { purchaseId: invoiceId });
            });
          }

          await batch.commit();
          showToast(
            `${netToConvert.length} commandes converties en factures avec succès !`,
            'success'
          );
          setSelectedPurchaseIds([]);
          navigate('/facturation');
        } catch (err) {
          console.error(err);
          showToast("Une erreur s'est produite lors de la conversion groupée", 'error');
        }
      },
    });
  };

  // Duplicate selected purchases
  const handleBulkDuplicate = async () => {
    const selectedPurchases = purchases.filter((p) => selectedPurchaseIds.includes(p.id));
    if (selectedPurchases.length === 0) return;

    confirm({
      title: 'Dupliquer les commandes sélectionnées ?',
      message: `Voulez-vous dupliquer les ${selectedPurchases.length} commande(s) ?`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          for (const item of selectedPurchases) {
            const newRef = doc(collection(db, 'clients', item.clientId, 'purchases'));
            const { id, refId, child_id, date, ...duplicateData } = item;

            batch.set(newRef, {
              ...duplicateData,
              date: new Date(),
              notesList: [`Duplicata de la commande ${refId || ''}`],
            });
          }
          await batch.commit();
          showToast(
            `${selectedPurchases.length} commande(s) dupliquée(s) avec succès !`,
            'success'
          );
          setSelectedPurchaseIds([]);
        } catch (error) {
          console.error(error);
          showToast('Erreur lors de la duplication groupée', 'error');
        }
      },
    });
  };

  // Delete selected purchases
  const handleBulkDelete = async () => {
    const selectedPurchases = purchases.filter((p) => selectedPurchaseIds.includes(p.id));
    if (selectedPurchases.length === 0) return;

    confirm({
      title: 'Supprimer les commandes sélectionnées ?',
      message: `Attention: Cette action est irréversible et supprimera les ${selectedPurchases.length} commandes ainsi que tous leurs paiements liés.`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          for (const purchase of selectedPurchases) {
            const paymentsSnap = await getDocs(
              query(
                collection(db, 'clients', purchase.clientId, 'payments'),
                where('purchaseId', '==', purchase.id),
                where('ownerId', '==', user.uid)
              )
            );
            paymentsSnap.forEach((d) => batch.delete(d.ref));
            batch.delete(doc(db, 'clients', purchase.clientId, 'purchases', purchase.id));
            if (purchase.parent_id) {
              batch.update(doc(db, 'clients', purchase.clientId, 'purchases', purchase.parent_id), { child_id: deleteField() });
            }
          }
          await batch.commit();
          showToast(`${selectedPurchases.length} commande(s) supprimée(s)`, 'success');
          setSelectedPurchaseIds([]);
        } catch (err) {
          console.error(err);
          showToast('Erreur lors de la suppression groupée', 'error');
        }
      },
    });
  };

  // WhatsApp / Send selected purchases
  const handleBulkSend = async () => {
    const selectedPurchases = purchases.filter((p) => selectedPurchaseIds.includes(p.id));
    if (selectedPurchases.length === 0) return;

    const withPhones = selectedPurchases.filter((p) => {
      const client = clients.find((c) => c.id === p.clientId);
      return client && client.phone && isWhatsAppEligiblePhone(client.phone);
    });

    if (withPhones.length === 0) {
      showToast(
        "Aucun des clients des commandes sélectionnées n'a de numéro mobile compatible WhatsApp (les numéros fixes 05... sont ignorés).",
        'error'
      );
      return;
    }

    showToast(`Lancement de l'envoi WhatsApp pour ${withPhones.length} relance(s)...`, 'success');
    for (const purchase of withPhones) {
      // Envoi asynchrone (non-bloquant) 
      sendWhatsAppRelance(purchase).then(res => {
        if(!res.success) console.error(res.error);
      });
    }
    setSelectedPurchaseIds([]);
  };

  // Bulk print selected purchases
  const handleBulkPrint = () => {
    if (selectedPurchaseIds.length === 0) return;
    const selectedPurchases = purchases.filter((p) => selectedPurchaseIds.includes(p.id));
    setPrintingQueue(selectedPurchases);
    showToast(
      `Préparation du fichier PDF groupé (${selectedPurchases.length} document${selectedPurchases.length > 1 ? 's' : ''})...`,
      'success'
    );
    setIsBulkDropdownOpen(false);
  };

  const handlePrintSingle = (purchase: any) => {
    setPrintingQueue([purchase]);
    showToast(`Préparation du PDF en cours...`, 'success');
  };

  const handlePrintTicketSingle = (purchase: any) => {
    const client = clients.find((c) => c.id === purchase.clientId) || {};
    const invoiceData = mapDocToInvoiceData(purchase, client);
    printTicket(invoiceData);
    showToast(`Impression du Ticket lancée`, 'success');
  };

  const handleDeleteSingle = (purchase: any) => {
    confirm({
      title: 'Supprimer la commande ?',
      message: `Attention: Cette action supprimera définitivement la commande ${purchase.refId || ''} ainsi que tous ses paiements liés.`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          const paymentsSnap = await getDocs(
            query(
              collection(db, 'clients', purchase.clientId, 'payments'),
              where('purchaseId', '==', purchase.id),
              where('ownerId', '==', user.uid)
            )
          );
          paymentsSnap.forEach((d) => batch.delete(d.ref));
          batch.delete(doc(db, 'clients', purchase.clientId, 'purchases', purchase.id));
          if (purchase.parent_id) {
            batch.update(doc(db, 'clients', purchase.clientId, 'purchases', purchase.parent_id), { child_id: deleteField() });
          }
          await batch.commit();
          showToast('Commande supprimée', 'success');
        } catch (err) {
          console.error(err);
          showToast('Erreur lors de la suppression', 'error');
        }
      },
    });
  };

  // Sorted and Processed purchases list
  const filteredPurchases = useMemo(() => {
    // 1. Search Query and Tab Filters
    const searchLower = (search || '').trim().toLowerCase();
    const list = commandesListWithRefs.filter((p) => {
      const clientName = (clientsMap[p.clientId] || 'Client Inconnu').toLowerCase();
      const description = (p.description || '').toLowerCase();
      const refId = (p.refId || '').toLowerCase();
      const itemsText = Array.isArray(p.items) ? p.items.map((i: any) => i.description || '').join(' ').toLowerCase() : '';

      const matchQuery =
        !searchLower ||
        description.includes(searchLower) ||
        refId.includes(searchLower) ||
        clientName.includes(searchLower) ||
        itemsText.includes(searchLower);

      if (!matchQuery) return false;

      const total = Number(p.total) || 0;
      const isPaidStatus = p.paymentStatus === 'paid';
      const paid =
        p.amountPaid !== undefined ? Number(p.amountPaid) || 0 : isPaidStatus ? total : 0;
      const remainingDebt = total - paid;

      if (activeTab === 'debtors') return remainingDebt > 0;
      if (activeTab === 'paid') return remainingDebt <= 0 && total > 0;
      if (activeTab === 'exclu_compta') return !!(p.excludeFromAccounting || clientsMap[p.clientId] && clients.find(c => c.id === p.clientId)?.excludeFromAccounting);

      return true;
    });

    // 2. Sorting Criteria
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

      if (sortBy === 'oldest') return dateA - dateB;
      if (sortBy === 'highest') return totalB - totalA;
      if (sortBy === 'lowest') return totalA - totalB;
      if (sortBy === 'debt') return debtB - debtA;
      return dateB - dateA; // default "recent"
    });

    return list;
  }, [commandesListWithRefs, clientsMap, search, activeTab, sortBy]);

  const handleExportToExcel = () => {
    try {
      if (filteredPurchases.length === 0) {
        showToast('Aucune commande à exporter', 'info');
        return;
      }
      const dataToExport = filteredPurchases.map((p) => {
        const clientName = clientsMap[p.clientId] || 'Client Inconnu';
        return {
          'Référence BC': p.refId || p.id?.substring(0, 8).toUpperCase(),
          'Client': clientName,
          'Date': p.date?.toDate ? p.date.toDate().toISOString().slice(0, 10) : (p.date instanceof Date ? p.date.toISOString().slice(0, 10) : String(p.date || '')),
          'Désignation / Détail': p.description || '',
          'Total TTC (DH)': p.total || 0,
          'Payé (DH)': p.amountPaid || 0,
          'Reste à payer (DH)': (p.total || 0) - (p.amountPaid || 0),
          'Statut de paiement': p.paymentStatus === 'paid' ? 'Payé' : p.paymentStatus === 'partial' ? 'Partiel' : 'Non payé',
          'Conditions': p.conditions_paiement || 'Paiement à la livraison',
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Commandes Clients');
      XLSX.writeFile(workbook, 'export_commandes_clients.xlsx');
      showToast('Exportation Excel réussie !', 'success');
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de l'exportation", 'error');
    }
  };

  useEffect(() => {
    const handleImportEvent = () => setIsImportModalOpen(true);
    const handleExportEvent = () => handleExportToExcel();

    window.addEventListener('trigger-import-commandes', handleImportEvent);
    window.addEventListener('trigger-export-commandes', handleExportEvent);

    return () => {
      window.removeEventListener('trigger-import-commandes', handleImportEvent);
      window.removeEventListener('trigger-export-commandes', handleExportEvent);
    };
  }, [filteredPurchases, clientsMap]);

  // General Statistics based on loaded purchases
  const stats = useMemo(() => {
    let totalSales = 0;
    let totalCollected = 0;
    let totalUnpaid = 0;
    const invoicesCount = filteredPurchases.length;

    filteredPurchases.forEach((p) => {
      const total = Number(p.total) || 0;
      const isPaidStatus = p.paymentStatus === 'paid';
      const paid =
        p.amountPaid !== undefined ? Number(p.amountPaid) || 0 : isPaidStatus ? total : 0;
      const remaining = total - paid;

      totalSales += total;
      totalCollected += paid;
      totalUnpaid += Math.max(0, remaining);
    });

    const recoveryRate = totalSales > 0 ? (totalCollected / totalSales) * 105 : 100;

    return {
      totalSales,
      totalCollected,
      totalUnpaid,
      invoicesCount,
      recoveryRate: Math.min(100, totalSales > 0 ? (totalCollected / totalSales) * 100 : 100),
    };
  }, [filteredPurchases]);

  const totalEntries = filteredPurchases.length;
  const totalPages = Math.ceil(totalEntries / pageSize) || 1;
  const paginatedPurchases = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredPurchases.slice(startIndex, startIndex + pageSize);
  }, [filteredPurchases, currentPage, pageSize]);

  const entryStart = totalEntries === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const entryEnd = Math.min(currentPage * pageSize, totalEntries);

  const isAllSelected =
    paginatedPurchases.length > 0 &&
    paginatedPurchases.every((s) => selectedPurchaseIds.includes(s.id));
  const isSomeSelected =
    paginatedPurchases.length > 0 &&
    paginatedPurchases.some((s) => selectedPurchaseIds.includes(s.id)) &&
    !isAllSelected;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pageIds = paginatedPurchases.map((s) => s.id);
      setSelectedPurchaseIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = paginatedPurchases.map((s) => s.id);
      setSelectedPurchaseIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    }
  };

  return (
    <div className="w-full py-4 space-y-6 select-none relative bg-transparent">
      <div className="w-full space-y-5">
        {/* Core Analytics Banner - Sneat KPI Card Style */}
        <div className="w-full bg-[#ffffff] dark:bg-[#2b2c40] border border-[#eceef1] dark:border-[#434460]/60 rounded-xl shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:shadow-none overflow-hidden mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: Chiffre d'Affaires */}
            <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40]">
              <div className="space-y-1.5">
                <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                  Chiffre d'Affaires
                </span>
                <div className="flex items-baseline gap-1 whitespace-nowrap">
                  <span className="font-mono text-2xl font-bold tracking-tight text-[#222222] dark:text-[#dbdade]">
                    {stats.totalSales.toLocaleString('fr-FR', {
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
                  <span>Opération{stats.invoicesCount > 1 ? 's' : ''}</span>
                </div>
              </div>
              <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
                <Coins size={22} className="stroke-[2.2]" />
              </div>
            </div>

            {/* Card 2: Total Encaissé */}
            <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t-0 md:border-l border-[#eceef1] dark:border-[#434460]/50">
              <div className="space-y-1.5">
                <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                  Total Encaissé
                </span>
                <div className="flex items-baseline gap-1 whitespace-nowrap">
                  <span className="font-mono text-2xl font-bold tracking-tight text-emerald-600 dark:text-[#71dd37]">
                    {stats.totalCollected.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                    DH
                  </span>
                </div>
                <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                  <span className="font-bold text-emerald-600 dark:text-[#71dd37]">
                    {stats.recoveryRate.toFixed(1)}%
                  </span>
                  <span>Récupéré</span>
                </div>
              </div>
              <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
                <CheckCircle2 size={22} className="stroke-[2.2]" />
              </div>
            </div>

            {/* Card 3: Crédit Client */}
            <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 lg:border-l border-[#eceef1] dark:border-[#434460]/50">
              <div className="space-y-1.5">
                <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                  Crédit Client
                </span>
                <div className="flex items-baseline gap-1 whitespace-nowrap">
                  <span className="font-mono text-2xl font-bold tracking-tight text-[#ff3e1d]">
                    {stats.totalUnpaid.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                    DH
                  </span>
                </div>
                <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                  <span>Restant dû global</span>
                </div>
              </div>
              <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
                <AlertCircle size={22} className="stroke-[2.2]" />
              </div>
            </div>

            {/* Card 4: Panier Moyen */}
            <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 md:border-l lg:border-l border-[#eceef1] dark:border-[#434460]/50">
              <div className="space-y-1.5">
                <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                  Panier Moyen
                </span>
                <div className="flex items-baseline gap-1 whitespace-nowrap">
                  <span className="font-mono text-2xl font-bold tracking-tight text-purple-600 dark:text-[#b1b4ff]">
                    {(stats.invoicesCount > 0
                      ? stats.totalSales / stats.invoicesCount
                      : 0
                    ).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
                  </span>
                  <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                    DH
                  </span>
                </div>
                <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium mt-1">
                  <span>Valeur moyenne</span>
                </div>
              </div>
              <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
                <TrendingUp size={22} className="stroke-[2.2]" />
              </div>
            </div>
          </div>
        </div>

        {/* MERGED CONTROLS & TABLE DIRECTORY (Unified Dashboard Style) */}
        <div className="sneat-table-container w-full overflow-visible mb-8 bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg shadow-xs">
          <style
            dangerouslySetInnerHTML={{
              __html: `
              /* ==========================================
                 SNEAT STYLE - EN-TÊTE COMMANDES (TABS)
                 ========================================== */

              /* Table Control Header Bar (Search & Tabs / Bulk Selection swap) */
              .table-nav {
                  position: relative;
                  min-height: 76px;
                  border-bottom: 1px solid #eceef1;
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
                  width: 200px;
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
                  color: #eceff4;
              }

              /* Primary bulk action (Sneat indigo light button) */
              .action-bar-btn-primary {
                  background-color: rgba(105, 108, 255, 0.09) !important;
                  color: #696cff !important;
                  font-weight: 600;
                  border: 1px solid rgba(105, 108, 255, 0.2);
              }
              .dark .action-bar-btn-primary {
                  background-color: rgba(105, 108, 255, 0.15) !important;
                  color: #b1b4ff !important;
                  border-color: rgba(105, 108, 255, 0.3);
              }

              .action-bar-btn-primary:hover {
                  background-color: #696cff !important;
                  color: #ffffff !important;
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
                  color: #71dd37;
                  cursor: pointer;
                  font-size: 16px;
                  line-height: 1;
                  font-weight: bold;
                  transition: color 0.1s;
              }
              .counter-close:hover {
                  color: #ff3e1d;
              }

              /* Sneat Pagination Clean list */
              .sneat-pag-btn {
                  min-width: 38px;
                  height: 38px;
                  border-radius: 0.375rem;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 13px;
                  font-weight: 500;
                  cursor: pointer;
                  border: none;
                  background-color: #f0f2f4;
                  color: #566a7f;
                  transition: all 0.15s ease;
              }
              .dark .sneat-pag-btn {
                  background-color: #232333;
                  color: #a3a4cc;
              }

              .sneat-pag-btn:hover {
                  background-color: #e1e4e8;
              }
              .dark .sneat-pag-btn:hover {
                  background-color: #323249;
              }

              .sneat-pag-btn.active {
                  background-color: #696cff;
                  color: #ffffff;
                  box-shadow: 0 0.125rem 0.25rem rgba(105, 108, 255, 0.4);
              }
              .dark .sneat-pag-btn.active {
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

          <div className={`table-nav ${selectedPurchaseIds.length > 0 ? 'has-selection' : ''}`}>
            {/* VIEW A: Standard Filters */}
            <div className="nav-default-view flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full gap-4">
              {/* Left Side: Entries Selector conforming to Sneat placement */}
              <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
                <span className="text-sm font-medium text-[#8592a3] dark:text-[#a3afbb]">
                  Afficher
                </span>
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

                {/* Create Order Button - directly inline with Show Entries dropdown on the left */}
                <Link
                  to="/add-purchase?type=commande"
                  className="bg-[#696cff] hover:bg-[#5f61e6] active:bg-[#5f61e6] text-white px-4 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm shadow-[0_2px_4px_0_rgba(105,108,255,0.4)] hover:shadow-[0_4px_8px_0_rgba(105,108,255,0.4)] cursor-pointer whitespace-nowrap ml-2 sm:ml-3"
                >
                  <Plus size={16} strokeWidth={2.5} />
                  <span>Nouvelle Commande</span>
                </Link>
              </div>

              {/* Right Side Actions Group (Search + Status Filter + Sort) */}
              <div className="flex items-center gap-3 flex-wrap md:flex-nowrap justify-end">
                <div className="relative">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher..."
                    className="search-input w-[180px] md:w-[200px] h-[38px]"
                  />
                </div>

                {/* Status Dropdown conforming to Sneat list styling with neutral border */}
                <div className="relative text-left min-w-[170px]">
                  <button
                    id="purchase-status-dropdown-btn"
                    type="button"
                    onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                    className="w-full appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none flex items-center justify-between shadow-xs transition-all tracking-wide h-[38px] hover:border-[#696cff] focus:border-[#696cff] active:border-[#696cff]"
                  >
                    <span className="truncate">
                      {activeTab === 'all' && 'Statut'}
                      {activeTab === 'debtors' && 'Débiteurs'}
                      {activeTab === 'paid' && 'Régularisés'}
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
                          Toutes les Commandes
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('debtors');
                            setIsStatusDropdownOpen(false);
                          }}
                          className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'debtors' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                        >
                          Débiteurs (Créance)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab('paid');
                            setIsStatusDropdownOpen(false);
                          }}
                          className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'paid' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                        >
                          Régularisés (Payé)
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

                {/* Sort selection conforming to Sneat dropdown */}
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 pl-4 pr-10 py-2 rounded-[6px] text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none focus:border-[#696cff]"
                  >
                    <option value="recent">Tri: Récents</option>
                    <option value="oldest">Tri: Anciens</option>
                    <option value="highest">Tri: Montant</option>
                    <option value="debt">Tri: Créance</option>
                  </select>
                  <ChevronDown
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8592a3] pointer-events-none"
                    size={14}
                  />
                </div>
              </div>
            </div>

            {/* VIEW B: Bulk Actions */}
            <div className="nav-selection-view">
              <button
                className="action-bar-btn flex items-center gap-1.5"
                onClick={() => setSelectedPurchaseIds([])}
              >
                <span>{selectedPurchaseIds.length} sélectionné(s)</span>
                <span className="text-lg leading-none">&times;</span>
              </button>

              {/* Settings Actions dropdown matching DevisPage layout */}
              <div className="relative">
                <button
                  onClick={() => setIsBulkDropdownOpen(!isBulkDropdownOpen)}
                  className="action-bar-btn flex items-center gap-1.5"
                >
                  <Settings size={15} strokeWidth={2.2} />
                  <span>Action</span>
                  <span className="text-[10px]">▼</span>
                </button>
                {isBulkDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsBulkDropdownOpen(false)}
                    />
                    <div className="absolute top-[110%] left-0 bg-white dark:bg-[#2b2c40] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] shadow-[0_4px_12px_rgba(67,89,113,0.12)] w-[170px] z-50 py-1.5 flex flex-col font-sans">
                      <button
                        type="button"
                        onClick={() => {
                          handleBulkConvertToFacture();
                          setIsBulkDropdownOpen(false);
                        }}
                        className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#566a7f] dark:text-[#dbdade] hover:bg-[#f5f5f9] dark:hover:bg-[#323249] font-medium cursor-pointer flex items-center gap-2"
                      >
                        <FileText size={15} />
                        Créer facture
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleBulkDuplicate();
                          setIsBulkDropdownOpen(false);
                        }}
                        className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#566a7f] dark:text-[#dbdade] hover:bg-[#f5f5f9] dark:hover:bg-[#323249] font-medium cursor-pointer flex items-center gap-2"
                      >
                        <Copy size={15} />
                        Dupliquer
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleBulkDelete();
                          setIsBulkDropdownOpen(false);
                        }}
                        className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-rose-600 dark:text-rose-400 hover:bg-[#fff5f5] dark:hover:bg-rose-950/20 font-semibold cursor-pointer flex items-center gap-2 border-t border-slate-100 dark:border-slate-800"
                      >
                        <Trash2 size={15} />
                        Supprimer
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Dynamic Records Lists */}
          <AnimatePresence mode="wait">
            {filteredPurchases.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-24 text-center bg-[#ffffff] dark:bg-[#2b2c40]"
              >
                <div className="w-20 h-20 bg-[#696cff]/5 rounded-full flex items-center justify-center mx-auto text-[#696cff]/30 mb-5">
                  <Package size={36} strokeWidth={1} />
                </div>
                <h3 className="text-base font-bold text-[#435971] dark:text-[#dbdade]">
                  Aucune donnée disponible
                </h3>
                <p className="text-[#a1acb8] text-[12px] font-medium mt-2 max-w-xs mx-auto">
                  Aucune transaction ne correspond à vos critères de recherche actuels.
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
                        <th className="py-3 px-6 text-left">N° Commande</th>
                        <th className="py-3 px-6 text-left">Client</th>
                        <th className="py-3 px-6 text-left">Date</th>
                        <th className="py-3 px-6 text-right">Reste / Total</th>
                        <th className="py-3 px-6 text-left">Recouvrement</th>
                        <th className="py-3 px-6 text-left">Etat</th>
                        <th className="py-3 px-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {paginatedPurchases.map((purchase, idx) => {
                        const isLastRows =
                          idx >= paginatedPurchases.length - 2 && paginatedPurchases.length > 3;
                        const clientName = clientsMap[purchase.clientId] || 'Client Inconnu';
                        const { total, paid, credited, debt, percentPaid } = calculatePurchaseBalance(purchase);
                        const avatar = getAvatarStyle(clientName);
                        // Fixed avatar initials logic to match ClientsPage fully
                        const initials = clientName
                          ? clientName
                              .split(' ')
                              .slice(0, 2)
                              .map((n: string) => n[0])
                              .join('')
                          : '?';

                        return (
                          <tr
                            key={purchase.id + "_" + idx}
                            className="border-b border-[#dbdade]/70 dark:border-[#434460]/40 hover:bg-[#f5f5f9]/40 dark:hover:bg-[#232333]/30 transition-colors group cursor-pointer h-[72px]"
                            onClick={() =>
                              navigate(`/purchase/${purchase.clientId}/${purchase.id}`)
                            }
                          >
                            <td
                              className="px-4 text-center w-12"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                className="w-4 h-4 text-[#696cff] border-[#dbdade] rounded focus:ring-[#696cff] cursor-pointer"
                                checked={selectedPurchaseIds.includes(purchase.id)}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  if (checked) {
                                    setSelectedPurchaseIds((prev) => [...prev, purchase.id]);
                                  } else {
                                    setSelectedPurchaseIds((prev) =>
                                      prev.filter((id) => id !== purchase.id)
                                    );
                                  }
                                }}
                              />
                            </td>
                            <td className="px-6">
                              <span className="font-mono font-bold text-sm text-[#696cff] dark:text-[#b1b4ff]">
                                {purchase.refId}
                              </span>
                            </td>

                            <td className="px-6">
                              <div className="flex items-center gap-4">
                                {/* Status Indicator */}
                                <div className="w-1 flex justify-center shrink-0">
                                  {debt > 0 ? (
                                    <div className="w-[3px] h-[32px] bg-[#ffab00] rounded-full" />
                                  ) : (
                                    <div className="w-[3px] h-[32px] bg-transparent" />
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
                                        navigate(`/client/${purchase.clientId}`);
                                      }}
                                    >
                                      {clientName.toUpperCase()}
                                      <ChevronRight
                                        size={14}
                                        className="text-[#a1acb8] group-hover:text-[#696cff] transition-colors"
                                      />
                                    </h4>
                                    <div className="flex items-center gap-1.5 leading-none mt-1">
                                      <span className="text-[10px] text-[#a1acb8] font-mono">
                                        #{purchase.id.slice(0, 8).toUpperCase()}
                                      </span>
                                      {purchase.excludeFromAccounting && (
                                        <span className="text-[9px] font-black text-rose-500 tracking-wider">
                                          (EXCLU COMPTA)
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </td>

                            <td className="px-6 whitespace-nowrap">
                              <div className="flex flex-col">
                                <span className="text-[13px] text-[#435971] dark:text-[#dbdade] font-bold font-mono">
                                  {purchase.date
                                    ?.toDate()
                                    ?.toLocaleDateString('fr-FR', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    }) || '---'}
                                </span>
                                <span className="text-[10px] text-[#a1acb8] font-black uppercase mt-1">
                                  Date de règlement:{' '}
                                  {purchase.dueDate
                                    ? purchase.dueDate.toDate
                                      ? purchase.dueDate
                                          .toDate()
                                          .toLocaleDateString('fr-FR', {
                                            day: '2-digit',
                                            month: 'short',
                                          })
                                      : new Date(purchase.dueDate).toLocaleDateString('fr-FR', {
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
                                {debt > 0 ? (
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
                              {purchase.child_id && validInvoiceIds.has(purchase.child_id) ? (
                                <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-[#71dd37] text-[11px] font-extrabold uppercase tracking-wide">
                                  <CheckCircle2 size={13} className="shrink-0" /> Converti
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[#ffab00] dark:text-orange-400 text-[11px] font-extrabold uppercase tracking-wide">
                                  <Clock size={13} className="shrink-0" /> En attente
                                </span>
                              )}
                            </td>

                            <td className="px-6 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="relative inline-block text-left">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenActionDropdownId(
                                      openActionDropdownId === purchase.id ? null : purchase.id
                                    )
                                  }
                                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#323249] rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                  title="Actions"
                                >
                                  <MoreVertical size={16} />
                                </button>

                                {openActionDropdownId === purchase.id && (
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
                                          navigate(`/purchase/${purchase.clientId}/${purchase.id}`);
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
                                            `/edit-purchase/${purchase.clientId}/${purchase.id}?type=commande`
                                          );
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                      >
                                        <Pencil size={14} />
                                        <span>Modifier</span>
                                      </button>

                                      {!(purchase.child_id && validInvoiceIds.has(purchase.child_id)) && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenActionDropdownId(null);
                                            handleConvertToInvoice(purchase);
                                          }}
                                          className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                        >
                                          <FileText size={14} />
                                          <span>Facturer</span>
                                        </button>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionDropdownId(null);
                                          handlePrintSingle(purchase);
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
                                          handlePrintTicketSingle(purchase);
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                      >
                                        <Printer size={14} />
                                        <span>Imp. Ticket</span>
                                      </button>

                                      <hr className="border-[#eceef1] dark:border-[#434460]/40 my-1" />

                                      <button
                                        type="button"
                                        onClick={() => {
                                          setOpenActionDropdownId(null);
                                          handleDeleteSingle(purchase);
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2 cursor-pointer font-semibold"
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

                {/* MOBILE JOURNAL RESPONSIVE LIST */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:hidden gap-4 mt-6">
                  {paginatedPurchases.map((purchase, idx) => {
                    const clientName = clientsMap[purchase.clientId] || 'Client Inconnu';
                    const avatar = getAvatarStyle(clientName);
                    const formattedInitials = clientName
                      ? clientName
                          .split(' ')
                          .slice(0, 2)
                          .map((n: string) => n[0])
                          .join('')
                      : '?';

                    const { total, paid, credited, debt, percentPaid } = calculatePurchaseBalance(purchase);
                    const sendWa = () => {
    showToast('Envoi du message WhatsApp en cours...', 'info');
    sendWhatsAppRelance(purchase).then(res => {
      if (res.success) showToast('Relance WhatsApp envoyée avec succès.', 'success');
      else showToast('Erreur WhatsApp: ' + res.error, 'error');
    });
  };

                    return (
                      <motion.div
                        key={purchase.id + "_" + idx}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 p-5 rounded-lg hover:shadow-md transition-all duration-200 flex flex-col justify-between space-y-4"
                        onClick={() => navigate(`/purchase/${purchase.clientId}/${purchase.id}`)}
                      >
                        {/* Header card info */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`w-9 h-9 ${avatar.bg} ${avatar.text} ring-4 ${avatar.ring} rounded-full flex items-center justify-center shrink-0 font-extrabold text-[11px] uppercase shadow-sm`}
                            >
                              {formattedInitials.slice(0, 2)}
                            </div>
                            <div className="min-w-0">
                              <h4
                                className="font-bold text-slate-900 text-[13px] leading-tight truncate pr-1 hover:text-[#696cff] dark:text-[#b1b4ff] transition-colors"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/client/${purchase.clientId}`);
                                }}
                              >
                                {clientName}
                              </h4>
                              <div className="flex items-center gap-1.5 mt-1">
                                <p className="text-[10px] text-[#566a7f] dark:text-[#707194] font-bold font-mono tracking-widest uppercase">
                                  {purchase.refId || purchase.id.slice(0, 8)}
                                </p>
                                {purchase.excludeFromAccounting && (
                                  <span className="text-[9px] font-black text-rose-500 tracking-wider">
                                    (EXCLU)
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <span
                            className={
                              debt <= 0
                                ? 'badge-emerald-soft transform scale-90 origin-top-right px-3 py-1'
                                : 'badge-rose-soft transform scale-90 origin-top-right px-3 py-1'
                            }
                          >
                            {debt <= 0 ? 'Payé' : 'À Crédit'}
                          </span>
                        </div>

                        {/* Mid transaction desc & date */}
                        <div className="space-y-2">
                          <div className="flex items-center gap-3 text-[10px] text-[#566a7f] dark:text-[#707194] font-bold mt-1">
                            <div className="flex items-center gap-1.5 font-mono">
                              <Calendar size={12} className="text-slate-300" />
                              <span>
                                {purchase.date?.toDate()?.toLocaleDateString('fr-FR', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                }) || '---'}
                              </span>
                            </div>
                            <span>•</span>
                            <span className="font-mono">
                              {purchase.items?.length || 0} POSTE(S)
                            </span>
                          </div>
                        </div>

                        {/* Financial metrics layout with dynamic bar */}
                        <div className="bg-transparent border border-slate-100 rounded-lg p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="text-slate-400 font-bold text-[9px] uppercase tracking-wider block leading-tight">
                                Total Dossier
                              </span>
                              <span className="text-slate-900 font-bold font-mono text-[13px] block mt-0.5 tracking-tight">
                                {total.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                DH
                              </span>
                            </div>
                            <div className="text-right">
                              <span className="text-slate-400 font-bold text-[9px] uppercase tracking-wider block leading-tight">
                                Crédit Restant
                              </span>
                              <span
                                className={`font-mono text-[13px] font-bold block mt-0.5 tracking-tight ${debt > 0 ? 'text-[#ff3e1d] dark:text-[#ff3e1d]' : 'text-[#71dd37] dark:text-[#71dd37]'}`}
                              >
                                {debt.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                DH
                              </span>
                            </div>
                          </div>

                          {/* Progress bar */}
                          <div className="space-y-1.5">
                            <div className="w-full bg-white h-1.5 rounded-full overflow-hidden border border-slate-200/50 shadow-inner">
                              <div
                                className={`h-full transition-all duration-1000 ${debt <= 0 ? 'bg-transparent dark:bg-transparent dark:bg-transparent' : 'bg-rose-400'}`}
                                style={{ width: `${Math.min(100, percentPaid)}%` }}
                              />
                            </div>
                            <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase font-mono tracking-tighter">
                              <span>
                                Payé:{' '}
                                {paid.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                DH
                              </span>
                              <span className="text-slate-500 font-extrabold">
                                {percentPaid.toFixed(0)}%
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Actions line footer */}
                        <div
                          className="pt-2 flex items-center justify-between gap-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-2 flex-1">
                            {purchase.child_id && validInvoiceIds.has(purchase.child_id) ? (
                              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-[#71dd37] text-[10px] font-extrabold uppercase tracking-wide mt-1.5 ml-2.5">
                                <CheckCircle2 size={11} className="shrink-0" /> Converti
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[#ffab00] dark:text-orange-400 text-[10px] font-extrabold uppercase tracking-wide mt-1.5 ml-2.5">
                                <Clock size={11} className="shrink-0" /> En attente
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <Link
                              to={`/edit-purchase/${purchase.clientId}/${purchase.id}?type=commande`}
                              className="text-slate-400 hover:text-[#696cff] dark:text-[#b1b4ff] bg-transparent dark:bg-transparent hover:text-indigo-500 transition-all p-1.5"
                              title="Modifier"
                            >
                              <Pencil size={14} />
                            </Link>
                            <button
                              onClick={() => {
                                confirm({
                                  title: 'Supprimer ?',
                                  message:
                                    'Cette opération effacera la transaction et tous ses paiements.',
                                  onConfirm: async () => {
                                    if (!purchase.clientId || !purchase.id) return;
                                    try {
                                      const batch = writeBatch(db);
                                      const paymentsSnap = await getDocs(
                                        query(
                                          collection(db, 'clients', purchase.clientId, 'payments'),
                                          where('purchaseId', '==', purchase.id),
                                          where('ownerId', '==', user.uid)
                                        )
                                      );
                                      paymentsSnap.forEach((d) => batch.delete(d.ref));
                                      batch.delete(
                                        doc(
                                          db,
                                          'clients',
                                          purchase.clientId,
                                          'purchases',
                                          purchase.id
                                        )
                                      );
                                      await batch.commit();
                                      showToast('Supprimé', 'success');
                                    } catch (err) {
                                      showToast('Erreur', 'error');
                                    }
                                  },
                                });
                              }}
                              className="text-slate-400 hover:text-[#ff3e1d] dark:text-[#ff3e1d] bg-transparent dark:bg-transparent hover:text-rose-500 transition-all font-bold p-1.5"
                              title="Supprimer"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* PAGINATION CONTROLS */}
                {filteredPurchases.length > 0 && (
                  <div className="px-6 py-4 border-t border-[#dbdade]/70 dark:border-[#434460]/40 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white dark:bg-[#2b2c40] rounded-b-lg">
                    <div className="flex items-center gap-2 text-xs text-[#566a7f] dark:text-[#a3a4cc] whitespace-nowrap">
                      <span>Afficher</span>
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/50 dark:border-[#434460]/20 rounded py-1 px-2.5 text-xs font-semibold text-[#697a8d] dark:text-[#a3a4cc] focus:ring-1 focus:ring-[#696cff] cursor-pointer outline-none"
                      >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                      <span>lignes par page</span>
                    </div>

                    <div className="text-xs font-medium text-[#566a7f] dark:text-[#a3a4cc]">
                      <span>
                        Affichage de{' '}
                        <span className="font-bold text-[#222222] dark:text-[#dbdade]">
                          {entryStart}
                        </span>{' '}
                        à{' '}
                        <span className="font-bold text-[#222222] dark:text-[#dbdade]">
                          {entryEnd}
                        </span>{' '}
                        sur{' '}
                        <span className="font-bold text-[#222222] dark:text-[#dbdade]">
                          {totalEntries}
                        </span>{' '}
                        commandes
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1.5 rounded border border-[#dbdade]/70 dark:border-[#434460]/40 text-[#697a8d] dark:text-[#a3a4cc] hover:bg-[#f5f5f9] dark:hover:bg-[#232333] disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer select-none flex items-center justify-center w-8 h-8"
                        title="Précédent"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                        if (
                          totalPages > 5 &&
                          page !== 1 &&
                          page !== totalPages &&
                          Math.abs(page - currentPage) > 1
                        ) {
                          if (page === 2 && currentPage > 3)
                            return (
                              <span key="dots1" className="px-1 text-slate-400">
                                ...
                              </span>
                            );
                          if (page === totalPages - 1 && currentPage < totalPages - 2)
                            return (
                              <span key="dots2" className="px-1 text-slate-400">
                                ...
                              </span>
                            );
                          return null;
                        }
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`w-8 h-8 rounded text-xs font-bold font-mono transition-colors cursor-pointer select-none ${
                              currentPage === page
                                ? 'bg-[#696cff] text-white shadow-xs'
                                : 'text-[#697a8d] hover:bg-[#f5f5f9] dark:text-[#a3a4cc] dark:hover:bg-[#232333]'
                            }`}
                          >
                            {page}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-1.5 rounded border border-[#dbdade]/70 dark:border-[#434460]/40 text-[#697a8d] dark:text-[#a3a4cc] hover:bg-[#f5f5f9] dark:hover:bg-[#232333] disabled:opacity-40 disabled:hover:bg-transparent transition-colors cursor-pointer select-none flex items-center justify-center w-8 h-8"
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
      </div>
      {/* Hidden template logic for bulk or single queue printing printing */}
      {(() => {
        if (printingQueue.length === 0) return null;

        return (
          <div style={{ position: 'absolute', top: '-9999px', left: '-9999px', zIndex: -9999 }}>
            <div
              id="hidden-pdf-content"
              style={{ background: 'white', display: 'flex', flexDirection: 'column' }}
            >
              {printingQueue.map((purchase, idx) => {
                const client = clients.find((c) => c.id === purchase.clientId) || {};
                const invoiceData = mapDocToInvoiceData(purchase, client);
                return (
                  <div
                    key={purchase.id + "_" + idx}
                    style={{
                      width: '210mm',
                      height: '297mm',
                      pageBreakAfter: idx < printingQueue.length - 1 ? 'always' : 'auto',
                    }}
                  >
                    <InvoicePrint data={invoiceData} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      <CommandesXlsxModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        ownerId={user?.uid || ''}
        existingClients={clients}
        showToast={showToast}
      />
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  getDocs,
  writeBatch,
  where,
  collectionGroup,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useNavigate, Link } from 'react-router-dom';
import { CustomerService } from '../services/customer.service';
import { isWhatsAppEligiblePhone, isLandlinePhone } from '../services/whatsappService';
import {
  Users,
  Search,
  Phone,
  Trash2,
  Plus,
  User,
  Eye,
  Coins,
  Scale,
  AlertCircle,
  ArrowUpDown,
  CheckCircle2,
  MessageSquare,
  Calculator,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ExternalLink,
  LayoutGrid,
  List,
  Mail,
  TrendingUp,
  Pencil,
  ChevronDown,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { ClientXlsxModal } from '../components/ClientXlsxModal';
import { Upload, Download } from 'lucide-react';

export default function ClientsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [clientPurchases, setClientPurchases] = useState<any[]>([]);
  const [supplierPurchases, setSupplierPurchases] = useState<any[]>([]);
  const [clientCreditNotes, setClientCreditNotes] = useState<any[]>([]);
  const [search, setSearch] = useState(() => localStorage.getItem('clie_filter_search') || '');
  const [activeTab, setActiveTab] = useState<'all' | 'debtors' | 'cleared' | 'double' | 'archived'>(
    () => {
      const val = localStorage.getItem('clie_filter_activeTab');
      return (val as any) || 'all';
    }
  );
  const [sortBy, setSortBy] = useState<'date' | 'debt' | 'name'>(() => {
    const val = localStorage.getItem('clie_filter_sortBy');
    return (val as any) || 'date';
  });
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [isBulkDropdownOpen, setIsBulkDropdownOpen] = useState(false);

  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const val = localStorage.getItem('clie_filter_pageSize');
    return val ? Number(val) : 10;
  });
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  // Persist filter states to localStorage
  useEffect(() => {
    localStorage.setItem('clie_filter_search', search);
  }, [search]);

  useEffect(() => {
    localStorage.setItem('clie_filter_activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('clie_filter_sortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('clie_filter_pageSize', String(pageSize));
  }, [pageSize]);

  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();

  // Reset page and selection when search, activeTab, or sortBy changes
  useEffect(() => {
    setCurrentPage(1);
    setSelectedClientIds([]);
  }, [search, activeTab, sortBy]);

  useEffect(() => {
    if (!user) return;

    // Listen to Clients
    const clientsQuery = query(
      collection(db, 'clients'),
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );
    const unsubscribeClients = onSnapshot(
      clientsQuery,
      (snapshot) => setClients(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
      (error) => handleFirestoreError(error, OperationType.LIST, 'clients')
    );

    // Listen to Suppliers
    const suppliersQuery = query(collection(db, 'suppliers'), where('ownerId', '==', user.uid));
    const unsubscribeSuppliers = onSnapshot(
      suppliersQuery,
      (snapshot) => setSuppliers(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))),
      (error) => handleFirestoreError(error, OperationType.LIST, 'suppliers')
    );

    // Listen to Purchases group for all documents (handles both clients & suppliers)
    const purchasesQuery = query(
      collectionGroup(db, 'purchases'),
      where('ownerId', '==', user.uid)
    );
    const unsubscribePurchases = onSnapshot(
      purchasesQuery,
      (snapshot) => {
        const allPurch = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
          parentId: docSnap.ref.parent?.parent?.id,
          parentPath: docSnap.ref.parent?.parent?.parent?.id, // "clients" or "suppliers"
        }));

        const cPurch = allPurch
          .filter((p) => p.parentPath === 'clients')
          .map((p) => ({ ...p, clientId: p.parentId }));

        const sPurch = allPurch
          .filter((p) => p.parentPath === 'suppliers')
          .map((p) => ({ ...p, supplierId: p.parentId }));

        setClientPurchases(cPurch);
        setSupplierPurchases(sPurch);
      },
      (error) => {
        console.warn('Could not load group purchases safely', error);
      }
    );

    // Listen to Credit Notes group for all clients
    const creditNotesQuery = query(
      collectionGroup(db, 'credit_notes'),
      where('ownerId', '==', user.uid)
    );
    const unsubscribeCreditNotes = onSnapshot(
      creditNotesQuery,
      (snapshot) => {
        const cCreditNotes = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
          clientId: docSnap.ref.parent?.parent?.id,
        }));
        setClientCreditNotes(cCreditNotes);
      },
      (error) => {
        console.warn('Could not load group credit notes safely', error);
      }
    );

    return () => {
      unsubscribeClients();
      unsubscribeSuppliers();
      unsubscribePurchases();
      unsubscribeCreditNotes();
    };
  }, [user]);

  // Clients processed with comprehensive statistics and Double Casquette mutual netting
  const clientsWithStats = useMemo(() => {
    return clients.map((client) => {
      // 1. Calculate Client stats
      const cPurch = clientPurchases.filter(
        (p) =>
          p.clientId === client.id &&
          p.type !== 'devis' &&
          p.status !== 'Annulée' &&
          p.status !== 'Brouillon'
      );
      
      const cNotes = clientCreditNotes.filter((cn) => cn.clientId === client.id);
      
      const csStats = CustomerService.calculateCustomerStats(cPurch, cNotes);
      
      const totalPurchased = csStats.totalSales;
      const totalPaid = csStats.totalPaid;
      const balance = csStats.detteClient; // Use detteClient as the main balance
      const creditClient = csStats.creditClient; // Added creditClient

      // 2. Double Casquette Netting calculation
      let hasSupplierAccount = false;
      let supplierName = '';
      let supplierBalance = 0;

      if (client.linkedPartnerId) {
        const matchingSupplier = suppliers.find((s) => s.id === client.linkedPartnerId);
        if (matchingSupplier) {
          hasSupplierAccount = true;
          supplierName = matchingSupplier.name;

          const sPurch = supplierPurchases.filter(
            (p) =>
              p.supplierId === client.linkedPartnerId &&
              p.type !== 'devis' &&
              p.status !== 'Annulée' &&
              p.status !== 'Brouillon'
          );
          const sTotal = sPurch.reduce((acc, p) => acc + (Number(p.total) || 0), 0);
          const sPaid = sPurch.reduce(
            (acc, p) =>
              acc +
              (p.amountPaid !== undefined
                ? Number(p.amountPaid) || 0
                : p.paymentStatus === 'paid'
                  ? Number(p.total) || 0
                  : 0),
            0
          );
          supplierBalance = sTotal - sPaid; // How much we owe the supplier
        }
      }

      // Net compensation: Client balance (their debt to us) - Supplier balance (our debt to them)
      const netCompensation = balance - supplierBalance;

      return {
        ...client,
        balance,
        creditClient,
        totalPurchased,
        totalPaid,
        purchasesCount: cPurch.length,
        hasSupplierAccount,
        supplierName,
        supplierBalance,
        netCompensation,
      };
    });
  }, [clients, clientPurchases, clientCreditNotes, suppliers, supplierPurchases]);

  // Apply search, filters & sort Order
  const filteredAndSortedClients = useMemo(() => {
    let result = clientsWithStats.filter((c) => {
      const matchSearch =
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.phone && c.phone.includes(search));

      if (!matchSearch) return false;

      // Handle archived-specific status filter tab
      if (activeTab === 'archived') {
        return c.archived === true;
      }
      // Hide archived clients in other filter views
      if (c.archived === true) return false;

      if (activeTab === 'debtors') return c.balance > 0;
      if (activeTab === 'cleared') return c.balance <= 0 && c.purchasesCount > 0;
      if (activeTab === 'double') return !!c.linkedPartnerId;

      return true;
    });

    // Sorting
    if (sortBy === 'debt') {
      result = [...result].sort((a, b) => b.balance - a.balance);
    } else if (sortBy === 'name') {
      result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result = [...result].sort((a, b) => {
        const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return timeB - timeA;
      });
    }

    return result;
  }, [clientsWithStats, search, activeTab, sortBy]);

  // General Dashboard Metrics
  const systemStats = useMemo(() => {
    const totalBilled = filteredAndSortedClients.reduce((acc, c) => acc + c.totalPurchased, 0);
    const totalCollected = filteredAndSortedClients.reduce((acc, c) => acc + c.totalPaid, 0);
    const totalActiveCredit = filteredAndSortedClients.reduce(
      (acc, c) => acc + Math.max(0, c.balance),
      0
    );
    const debtorCount = filteredAndSortedClients.filter((c) => c.balance > 0).length;
    const globalRecovery = totalBilled > 0 ? (totalCollected / totalBilled) * 150 : 100;
    const clampedRecovery = Math.min(
      100,
      globalRecovery > 100 ? (totalCollected / totalBilled) * 100 : globalRecovery
    );

    return {
      totalBilled,
      totalCollected,
      totalActiveCredit,
      debtorCount,
      globalRecovery: clampedRecovery,
    };
  }, [filteredAndSortedClients]);

  // Pagination calculations
  const paginatedClients = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredAndSortedClients.slice(startIndex, startIndex + pageSize);
  }, [filteredAndSortedClients, currentPage, pageSize]);

  const totalEntries = filteredAndSortedClients.length;
  const totalPages = Math.ceil(totalEntries / pageSize) || 1;
  const entryStart = (currentPage - 1) * pageSize + 1;
  const entryEnd = Math.min(currentPage * pageSize, totalEntries);

  // Bulk Selection Utilities
  const isAllSelected = useMemo(() => {
    return (
      paginatedClients.length > 0 && paginatedClients.every((c) => selectedClientIds.includes(c.id))
    );
  }, [paginatedClients, selectedClientIds]);

  const isSomeSelected = useMemo(() => {
    const count = paginatedClients.filter((c) => selectedClientIds.includes(c.id)).length;
    return count > 0 && count < paginatedClients.length;
  }, [paginatedClients, selectedClientIds]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pageIds = paginatedClients.map((c) => c.id);
      setSelectedClientIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = paginatedClients.map((c) => c.id);
      setSelectedClientIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    }
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
        text: 'text-[#4fb922] dark:text-[#71dd37]',
        ring: 'ring-[#71dd37]/10',
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
      V: { bg: 'bg-transparent', text: 'text-violet-700', ring: 'ring-violet-200/50' },
      W: {
        bg: 'bg-transparent',
        text: 'text-[#4fb922] dark:text-[#71dd37]',
        ring: 'ring-[#71dd37]/10',
      },
      X: {
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

  const handleWhatsAppRelance = (phone: string, name: string, balance: number) => {
    if (isLandlinePhone(phone)) {
      showToast('Ce numéro est une ligne fixe (05...), impossible d\'envoyer par WhatsApp.', 'error');
      return;
    }
    let cleanPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (!cleanPhone.startsWith('+')) {
      if (cleanPhone.startsWith('0')) {
        cleanPhone = '212' + cleanPhone.slice(1);
      }
    } else {
      cleanPhone = cleanPhone.replace('+', '');
    }
    const txt = `Bonjour ${name},\n\nNous vous contactons pour vous rappeler que votre compte affiche un solde débiteur de *${balance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH*.\n\nMerci de bien vouloir procéder à la régularisation dans les meilleurs délais.\n\nCordialement.`;
    
    showToast('Envoi du message WhatsApp en cours...', 'info');
    import('../services/whatsappService').then(({ sendWhatsAppMessage }) => {
      sendWhatsAppMessage(cleanPhone, txt).then(result => {
        if (result.success) {
          showToast('Relance WhatsApp envoyée avec succès.', 'success');
        } else {
          showToast('Erreur WhatsApp: ' + result.error, 'error');
        }
      });
    });
  };

  const exportClientsListToXlsx = (clientsToExport: any[], filename: string) => {
    // We build a clean, comprehensive column mapping for Moroccan accounting standards
    const mapped = clientsToExport.map((c) => {
      const regDate = c.createdAt?.toDate
        ? c.createdAt.toDate().toLocaleDateString('fr-FR')
        : c.createdAt instanceof Date
          ? c.createdAt.toLocaleDateString('fr-FR')
          : '';
      return {
        'ID Spire': c.id || '',
        'Raison Sociale / Nom': c.name || '',
        Téléphone: c.phone || '',
        Email: c.email || '',
        Ville: c.city || '',
        'Adresse Ligne 1': c.addressLine1 || '',
        'Adresse Ligne 2': c.addressLine2 || '',
        'I.C.E.': c.ice || '',
        'Commandes (Total)': c.purchasesCount || 0,
        'Montant Commandé (DH)': c.totalPurchased || 0,
        'Montant Réglé (DH)': c.totalPaid || 0,
        'Solde Client (Créance en DH)': c.balance || 0,
        'Crédit (Avoirs en DH)': c.creditClient || 0,
        "Date d'enregistrement": regDate,
      };
    });

    const ws = XLSX.utils.json_to_sheet(mapped);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Repertoire Clients');

    // Auto-adjust column widths
    if (mapped.length > 0) {
      const maxLens = Object.keys(mapped[0]).map((key) => Math.max(key.length, 16));
      ws['!cols'] = maxLens.map((w) => ({ wch: w }));
    }

    XLSX.writeFile(wb, `${filename}.xlsx`);
    showToast(`${clientsToExport.length} client(s) exporté(s) en format Excel (.xlsx).`, 'success');
  };

  const handleBulkExport = () => {
    if (selectedClientIds.length === 0) return;
    const selectedClients = clientsWithStats.filter((c) => selectedClientIds.includes(c.id));
    exportClientsListToXlsx(
      selectedClients,
      `export_clients_selection_${new Date().toISOString().slice(0, 10)}`
    );
  };

  const handleExportAllFiltered = () => {
    if (filteredAndSortedClients.length === 0) {
      showToast('Aucun client à exporter.', 'info');
      return;
    }
    exportClientsListToXlsx(
      filteredAndSortedClients,
      `export_clients_repertoire_${new Date().toISOString().slice(0, 10)}`
    );
  };

  const handleBulkDuplicate = async () => {
    if (selectedClientIds.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const id of selectedClientIds) {
        const source = clients.find((c) => c.id === id);
        if (source) {
          // generate a new doc ID
          const newDocRef = doc(collection(db, 'clients'));
          const duplicatedData = {
            name: `${source.name} - Copie`,
            phone: source.phone || '',
            email: source.email || '',
            address: source.address || '',
            city: source.city || '',
            notes: source.notes || '',
            ownerId: user?.uid,
            createdAt: new Date(),
          };
          batch.set(newDocRef, duplicatedData);
        }
      }
      await batch.commit();
      setSelectedClientIds([]);
      showToast(`${selectedClientIds.length} client(s) dupliqué(s) avec succès.`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Erreur lors de la duplication des clients.', 'error');
    }
  };

  const handleBulkArchive = async (archive: boolean) => {
    if (selectedClientIds.length === 0) return;
    try {
      const batch = writeBatch(db);
      for (const id of selectedClientIds) {
        const clientRef = doc(db, 'clients', id);
        batch.update(clientRef, { archived: archive });
      }
      await batch.commit();
      setSelectedClientIds([]);
      showToast(
        archive
          ? `${selectedClientIds.length} client(s) archivé(s).`
          : `${selectedClientIds.length} client(s) désarchivé(s).`,
        'success'
      );
    } catch (err) {
      console.error(err);
      showToast("Erreur de modification d'archivage.", 'error');
    }
  };

  const handleBulkPrintStatements = () => {
    if (selectedClientIds.length === 0) return;
    const selectedClients = clientsWithStats.filter((c) => selectedClientIds.includes(c.id));

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('Veuillez autoriser les fenêtres pop-up pour imprimer les relevés.', 'error');
      return;
    }

    let htmlContent = `
      <html>
        <head>
          <title>Relevés de Compte Client</title>
          <style>
            body { font-family: 'Public Sans', sans-serif; color: #333; margin: 40px; }
            .statement { page-break-after: always; max-width: 800px; margin: 0 auto; padding-bottom: 20px; border-bottom: 2px dashed #eceef1; margin-bottom: 40px; }
            .statement:last-child { page-break-after: avoid; border-bottom: none; }
            .header { display: flex; justify-content: space-between; border-bottom: 2px solid #566a7f; padding-bottom: 20px; margin-bottom: 20px; }
            .title { font-size: 24px; font-weight: bold; color: #696cff; text-transform: uppercase; }
            .info-table { width: 100%; margin-bottom: 30px; border-collapse: collapse; }
            .info-table td { padding: 6px 0; font-size: 14px; }
            .info-table td.label { font-weight: bold; color: #566a7f; width: 150px; }
            .purchases-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            .purchases-table th { background-color: #f5f5f9; color: #566a7f; font-size: 11px; font-weight: bold; text-transform: uppercase; padding: 10px; text-align: left; border-bottom: 1px solid #d9dee3; }
            .purchases-table td { padding: 10px; font-size: 13px; border-bottom: 1px solid #eceef1; }
            .text-right { text-align: right; }
            .totals { float: right; width: 300px; margin-top: 20px; }
            .totals table { width: 100%; border-collapse: collapse; }
            .totals td { padding: 6px 10px; font-size: 13px; }
            .totals td.bold { font-weight: bold; font-size: 15px; color: #ffab00; }
            .clearfix { clear: both; }
          </style>
        </head>
        <body>
    `;

    selectedClients.forEach((c) => {
      const cPurch = clientPurchases.filter((p) => p.clientId === c.id);

      htmlContent += `
        <div class="statement">
          <div class="header">
            <div>
              <div class="title">RELEVÉ DE COMPTE</div>
              <div style="font-size: 14px; font-weight: bold; margin-top: 6px;">Date d'édition: ${new Date().toLocaleDateString('fr-FR')}</div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: bold; font-size: 16px;">${c.name.toUpperCase()}</div>
              <div style="font-size: 13px; color: #697a8d; margin-top: 4px;">Tél: ${c.phone || 'Non renseigné'}</div>
              <div style="font-size: 13px; color: #697a8d;">Email: ${c.email || 'Non renseigné'}</div>
            </div>
          </div>
          
          <table class="info-table">
            <tr>
              <td class="label">ID Client:</td>
              <td>#${c.id.slice(0, 8).toUpperCase()}</td>
              <td class="label" style="text-align: right;">Nombre d'achats:</td>
              <td style="text-align: right;">${c.purchasesCount}</td>
            </tr>
            <tr>
              <td class="label">Date création:</td>
              <td>${c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('fr-FR') : '---'}</td>
              <td class="label" style="text-align: right;">Compte Mixte:</td>
              <td style="text-align: right;">${c.linkedPartnerId ? 'Oui' : 'Non'}</td>
            </tr>
          </table>
          
          <h3>HISTORIQUE DES ENREGISTREMENTS</h3>
          <table class="purchases-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th class="text-right">Total Facturé</th>
                <th class="text-right">Réglé (Encaissé)</th>
                <th class="text-right">Reste à payer</th>
              </tr>
            </thead>
            <tbody>
      `;

      if (cPurch.length === 0) {
        htmlContent += `
          <tr>
            <td colspan="5" style="text-align: center; color: #a1acb8; padding: 20px;">Aucune transaction enregistrée.</td>
          </tr>
        `;
      } else {
        cPurch.forEach((p) => {
          const pTotal = Number(p.total) || 0;
          const pPaid =
            p.amountPaid !== undefined
              ? Number(p.amountPaid) || 0
              : p.paymentStatus === 'paid'
                ? pTotal
                : 0;
          const pDebt = pTotal - pPaid;
          const pDate = p.date?.toDate ? p.date.toDate().toLocaleDateString('fr-FR') : '---';

          htmlContent += `
            <tr>
              <td>${pDate}</td>
              <td style="font-weight: 500;">${p.description || 'Achat de stock client'}</td>
              <td class="text-right">${pTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</td>
              <td class="text-right">${pPaid.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</td>
              <td class="text-right" style="font-weight: bold; color: ${pDebt > 0 ? '#ffab00' : '#71dd37'};">${pDebt.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</td>
            </tr>
          `;
        });
      }

      htmlContent += `
            </tbody>
          </table>
          
          <div class="totals">
            <table>
              <tr>
                <td>Total Commandé:</td>
                <td class="text-right" style="font-weight: bold;">${c.totalPurchased.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</td>
              </tr>
              <tr>
                <td>Total Encaissé:</td>
                <td class="text-right" style="font-weight: bold; color: #71dd37;">${c.totalPaid.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</td>
              </tr>
              <tr style="border-top: 1.5px solid #566a7f;">
                <td class="bold">Crédit Échu (Créance):</td>
                <td class="text-right bold">${c.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</td>
              </tr>
            </table>
          </div>
          <div class="clearfix"></div>
        </div>
      `;
    });

    htmlContent += `
          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    showToast(`${selectedClients.length} relevé(s) de compte ouvert(s) pour imprimer.`, 'success');
  };

  const handleBulkEmail = () => {
    if (selectedClientIds.length === 0) return;
    const selectedClients = clientsWithStats.filter((c) => selectedClientIds.includes(c.id));
    const emails = selectedClients.map((c) => c.email).filter(Boolean);

    if (emails.length === 0) {
      showToast("Aucun des clients sélectionnés n'a d'adresse email enregistrée.", 'info');
      return;
    }

    const subject = encodeURIComponent('Relevé de compte client');
    const body = encodeURIComponent(
      'Bonjour,\n\nNous vous prions de trouver ci-joint votre relevé de compte.\n\nCordialement.'
    );
    const mailtoUrl = `mailto:?bcc=${emails.join(',')}&subject=${subject}&body=${body}`;
    window.open(mailtoUrl, '_blank');
    showToast(`Messagerie mail ouverte pour ${emails.length} client(s).`, 'success');
  };

  const handleBulkDelete = () => {
    if (selectedClientIds.length === 0) return;
    confirm({
      title: `Supprimer ${selectedClientIds.length} client(s) ?`,
      message: `Attention: Cette action supprimera définitivement les clients sélectionnés ainsi que tout l'historique de leurs transactions (achats, paiements/règlements).`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          for (const id of selectedClientIds) {
            const clientObj = clients.find((c) => c.id === id);
            const purchasesSnap = await getDocs(
              query(collection(db, 'clients', id, 'purchases'), where('ownerId', '==', user?.uid))
            );
            purchasesSnap.forEach((doc) => batch.delete(doc.ref));
            const paymentsSnap = await getDocs(
              query(collection(db, 'clients', id, 'payments'), where('ownerId', '==', user?.uid))
            );
            paymentsSnap.forEach((doc) => batch.delete(doc.ref));
            if (clientObj?.linkedPartnerId) {
              batch.update(doc(db, 'suppliers', clientObj.linkedPartnerId), {
                linkedPartnerId: null,
              });
            }
            batch.delete(doc(db, 'clients', id));
          }
          await batch.commit();
          setSelectedClientIds([]);
          showToast('Clients supprimés avec succès.', 'success');
        } catch (err) {
          console.error(err);
          showToast('Erreur lors de la suppression.', 'error');
        }
      },
    });
  };

  const handleClearAllClients = () => {
    confirm({
      title: 'Vider et nettoyer tous les clients ?',
      message:
        "Attention: Cette action supprimera définitivement TOUS les clients de votre base de données ainsi que tout l'historique de leurs transactions (achats, paiements, règlements). Cette action est irréversible et détruira définitivement toutes les données.",
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          const clientsSnap = await getDocs(
            query(collection(db, 'clients'), where('ownerId', '==', user?.uid))
          );

          for (const d of clientsSnap.docs) {
            const id = d.id;
            const purchasesSnap = await getDocs(
              query(collection(db, 'clients', id, 'purchases'), where('ownerId', '==', user?.uid))
            );
            purchasesSnap.forEach((doc) => batch.delete(doc.ref));
            const paymentsSnap = await getDocs(
              query(collection(db, 'clients', id, 'payments'), where('ownerId', '==', user?.uid))
            );
            paymentsSnap.forEach((doc) => batch.delete(doc.ref));
            const clientObj = d.data();
            if (clientObj?.linkedPartnerId) {
              batch.update(doc(db, 'suppliers', clientObj.linkedPartnerId), {
                linkedPartnerId: null,
              });
            }
            batch.delete(d.ref);
          }
          await batch.commit();
          setSelectedClientIds([]);
          showToast('La base de clients a été vidée et nettoyée avec succès.', 'success');
        } catch (err) {
          console.error(err);
          showToast('Erreur lors du nettoyage de la base de clients.', 'error');
        }
      },
    });
  };

  return (
    <div className="w-full py-4 space-y-6 select-none relative bg-transparent">
      {/* Core Analytics Banner - Sneat KPI Card Style */}
      <div className="w-full bg-[#ffffff] dark:bg-[#2b2c40] border border-[#eceef1] dark:border-[#434460]/60 rounded-xl shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:shadow-none overflow-hidden mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Volume Facturé (CA) */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40]">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Volume Facturé (CA)
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#222222] dark:text-[#dbdade]">
                  {systemStats.totalBilled.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span>Facturation cumulée brute</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <Coins size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 2: Trésorerie Encaissée */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t-0 md:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Trésorerie Encaissée
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#4fb922] dark:text-[#71dd37]">
                  {systemStats.totalCollected.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span>Encaissements réels validés</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <CheckCircle2 size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 3: Créances Actives */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Créances Actives
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#ffab00]">
                  {systemStats.totalActiveCredit.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-[#ffab00]">{systemStats.debtorCount}</span>
                <span>
                  compte{systemStats.debtorCount > 1 ? 's' : ''} actif
                  {systemStats.debtorCount > 1 ? 's' : ''}
                </span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <AlertCircle size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 4: Taux Recouvrement */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 md:border-l lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5 w-full">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Taux Recouvrement
              </span>
              <div className="flex items-baseline justify-between whitespace-nowrap">
                <span className="text-2xl font-bold font-mono text-[#222222] dark:text-[#dbdade] tracking-tight">
                  {systemStats.globalRecovery.toFixed(1)}%
                </span>
                <span className="text-[10px] text-[#8592a3] dark:text-[#707194] uppercase font-bold tracking-wider font-mono font-mono">
                  OBJECTIF 85%
                </span>
              </div>
              <div className="w-full bg-[#f5f5f9] dark:bg-[#232333]/50 h-1.5 rounded-full overflow-hidden mt-1.5">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${systemStats.globalRecovery}%` }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                  className="bg-[#71dd37] h-full rounded-full"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MERGED CLIENT CONTROLS & DIRECTORY CARD */}
      <div className="sneat-table-container w-full overflow-visible mb-8">
        <style
          dangerouslySetInnerHTML={{
            __html: `
            /* ==========================================
               SNEAT STYLE - EN-TÊTE CLIENTS (TABS/FILTRES)
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
                z-index: 15;
            }
            .dark .table-nav {
                border-bottom-color: rgba(67, 68, 96, 0.4);
                background: #2b2c40;
            }

            /* VIEW A: Standard Header with original Filters navigation */
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
                z-index: 20;
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

            .sneat-checkbox {
                width: 16px;
                height: 16px;
                accent-color: #696cff;
                cursor: pointer;
            }

            /* Pagination Styles stuck directly below table */
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

            .sneat-pag-btn {
                background-color: #eceef1;
                border: none;
                color: #435971;
                width: 38px;
                height: 38px;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 0.375rem;
                font-size: 13.5px;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .dark .sneat-pag-btn {
                background-color: #323249;
                color: #a3a4cc;
            }

            .sneat-pag-btn:hover {
                background-color: #e1e4e8;
                color: #233446;
            }
            .dark .sneat-pag-btn:hover {
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

        <div className={`table-nav ${selectedClientIds.length > 0 ? 'has-selection' : ''}`}>
          {/* VIEW A: Standard Filters */}
          <div className="nav-default-view flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full gap-4">
            {/* Left Side: Entries Selector + Create Client Button conforming to Sneat placement */}
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
                  <option value={5}>5</option>
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

              {/* Create Client Button */}
              <Link
                to="/add-client"
                className="bg-[#696cff] hover:bg-[#5f61e6] active:bg-[#5f61e6] text-white px-4 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm shadow-[0_2px_4px_0_rgba(105,108,255,0.4)] hover:shadow-[0_4px_8px_0_rgba(105,108,255,0.4)] cursor-pointer whitespace-nowrap ml-2 sm:ml-3 shrink-0"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span>Ajouter</span>
              </Link>

              {/* Import Client Button (XLSX) */}
              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="bg-[#e7e7ff] hover:bg-[#d0d0ff] text-[#696cff] dark:bg-[#34354e] dark:text-[#b1b4ff] px-3.5 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm cursor-pointer whitespace-nowrap shrink-0"
                title="Importer des clients depuis Excel (XLSX / CSV)"
              >
                <Upload size={14} strokeWidth={2.5} />
                <span>Importer</span>
              </button>

              {/* Export Client Button (XLSX) */}
              <button
                type="button"
                onClick={handleExportAllFiltered}
                className="bg-[#f5f5f9] hover:bg-[#ebebed] text-[#566a7f] dark:bg-[#323249] dark:text-[#dbdade] dark:hover:bg-[#3c3d5a] px-3.5 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm cursor-pointer whitespace-nowrap shrink-0"
                title="Exporter les clients filtrés au format Excel (XLSX)"
              >
                <Download size={14} strokeWidth={2.5} />
                <span>Exporter</span>
              </button>

              {/* Vider / Nettoyer Button */}
              <button
                type="button"
                onClick={handleClearAllClients}
                className="bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/20 dark:text-rose-400 dark:hover:bg-rose-950/40 px-3.5 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm cursor-pointer whitespace-nowrap shrink-0 border border-rose-100 dark:border-rose-900/30"
                title="Vider et nettoyer la liste de tous les clients"
              >
                <Trash2 size={14} strokeWidth={2.5} />
                <span>Vider / Nettoyer</span>
              </button>
            </div>

            {/* Right Side Actions Group (Search + Status Filter + Sort) */}
            <div className="flex items-center gap-3 flex-wrap md:flex-nowrap justify-end">
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher client..."
                  className="search-input w-[180px] md:w-[200px] h-[38px]"
                />
              </div>

              {/* Status Dropdown conforming to Sneat list styling with neutral border */}
              <div className="relative text-left min-w-[170px]">
                <button
                  id="client-status-dropdown-btn"
                  type="button"
                  onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                  className="w-full appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none flex items-center justify-between shadow-xs transition-all tracking-wide h-[38px] hover:border-[#696cff] focus:border-[#696cff] active:border-[#696cff]"
                >
                  <span className="truncate">
                    {activeTab === 'all' && 'Tous les clients'}
                    {activeTab === 'debtors' && 'Débiteurs'}
                    {activeTab === 'cleared' && 'Régularisés'}
                    {activeTab === 'double' && 'Compte Mixte'}
                    {activeTab === 'archived' && 'Archivés'}
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
                        Tous les clients ({clientsWithStats.filter((c) => !c.archived).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('debtors');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'debtors' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Débiteurs (
                        {clientsWithStats.filter((c) => c.balance > 0 && !c.archived).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('cleared');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'cleared' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Régularisés (
                        {
                          clientsWithStats.filter(
                            (c) => c.balance <= 0 && c.purchasesCount > 0 && !c.archived
                          ).length
                        }
                        )
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('double');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'double' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Compte Mixte (
                        {clientsWithStats.filter((c) => !!c.linkedPartnerId && !c.archived).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('archived');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'archived' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Archivés ({clientsWithStats.filter((c) => c.archived === true).length})
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* Sort dropdown conforming to Sneat list styling */}
              <div className="relative text-left min-w-[150px]">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none w-full h-[38px] hover:border-[#696cff] focus:border-[#696cff] transition-all"
                >
                  <option value="date">Tri: Récents</option>
                  <option value="debt">Tri: Créance</option>
                  <option value="name">Tri: Nom A-Z</option>
                </select>
                <ChevronDown
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8592a3] pointer-events-none"
                  size={15}
                  strokeWidth={2.2}
                />
              </div>
            </div>
          </div>

          {/* VIEW B: Bulk Actions */}
          <div className="nav-selection-view">
            <button
              className="action-bar-btn flex items-center gap-1.5"
              onClick={() => setSelectedClientIds([])}
            >
              <span>{selectedClientIds.length} sélectionné(s)</span>
              <span className="text-lg leading-none">&times;</span>
            </button>

            {/* Actions Dropdown Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsBulkDropdownOpen(!isBulkDropdownOpen)}
                className="bg-[#696cff] hover:bg-[#5f61e6] text-white px-4 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm shadow-[0_2px_4px_0_rgba(105,108,255,0.4)] cursor-pointer"
              >
                <span>Actions</span>
                <ChevronDown size={14} className="stroke-[2.5]" />
              </button>

              {isBulkDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40 bg-transparent"
                    onClick={() => setIsBulkDropdownOpen(false)}
                  />
                  <div className="absolute top-[110%] left-0 bg-white dark:bg-[#2c2d42] border border-[#d9dee3] dark:border-[#434460]/40 rounded-lg shadow-lg min-w-[210px] z-50 py-1.5 flex flex-col font-sans">
                    <button
                      type="button"
                      onClick={() => {
                        handleBulkExport();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer"
                    >
                      <span>Exporter</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleBulkDuplicate();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer"
                    >
                      <span>Dupliquer</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleBulkArchive(true);
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer"
                    >
                      <span>Archiver</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleBulkArchive(false);
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer"
                    >
                      <span>Désarchiver</span>
                    </button>

                    {/* BORDER DIVISION SEPARATOR */}
                    <div className="border-t border-slate-100 dark:border-[#434460]/40 my-1.5" />

                    <button
                      type="button"
                      onClick={() => {
                        handleBulkPrintStatements();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer"
                    >
                      <span>Relevés client</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleBulkEmail();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer"
                    >
                      <span>Envoyer e-mail</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        handleBulkDelete();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-4 py-2 text-sm font-semibold text-[#ff3e1d] hover:bg-red-50 dark:hover:bg-[#4b2e2e]/30 flex items-center gap-2 cursor-pointer"
                    >
                      <span>Supprimer</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* CLIENT DIRECTORY CONTENT SECTION */}
        <AnimatePresence mode="wait">
          {filteredAndSortedClients.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="py-24 text-center space-y-4 bg-white dark:bg-[#2b2c40]"
            >
              <div className="w-16 h-16 bg-transparent dark:bg-transparent flex items-center justify-center mx-auto text-[#566a7f] dark:text-[#a3afbb] shrink-0">
                <Users size={24} />
              </div>
              <div className="max-w-xs mx-auto space-y-2">
                <h3 className="text-sm font-bold text-[#566a7f] dark:text-[#dbdade] uppercase tracking-widest font-sans">
                  Aucun client trouvé
                </h3>
                <p className="text-[#697a8d] dark:text-[#a3a4cc] text-xs leading-relaxed font-medium">
                  Aucun résultat ne correspond à vos filtres. Essayez de chercher un autre nom ou de
                  réajuster l'onglet actif.
                </p>
              </div>
            </motion.div>
          ) : (
            <div className="overflow-x-auto">
              <table className="sneat-table">
                <thead>
                  <tr>
                    <th className="w-10 px-5 text-center">
                      <input
                        type="checkbox"
                        className="sneat-checkbox"
                        checked={isAllSelected}
                        ref={(input) => {
                          if (input) {
                            input.indeterminate = isSomeSelected;
                          }
                        }}
                        onChange={handleSelectAll}
                      />
                    </th>
                    <th>Client</th>
                    <th>Téléphone</th>
                    <th>Activité</th>
                    <th>Recouvrement</th>
                    <th>Compensations</th>
                    <th className="text-right">Créance</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedClients.map((client, idx) => {
                    const avatar = getAvatarStyle(client.name);
                    const firstInitials = client.name
                      ? client.name
                          .split(' ')
                          .slice(0, 2)
                          .map((n: string) => n[0])
                          .join('')
                      : '?';

                    // Collection progress indicator ratio
                    const pct =
                      client.totalPurchased > 0
                        ? (client.totalPaid / client.totalPurchased) * 100
                        : 0;
                    const clampedPct = Math.min(100, pct);

                    return (
                      <tr
                        key={client.id + "_" + idx}
                        className={selectedClientIds.includes(client.id) ? 'selected' : ''}
                      >
                        {/* CHECKBOX CELL */}
                        <td className="w-10 px-5 text-center" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="sneat-checkbox"
                            checked={selectedClientIds.includes(client.id)}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              if (checked) {
                                setSelectedClientIds((prev) => [...prev, client.id]);
                              } else {
                                setSelectedClientIds((prev) =>
                                  prev.filter((id) => id !== client.id)
                                );
                              }
                            }}
                          />
                        </td>

                        {/* CLIENT CELL */}
                        <td>
                          <div className="flex items-center gap-4">
                            {/* Left Standing Indicator */}
                            <div className="w-1 flex justify-center shrink-0">
                              {client.balance > 0 ? (
                                <div className="w-[3px] h-[32px] bg-[#ffab00] rounded-full" />
                              ) : (
                                <div className="w-[3px] h-[32px] bg-transparent" />
                              )}
                            </div>

                            <div className="flex items-center gap-3">
                              <div
                                className={`w-9 h-9 ${avatar.bg} ${avatar.text} ring-4 ${avatar.ring} rounded-full flex items-center justify-center shrink-0 font-extrabold text-[11px] uppercase transition-transform duration-300 hover:scale-105 shadow-3xs`}
                              >
                                {firstInitials.slice(0, 2)}
                              </div>
                              <div className="min-w-0 flex flex-col text-left">
                                <h4
                                  className="font-bold text-[#696cff] hover:text-[#5f61e6] text-[14px] tracking-tight transition-colors duration-150 cursor-pointer flex items-center gap-1.5"
                                  onClick={() => navigate(`/client/${client.id}`)}
                                >
                                  <span className="truncate max-w-[150px] inline-block font-sans font-semibold text-[#696cff]">
                                    {client.name.toUpperCase()}
                                  </span>
                                  <ChevronRight size={14} className="text-[#8592a3] shrink-0" />
                                </h4>
                                <span className="text-[10px] text-[#8592a3] dark:text-[#707194] font-mono leading-none mt-0.5">
                                  #{client.id.slice(0, 8).toUpperCase()}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* PHONE CELL */}
                        <td>
                          {client.phone ? (
                            <div className="flex items-center gap-2">
                              <span className="text-[14px] text-[#566a7f] dark:text-[#dbdade] font-semibold font-mono">
                                {client.phone}
                              </span>
                              {isWhatsAppEligiblePhone(client.phone) && (
                                <div className="flex gap-1 items-center">
                                  <button
                                    onClick={() => handleWhatsAppRelance(client.phone, client.name, client.balance)}
                                    className="p-1 text-[#4fb922] dark:text-[#71dd37] hover:bg-[#71dd37]/10 rounded transition-colors shrink-0 cursor-pointer"
                                    title="WhatsApp Relance (OpenWA)"
                                  >
                                    <MessageSquare size={14} strokeWidth={2.5} />
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-[#a1acb8] dark:text-[#a3afbb]/60 italic font-normal opacity-70">
                              Non renseigné
                            </span>
                          )}
                        </td>

                        {/* ACTIVITY CELL */}
                        <td>
                          <div className="flex flex-col text-left">
                            <span className="text-[13px] text-[#566a7f] dark:text-[#dbdade] font-bold">
                              {client.purchasesCount}{' '}
                              {client.purchasesCount > 1 ? 'commandes' : 'commande'}
                            </span>
                            <span className="text-[11px] text-[#8592a3] dark:text-[#707194] font-mono font-bold uppercase">
                              CA:{' '}
                              <span className="text-[#566a7f] dark:text-[#dbdade]">
                                {client.totalPurchased.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                DH
                              </span>
                            </span>
                          </div>
                        </td>

                        {/* RECOVERY PROGRESS CELL */}
                        <td>
                          {client.totalPurchased > 0 ? (
                            <div className="flex flex-col text-left min-w-[130px] max-w-[180px] space-y-1">
                              <div className="flex justify-between items-center text-[11px] font-mono font-bold text-[#8592a3] dark:text-[#a3afbb]">
                                <span>{clampedPct.toFixed(0)}% reçu</span>
                                <span className="text-[#566a7f] dark:text-[#dbdade]">
                                  {client.totalPaid.toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  DH
                                </span>
                              </div>
                              <div className="w-full bg-[#f5f5f9] dark:bg-[#232333]/50 rounded-full h-1.5 overflow-hidden">
                                <motion.div
                                  initial={{ width: 0 }}
                                  animate={{ width: `${clampedPct}%` }}
                                  className={`h-full rounded-full transition-all duration-500 ${clampedPct === 100 ? 'bg-[#71dd37]' : 'bg-[#696cff]'}`}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center">
                              <span className="text-[11px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider">
                                Aucune commande
                              </span>
                            </div>
                          )}
                        </td>

                        {/* COMPENSATIONS CELL */}
                        <td>
                          {client.hasSupplierAccount ? (
                            <div className="flex flex-col items-start justify-start text-left gap-1">
                              <span className="inline-flex items-center gap-1.5 text-orange-400 dark:text-orange-300 px-0 py-0 rounded text-[12px] font-bold tracking-wider select-none">
                                <Scale size={11} strokeWidth={2.5} />
                                <span>Mixte</span>
                              </span>
                              <div className="text-[11px] font-mono text-[#8592a3] dark:text-[#a3afbb] font-bold">
                                <span>Net: </span>
                                <span
                                  className={
                                    client.netCompensation >= 0
                                      ? 'text-[#71dd37]'
                                      : 'text-[#ff3e1d]'
                                  }
                                >
                                  {client.netCompensation >= 0 ? '+' : ''}
                                  {client.netCompensation.toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  DH
                                </span>
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-[#8592a3] dark:text-[rgb(112,113,148)] uppercase tracking-widest font-bold">
                              Simple
                            </span>
                          )}
                        </td>

                        {/* CURRENT BALANCE CELL */}
                        <td className="text-right">
                          <div className="flex flex-col items-end gap-1">
                            <span
                              className={`inline-block font-mono font-bold text-[15px] tracking-tight ${client.balance > 0 ? 'text-[#ffab00]' : 'text-[#71dd37]'}`}
                              title="Dette Client (Restant dû)"
                            >
                              {client.balance.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                              <span className="text-[11px] font-sans font-extrabold ml-1">DH</span>
                            </span>
                            {(client.creditClient || 0) > 0 && (
                              <span 
                                className="inline-block font-mono font-bold text-[11px] text-emerald-500 bg-emerald-50 px-1.5 py-0.5 rounded"
                                title="Crédit Client Disponible (Avoirs)"
                              >
                                + {client.creditClient.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })} DH (Crédit)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* ACTIONS CELL */}
                        <td className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              to={`/add-purchase?clientId=${client.id}`}
                              className="p-1.5 text-[#8592a3] hover:text-[#696cff] dark:text-[#a3afbb] dark:hover:text-[#b1b4ff] hover:bg-[#696cff]/10 rounded transition-colors"
                              title="Nouvelle Vente"
                            >
                              <Plus size={16} strokeWidth={2.5} />
                            </Link>

                            <Link
                              to={`/client/${client.id}`}
                              className="p-1.5 text-[#8592a3] hover:text-[#696cff] dark:text-[#a3afbb] dark:hover:text-[#b1b4ff] hover:bg-[#f5f5f9] dark:hover:bg-[#232333] rounded transition-colors"
                              title="Détails"
                            >
                              <Eye size={16} strokeWidth={2.5} />
                            </Link>

                            <Link
                              to={`/edit-client/${client.id}`}
                              className="p-1.5 text-[#8592a3] hover:text-[#696cff] dark:text-[#a3afbb] dark:hover:text-[#b1b4ff] hover:bg-[#696cff]/10 rounded transition-colors"
                              title="Modifier"
                            >
                              <Pencil size={16} strokeWidth={2.5} />
                            </Link>

                            <button
                              onClick={() => {
                                confirm({
                                  title: 'Supprimer ?',
                                  onConfirm: async () => {
                                    try {
                                      const batch = writeBatch(db);
                                      const purchasesSnap = await getDocs(
                                        query(
                                          collection(db, 'clients', client.id, 'purchases'),
                                          where('ownerId', '==', user.uid)
                                        )
                                      );
                                      purchasesSnap.forEach((doc) => batch.delete(doc.ref));
                                      const paymentsSnap = await getDocs(
                                        query(
                                          collection(db, 'clients', client.id, 'payments'),
                                          where('ownerId', '==', user.uid)
                                        )
                                      );
                                      paymentsSnap.forEach((doc) => batch.delete(doc.ref));
                                      if (client.linkedPartnerId) {
                                        batch.update(doc(db, 'suppliers', client.linkedPartnerId), {
                                          linkedPartnerId: null,
                                        });
                                      }
                                      batch.delete(doc(db, 'clients', client.id));
                                      await batch.commit();
                                      showToast('Supprimé.');
                                    } catch (err) {
                                      showToast('Erreur', 'error');
                                    }
                                  },
                                });
                              }}
                              className="p-1.5 text-[#8592a3] hover:text-[#ff3e1d] dark:text-[#a3afbb] dark:hover:text-[#ff3e1d] hover:bg-[#ff3e1d]/10 rounded transition-colors shrink-0 cursor-pointer"
                              title="Supprimer"
                            >
                              <Trash2 size={16} strokeWidth={2.5} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AnimatePresence>

        {/* PAGINATION CONTROLS */}
        {filteredAndSortedClients.length > 0 && (
          <div className="sneat-pagination-bar">
            <div className="flex items-center gap-2 text-xs text-[#566a7f] dark:text-[#a3afbb] whitespace-nowrap">
              <span>Afficher</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="bg-[#f5f5f9] dark:bg-[#232333]/50 border border-[#dbdade]/50 dark:border-[#434460]/20 rounded py-1 px-2.5 text-xs font-semibold text-[#697a8d] dark:text-[#a3afbb] focus:ring-1 focus:ring-[#696cff] cursor-pointer outline-none"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
              <span>lignes par page</span>
            </div>

            <div className="text-xs font-medium text-[#566a7f] dark:text-[#a3afbb]">
              <span>
                Affichage de{' '}
                <span className="font-bold text-[#222222] dark:text-[#dbdade]">{entryStart}</span> à{' '}
                <span className="font-bold text-[#222222] dark:text-[#dbdade]">{entryEnd}</span> sur{' '}
                <span className="font-bold text-[#222222] dark:text-[#dbdade]">{totalEntries}</span>{' '}
                clients
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="sneat-pag-btn w-8 h-8 flex items-center justify-center p-0"
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
                    className={`sneat-pag-btn w-8 h-8 p-0 ${currentPage === page ? 'active' : ''}`}
                  >
                    {page}
                  </button>
                );
              })}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="sneat-pag-btn w-8 h-8 flex items-center justify-center p-0"
                title="Suivant"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* XLSX Import Modal */}
      <ClientXlsxModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        existingClients={clients}
        ownerId={user?.uid || ''}
        showToast={showToast}
      />
    </div>
  );
}

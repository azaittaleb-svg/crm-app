import { useEffect, useState, FormEvent, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  doc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
  writeBatch,
  getDocs,
  where,
  deleteField,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useNotification } from '../context/NotificationContext';
import { CustomerService } from '../services/customer.service';
import { useAuth } from '../context/AuthContext';
import {
  Plus,
  Trash2,
  Calendar,
  ArrowLeft,
  CheckCircle2,
  Edit2,
  Link2,
  Unlink,
  X,
  Phone,
  MessageSquare,
  Copy,
  Search,
  Eye,
  AlertCircle,
  Package,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { updateDoc } from 'firebase/firestore';

export default function ClientDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const [client, setClient] = useState<any | null>(null);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [creditNotes, setCreditNotes] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'clean'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'total-desc' | 'total-asc'>(
    'date-desc'
  );
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [linkedSupplierPurchases, setLinkedSupplierPurchases] = useState<any[]>([]);
  const [isLinking, setIsLinking] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkDropdown, setShowLinkDropdown] = useState(false);
  const [isCreatingSupplier, setIsCreatingSupplier] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterType, searchQuery, sortBy]);

  const [hoveredPurchase, setHoveredPurchase] = useState<any | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ top: number; left: number } | null>(null);
  const hoverTimerRef = useRef<any>(null);

  useEffect(() => {
    const handleScroll = () => {
      setHoveredPurchase(null);
      setHoverCoords(null);
    };
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  // Modals / Sections
  const [isAddingPurchase, setIsAddingPurchase] = useState(false);

  // Forms
  const [purchaseForm, setPurchaseForm] = useState({
    description: '',
    price: '',
    quantity: '1',
    status: 'paid' as 'paid' | 'credit',
    advance: '0',
    dueDate: '',
  });

  useEffect(() => {
    const handleOpenAddPurchase = () => {
      setIsAddingPurchase(true);
    };
    window.addEventListener('open-add-purchase', handleOpenAddPurchase);
    return () => {
      window.removeEventListener('open-add-purchase', handleOpenAddPurchase);
    };
  }, []);

  useEffect(() => {
    if (!id || !user) return;

    setLoading(true);
    const unsubClient = onSnapshot(
      doc(db, 'clients', id),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.ownerId === user.uid) {
            setClient({ id: snap.id, ...data });
          } else {
            showToast('Accès non autorisé', 'error');
            navigate('/clients');
          }
        } else {
          setClient(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );

    const qPurchases = query(
      collection(db, 'clients', id, 'purchases'),
      where('ownerId', '==', user.uid),
      orderBy('date', 'desc')
    );
    const unsubPurchases = onSnapshot(
      qPurchases,
      (snap) => {
        setPurchases(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `clients/${id}/purchases`)
    );

    const qCreditNotes = query(
      collection(db, 'clients', id, 'credit_notes'),
      where('ownerId', '==', user.uid)
    );
    const unsubCreditNotes = onSnapshot(
      qCreditNotes,
      (snap) => {
        setCreditNotes(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `clients/${id}/credit_notes`)
    );

    return () => {
      unsubClient();
      unsubPurchases();
      unsubCreditNotes();
    };
  }, [id, user]);

  useEffect(() => {
    if (!user) return;
    const qSuppliers = query(collection(db, 'suppliers'), where('ownerId', '==', user.uid));
    const unsub = onSnapshot(qSuppliers, (snap) => {
      setSuppliers(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!client?.linkedPartnerId || !user) {
      setLinkedSupplierPurchases([]);
      return;
    }

    const q = query(
      collection(db, 'suppliers', client.linkedPartnerId, 'purchases'),
      where('ownerId', '==', user.uid)
    );

    return onSnapshot(q, (snap) => {
      setLinkedSupplierPurchases(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
  }, [client?.linkedPartnerId, user]);

  const stats = useMemo(() => {
    const validPurchases = purchases.filter((p) => p.type !== 'devis' && p.status !== 'Annulée');
    
    // Leverage the new enterprise calculation from CustomerService
    const csStats = CustomerService.calculateCustomerStats(validPurchases, creditNotes);
    
    const totalVentes = csStats.totalSales;
    const totalPaidOnPurchases = csStats.totalPaid;
    const clientBalance = csStats.detteClient;
    const creditDispo = csStats.creditClient;

    // Supplier balance (what we owe them)
    const validSupplierPurchases = linkedSupplierPurchases.filter(
      (p) => p.type !== 'devis' && p.status !== 'Annulée'
    );
    const totalSupplierPurchases = validSupplierPurchases.reduce(
      (acc, p) => acc + (Number(p.total) || 0),
      0
    );
    const totalPaidToSupplier = validSupplierPurchases.reduce(
      (acc, p) =>
        acc +
        (p.amountPaid !== undefined
          ? Number(p.amountPaid) || 0
          : p.paymentStatus === 'paid'
            ? Number(p.total) || 0
            : 0),
      0
    );
    const supplierDette = totalSupplierPurchases - totalPaidToSupplier;

    // Consolidated: what client owes us - what we owe them
    // Note: If they have available credit, we could optionally deduct it from their debt.
    // However, the requested logic is that "Dette" and "Credit" are separate. 
    // For net consolidated we take Dette - Credit - Supplier Dette
    const consolidatedBalance = clientBalance - creditDispo - supplierDette;

    // Advanced statistics
    const transactionCount = validPurchases.length;
    const averageValue = transactionCount > 0 ? totalVentes / transactionCount : 0;

    // Sort chronological helper
    const sortedPurchases = [...validPurchases].sort((a, b) => {
      const dA = a.date?.toDate() || new Date(0);
      const dB = b.date?.toDate() || new Date(0);
      return dA.getTime() - dB.getTime();
    });

    const lastTransaction = sortedPurchases[sortedPurchases.length - 1];
    const lastTransactionDate = lastTransaction?.date?.toDate() || null;

    const creditPurchases = sortedPurchases.filter((p) => {
      const pTotal = Number(p.total) || 0;
      const pPaid =
        p.amountPaid !== undefined
          ? Number(p.amountPaid) || 0
          : p.paymentStatus === 'paid'
            ? pTotal
            : 0;
      const explicit = Number((p as any).creditNotesTotal || 0);
      return pTotal - pPaid - explicit > 0.05;
    });
    const oldestPendingDate = creditPurchases[0]?.date?.toDate() || null;

    return {
      totalVentes,
      totalPaid: totalPaidOnPurchases,
      balance: clientBalance,
      creditDispo,
      supplierDette,
      consolidatedBalance,
      transactionCount,
      averageValue,
      lastTransactionDate,
      oldestPendingDate,
    };
  }, [purchases, creditNotes, linkedSupplierPurchases]);

  const copyReportToClipboard = () => {
    if (!client) return;
    const dateStr = new Date().toLocaleDateString('fr-FR');
    const reportText = `📋 *RELEVÉ DE COMPTE CLIENT* 📋
Date: ${dateStr}
Client: ${client.name.toUpperCase()}

━━━━━━━━━━━━━━━━━━━
💰 Volume Ventes: ${stats.totalVentes.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
✅ Total Réglé: ${stats.totalPaid.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
⚠️ Solde dû (Crédit): ${stats.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
━━━━━━━━━━━━━━━━━━━

*Merci pour votre fidélité !*
شکرا على ثقتكم بنا`;

    navigator.clipboard.writeText(reportText);
    showToast('Le rapport de compte a été copié dans le presse-papiers !', 'success');
  };

  useEffect(() => {
    const handleCopyReport = () => {
      copyReportToClipboard();
    };
    window.addEventListener('copy-client-report', handleCopyReport);
    return () => {
      window.removeEventListener('copy-client-report', handleCopyReport);
    };
  }, [client, stats, purchases]);

  const handleLinkPartner = async (partnerId: string) => {
    if (!id) return;
    try {
      setIsLinking(true);
      const batch = writeBatch(db);

      const clientRef = doc(db, 'clients', id);
      batch.update(clientRef, { linkedPartnerId: partnerId });

      // Also link the supplier back to the client for bidirectional sync
      const supplierRef = doc(db, 'suppliers', partnerId);
      batch.update(supplierRef, { linkedPartnerId: id });

      await batch.commit();

      showToast('Partenaire lié avec succès');
      setIsLinking(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `clients/${id} + suppliers/${partnerId}`);
      setIsLinking(false);
    }
  };

  const handleUnlinkPartner = async () => {
    if (!id || !client?.linkedPartnerId) return;
    try {
      const partnerId = client.linkedPartnerId;
      const clientRef = doc(db, 'clients', id);
      await updateDoc(clientRef, { linkedPartnerId: null });

      const supplierRef = doc(db, 'suppliers', partnerId);
      await updateDoc(supplierRef, { linkedPartnerId: null });

      showToast('Lien supprimé');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `clients/${id} + suppliers/${client.linkedPartnerId}`
      );
    }
  };

  const handleCreateSupplier = async () => {
    if (!client || !user) return;
    try {
      setIsCreatingSupplier(true);
      const supplierData = {
        name: client.name,
        phone: client.phone || '',
        email: client.email || '',
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        linkedPartnerId: id, // Link back to this client
      };

      const docRef = await addDoc(collection(db, 'suppliers'), supplierData);

      // Update this client to link to the new supplier
      await updateDoc(doc(db, 'clients', id!), { linkedPartnerId: docRef.id });

      showToast('Fournisseur créé et lié avec succès');
      setIsCreatingSupplier(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'suppliers creation + client link');
      setIsCreatingSupplier(false);
    }
  };

  const matchingSupplier = useMemo(() => {
    if (!client || client.linkedPartnerId) return null;
    return suppliers.find((s) => s.name.toLowerCase() === client.name.toLowerCase());
  }, [client, suppliers]);

  const filteredSuppliers = useMemo(() => {
    return suppliers
      .filter((s) => !s.linkedPartnerId || s.linkedPartnerId === id)
      .filter((s) => s.name.toLowerCase().includes(linkSearch.toLowerCase()))
      .slice(0, 5);
  }, [suppliers, linkSearch, id]);

  const filteredPurchases = useMemo(() => {
    let result = purchases.filter((p) => {
      if (filterType === 'credit') return p.paymentStatus === 'credit';
      if (filterType === 'clean') return p.paymentStatus === 'paid';
      return true;
    });

    if (searchQuery.trim() !== '') {
      const qLower = searchQuery.toLowerCase();
      result = result.filter(
        (p) => p.description?.toLowerCase().includes(qLower) || p.id?.toLowerCase().includes(qLower)
      );
    }

    result.sort((a, b) => {
      const dateA = a.date?.toDate() || new Date(0);
      const dateB = b.date?.toDate() || new Date(0);
      const totalA = Number(a.total) || 0;
      const totalB = Number(b.total) || 0;

      if (sortBy === 'date-desc') return dateB.getTime() - dateA.getTime();
      if (sortBy === 'date-asc') return dateA.getTime() - dateB.getTime();
      if (sortBy === 'total-desc') return totalB - totalA;
      if (sortBy === 'total-asc') return totalA - totalB;
      return 0;
    });

    return result;
  }, [purchases, filterType, searchQuery, sortBy]);

  const paginatedPurchases = useMemo(() => {
    const startIndex = (currentPage - 1) * 10;
    return filteredPurchases.slice(startIndex, startIndex + 10);
  }, [filteredPurchases, currentPage]);

  const totalPages = Math.ceil(filteredPurchases.length / 10);

  const handleAddPurchase = async (e: FormEvent) => {
    e.preventDefault();
    if (!id) return;
    const total = Number(purchaseForm.price) * Number(purchaseForm.quantity);
    const finalAmountPaid = purchaseForm.status === 'paid' ? total : Number(purchaseForm.advance);
    const finalStatus = finalAmountPaid >= total ? 'paid' : purchaseForm.status;

    try {
      if (!user) return;
      await addDoc(collection(db, 'clients', id, 'purchases'), {
        ownerId: user.uid,
        clientId: id,
        description: purchaseForm.description,
        price: Number(purchaseForm.price),
        quantity: Number(purchaseForm.quantity),
        total,
        paymentStatus: finalStatus,
        amountPaid: finalAmountPaid,
        date: serverTimestamp(),
        dueDate:
          finalStatus === 'credit' && purchaseForm.dueDate
            ? Timestamp.fromDate(new Date(purchaseForm.dueDate))
            : null,
      });
      setIsAddingPurchase(false);
      setPurchaseForm({
        description: '',
        price: '',
        quantity: '1',
        status: 'paid',
        advance: '0',
        dueDate: '',
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleWhatsAppReminder = (phone: string, name: string, balance: number) => {
    let cleanPhone = phone.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    if (
      cleanPhone.startsWith('05') ||
      cleanPhone.startsWith('08') ||
      cleanPhone.startsWith('+2125') ||
      cleanPhone.startsWith('+2128') ||
      cleanPhone.startsWith('2125') ||
      cleanPhone.startsWith('2128') ||
      cleanPhone.startsWith('002125') ||
      cleanPhone.startsWith('002128')
    ) {
      showToast('Ce numéro est une ligne fixe ou numéro spécial (05... / 08... / 002128...), impossible d\'envoyer par WhatsApp.', 'error');
      return;
    }
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
        if (result.success) showToast('Relance WhatsApp envoyée avec succès.', 'success');
        else showToast('Erreur WhatsApp: ' + result.error, 'error');
      });
    });
  };

  if (loading)
    return (
      <div className="h-full flex items-center justify-center py-20">
        <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (!client)
    return <div className="p-20 text-center font-bold text-slate-500">Client non trouvé</div>;

  return (
    <>
      <div
        id="client-details-container"
        className="flex flex-col gap-6 py-4 animate-in fade-in duration-300"
      >
        {/* 2. HIGH-IMPACT COMPACT KPI CARDS DECK (Row of 5 Cards) */}
        <div id="kpi-cards-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
          {/* KPI 1: Volume d'affaires */}
          <div
            id="kpi-card-ca"
            className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 rounded-xl p-5 flex flex-col justify-between h-[120px] shadow-[0_2px_12px_rgba(15,23,42,0.03)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Volume d'affaires
              </span>
              <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-500 shrink-0">
                <Package size={16} />
              </div>
            </div>
            <div>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono tracking-tight">
                {stats.totalVentes.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                <span className="text-[10px] font-sans font-bold text-slate-400">DH</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {stats.transactionCount} ventes validées
              </p>
            </div>
          </div>

          {/* KPI 2: Encaissé */}
          <div
            id="kpi-card-encaisse"
            className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 rounded-xl p-5 flex flex-col justify-between h-[120px] shadow-[0_2px_12px_rgba(15,23,42,0.03)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Total Réglé
              </span>
              <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-500 shrink-0">
                <CheckCircle2 size={16} />
              </div>
            </div>
            <div>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono tracking-tight">
                {stats.totalPaid.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                <span className="text-[10px] font-sans font-bold text-slate-400">DH</span>
              </p>
              <p className="text-[11px] text-emerald-600 mt-0.5 font-semibold">
                {stats.totalVentes > 0
                  ? ((stats.totalPaid / stats.totalVentes) * 100).toFixed(1)
                  : 100}
                % d'encaissement
              </p>
            </div>
          </div>

          {/* KPI 3: Dette Client */}
          <div
            id="kpi-card-credit"
            className={`bg-white dark:bg-[#2b2c40] border rounded-xl p-5 flex flex-col justify-between h-[120px] shadow-[0_2px_12px_rgba(15,23,42,0.03)] transition-colors ${stats.balance > 0 ? 'border-orange-200/60 bg-orange-50/5' : 'border-slate-200/60'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Dette Client
              </span>
              <div
                className={`p-1.5 rounded-lg shrink-0 ${stats.balance > 0 ? 'bg-orange-50 text-orange-500' : 'bg-slate-50 text-slate-400'}`}
              >
                <AlertCircle size={16} />
              </div>
            </div>
            <div>
              <p
                className={`text-xl font-bold font-mono tracking-tight ${stats.balance > 0 ? 'text-[#ffab00]' : 'text-[#71dd37]'}`}
              >
                {stats.balance.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                <span className="text-[10px] font-sans font-bold text-slate-400">DH</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                {stats.balance > 0 ? 'Créance non soldée' : 'Compte parfaitement à jour'}
              </p>
            </div>
          </div>

          {/* KPI 3.5: Crédit Client */}
          <div
            id="kpi-card-credit-client"
            className={`bg-white dark:bg-[#2b2c40] border rounded-xl p-5 flex flex-col justify-between h-[120px] shadow-[0_2px_12px_rgba(15,23,42,0.03)] transition-colors ${stats.creditDispo > 0 ? 'border-emerald-200/60 bg-emerald-50/5' : 'border-slate-200/60'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Crédit Client
              </span>
              <div
                className={`p-1.5 rounded-lg shrink-0 ${stats.creditDispo > 0 ? 'bg-emerald-50 text-emerald-500' : 'bg-slate-50 text-slate-400'}`}
              >
                <Plus size={16} />
              </div>
            </div>
            <div>
              <p
                className={`text-xl font-bold font-mono tracking-tight ${stats.creditDispo > 0 ? 'text-emerald-500' : 'text-[#71dd37]'}`}
              >
                {stats.creditDispo.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                <span className="text-[10px] font-sans font-bold text-slate-400">DH</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                {stats.creditDispo > 0 ? 'Disponible (Avoirs)' : 'Aucun crédit disponible'}
              </p>
            </div>
          </div>

          {/* KPI 4: Activité */}
          <div
            id="kpi-card-activity"
            className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 rounded-xl p-5 flex flex-col justify-between h-[120px] shadow-[0_2px_12px_rgba(15,23,42,0.03)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Dernière activité
              </span>
              <div className="p-1.5 rounded-lg bg-blue-50 text-blue-500 shrink-0">
                <Calendar size={16} />
              </div>
            </div>
            <div>
              <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200 capitalize truncate">
                {stats.lastTransactionDate
                  ? stats.lastTransactionDate.toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                  : 'Aucune transaction'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-widest font-mono">
                {stats.oldestPendingDate
                  ? `Crédit d'ancienneté : ${stats.oldestPendingDate.toLocaleDateString('fr-FR', { month: 'short' })}`
                  : 'Aucun impayé'}
              </p>
            </div>
          </div>
        </div>

        {/* 3. WORKSPACE: LEDGER & PROFILE DETAILED SPLIT */}
        <div
          id="details-workspace-grid"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          {/* LEFT SIDE: TRANSACTIONS CARD & TABLE (Unified Card) (8 cols) */}
          <div
            id="ledger-section"
            className="lg:col-span-8 bg-white dark:bg-[#2b2c40] border border-slate-200/60 rounded-xl shadow-[0_2px_12px_rgba(15,23,42,0.02)] overflow-hidden"
          >
            {/* Table Header Controls */}
            <div
              id="ledger-header"
              className="p-5 border-b border-slate-100 dark:border-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div>
                <h3
                  id="ledger-title"
                  className="text-sm font-bold text-slate-800 dark:text-slate-100"
                >
                  Journal des ventes
                </h3>
                <p id="ledger-desc" className="text-xs text-slate-400 mt-0.5">
                  Historique des transactions et factures du client
                </p>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                {/* Search query input */}
                <div className="relative">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    type="text"
                    placeholder="Rechercher une vente..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full sm:w-48 bg-slate-50 border border-slate-200/60 rounded-lg pl-9 pr-8 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-[#696cff] transition-colors"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>

                {/* Filter Selector tabs */}
                <div className="flex gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200/60">
                  <button
                    onClick={() => setFilterType('all')}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${filterType === 'all' ? 'bg-white text-[#696cff] shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Toutes
                  </button>
                  <button
                    onClick={() => setFilterType('credit')}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${filterType === 'credit' ? 'bg-white text-orange-500 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Crédits
                  </button>
                  <button
                    onClick={() => setFilterType('clean')}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${filterType === 'clean' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                  >
                    Cash
                  </button>
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table id="transactions-table" className="w-full text-left border-collapse">
                <thead className="bg-slate-50/70 dark:bg-slate-800/40 border-b border-slate-200/60 text-[10px] uppercase tracking-wider font-extrabold text-slate-500 select-none">
                  <tr>
                    <th className="py-3 px-5">Opération & Date</th>
                    <th className="py-3 px-5 text-center">Qté</th>
                    <th className="py-3 px-5 text-center">Statut</th>
                    <th className="py-3 px-5 text-right">Montant Total</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40 text-xs">
                  {filteredPurchases.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-16 text-center text-slate-400">
                        <div className="w-10 h-10 bg-transparent flex items-center justify-center mx-auto mb-2 text-slate-300">
                          <Search size={22} />
                        </div>
                        <p className="font-bold uppercase tracking-wider text-[10px] font-mono">
                          Aucun enregistrement trouvé
                        </p>
                      </td>
                    </tr>
                  ) : (
                    paginatedPurchases.map((p, index) => {
                      const debt = Math.max(0, (Number(p.total) || 0) - (Number(p.amountPaid) || 0) - (Number(p.creditNotesTotal) || 0));
                      return (
                        <tr
                          key={`${p.id}-${index}`}
                          onClick={() => navigate(`/purchase/${id}/${p.id}`)}
                          onMouseEnter={(e) => {
                            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                            const rect = e.currentTarget.getBoundingClientRect();
                            const viewportHeight = window.innerHeight;
                            const viewportWidth = window.innerWidth;
                            const estimateHeight = 240; // estimation of popup height
                            const estimateWidth = 440;

                            // Check if showing below overflows window bottom
                            const showAbove = rect.bottom + 6 + estimateHeight > viewportHeight;
                            const top = showAbove ? rect.top - estimateHeight - 6 : rect.bottom + 6;

                            // Check horizontal offset
                            let left = rect.left + 20;
                            if (left + estimateWidth > viewportWidth) {
                              left = Math.max(10, viewportWidth - estimateWidth - 10);
                            }

                            hoverTimerRef.current = setTimeout(() => {
                              setHoveredPurchase(p);
                              setHoverCoords({ top, left });
                            }, 300);
                          }}
                          onMouseLeave={() => {
                            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
                            setHoveredPurchase(null);
                            setHoverCoords(null);
                          }}
                          className="group hover:bg-slate-50/60 dark:hover:bg-slate-800/20 cursor-pointer transition-colors"
                        >
                          {/* Col 1: Operation Details */}
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${debt > 0 ? 'text-orange-500 bg-orange-50/30' : 'text-emerald-500 bg-emerald-50/30'}`}
                              >
                                <Calendar size={14} />
                              </div>
                              <div>
                                <p className="font-bold text-slate-700 dark:text-slate-300 group-hover:text-[#696cff] transition-colors leading-snug font-mono text-[13px]">
                                  {p.refId || `FAC-${p.id.substring(0, 8).toUpperCase()}`}
                                </p>
                                <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                                  {p.date
                                    ?.toDate()
                                    .toLocaleDateString('fr-FR', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    })}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Col 2: Quantity */}
                          <td className="py-3 px-5 text-center font-mono font-bold text-slate-500">
                            {p.quantity}{' '}
                            <span className="text-[10px] font-sans font-medium text-slate-400">
                              U.
                            </span>
                          </td>

                          {/* Col 3: Statut (GHOST BADGES: NO BACKGROUND COLOR) */}
                          <td className="py-3 px-5 text-center">
                            {debt <= 0 ? (
                              <span className="text-[#71dd37] font-bold text-xs uppercase tracking-wider">
                                Payé
                              </span>
                            ) : (
                              <span className="text-[#ffab00] font-bold text-xs uppercase tracking-wider">
                                Crédit
                              </span>
                            )}
                          </td>

                          {/* Col 4: Total & Remaining Debt */}
                          <td className="py-3 px-5 text-right">
                            <p className="font-bold text-slate-700 dark:text-slate-300 font-mono">
                              {Number(p.total).toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              <span className="text-[10px] font-sans font-medium text-slate-400">
                                DH
                              </span>
                            </p>
                            {debt > 0 && (
                              <p className="text-[10px] font-bold text-rose-500 font-mono mt-0.5">
                                Reste:{' '}
                                {debt.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{' '}
                                DH
                              </p>
                            )}
                          </td>

                          {/* Col 5: Row Actions */}
                          <td className="py-3 px-5 text-right">
                            <div
                              className="flex items-center justify-end gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => navigate(`/purchase/${id}/${p.id}`)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                                title="Voir"
                              >
                                <Eye size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/edit-purchase/${id}/${p.id}`)}
                                className="p-1.5 text-slate-400 hover:text-[#696cff] hover:bg-indigo-50/50 rounded-md transition-colors"
                                title="Modifier"
                              >
                                <Edit2 size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  confirm({
                                    title: 'Confirmer la suppression ?',
                                    onConfirm: async () => {
                                      if (!id || !p.id) return;
                                      try {
                                        const batch = writeBatch(db);
                                        const paymentsSnap = await getDocs(
                                          query(
                                            collection(db, 'clients', id, 'payments'),
                                            where('ownerId', '==', user.uid),
                                            where('purchaseId', '==', p.id)
                                          )
                                        );
                                        paymentsSnap.forEach((d) => batch.delete(d.ref));
                                        batch.delete(doc(db, 'clients', id, 'purchases', p.id));
                                        if (p.parent_id) {
                                          batch.update(doc(db, 'clients', id, 'purchases', p.parent_id), { child_id: deleteField() });
                                        }
                                        await batch.commit();
                                        showToast('Vente supprimée avec succès.');
                                      } catch (err) {
                                        handleFirestoreError(
                                          err,
                                          OperationType.WRITE,
                                          `clients/${id}/purchases/${p.id}`
                                        );
                                      }
                                    },
                                  });
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50/55 rounded-md transition-colors"
                                title="Supprimer"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800/40 p-4 bg-slate-50/30">
                <span className="text-xs text-slate-400">
                  Affichage de{' '}
                  <span className="font-semibold text-slate-600">{(currentPage - 1) * 10 + 1}</span>{' '}
                  à{' '}
                  <span className="font-semibold text-slate-600">
                    {Math.min(currentPage * 10, filteredPurchases.length)}
                  </span>{' '}
                  sur{' '}
                  <span className="font-semibold text-slate-600">{filteredPurchases.length}</span>{' '}
                  achats
                </span>
                <div className="flex items-center gap-1">
                  <button
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    className="p-1 px-2 border border-slate-200/60 rounded text-xs bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    Précédent
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => {
                    if (
                      pageNum === 1 ||
                      pageNum === totalPages ||
                      Math.abs(pageNum - currentPage) <= 1
                    ) {
                      return (
                        <button
                          key={pageNum}
                          onClick={() => setCurrentPage(pageNum)}
                          className={`p-1 px-2.5 border rounded text-xs transition-colors cursor-pointer ${
                            currentPage === pageNum
                              ? 'bg-[#696cff] text-white border-[#696cff]'
                              : 'bg-white border-slate-200/60 text-slate-600 hover:bg-slate-50'
                          }`}
                        >
                          {pageNum}
                        </button>
                      );
                    }
                    if (pageNum === 2 && currentPage > 3) {
                      return (
                        <span key="dots-prev" className="px-1 text-slate-400 text-xs">
                          ...
                        </span>
                      );
                    }
                    if (pageNum === totalPages - 1 && currentPage < totalPages - 2) {
                      return (
                        <span key="dots-next" className="px-1 text-slate-400 text-xs">
                          ...
                        </span>
                      );
                    }
                    return null;
                  })}
                  <button
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    className="p-1 px-2 border border-slate-200/60 rounded text-xs bg-white text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    Suivant
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* RIGHT SIDE: PROFILE & COUPLING CARDS (4 cols) */}
          <div id="profile-sidebar-section" className="lg:col-span-4 flex flex-col gap-6">
            {/* Fiche Client Profile */}
            <div
              id="client-info-card"
              className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 rounded-xl p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-11 h-11 bg-slate-100 flex items-center justify-center text-[#696cff] rounded-lg font-bold text-base uppercase shrink-0">
                      {client.name.substring(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <h3
                        id="client-name-details"
                        className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight capitalize truncate"
                      >
                        {client.name}
                      </h3>
                      <p
                        id="client-city-details"
                        className="text-[11px] text-slate-400 mt-0.5 truncate"
                      >
                        {client.city || 'Pas de ville spécifiée'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3.5 pt-4 border-t border-slate-100 dark:border-slate-800/40">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Téléphone :</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">
                      {client.phone || 'Non renseigné'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Email :</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 font-mono truncate max-w-[150px]">
                      {client.email || 'Non renseigné'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">N° ICE :</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">
                      {client.ice || 'Non renseigné'}
                    </span>
                  </div>
                  {client.addressLine1 && (
                    <div className="text-xs space-y-1">
                      <span className="text-slate-400 block">Adresse de facturation :</span>
                      <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-medium bg-slate-50/50 p-2 rounded-lg border border-slate-100">
                        {client.addressLine1} {client.addressLine2}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Compte Mixte Linkage Card */}
            <div
              id="compte-mixte-card"
              className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 rounded-xl p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)]"
            >
              {client.linkedPartnerId ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[#696cff] text-[10px] font-extrabold uppercase tracking-widest">
                      <Link2 size={13} />
                      Fournisseur Couplé
                    </span>
                    <button
                      type="button"
                      onClick={handleUnlinkPartner}
                      className="text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg transition-colors"
                      title="Délier le compte"
                    >
                      <Unlink size={13} />
                    </button>
                  </div>

                  <div className="space-y-3.5">
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                        Fournisseur lié :
                      </p>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase mt-0.5 truncate">
                        {suppliers.find((s) => s.id === client.linkedPartnerId)?.name ||
                          'Chargement...'}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800/40">
                      <p className="text-[10px] text-slate-400 uppercase tracking-wider">
                        Solde de Compensation Mutualisé :
                      </p>
                      <div className="flex flex-col gap-1 mt-1">
                        <span
                          className={`font-mono text-lg font-bold leading-none ${stats.consolidatedBalance >= 0 ? 'text-[#71dd37]' : 'text-rose-500'}`}
                        >
                          {stats.consolidatedBalance > 0 ? '+' : ''}
                          {stats.consolidatedBalance.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                        <span
                          className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider w-fit ${stats.consolidatedBalance > 0 ? 'text-[#71dd37]' : stats.consolidatedBalance < 0 ? 'text-rose-500' : 'text-slate-400'}`}
                        >
                          {stats.consolidatedBalance > 0
                            ? 'Excédent (Nous doit)'
                            : stats.consolidatedBalance < 0
                              ? 'Débiteur (Nous devons)'
                              : 'Compte Équilibré'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 mt-2.5 leading-relaxed">
                        Balance consolidée déduisant vos dettes d'achats mutuels de vos créances
                        clients.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <span className="text-slate-400 text-[10px] font-extrabold uppercase tracking-widest block">
                    Couplage Fournisseur
                  </span>

                  {matchingSupplier ? (
                    <div className="bg-emerald-50/20 border border-emerald-100/60 p-4 rounded-lg flex flex-col gap-3">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 size={13} className="text-[#71dd37] mt-0.5 shrink-0" />
                        <div>
                          <h4 className="text-[11px] font-bold text-[#71dd37] uppercase">
                            Correspondance
                          </h4>
                          <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                            Le fournisseur{' '}
                            <span className="font-bold">"{matchingSupplier.name}"</span> correspond
                            à ce profil.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleLinkPartner(matchingSupplier.id)}
                        className="w-full bg-[#71dd37] hover:bg-emerald-600 text-white py-1.5 rounded-md font-bold text-[10px] uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5"
                      >
                        <Link2 size={12} />
                        Lier les Comptes
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Ce client est également un fournisseur ? Liez son compte pour mutualiser et
                        compenser vos créances réciproques.
                      </p>

                      <button
                        onClick={handleCreateSupplier}
                        disabled={isCreatingSupplier}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 py-1.5 rounded-md font-bold text-[10px] uppercase tracking-wider transition-all disabled:opacity-50"
                      >
                        {isCreatingSupplier ? 'Création...' : 'Créer le Profil Fournisseur'}
                      </button>

                      <div className="relative flex items-center justify-center">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-slate-100"></div>
                        </div>
                        <span className="relative bg-white px-2 text-[9px] font-bold text-slate-300 uppercase tracking-widest">
                          OU
                        </span>
                      </div>

                      <button
                        onClick={() => setShowLinkDropdown(!showLinkDropdown)}
                        className="w-full border border-dashed border-slate-200 text-slate-500 hover:bg-slate-50 py-1.5 rounded-md font-bold text-[10px] uppercase tracking-wider transition-all"
                      >
                        {showLinkDropdown ? 'Masquer la liste' : 'Lier à un Fournisseur Existant'}
                      </button>

                      {showLinkDropdown && (
                        <div className="space-y-2 pt-2 animate-in slide-in-from-top-2 duration-200">
                          <input
                            type="text"
                            placeholder="Saisir le nom..."
                            value={linkSearch}
                            onChange={(e) => setLinkSearch(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-[#696cff] transition-colors"
                          />
                          <div className="max-h-36 overflow-y-auto border border-slate-150 rounded-lg divide-y divide-slate-100">
                            {filteredSuppliers.length > 0 ? (
                              filteredSuppliers.map((s) => (
                                <button
                                  key={s.id}
                                  onClick={() => handleLinkPartner(s.id)}
                                  className="w-full text-left p-2 hover:bg-indigo-50/50 text-[10px] font-semibold text-slate-700 flex items-center justify-between"
                                >
                                  <span className="truncate">{s.name}</span>
                                  <span className="text-[9px] text-[#696cff] font-bold uppercase tracking-wider">
                                    Lier
                                  </span>
                                </button>
                              ))
                            ) : (
                              <p className="text-[10px] text-slate-400 text-center py-4">
                                Aucun fournisseur disponible
                              </p>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 4. MODAL: ADD PURCHASE / VENTE (SNEAT STYLED) */}
      <AnimatePresence>
        {isAddingPurchase ? (
          <div
            id="modal-add-purchase"
            className="fixed inset-0 z-[60] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingPurchase(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white dark:bg-[#2b2c40] w-full max-w-md rounded-xl shadow-xl relative z-10 overflow-hidden border border-slate-200/60"
            >
              <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800/40">
                <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Nouvelle Vente Directe
                </h2>
                <button
                  onClick={() => setIsAddingPurchase(false)}
                  className="text-slate-400 hover:text-rose-500 transition-colors"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleAddPurchase} className="p-5 space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                    Désignation du produit
                  </label>
                  <input
                    required
                    autoFocus
                    value={purchaseForm.description}
                    onChange={(e) =>
                      setPurchaseForm({ ...purchaseForm, description: e.target.value })
                    }
                    className="w-full bg-slate-50 border border-slate-200/60 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-[#696cff] transition-colors"
                    placeholder="Ex: Palette de briques rouges"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                      Prix Unitaire (DH)
                    </label>
                    <input
                      type="number"
                      required
                      value={purchaseForm.price}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, price: e.target.value })}
                      className="w-full bg-slate-50 border border-slate-200/60 rounded-lg px-3 py-2 text-xs font-bold font-mono text-slate-700 outline-none focus:border-[#696cff] transition-colors"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                      Quantité
                    </label>
                    <input
                      type="number"
                      required
                      value={purchaseForm.quantity}
                      onChange={(e) =>
                        setPurchaseForm({ ...purchaseForm, quantity: e.target.value })
                      }
                      className="w-full bg-slate-50 border border-slate-200/60 rounded-lg px-3 py-2 text-xs font-bold font-mono text-slate-700 outline-none focus:border-[#696cff] transition-colors"
                    />
                  </div>
                </div>

                <div className="flex gap-2 p-1 bg-slate-100/60 rounded-lg border border-slate-200/30">
                  <button
                    type="button"
                    onClick={() => setPurchaseForm({ ...purchaseForm, status: 'paid' })}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all ${purchaseForm.status === 'paid' ? 'bg-white text-emerald-600 shadow-xs' : 'text-slate-400'}`}
                  >
                    Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setPurchaseForm({ ...purchaseForm, status: 'credit' })}
                    className={`flex-1 py-1.5 text-[10px] font-bold uppercase rounded-md transition-all ${purchaseForm.status === 'credit' ? 'bg-white text-orange-500 shadow-xs' : 'text-slate-400'}`}
                  >
                    Crédit
                  </button>
                </div>

                {purchaseForm.status === 'credit' && (
                  <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1">
                    <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                      Avance versée (DH)
                    </label>
                    <input
                      type="number"
                      value={purchaseForm.advance}
                      onChange={(e) => {
                        const val = e.target.value;
                        const totalVente =
                          Number(purchaseForm.price) * Number(purchaseForm.quantity);
                        if (val !== '' && Number(val) > totalVente) {
                          showToast(`Max: ${totalVente} DH`, 'error');
                          setPurchaseForm({ ...purchaseForm, advance: totalVente.toString() });
                        } else {
                          setPurchaseForm({ ...purchaseForm, advance: val });
                        }
                      }}
                      className="w-full bg-slate-50 border border-slate-200/60 rounded-lg px-3 py-2 text-xs font-bold font-mono text-slate-700 outline-none focus:border-[#696cff] transition-colors"
                      placeholder="0.00"
                    />
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/40 mt-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                        Total Vente :
                      </p>
                      <p className="text-xl font-bold font-mono text-slate-800 dark:text-slate-100 mt-0.5">
                        {(
                          Number(purchaseForm.price) * Number(purchaseForm.quantity)
                        ).toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        <span className="text-xs font-sans font-bold text-slate-400 ml-1">DH</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setIsAddingPurchase(false)}
                      className="flex-1 border border-slate-200 text-slate-500 py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-slate-50 transition-colors"
                    >
                      Annuler
                    </button>
                    <button
                      type="submit"
                      className="flex-[2] bg-[#696cff] text-white py-2 rounded-lg font-bold text-[10px] uppercase tracking-wider hover:bg-[#5f61e6] transition-all shadow-[0_2px_4px_0_rgba(105,108,255,0.3)]"
                    >
                      Enregistrer
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      {/* Floating Invoice Hover Preview */}
      <AnimatePresence>
        {hoveredPurchase && hoverCoords && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 5 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 5 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="fixed bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-4 pointer-events-none"
            style={{
              top: hoverCoords.top,
              left: hoverCoords.left,
              width: '440px',
              zIndex: 99999,
            }}
          >
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-[#696cff] dark:text-[#b1b4ff]">
                Aperçu Facture :{' '}
                {hoveredPurchase.refId || `FAC-${hoveredPurchase.id.substring(0, 8).toUpperCase()}`}
              </span>
              <span className="text-[10px] text-slate-400 font-mono font-bold">
                {hoveredPurchase.date
                  ?.toDate()
                  .toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>

            <table className="w-full text-[11px] text-left">
              <thead>
                <tr className="text-slate-400 uppercase text-[9px] tracking-wider border-b border-slate-100 dark:border-slate-800/40 font-bold">
                  <th className="pb-1.5 font-semibold">Article / Désignation</th>
                  <th className="pb-1.5 text-center font-semibold w-12">Qté</th>
                  <th className="pb-1.5 text-right font-semibold w-24">P.U.</th>
                  <th className="pb-1.5 text-right font-semibold w-24">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/30">
                {(
                  hoveredPurchase.items || [
                    {
                      description: hoveredPurchase.description || 'N/A',
                      price: hoveredPurchase.price || 0,
                      quantity: hoveredPurchase.quantity || 1,
                      total: hoveredPurchase.total || 0,
                    },
                  ]
                ).map((item: any, idx: number) => (
                  <tr key={idx} className="text-slate-600 dark:text-slate-300">
                    <td
                      className="py-2 pr-2 font-medium max-w-[180px] truncate"
                      title={item.description}
                    >
                      {item.description}
                    </td>
                    <td className="py-2 text-center font-bold font-mono text-slate-500">
                      {item.quantity}
                    </td>
                    <td className="py-2 text-right font-mono text-slate-500">
                      {Number(item.price).toLocaleString('fr-FR')} DH
                    </td>
                    <td className="py-2 text-right font-bold font-mono text-slate-700 dark:text-slate-200">
                      {Number(item.total).toLocaleString('fr-FR')} DH
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800/60 flex justify-between items-center text-[11px]">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Total Net :
              </span>
              <span className="font-bold text-slate-800 dark:text-slate-100 font-mono text-sm">
                {Number(hoveredPurchase.total).toLocaleString('fr-FR')}{' '}
                <span className="text-[10px] font-sans font-bold text-slate-400 ml-0.5">DH</span>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

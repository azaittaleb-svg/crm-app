import React, { useEffect, useState, FormEvent, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  doc,
  getDoc,
  deleteDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  getDocs,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useNotification } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import {
  Plus,
  Trash2,
  Calendar,
  Truck,
  ArrowLeft,
  History,
  Pencil,
  AlertCircle,
  CheckCircle2,
  Package,
  Wallet,
  Link2,
  Unlink,
  ChevronRight,
  X,
  Phone,
  Mail,
  MessageSquare,
  Copy,
  Search,
  ArrowUpDown,
  TrendingUp,
  Eye,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { updateDoc } from 'firebase/firestore';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

export default function SupplierDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const [supplier, setSupplier] = useState<any | null>(null);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'clean'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'total-desc' | 'total-asc'>(
    'date-desc'
  );
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<any[]>([]);
  const [linkedClientPurchases, setLinkedClientPurchases] = useState<any[]>([]);
  const [isLinking, setIsLinking] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [showLinkDropdown, setShowLinkDropdown] = useState(false);
  const [isCreatingClient, setIsCreatingClient] = useState(false);
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

  useEffect(() => {
    if (!id || !user) return;

    setLoading(true);
    const unsubSupplier = onSnapshot(
      doc(db, 'suppliers', id),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          if (!data.ownerId || data.ownerId === user.uid) {
            setSupplier({ id: snap.id, ...data });
          } else {
            showToast('Accès non autorisé', 'error');
            navigate('/suppliers');
          }
        } else {
          setSupplier(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );

    const unsubPurchases = onSnapshot(
      collection(db, 'suppliers', id, 'purchases'),
      (snap) => {
        const list = snap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((p: any) => !p.ownerId || p.ownerId === user.uid);
        setPurchases(list);
      },
      (err) => console.warn(`Erreur chargement suppliers/${id}/purchases:`, err)
    );

    return () => {
      unsubSupplier();
      unsubPurchases();
    };
  }, [id, user]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'clients'), where('ownerId', '==', user.uid));
    return onSnapshot(q, (snap) => {
      setClients(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
  }, [user]);

  useEffect(() => {
    if (!supplier?.linkedPartnerId || !user) {
      setLinkedClientPurchases([]);
      return;
    }

    const q = query(
      collection(db, 'clients', supplier.linkedPartnerId, 'purchases'),
      where('ownerId', '==', user.uid)
    );

    return onSnapshot(q, (snap) => {
      setLinkedClientPurchases(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });
  }, [supplier?.linkedPartnerId, user]);

  const stats = useMemo(() => {
    const validPurchases = purchases.filter((p) => p.type !== 'devis' && p.status !== 'Annulée');
    const totalPurchases = validPurchases.reduce((acc, p) => acc + (Number(p.total) || 0), 0);
    const totalPaidOnPurchases = validPurchases.reduce(
      (acc, p) =>
        acc +
        (p.amountPaid !== undefined
          ? Number(p.amountPaid) || 0
          : p.paymentStatus === 'paid'
            ? Number(p.total) || 0
            : 0),
      0
    );
    const supplierDette = totalPurchases - totalPaidOnPurchases;

    // Client balance (what they owe us)
    const validClientPurchases = linkedClientPurchases.filter(
      (p) => p.type !== 'devis' && p.status !== 'Annulée'
    );
    const totalClientPurchases = validClientPurchases.reduce(
      (acc, p) => acc + (Number(p.total) || 0),
      0
    );
    const totalPaidByClient = validClientPurchases.reduce(
      (acc, p) =>
        acc +
        (p.amountPaid !== undefined
          ? Number(p.amountPaid) || 0
          : p.paymentStatus === 'paid'
            ? Number(p.total) || 0
            : 0),
      0
    );
    const clientCredit = totalClientPurchases - totalPaidByClient;

    // Consolidated: what they owe us - what we owe them
    const consolidatedBalance = clientCredit - supplierDette;

    // Advanced statistics
    const transactionCount = validPurchases.length;
    const averageValue = transactionCount > 0 ? totalPurchases / transactionCount : 0;

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
      return pPaid < pTotal;
    });
    const oldestPendingDate = creditPurchases[0]?.date?.toDate() || null;

    return {
      totalPurchases,
      totalPaid: totalPaidOnPurchases,
      balance: supplierDette,
      clientCredit,
      consolidatedBalance,
      transactionCount,
      averageValue,
      lastTransactionDate,
      oldestPendingDate,
    };
  }, [purchases, linkedClientPurchases]);

  // Compute monthly data for supplier trends chart
  const chartData = useMemo(() => {
    const groups: { [key: string]: { total: number; paid: number; credit: number } } = {};
    const months = [
      'Jan',
      'Fév',
      'Mar',
      'Avr',
      'Mai',
      'Jun',
      'Jul',
      'Aoû',
      'Sep',
      'Oct',
      'Nov',
      'Déc',
    ];

    const validPurchases = purchases.filter((p) => p.type !== 'devis' && p.status !== 'Annulée');
    const sorted = [...validPurchases].sort((a, b) => {
      const dateA = a.date?.toDate() || new Date(0);
      const dateB = b.date?.toDate() || new Date(0);
      return dateA.getTime() - dateB.getTime();
    });

    sorted.forEach((p) => {
      const dateObj = p.date?.toDate() || new Date();
      const monthStr = `${months[dateObj.getMonth()]} ${dateObj.getFullYear().toString().substring(2)}`;
      if (!groups[monthStr]) {
        groups[monthStr] = { total: 0, paid: 0, credit: 0 };
      }
      const t = Number(p.total) || 0;
      const pd =
        p.amountPaid !== undefined ? Number(p.amountPaid) || 0 : p.paymentStatus === 'paid' ? t : 0;
      groups[monthStr].total += t;
      groups[monthStr].paid += pd;
      groups[monthStr].credit += Math.max(0, t - pd);
    });

    return Object.entries(groups)
      .map(([name, val]) => ({
        name,
        ...val,
      }))
      .slice(-6); // Last 6 months with data
  }, [purchases]);

  const copyReportToClipboard = () => {
    if (!supplier) return;
    const dateStr = new Date().toLocaleDateString('fr-FR');
    const reportText = `📋 *RELEVÉ DE COMPTE FOURNISSEUR* 📋
Date: ${dateStr}
Fournisseur: ${supplier.name.toUpperCase()}

━━━━━━━━━━━━━━━━━━━
💰 Réception Stock: ${stats.totalPurchases.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
✅ Total Réglé: ${stats.totalPaid.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
⚠️ Dette Fournisseur: ${stats.balance.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
━━━━━━━━━━━━━━━━━━━`;

    navigator.clipboard.writeText(reportText);
    showToast('Le rapport de compte fournisseur a été copié !', 'success');
  };

  useEffect(() => {
    const handleCopyReport = () => {
      copyReportToClipboard();
    };
    window.addEventListener('copy-supplier-report', handleCopyReport);
    return () => {
      window.removeEventListener('copy-supplier-report', handleCopyReport);
    };
  }, [supplier, stats, copyReportToClipboard]);

  const handleLinkPartner = async (partnerId: string) => {
    if (!id) return;
    try {
      setIsLinking(true);
      const batch = writeBatch(db);

      const supplierRef = doc(db, 'suppliers', id);
      batch.update(supplierRef, { linkedPartnerId: partnerId });

      const clientRef = doc(db, 'clients', partnerId);
      batch.update(clientRef, { linkedPartnerId: id });

      await batch.commit();

      showToast('Partenaire lié avec succès');
      setIsLinking(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `suppliers/${id} + clients/${partnerId}`);
      setIsLinking(false);
    }
  };

  const handleUnlinkPartner = async () => {
    if (!id || !supplier?.linkedPartnerId) return;
    try {
      const partnerId = supplier.linkedPartnerId;
      const supplierRef = doc(db, 'suppliers', id);
      await updateDoc(supplierRef, { linkedPartnerId: null });

      const clientRef = doc(db, 'clients', partnerId);
      await updateDoc(clientRef, { linkedPartnerId: null });

      showToast('Lien supprimé');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `suppliers/${id} + clients/${supplier.linkedPartnerId}`
      );
    }
  };

  const handleCreateClient = async () => {
    if (!supplier || !user) return;
    try {
      setIsCreatingClient(true);
      const clientData = {
        name: supplier.name,
        phone: supplier.phone || '',
        email: supplier.email || '',
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        linkedPartnerId: id, // Link back to this supplier
      };

      const docRef = await addDoc(collection(db, 'clients'), clientData);

      // Update this supplier to link to the new client
      await updateDoc(doc(db, 'suppliers', id!), { linkedPartnerId: docRef.id });

      showToast('Client créé et lié avec succès');
      setIsCreatingClient(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'clients creation + supplier link');
      setIsCreatingClient(false);
    }
  };

  const matchingClient = useMemo(() => {
    if (!supplier || supplier.linkedPartnerId) return null;
    return clients.find((c) => c.name.toLowerCase() === supplier.name.toLowerCase());
  }, [supplier, clients]);

  const filteredClients = useMemo(() => {
    return clients
      .filter((c) => !c.linkedPartnerId || c.linkedPartnerId === id)
      .filter((c) => c.name.toLowerCase().includes(linkSearch.toLowerCase()))
      .slice(0, 5);
  }, [clients, linkSearch, id]);

  const filteredPurchases = useMemo(() => {
    let result = purchases.filter((p) => {
      if (filterType === 'credit') return p.paymentStatus !== 'paid';
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

  if (loading)
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (!supplier)
    return <div className="p-20 text-center font-bold text-slate-500">Fournisseur non trouvé</div>;

  return (
    <>
      <div
        id="supplier-details-container"
        className="flex flex-col gap-6 py-4 animate-in fade-in duration-300"
      >
        {/* 1. HIGH-IMPACT COMPACT KPI CARDS DECK (Row of 4 Cards) */}
        <div id="kpi-cards-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* KPI 1: Volume d'achats */}
          <div
            id="kpi-card-ca"
            className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 rounded-xl p-5 flex flex-col justify-between h-[120px] shadow-[0_2px_12px_rgba(15,23,42,0.03)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Volume d'achats
              </span>
              <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-500 shrink-0">
                <Package size={16} />
              </div>
            </div>
            <div>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono tracking-tight">
                {stats.totalPurchases.toLocaleString('fr-FR', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{' '}
                <span className="text-[10px] font-sans font-bold text-slate-400">DH</span>
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {stats.transactionCount} approvisionnements
              </p>
            </div>
          </div>

          {/* KPI 2: Réglé */}
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
                {stats.totalPurchases > 0
                  ? ((stats.totalPaid / stats.totalPurchases) * 100).toFixed(1)
                  : 100}
                % de règlement
              </p>
            </div>
          </div>

          {/* KPI 3: Dette Actuelle */}
          <div
            id="kpi-card-credit"
            className={`bg-white dark:bg-[#2b2c40] border rounded-xl p-5 flex flex-col justify-between h-[120px] shadow-[0_2px_12px_rgba(15,23,42,0.03)] transition-colors ${stats.balance > 0 ? 'border-orange-200/60 bg-orange-50/5' : 'border-slate-200/60'}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Dette Actuelle
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
                {stats.balance > 0 ? 'Dette non soldée' : 'Compte parfaitement à jour'}
              </p>
            </div>
          </div>

          {/* KPI 4: Dernière activité */}
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
                  : 'Aucune livraison'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 uppercase tracking-widest font-mono">
                {stats.oldestPendingDate
                  ? `Dette d'ancienneté : ${stats.oldestPendingDate.toLocaleDateString('fr-FR', { month: 'short' })}`
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
                  Journal des achats
                </h3>
                <p id="ledger-desc" className="text-xs text-slate-400 mt-0.5">
                  Historique des approvisionnements de stock du fournisseur
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
                    placeholder="Rechercher un achat..."
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
                    Tous
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
                    Soldés
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
                      const total = Number(p.total) || 0;
                      const paid = p.paymentStatus === 'paid' ? total : Number(p.amountPaid) || 0;
                      const debt = total - paid;
                      return (
                        <tr
                          key={`${p.id}-${index}`}
                          onClick={() => navigate(`/supplier-purchase/${id}/${p.id}`)}
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
                            {p.items?.reduce((a: number, b: any) => a + (b.quantity || 0), 0) ||
                              p.quantity ||
                              0}{' '}
                            <span className="text-[10px] font-sans font-medium text-slate-400">
                              U.
                            </span>
                          </td>

                          {/* Col 3: Statut */}
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
                                onClick={() => navigate(`/supplier-purchase/${id}/${p.id}`)}
                                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                                title="Voir"
                              >
                                <Eye size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate(`/edit-supplier-purchase/${id}/${p.id}`)}
                                className="p-1.5 text-slate-400 hover:text-[#696cff] hover:bg-indigo-50/50 rounded-md transition-colors"
                                title="Modifier"
                              >
                                <Pencil size={14} />
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
                                            collection(db, 'suppliers', id, 'payments'),
                                            where('ownerId', '==', user.uid),
                                            where('purchaseId', '==', p.id)
                                          )
                                        );
                                        paymentsSnap.forEach((d) => batch.delete(d.ref));
                                        batch.delete(doc(db, 'suppliers', id, 'purchases', p.id));
                                        await batch.commit();
                                        showToast('Achat supprimé avec succès.');
                                      } catch (err) {
                                        handleFirestoreError(
                                          err,
                                          OperationType.WRITE,
                                          `suppliers/${id}/purchases/${p.id}`
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

          {/* RIGHT SIDE: PROFILE, LINKAGE & CHART CARDS (4 cols) */}
          <div id="profile-sidebar-section" className="lg:col-span-4 flex flex-col gap-6">
            {/* Fiche Fournisseur Profile */}
            <div
              id="supplier-info-card"
              className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 rounded-xl p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between mb-5">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-11 h-11 bg-slate-100 flex items-center justify-center text-[#696cff] rounded-lg font-bold text-base uppercase shrink-0">
                      {supplier.name.substring(0, 2)}
                    </div>
                    <div className="min-w-0">
                      <h3
                        id="supplier-name-details"
                        className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight capitalize truncate"
                      >
                        {supplier.name}
                      </h3>
                      <p
                        id="supplier-type-details"
                        className="text-[11px] text-[#696cff] dark:text-[#b1b4ff] font-bold uppercase tracking-wider mt-0.5"
                      >
                        Fournisseur Partenaire
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3.5 pt-4 border-t border-slate-100 dark:border-slate-800/40">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Téléphone :</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">
                      {supplier.phone || 'Non renseigné'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Email :</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 font-mono truncate max-w-[150px]">
                      {supplier.email || 'Non renseigné'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">N° ICE :</span>
                    <span className="font-bold text-slate-700 dark:text-slate-300 font-mono">
                      {supplier.ice || 'Non renseigné'}
                    </span>
                  </div>

                  <div className="flex justify-between items-center text-xs pt-2.5 border-t border-dashed border-slate-150 dark:border-slate-800/40">
                    <span className="text-slate-400 font-medium">Exclure de la compta :</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={!!supplier.excludeFromAccounting}
                        onChange={async (e) => {
                          try {
                            await updateDoc(doc(db, 'suppliers', supplier.id), {
                              excludeFromAccounting: e.target.checked,
                            });
                            showToast(
                              e.target.checked
                                ? 'Fournisseur exclu de la comptabilité'
                                : 'Fournisseur inclus dans la comptabilité',
                              'success'
                            );
                          } catch (err) {
                            console.error(err);
                            showToast('Erreur lors de la mise à jour', 'error');
                          }
                        }}
                      />
                      <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#ff3e1d]"></div>
                    </label>
                  </div>

                  {(supplier.addressLine1 ||
                    supplier.addressLine2 ||
                    supplier.city ||
                    supplier.address) && (
                    <div className="text-xs space-y-1">
                      <span className="text-slate-400 block">Adresse de facturation :</span>
                      <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-medium bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800/40">
                        {supplier.addressLine1} {supplier.addressLine2} {supplier.city}{' '}
                        {!supplier.addressLine1 &&
                          !supplier.addressLine2 &&
                          !supplier.city &&
                          supplier.address}
                      </p>
                    </div>
                  )}

                  {supplier.notes && (
                    <div className="text-xs space-y-1">
                      <span className="text-slate-400 block">Note / Observation :</span>
                      <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-medium bg-slate-50/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800/40 italic">
                        {supplier.notes}
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
              {supplier.linkedPartnerId ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[#696cff] text-[10px] font-extrabold uppercase tracking-widest">
                      <Link2 size={13} />
                      Client Couplé
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
                        Client lié :
                      </p>
                      <p className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase mt-0.5 truncate">
                        {clients.find((c) => c.id === supplier.linkedPartnerId)?.name ||
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
                          className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider w-fit mt-1 ${stats.consolidatedBalance >= 0 ? 'text-[#71dd37] bg-emerald-50/10' : 'text-rose-500 bg-rose-50/10'}`}
                        >
                          {stats.consolidatedBalance > 0
                            ? 'Excédent (Il vous doit)'
                            : stats.consolidatedBalance < 0
                              ? 'Débiteur (Vous lui devez)'
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
                    Couplage Client
                  </span>

                  {matchingClient ? (
                    <div className="bg-emerald-50/20 border border-emerald-100/60 p-4 rounded-lg flex flex-col gap-3">
                      <div className="flex items-start gap-2">
                        <CheckCircle2 size={13} className="text-[#71dd37] mt-0.5 shrink-0" />
                        <div>
                          <h4 className="text-[11px] font-bold text-[#71dd37] uppercase">
                            Correspondance
                          </h4>
                          <p className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">
                            Le client <span className="font-bold">"{matchingClient.name}"</span>{' '}
                            correspond à ce profil.
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleLinkPartner(matchingClient.id)}
                        className="w-full bg-[#71dd37] hover:bg-emerald-600 text-white py-1.5 rounded-md font-bold text-[10px] uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Link2 size={12} />
                        Lier les Comptes
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3.5">
                      <p className="text-[10px] text-slate-400 leading-relaxed">
                        Ce fournisseur est également un client ? Liez son compte pour mutualiser et
                        compenser vos créances réciproques.
                      </p>

                      <button
                        onClick={handleCreateClient}
                        disabled={isCreatingClient}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100 py-1.5 rounded-md font-bold text-[10px] uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {isCreatingClient ? 'Création...' : 'Créer comme client'}
                      </button>

                      {/* Manual Link Input */}
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800/40 relative">
                        <p className="text-[9px] font-bold uppercase text-slate-400 mb-1.5">
                          Lier manuellement un client :
                        </p>
                        <div className="relative">
                          <input
                            type="text"
                            placeholder="Rechercher..."
                            value={linkSearch}
                            onChange={(e) => {
                              setLinkSearch(e.target.value);
                              setShowLinkDropdown(true);
                            }}
                            onFocus={() => setShowLinkDropdown(true)}
                            className="w-full bg-slate-50 dark:bg-slate-800/20 border border-slate-200 dark:border-slate-700 rounded-md px-2.5 py-1 text-[11px] outline-none focus:border-[#696cff] dark:text-slate-200 font-semibold uppercase"
                          />
                          {linkSearch && (
                            <button
                              onClick={() => {
                                setLinkSearch('');
                                setShowLinkDropdown(false);
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
                            >
                              <X size={10} />
                            </button>
                          )}
                        </div>

                        <AnimatePresence>
                          {showLinkDropdown && (linkSearch || filteredClients.length > 0) && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={() => setShowLinkDropdown(false)}
                              />
                              <div className="absolute left-0 right-0 mt-1 bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl z-40 overflow-hidden max-h-48 overflow-y-auto">
                                {filteredClients.length > 0 ? (
                                  filteredClients.map((c) => (
                                    <button
                                      key={c.id}
                                      onClick={() => {
                                        handleLinkPartner(c.id);
                                        setShowLinkDropdown(false);
                                        setLinkSearch('');
                                      }}
                                      className="w-full text-left px-3 py-2 text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/40 flex justify-between items-center border-b border-slate-100 last:border-0 dark:border-slate-850"
                                    >
                                      <span className="font-bold text-slate-750 dark:text-slate-200 truncate mr-2 uppercase">
                                        {c.name}
                                      </span>
                                      <Link2 size={10} className="text-[#696cff] shrink-0" />
                                    </button>
                                  ))
                                ) : (
                                  <div className="p-3 text-center text-slate-400 text-[10px]">
                                    Aucun résultat
                                  </div>
                                )}
                              </div>
                            </>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Purchases Activity Trend Chart Card */}
            <div className="bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-slate-700 rounded-xl p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between min-h-[250px]">
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-450 mb-1 flex items-center gap-1.5">
                  <TrendingUp size={13} className="text-[#696cff]" />
                  Activité Approvisionnements
                </h4>
                <p className="text-xs text-slate-400">Volume de stock mensuels</p>
              </div>

              <div className="h-32 w-full mt-3">
                {chartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                    <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -30, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorTotalSupplier" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="name"
                        stroke="#94a3b8"
                        fontSize={8}
                        fontWeight="bold"
                        tickLine={false}
                      />
                      <YAxis stroke="#94a3b8" fontSize={8} fontWeight="bold" tickLine={false} />
                      <Tooltip
                        contentStyle={{
                          background: '#0f172a',
                          border: 'none',
                          borderRadius: '0.5rem',
                          color: '#fff',
                          fontSize: '10px',
                          fontWeight: 'bold',
                        }}
                        labelStyle={{ color: '#94a3b8', marginBottom: '2px' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke="#6366f1"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#colorTotalSupplier)"
                        name="Commandé"
                      />
                      <Area
                        type="monotone"
                        dataKey="paid"
                        stroke="#10b981"
                        strokeWidth={1.5}
                        fillOpacity={0}
                        name="Réglé"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center">
                    <TrendingUp
                      size={24}
                      className="text-slate-200 dark:text-slate-700 mb-1.5 animate-pulse"
                    />
                    <p className="text-[10px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-wider">
                      En attente de livraisons
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

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

function DetailStat({ icon, label, value, color }: any) {
  const colorMap: any = {
    red: 'text-[#ff3e1d] dark:text-[#ff3e1d] bg-transparent dark:border-transparent',
    emerald:
      'text-[#71dd37] dark:text-[#71dd37] bg-transparent dark:border-transparent font-display',
    slate: 'text-slate-600 bg-slate-50 border-slate-200',
    blue: 'text-[#696cff] dark:text-[#b1b4ff] bg-transparent dark:border-transparent',
  };

  return (
    <div className="bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-[0_4px_24px_rgba(15,23,42,0.012)] hover:shadow-[0_8px_30px_rgba(15,23,42,0.025)] hover:-translate-y-0.5 flex items-center gap-5 transition-all duration-300 min-h-[145px]">
      <div
        className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 transition-all border ${colorMap[color]}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase text-slate-400 tracking-widest leading-none font-mono mb-1">
          {label}
        </p>
        <p
          className={`text-3xl font-mono font-bold tracking-tight ${color === 'red' ? 'text-[#ff3e1d] dark:text-[#ff3e1d]' : color === 'emerald' ? 'text-[#71dd37] dark:text-[#71dd37]' : 'text-slate-950 dark:text-slate-100'}`}
        >
          {value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          <span className="text-sm font-sans font-semibold text-slate-400 ml-1.5 opacity-80 tracking-normal">
            DH
          </span>
        </p>
      </div>
    </div>
  );
}

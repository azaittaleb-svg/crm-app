import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  collection,
  onSnapshot,
  query,
  orderBy,
  doc,
  collectionGroup,
  getDocs,
  writeBatch,
  where,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useNavigate, Link } from 'react-router-dom';
import {
  Truck,
  UserPlus,
  Search,
  Phone,
  Trash2,
  Package,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  User,
  Eye,
  Pencil,
  Coins,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ArrowUpDown,
  ArrowUpRight,
  Scale,
  Upload,
  Globe,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SupplierXlsxModal } from '../components/SupplierXlsxModal';

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<any[]>([]);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [search, setSearch] = useState(() => localStorage.getItem('supp_filter_search') || '');
  const [activeTab, setActiveTab] = useState<'all' | 'debtors' | 'settled'>(() => {
    const val = localStorage.getItem('supp_filter_activeTab');
    return (val as any) || 'all';
  });
  const [sortBy, setSortBy] = useState<'name' | 'recent' | 'debt' | 'purchases'>(() => {
    const val = localStorage.getItem('supp_filter_sortBy');
    return (val as any) || 'recent';
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const val = localStorage.getItem('supp_filter_pageSize');
    return val ? Number(val) : 10;
  });
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);

  // Persist filter states to localStorage
  useEffect(() => {
    localStorage.setItem('supp_filter_search', search);
  }, [search]);

  useEffect(() => {
    localStorage.setItem('supp_filter_activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('supp_filter_sortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('supp_filter_pageSize', String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeTab]);

  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;

    const unsubscribeSuppliers = onSnapshot(
      collection(db, 'suppliers'),
      (snapshot) => {
        const list = snapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as any) }))
          .filter((s: any) => !s.ownerId || s.ownerId === user.uid);
        setSuppliers(list);
      },
      (error) => console.warn('Could not fetch suppliers', error)
    );

    // Fetch all purchases for all suppliers to calculate balances
    const unsubscribePurchases = onSnapshot(
      collectionGroup(db, 'purchases'),
      (snapshot) => {
        const data = snapshot.docs
          .map((docSnap) => {
            const dataObj = docSnap.data() as any;
            const pathParts = docSnap.ref.path.split('/').filter(Boolean);
            const suppliersIndex = pathParts.indexOf('suppliers');
            const parentId = docSnap.ref.parent?.parent?.id;
            const parentPath = docSnap.ref.parent?.parent?.parent?.id;
            const supplierId =
              dataObj.supplierId ||
              parentId ||
              (suppliersIndex !== -1 ? pathParts[suppliersIndex + 1] : pathParts[1]) ||
              '';

            const isSupplierPurchase =
              parentPath === 'suppliers' ||
              suppliersIndex !== -1 ||
              docSnap.ref.path.startsWith('suppliers/') ||
              docSnap.ref.path.includes('/suppliers/');

            return {
              id: docSnap.id,
              ...dataObj,
              supplierId,
              isSupplierPurchase,
            };
          })
          .filter(
            (p) =>
              p.isSupplierPurchase &&
              (!p.ownerId || p.ownerId === user.uid)
          );

        setPurchases(data);
      },
      (error) => {
        console.warn('Could not fetch all supplier purchases at once', error);
      }
    );

    return () => {
      unsubscribeSuppliers();
      unsubscribePurchases();
    };
  }, [user]);

  // Build supplier objects containing reactive stats
  const suppliersWithStats = useMemo(() => {
    return suppliers.map((supplier) => {
      const supplierPurchases = purchases.filter(
        (p) =>
          p.supplierId === supplier.id &&
          p.type !== 'devis' &&
          p.status !== 'Annulée' &&
          p.status !== 'Brouillon'
      );
      const total = supplierPurchases.reduce((acc, p) => acc + (Number(p.total) || 0), 0);
      const paid = supplierPurchases.reduce(
        (acc, p) =>
          acc +
          (p.amountPaid !== undefined
            ? Number(p.amountPaid) || 0
            : p.paymentStatus === 'paid'
              ? Number(p.total) || 0
              : 0),
        0
      );
      const balance = total - paid;
      return {
        ...supplier,
        balance: Math.max(0, balance),
        totalSourcing: total,
        totalPaid: paid,
        purchasesCount: supplierPurchases.length,
      };
    });
  }, [suppliers, purchases]);

  // Filtering & Sorting Supplier Records
  const filteredSuppliers = useMemo(() => {
    let list = suppliersWithStats.filter((s) => {
      const matchSearch =
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.phone && s.phone.includes(search));

      if (!matchSearch) return false;

      if (activeTab === 'debtors') return s.balance > 0;
      if (activeTab === 'settled') return s.balance <= 0 && s.totalSourcing > 0;

      return true;
    });

    // Sort order
    list.sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'debt') {
        return b.balance - a.balance;
      }
      if (sortBy === 'purchases') {
        return b.purchasesCount - a.purchasesCount;
      }
      // default "recent" (by Firebase document creation timestamp / fallback to id)
      const dateA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const dateB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return dateB - dateA;
    });

    return list;
  }, [suppliersWithStats, search, activeTab, sortBy]);

  // General Statistics based on loaded purchases & suppliers
  const stats = useMemo(() => {
    let totalPurchases = 0;
    let totalPaid = 0;
    let totalOwed = 0; // Our debt to them
    let suppliersWithDebt = 0;

    filteredSuppliers.forEach((s) => {
      totalPurchases += s.totalSourcing || 0;
      totalPaid += s.totalPaid || 0;
      totalOwed += s.balance || 0;
      if (s.balance > 0) {
        suppliersWithDebt++;
      }
    });

    return {
      totalPurchases,
      totalPaid,
      totalOwed,
      suppliersWithDebt,
      suppliersCount: filteredSuppliers.length,
    };
  }, [filteredSuppliers]);

  const totalEntries = filteredSuppliers.length;
  const totalPages = Math.ceil(totalEntries / pageSize) || 1;
  const paginatedSuppliers = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredSuppliers.slice(startIndex, startIndex + pageSize);
  }, [filteredSuppliers, currentPage, pageSize]);

  const entryStart = totalEntries === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const entryEnd = Math.min(currentPage * pageSize, totalEntries);

  const isAllSelected =
    paginatedSuppliers.length > 0 &&
    paginatedSuppliers.every((s) => selectedSupplierIds.includes(s.id));
  const isSomeSelected =
    paginatedSuppliers.length > 0 &&
    paginatedSuppliers.some((s) => selectedSupplierIds.includes(s.id)) &&
    !isAllSelected;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pageIds = paginatedSuppliers.map((s) => s.id);
      setSelectedSupplierIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = paginatedSuppliers.map((s) => s.id);
      setSelectedSupplierIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    }
  };

  // Visual avatar pallettes matching client-side pastel layout
  const getAvatarStyle = (name: string) => {
    const char = name ? name.trim().charAt(0).toUpperCase() : '?';
    const colors: Record<string, { bg: string; text: string; border: string; ring: string }> = {
      A: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent',
        ring: 'ring-[#696cff]/10',
      },
      B: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent',
        ring: 'ring-[#696cff]/10',
      },
      C: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent',
        ring: 'ring-[#696cff]/10',
      },
      D: {
        bg: 'bg-transparent',
        text: 'text-[#ff3e1d] dark:text-[#ff3e1d]',
        border: 'border-transparent',
        ring: 'ring-[#ff3e1d]/10',
      },
      E: {
        bg: 'bg-transparent',
        text: 'text-[#ff3e1d] dark:text-[#ff3e1d]',
        border: 'border-transparent',
        ring: 'ring-[#ff3e1d]/10',
      },
      F: {
        bg: 'bg-transparent',
        text: 'text-fuchsia-600',
        border: 'border-transparent',
        ring: 'ring-fuchsia-100/50',
      },
      G: {
        bg: 'bg-transparent',
        text: 'text-violet-600',
        border: 'border-transparent',
        ring: 'ring-violet-100/50',
      },
      H: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent',
        ring: 'ring-[#696cff]/10',
      },
      I: {
        bg: 'bg-transparent',
        text: 'text-[#03c3ec] dark:text-[#03c3ec]',
        border: 'border-transparent',
        ring: 'ring-[#03c3ec]/10',
      },
      J: {
        bg: 'bg-transparent',
        text: 'text-[#71dd37] dark:text-[#71dd37]',
        border: 'border-transparent',
        ring: 'ring-[#71dd37]/10',
      },
      K: {
        bg: 'bg-transparent',
        text: 'text-[#71dd37] dark:text-[#71dd37]',
        border: 'border-transparent',
        ring: 'ring-[#71dd37]/10',
      },
      L: {
        bg: 'bg-transparent',
        text: 'text-[#ffab00] dark:text-[#ffab00]',
        border: 'border-transparent',
        ring: 'ring-[#ffab00]/10',
      },
      M: {
        bg: 'bg-transparent',
        text: 'text-[#ffab00] dark:text-[#ffab00]',
        border: 'border-transparent',
        ring: 'ring-[#ffab00]/10',
      },
      N: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent',
        ring: 'ring-[#696cff]/10',
      },
      O: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent',
        ring: 'ring-[#696cff]/10',
      },
      P: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent',
        ring: 'ring-[#696cff]/10',
      },
      Q: {
        bg: 'bg-transparent',
        text: 'text-[#71dd37] dark:text-[#71dd37]',
        border: 'border-transparent',
        ring: 'ring-[#71dd37]/10',
      },
      R: {
        bg: 'bg-transparent',
        text: 'text-[#697a8d] dark:text-[#a3a4cc]',
        border: 'border-transparent',
        ring: 'ring-[#697a8d]/10',
      },
      S: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent',
        ring: 'ring-[#696cff]/10',
      },
      T: {
        bg: 'bg-transparent',
        text: 'text-[#ffab00] dark:text-[#ffab00]',
        border: 'border-transparent',
        ring: 'ring-[#ffab00]/10',
      },
    };
    return (
      colors[char] || {
        bg: 'bg-slate-50',
        text: 'text-[#697a8d]',
        border: 'border-transparent',
        ring: 'ring-[#697a8d]/10',
      }
    );
  };

  return (
    <div className="w-full py-0 space-y-6 select-none relative bg-transparent">
      {/* Core Analytics Banner - Sneat KPI Card Style */}
      <div className="w-full bg-[#ffffff] dark:bg-[#2b2c40] border border-[#eceef1] dark:border-[#434460]/60 rounded-xl shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:shadow-none overflow-hidden mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Fournisseurs Actifs */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40]">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Fournisseurs Actifs
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#222222] dark:text-[#dbdade]">
                  {stats.suppliersCount}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-sans">
                  Profils
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span>Partenaires commerciaux actifs</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <Truck size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 2: Total Approvisionné */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t-0 md:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Total Sourcing
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#222222] dark:text-[#dbdade]">
                  {stats.totalPurchases.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span>Achat global cumulé</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <Coins size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 3: Reste à Payer (Dettes) */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Reste à Payer (Dettes)
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-rose-500">
                  {stats.totalOwed.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-rose-500">{stats.suppliersWithDebt}</span>
                <span>
                  créancier{stats.suppliersWithDebt > 1 ? 's' : ''} actif
                  {stats.suppliersWithDebt > 1 ? 's' : ''}
                </span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-rose-50 dark:bg-rose-950/20 text-rose-500 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-100 dark:border-rose-900/30">
              <AlertCircle size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 4: Règlements Effectués */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 md:border-l lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5 w-full">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Règlements Fournisseurs
              </span>
              <div className="flex items-baseline justify-between whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#4fb922] dark:text-[#71dd37]">
                  {stats.totalPaid.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span>
                  Taux de règlement :{' '}
                  {stats.totalPurchases > 0
                    ? ((stats.totalPaid / stats.totalPurchases) * 100).toFixed(1)
                    : 100}
                  %
                </span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-100 dark:border-emerald-900/30">
              <CheckCircle2 size={22} className="stroke-[2.2]" />
            </div>
          </div>
        </div>
      </div>

      {/* MERGED CONTROLS & TABLE DIRECTORY */}
      <div className="sneat-table-container w-full overflow-visible mb-8">
        <style
          dangerouslySetInnerHTML={{
            __html: `
            /* ==========================================
               SNEAT STYLE - EN-TÊTE FOURNISSEURS (TABS/FILTRES)
               ========================================== */

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

            .nav-default-view {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 24px;
                width: 100%;
                min-height: 76px;
                transition: transform 0.2s ease, opacity 0.2s ease;
            }

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

            .sneat-table {
                width: 100%;
                border-collapse: collapse;
                font-family: "Public Sans", -apple-system, sans-serif;
                text-align: left;
            }

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

        <div className={`table-nav ${selectedSupplierIds.length > 0 ? 'has-selection' : ''}`}>
          {/* VIEW A: Standard Filters */}
          <div className="nav-default-view flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full gap-4">
            {/* Left Side: Entries Selector + Create Supplier Button conforming to Sneat placement */}
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

              {/* Create Supplier Button */}
              <Link
                to="/add-supplier"
                className="bg-[#696cff] hover:bg-[#5f61e6] active:bg-[#5f61e6] text-white px-4 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm shadow-[0_2px_4px_0_rgba(105,108,255,0.4)] hover:shadow-[0_4px_8px_0_rgba(105,108,255,0.4)] cursor-pointer whitespace-nowrap ml-2 sm:ml-3"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span>Ajouter un fournisseur</span>
              </Link>

              {/* Import Supplier Button (XLSX) */}
              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="bg-[#e7e7ff] hover:bg-[#d0d0ff] text-[#696cff] dark:bg-[#34354e] dark:text-[#b1b4ff] px-3.5 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm cursor-pointer whitespace-nowrap shrink-0"
                title="Importer des fournisseurs depuis Excel (XLSX / CSV)"
              >
                <Upload size={14} strokeWidth={2.5} />
                <span>Importer</span>
              </button>
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
                  id="supplier-status-dropdown-btn"
                  type="button"
                  onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                  className="w-full appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none flex items-center justify-between shadow-xs transition-all tracking-wide h-[38px] hover:border-[#696cff] focus:border-[#696cff] active:border-[#696cff]"
                >
                  <span className="truncate text-left block">
                    {activeTab === 'all' && 'Tous'}
                    {activeTab === 'debtors' && 'Dettes encours'}
                    {activeTab === 'settled' && 'Soldés complets'}
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
                        Tous ({suppliers.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('debtors');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'debtors' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Dettes encours ({suppliersWithStats.filter((s) => s.balance > 0).length})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('settled');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'settled' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Soldés complets (
                        {
                          suppliersWithStats.filter((s) => s.balance <= 0 && s.totalSourcing > 0)
                            .length
                        }
                        )
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
                  <option value="recent">Tri: Récents</option>
                  <option value="name">Tri: A-Z / Nom</option>
                  <option value="debt">Tri: Dettes (+)</option>
                  <option value="purchases">Tri: Approvisionnement</option>
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
              onClick={() => setSelectedSupplierIds([])}
            >
              <span>{selectedSupplierIds.length} sélectionné(s)</span>
              <span className="text-lg leading-none">&times;</span>
            </button>

            <button
              onClick={() => {
                confirm({
                  title: `Détruire ces ${selectedSupplierIds.length} fiches ?`,
                  message:
                    "Cette opération irréversible videra tout l'historique d'achat rattaché auprès de ces fournisseurs.",
                  onConfirm: async () => {
                    try {
                      const batch = writeBatch(db);
                      for (const id of selectedSupplierIds) {
                        const purchasesSnap = await getDocs(
                          query(
                            collection(db, 'suppliers', id, 'purchases'),
                            where('ownerId', '==', user.uid)
                          )
                        );
                        purchasesSnap.forEach((doc) => batch.delete(doc.ref));

                        // Detach associated bank reconciliations for each deleted purchase
                        for (const pDoc of purchasesSnap.docs) {
                          const reconciliationsSnap = await getDocs(
                            query(
                              collection(db, 'bank_reconciliations'),
                              where('matchedDocId', '==', pDoc.id),
                              where('ownerId', '==', user.uid)
                            )
                          );
                          reconciliationsSnap.forEach((rDoc) => {
                            batch.update(rDoc.ref, {
                              isReconciled: false,
                              matchedDocument: '',
                              matchedDocId: '',
                              matchedDocParentType: '',
                              matchedDocParentId: '',
                              matchedDocTotalAmount: 0,
                            });
                          });
                        }

                        const paymentsSnap = await getDocs(
                          query(
                            collection(db, 'suppliers', id, 'payments'),
                            where('ownerId', '==', user.uid)
                          )
                        );
                        paymentsSnap.forEach((doc) => batch.delete(doc.ref));

                        const supplierSnap = suppliers.find((s) => s.id === id);
                        if (supplierSnap && supplierSnap.linkedPartnerId) {
                          batch.update(doc(db, 'clients', supplierSnap.linkedPartnerId), {
                            linkedPartnerId: null,
                          });
                        }

                        batch.delete(doc(db, 'suppliers', id));
                      }
                      await batch.commit();
                      setSelectedSupplierIds([]);
                      showToast('Fiches fournisseurs liquidées avec succès');
                    } catch (err) {
                      handleFirestoreError(err, OperationType.WRITE, 'suppliers-bulk-delete');
                    }
                  },
                });
              }}
              className="action-bar-btn border border-red-200 hover:border-red-300 text-rose-500!"
            >
              <Trash2 size={16} strokeWidth={2.2} />
              <span>Supprimer la sélection</span>
            </button>
          </div>
        </div>

        {/* Suppliers list presentation */}
        <AnimatePresence mode="wait">
          {filteredSuppliers.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-20 text-center space-y-4 bg-white dark:bg-[#2b2c40] animate-fade-in"
            >
              <div className="w-16 h-16 bg-slate-50 border border-slate-150 rounded-2xl flex items-center justify-center mx-auto text-slate-300">
                <Truck size={30} />
              </div>
              <div className="max-w-xs mx-auto">
                <h3 className="text-sm font-bold text-slate-800 dark:text-[#dbdade]">
                  Aucun fournisseur trouvé
                </h3>
                <p className="text-slate-450 text-[11px] font-bold uppercase tracking-widest mt-1 leading-relaxed">
                  Veuillez ajuster votre filtrage ou ajouter un nouveau compte fournisseur avec son
                  profil d'entreprise.
                </p>
              </div>
            </motion.div>
          ) : (
            <div className="space-y-0">
              {/* DESKTOP VIEW COMPACT TABLE */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="sneat-table whitespace-nowrap">
                  <thead>
                    <tr>
                      <th className="py-3 px-4 text-center w-12">
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
                      <th>Raison Sociale / Profil</th>
                      <th>Activité / Bons</th>
                      <th>Total Approvisionné</th>
                      <th className="text-right">Reste à Payer (Dettes)</th>
                      <th className="text-center">État Réglementaire</th>
                      <th className="text-right">Actions Directes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedSuppliers.map((supplier, idx) => {
                      const avatar = getAvatarStyle(supplier.name);
                      const initials = supplier.name
                        ? supplier.name
                            .split(' ')
                            .slice(0, 2)
                            .map((n: string) => n[0])
                            .join('')
                        : '?';
                      const isSelected = selectedSupplierIds.includes(supplier.id);

                      return (
                        <tr
                          key={supplier.id + "_" + idx}
                          className={`${isSelected ? 'selected' : ''}`}
                          onClick={() => navigate(`/supplier/${supplier.id}`)}
                        >
                          <td className="text-center w-12!" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="sneat-checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (checked) {
                                  setSelectedSupplierIds((prev) => [...prev, supplier.id]);
                                } else {
                                  setSelectedSupplierIds((prev) =>
                                    prev.filter((id) => id !== supplier.id)
                                  );
                                }
                              }}
                            />
                          </td>
                          <td>
                            <div className="flex items-center gap-4">
                              <div className="flex items-center gap-2.5">
                                <div className="w-1 flex justify-center shrink-0">
                                  {supplier.balance > 0 ? (
                                    <div className="w-[3px] h-[32px] bg-[#ff3e1d] rounded-full" />
                                  ) : (
                                    <div className="w-[3px] h-[32px] bg-transparent" />
                                  )}
                                </div>
                                <div
                                  className={`w-9 h-9 ${avatar.bg} ${avatar.text} ring-4 ${avatar.ring} rounded-full flex items-center justify-center shrink-0 font-extrabold text-[11px] uppercase transition-transform duration-300 group-hover:scale-105 shadow-3xs`}
                                >
                                  {initials.slice(0, 2)}
                                </div>
                              </div>
                              <div className="flex flex-col text-left">
                                <h4 className="font-bold text-[#222222] dark:text-[#dbdade] text-[14px] tracking-tight group-hover:text-[#696cff] transition-colors duration-150 cursor-pointer flex items-center gap-1.5">
                                  {supplier.name}
                                  {(supplier.isInternational || (supplier.name && supplier.name.toUpperCase().includes('MOTCHO'))) && (
                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-[#696cff] dark:bg-indigo-950/40 dark:text-[#b1b4ff] border border-indigo-100/80 dark:border-indigo-900/40" title="Format International / MOTCHO">
                                      <Globe size={11} />
                                      MOTCHO
                                    </span>
                                  )}
                                  <ChevronRight
                                    size={14}
                                    className="text-[#566a7f] group-hover:text-[#696cff] transition-colors shrink-0"
                                  />
                                </h4>
                                <span className="text-[10px] text-[#697a8d] dark:text-[#a3a4cc] font-mono leading-none mt-1">
                                  #{supplier.id.slice(0, 8).toUpperCase()}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td>
                            <div className="flex flex-col text-left">
                              <span className="text-[12px] text-[#435971] dark:text-[#dbdade] font-semibold italic">
                                {supplier.purchasesCount}{' '}
                                {supplier.purchasesCount > 1 ? 'bons' : 'bon'} d'achat
                              </span>
                              <span className="text-[10px] text-[#697a8d] dark:text-[#a3a4cc] font-mono font-medium uppercase tracking-wider mt-1">
                                Approvisionnements
                              </span>
                            </div>
                          </td>

                          <td>
                            <p className="text-[13px] font-mono font-bold text-[#435971] dark:text-[#dbdade] tracking-tight">
                              {supplier.totalSourcing.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                              <span className="text-[10px] font-sans font-bold ml-1">DH</span>
                            </p>
                          </td>

                          <td className="text-right">
                            <p
                              className={`text-[13px] font-mono font-bold tracking-tight ${supplier.balance > 0 ? 'text-[#ff3e1d] dark:text-[#ff3e1d]' : 'text-[#71dd37] dark:text-[#71dd37]'}`}
                            >
                              {supplier.balance.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                              <span className="text-[10px] font-sans font-bold ml-1 uppercase">
                                DH
                              </span>
                            </p>
                          </td>

                          <td>
                            <div className="flex justify-center text-center">
                              <span
                                className={`text-[12px] font-semibold uppercase tracking-wider ${supplier.balance <= 0 ? 'text-[#71dd37] dark:text-[#71dd37]' : 'text-[#ff3e1d] dark:text-[#ff1d1d]'}`}
                              >
                                {supplier.balance <= 0 ? 'Compte Soldé' : 'Reste Dû'}
                              </span>
                            </div>
                          </td>

                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              <Link
                                to={`/supplier/${supplier.id}`}
                                className="p-1.5 text-[#697a8d] hover:text-[#696cff] dark:text-[#a3a4cc] dark:hover:text-[#b1b4ff] hover:bg-[#f5f5f9] dark:hover:bg-[#232333] rounded transition-colors"
                                title="Détails"
                              >
                                <Eye size={16} strokeWidth={2.5} />
                              </Link>

                              <Link
                                to={`/edit-supplier/${supplier.id}`}
                                className="p-1.5 text-[#697a8d] hover:text-[#696cff] dark:text-[#a3a4cc] dark:hover:text-[#b1b4ff] hover:bg-[#696cff]/10 rounded transition-colors"
                                title="Modifier"
                              >
                                <Pencil size={16} strokeWidth={2.5} />
                              </Link>

                              <Link
                                to={`/add-supplier-purchase/${supplier.id}`}
                                className="p-1.5 text-[#697a8d] hover:text-[#696cff] dark:text-[#a3a4cc] dark:hover:text-[#b1b4ff] hover:bg-[#696cff]/10 rounded transition-colors"
                                title="Saisir Achat"
                              >
                                <Plus size={16} strokeWidth={2.5} />
                              </Link>

                              <button
                                onClick={async () => {
                                  confirm({
                                    title: 'Supprimer le fournisseur ?',
                                    message:
                                      "Tous les bons d'achats et les versements d'acomptes inscrits sur ce partenaire seront définitivement effacés.",
                                    onConfirm: async () => {
                                      try {
                                        const batch = writeBatch(db);
                                        const purchasesSnap = await getDocs(
                                          query(
                                            collection(db, 'suppliers', supplier.id, 'purchases'),
                                            where('ownerId', '==', user.uid)
                                          )
                                        );
                                        purchasesSnap.forEach((doc) => batch.delete(doc.ref));

                                        // Detach associated bank reconciliations for each deleted purchase
                                        for (const pDoc of purchasesSnap.docs) {
                                          const reconciliationsSnap = await getDocs(
                                            query(
                                              collection(db, 'bank_reconciliations'),
                                              where('matchedDocId', '==', pDoc.id),
                                              where('ownerId', '==', user.uid)
                                            )
                                          );
                                          reconciliationsSnap.forEach((rDoc) => {
                                            batch.update(rDoc.ref, {
                                              isReconciled: false,
                                              matchedDocument: '',
                                              matchedDocId: '',
                                              matchedDocParentType: '',
                                              matchedDocParentId: '',
                                              matchedDocTotalAmount: 0,
                                            });
                                          });
                                        }

                                        const paymentsSnap = await getDocs(
                                          query(
                                            collection(db, 'suppliers', supplier.id, 'payments'),
                                            where('ownerId', '==', user.uid)
                                          )
                                        );
                                        paymentsSnap.forEach((doc) => batch.delete(doc.ref));

                                        if (supplier.linkedPartnerId) {
                                          const clientDocRef = doc(
                                            db,
                                            'clients',
                                            supplier.linkedPartnerId
                                          );
                                          batch.update(clientDocRef, { linkedPartnerId: null });
                                        }

                                        batch.delete(doc(db, 'suppliers', supplier.id));
                                        await batch.commit();
                                        showToast('Fiche fournisseur radiée avec succès');
                                      } catch (err) {
                                        handleFirestoreError(
                                          err,
                                          OperationType.WRITE,
                                          `suppliers/${supplier.id}`
                                        );
                                      }
                                    },
                                  });
                                }}
                                className="p-1.5 text-[#697a8d] hover:text-[#ff3e1d] dark:text-[#a3a4cc] dark:hover:text-[#ff3e1d] hover:bg-[#ff3e1d]/10 rounded transition-colors"
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

              {/* MOBILE VIEW FOR SUPPLIERS LIST */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:hidden gap-4 p-5 bg-slate-50/50 dark:bg-transparent border-t border-[#eceef1] dark:border-[#434460]/40">
                {paginatedSuppliers.map((supplier, idx) => {
                  const avatar = getAvatarStyle(supplier.name);
                  const initials = supplier.name
                    ? supplier.name
                        .split(' ')
                        .slice(0, 2)
                        .map((n: string) => n[0])
                        .join('')
                    : '?';

                  return (
                    <motion.div
                      key={supplier.id + "_" + idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-[#434460]/45 p-5 rounded-xl shadow-xs hover:shadow-sm transition-all flex flex-col justify-between space-y-4"
                      onClick={() => navigate(`/supplier/${supplier.id}`)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className={`w-9.5 h-9.5 ${avatar.bg} ${avatar.text} ${avatar.border} border rounded-xl flex items-center justify-center shrink-0 font-bold text-[10px] uppercase`}
                          >
                            {initials.slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <h4 className="font-bold text-[#435971] dark:text-[#dbdade] text-[12.5px] leading-tight truncate pr-1">
                              {supplier.name}
                            </h4>
                            <p className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">
                              Fournisseur : {supplier.id.slice(0, 8)}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`text-[11px] font-semibold uppercase tracking-wider ${supplier.balance <= 0 ? 'text-[#71dd37]' : 'text-[#ff3e1d]'}`}
                        >
                          {supplier.balance <= 0 ? 'Soldé' : 'Dette'}
                        </span>
                      </div>

                      {/* Mid statistics section box */}
                      <div className="bg-transparent dark:bg-transparent flex items-center justify-between">
                        <div>
                          <span className="text-slate-400 font-bold text-[9px] uppercase leading-none block">
                            Total Sourcing
                          </span>
                          <span className="text-slate-800 dark:text-[#dbdade] font-bold font-mono text-[11.5px] mt-1 block">
                            {supplier.totalSourcing.toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            DH
                          </span>
                        </div>

                        <div className="text-right">
                          <span className="text-slate-400 font-bold text-[9px] uppercase leading-none block">
                            Resta à s'acquitter
                          </span>
                          <span
                            className={`font-bold font-mono text-[11.5px] mt-1 block ${supplier.balance > 0 ? 'text-[#ff3e1d]' : 'text-[#71dd37]'}`}
                          >
                            {supplier.balance.toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            DH
                          </span>
                        </div>
                      </div>

                      {/* Bottom line with quick button triggers */}
                      <div
                        className="border-t border-slate-100 dark:border-[#434460]/20 pt-3 flex items-center justify-between gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-1.5">
                          <Link
                            to={`/supplier/${supplier.id}`}
                            className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#232333]/90 hover:bg-slate-100 border border-slate-200 dark:border-[#434460]/50 text-slate-600 dark:text-[#dbdade] rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5"
                          >
                            <Eye size={12} />
                            <span>Fiche</span>
                          </Link>
                          <Link
                            to={`/edit-supplier/${supplier.id}`}
                            className="px-3.5 py-2.5 bg-slate-50 dark:bg-[#232333]/90 hover:bg-slate-100 border border-slate-200 dark:border-[#434460]/50 text-slate-600 dark:text-[#dbdade] rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5"
                          >
                            <Pencil size={12} />
                            <span>Modifier</span>
                          </Link>
                          <Link
                            to={`/add-supplier-purchase/${supplier.id}`}
                            className="px-3.5 py-2.5 bg-[#696cff]/10 hover:bg-[#696cff]/15 border border-[#696cff]/20 text-[#696cff] rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center gap-1"
                          >
                            <Plus size={12} />
                            <span>Achat</span>
                          </Link>
                        </div>

                        <button
                          onClick={() => {
                            confirm({
                              title: 'Retirer le fournisseur ?',
                              message:
                                "L'opération annulera l'ensemble de l'historique d'achat enregistrée chez lui.",
                              onConfirm: async () => {
                                try {
                                  const batch = writeBatch(db);
                                  const purchasesSnap = await getDocs(
                                    query(
                                      collection(db, 'suppliers', supplier.id, 'purchases'),
                                      where('ownerId', '==', user.uid)
                                    )
                                  );
                                  purchasesSnap.forEach((doc) => batch.delete(doc.ref));

                                  // Detach associated bank reconciliations for each deleted purchase
                                  for (const pDoc of purchasesSnap.docs) {
                                    const reconciliationsSnap = await getDocs(
                                      query(
                                        collection(db, 'bank_reconciliations'),
                                        where('matchedDocId', '==', pDoc.id),
                                        where('ownerId', '==', user.uid)
                                      )
                                    );
                                    reconciliationsSnap.forEach((rDoc) => {
                                      batch.update(rDoc.ref, {
                                        isReconciled: false,
                                        matchedDocument: '',
                                        matchedDocId: '',
                                        matchedDocParentType: '',
                                        matchedDocParentId: '',
                                        matchedDocTotalAmount: 0,
                                      });
                                    });
                                  }

                                  const paymentsSnap = await getDocs(
                                    query(
                                      collection(db, 'suppliers', supplier.id, 'payments'),
                                      where('ownerId', '==', user.uid)
                                    )
                                  );
                                  paymentsSnap.forEach((doc) => batch.delete(doc.ref));

                                  if (supplier.linkedPartnerId) {
                                    batch.update(doc(db, 'clients', supplier.linkedPartnerId), {
                                      linkedPartnerId: null,
                                    });
                                  }

                                  batch.delete(doc(db, 'suppliers', supplier.id));
                                  await batch.commit();
                                  showToast('Supprimé');
                                } catch (err) {
                                  showToast('Incident', 'error');
                                }
                              },
                            });
                          }}
                          className="p-2.5 text-slate-400 hover:text-[#ff3e1d] hover:bg-red-50 dark:hover:bg-red-950/20 border border-transparent rounded-lg transition-all"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* PAGINATION CONTROLS */}
              {filteredSuppliers.length > 0 && (
                <div className="sneat-pagination-bar flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-sm text-[#8592a3] dark:text-[#a3afbb] whitespace-nowrap">
                    <span>Displaying</span>
                    <span className="font-semibold text-[#566a7f] dark:text-[#dbdade]">
                      {entryStart} - {entryEnd}
                    </span>
                    <span>of</span>
                    <span className="font-semibold text-[#566a7f] dark:text-[#dbdade]">
                      {totalEntries}
                    </span>
                    <span>records</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="sneat-pag-btn flex items-center justify-center.5"
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
                            <span key="dots1" className="px-1 text-[#8592a3]">
                              ...
                            </span>
                          );
                        if (page === totalPages - 1 && currentPage < totalPages - 2)
                          return (
                            <span key="dots2" className="px-1 text-[#8592a3]">
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
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="sneat-pag-btn flex items-center justify-center.5"
                      title="Suivant"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </AnimatePresence>

        {/* XLSX Import Modal */}
        <SupplierXlsxModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          existingSuppliers={suppliers}
          ownerId={user?.uid || ''}
          showToast={showToast}
        />
      </div>
    </div>
  );
}

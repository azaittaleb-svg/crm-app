import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  collectionGroup,
  collection,
  onSnapshot,
  doc,
  writeBatch,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useSupplierData } from "../hooks/useSupplierData";
import { calculatePurchaseBalance } from "../utils/balanceUtils";
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Calendar,
  Search,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Trash2,
  Package,
  Truck,
  Eye,
  Pencil,
  Coins,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ArrowUpDown,
  MoreVertical,
  Upload,
  Settings,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { SupplierPurchaseXlsxModal } from '../components/SupplierPurchaseXlsxModal';
import { SupplierPurchaseMotchoXlsxModal } from '../components/SupplierPurchaseMotchoXlsxModal';
import PurchasePdfScanModal from '../components/PurchasePdfScanModal';
import * as XLSX from 'xlsx';

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

export default function SupplierPurchasesPage() {
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isMotchoImportModalOpen, setIsMotchoImportModalOpen] = useState(false);
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [search, setSearch] = useState(() => localStorage.getItem('pur_filter_search') || '');
  const [activeTab, setActiveTab] = useState<'all' | 'debt' | 'paid' | 'past_due' | 'all_draft' | 'exclu_compta'>(
    () => {
      const val = localStorage.getItem('pur_filter_activeTab');
      return (val as any) || 'all';
    }
  );
  const [datePeriodFilter, setDatePeriodFilter] = useState<string>(
    () => localStorage.getItem('pur_filter_datePeriodFilter') || 'all'
  );
  const [dateYearFilter, setDateYearFilter] = useState<string>(
    () => localStorage.getItem('pur_filter_dateYearFilter') || 'all'
  );
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'recent' | 'oldest' | 'highest' | 'lowest' | 'debt'>(
    'recent'
  );
  const [openActionDropdownId, setOpenActionDropdownId] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedPurchaseIds, setSelectedPurchaseIds] = useState<string[]>([]);
  const [isBulkDropdownOpen, setIsBulkDropdownOpen] = useState(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);

  const { user } = useAuth();
  const { purchases, suppliers, suppliersMap } = useSupplierData(user);
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.setItem('pur_filter_search', search);
  }, [search]);

  useEffect(() => {
    localStorage.setItem('pur_filter_activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('pur_filter_datePeriodFilter', datePeriodFilter);
  }, [datePeriodFilter]);

  useEffect(() => {
    localStorage.setItem('pur_filter_dateYearFilter', dateYearFilter);
  }, [dateYearFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeTab, datePeriodFilter, dateYearFilter]);


  // Sorting + Filtering Purchases list
  const filteredPurchases = useMemo(() => {
    const list = purchases.filter((p) => {
      const supplierName = suppliersMap[p.supplierId] || 'Fournisseur Inconnu';
      const refIdStr = p.refId || '';
      const idStr = p.id || '';
      const descStr = p.description || '';
      const matchSearch =
        descStr.toLowerCase().includes(search.toLowerCase()) ||
        supplierName.toLowerCase().includes(search.toLowerCase()) ||
        refIdStr.toLowerCase().includes(search.toLowerCase()) ||
        idStr.toLowerCase().includes(search.toLowerCase());

      if (!matchSearch) return false;

      const { total, paid: pays, debt } = calculatePurchaseBalance(p);

      let tabMatch = true;
      if (activeTab === 'debt') {
        tabMatch = debt > 0;
      } else if (activeTab === 'paid') {
        tabMatch = debt <= 0 && total > 0;
      } else if (activeTab === 'past_due') {
        const dueD = p.dueDate
          ? p.dueDate.toDate
            ? p.dueDate.toDate()
            : new Date(p.dueDate)
          : null;
        const isPastDue = debt > 0 && dueD && dueD < new Date();
        tabMatch = !!isPastDue;
      } else if (activeTab === 'exclu_compta') {
        tabMatch = !!(p.excludeFromAccounting || suppliers.some((s: any) => s.id === p.supplierId && s.excludeFromAccounting));
      }

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

    // Custom sorting
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

      const dateA = parseToDate(a.date)?.getTime() || 0;
      const dateB = parseToDate(b.date)?.getTime() || 0;

      if (sortBy === 'oldest') return dateA - dateB;
      if (sortBy === 'highest') return totalB - totalA;
      if (sortBy === 'lowest') return totalA - totalB;
      if (sortBy === 'debt') return debtB - debtA;
      return dateB - dateA; // default "recent"
    });

    return list;
  }, [purchases, suppliersMap, search, activeTab, datePeriodFilter, dateYearFilter, sortBy]);

  // Overall financial stats for purchases
  const stats = useMemo(() => {
    let totalPurchases = 0;
    let totalPaid = 0;
    let totalOwed = 0; // Our remain due to suppliers
    const count = filteredPurchases.length;

    filteredPurchases.forEach((p) => {
      const gTotal = Number(p.total) || 0;
      const isPaid = p.paymentStatus === 'paid';
      const paid = p.amountPaid !== undefined ? Number(p.amountPaid) || 0 : isPaid ? gTotal : 0;
      const remaining = gTotal - paid;

      totalPurchases += gTotal;
      totalPaid += paid;
      totalOwed += Math.max(0, remaining);
    });

    const averageBasket = count > 0 ? totalPurchases / count : 0;

    return {
      totalPurchases,
      totalPaid,
      totalOwed,
      averageBasket,
      count,
    };
  }, [filteredPurchases]);

  const handleExportToExcel = () => {
    if (filteredPurchases.length === 0) {
      showToast('Aucun achat à exporter', 'info');
      return;
    }
    try {
      const dataToExport = filteredPurchases.map((p) => {
        const supplierName = suppliersMap[p.supplierId] || 'Fournisseur Inconnu';
        const { total, paid, debt } = calculatePurchaseBalance(p);
        const pDate = parseToDate(p.date);
        const pDueDate = p.dueDate
          ? p.dueDate.toDate
            ? p.dueDate.toDate()
            : new Date(p.dueDate)
          : null;

        let safeAttachment = 'Aucun justificatif rattaché';
        if (p.attachmentUrl) {
          if (p.attachmentUrl.startsWith('data:')) {
            const origin = window.location.origin;
            const route = `/download/achat/${p.supplierId}/${p.id}`;
            safeAttachment = `${origin}${route}`;
          } else {
            safeAttachment = p.attachmentUrl;
          }
        }

        return {
          Référence: p.refId || p.id || '---',
          Date: pDate ? pDate.toLocaleDateString('fr-FR') : '---',
          Fournisseur: supplierName,
          Description: p.description || '',
          'Echéance / Conditions': pDueDate
            ? pDueDate.toLocaleDateString('fr-FR')
            : p.conditions_paiement || 'Immédiate',
          'Total (DH)': total,
          'Montant Payé (DH)': paid,
          'Reste à Payer (DH)': debt,
          Statut: debt <= 0 ? 'PAYÉ' : 'À CRÉDIT',
          'Lien Justificatif': safeAttachment,
        };
      });

      const worksheet = XLSX.utils.json_to_sheet(dataToExport);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Achats Fournisseurs');

      // Auto-fit column widths
      const maxLens = Object.keys(dataToExport[0] || {}).map((key) => {
        return Math.max(
          key.length,
          ...dataToExport.map((row: any) => String(row[key] || '').length)
        );
      });
      worksheet['!cols'] = maxLens.map((w) => ({ wch: w + 3 }));

      XLSX.writeFile(workbook, `achats_fournisseurs_${new Date().toISOString().slice(0, 10)}.xlsx`);
      showToast('Export Excel réussi !', 'success');
    } catch (error) {
      console.error('Export Excel Error:', error);
      showToast("Erreur lors de l'export Excel.", 'error');
    }
  };

  useEffect(() => {
    const handleTriggerImport = () => {
      setIsImportModalOpen(true);
    };
    const handleTriggerImportMotcho = () => {
      setIsMotchoImportModalOpen(true);
    };
    const handleTriggerExport = () => {
      handleExportToExcel();
    };

    window.addEventListener('trigger-import-purchases', handleTriggerImport);
    window.addEventListener('trigger-import-purchases-motcho', handleTriggerImportMotcho);
    window.addEventListener('trigger-export-purchases', handleTriggerExport);

    return () => {
      window.removeEventListener('trigger-import-purchases', handleTriggerImport);
      window.removeEventListener('trigger-import-purchases-motcho', handleTriggerImportMotcho);
      window.removeEventListener('trigger-export-purchases', handleTriggerExport);
    };
  }, [filteredPurchases, suppliersMap]);

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

  // Bulk delete selected purchases
  const handleBulkDelete = async () => {
    const selectedPurchases = purchases.filter((p) => selectedPurchaseIds.includes(p.id));
    if (selectedPurchases.length === 0) return;

    confirm({
      title: 'Supprimer les achats sélectionnés ?',
      message: `Attention: Cette action supprimera définitivement les ${selectedPurchases.length} achats ainsi que les paiements correspondants.`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          for (const purchase of selectedPurchases) {
            const paymentsSnap = await getDocs(
              query(
                collection(db, 'suppliers', purchase.supplierId, 'payments'),
                where('purchaseId', '==', purchase.id),
                where('ownerId', '==', user.uid)
              )
            );
            paymentsSnap.forEach((d) => batch.delete(d.ref));

            // Detach associated bank reconciliations
            const reconciliationsSnap = await getDocs(
              query(
                collection(db, 'bank_reconciliations'),
                where('matchedDocId', '==', purchase.id),
                where('ownerId', '==', user.uid)
              )
            );
            reconciliationsSnap.forEach((d) => {
              batch.update(d.ref, {
                isReconciled: false,
                matchedDocument: '',
                matchedDocId: '',
                matchedDocParentType: '',
                matchedDocParentId: '',
                matchedDocTotalAmount: 0,
              });
            });

            batch.delete(doc(db, 'suppliers', purchase.supplierId, 'purchases', purchase.id));
          }
          await batch.commit();
          showToast(`${selectedPurchases.length} achat(s) supprimé(s) avec succès.`, 'success');
          setSelectedPurchaseIds([]);
        } catch (err) {
          console.error(err);
          showToast('Erreur lors de la suppression groupée.', 'error');
        }
      },
    });
  };

  // Pastel generator color structure
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
    <div className="w-full py-0 space-y-6 select-none relative bg-transparent">
      {/* Core Analytics Banner - Sneat KPI Card Style */}
      <div className="w-full bg-[#ffffff] dark:bg-[#2b2c40] border border-[#eceef1] dark:border-[#434460]/60 rounded-xl shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:shadow-none overflow-hidden mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Total Sourcing */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40]">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Total Approvisionné
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
                <span className="font-bold text-[#222222] dark:text-[#eceeff]">{stats.count}</span>
                <span>Facture{stats.count > 1 ? 's' : ''} d’approvisionnement</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <Package size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 2: Montant Transféré (Payé) */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t-0 md:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Montant Transféré
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
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
                <span className="font-bold text-[#4fb922] dark:text-[#71dd37]">
                  {stats.totalPurchases > 0
                    ? ((stats.totalPaid / stats.totalPurchases) * 100).toFixed(0)
                    : 100}
                  %
                </span>
                <span>Apurement global</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-[#e8fadf] dark:bg-[#2e4b2d] text-[#71dd37] flex items-center justify-center shrink-0 border border-[#71dd37]/40">
              <CheckCircle2 size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 3: Dettes Fournisseurs Dûs */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Dettes Fournisseurs
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
                <span>Notre solde dû total</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-rose-50 dark:bg-rose-950/20 text-rose-500 dark:text-rose-400 flex items-center justify-center shrink-0 border border-rose-100 dark:border-rose-900/30">
              <AlertCircle size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 4: Panier Moyen d'Appro */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 md:border-l lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Panier Moyen
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-purple-600 dark:text-[#b1b4ff]">
                  {stats.averageBasket.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium mt-1">
                <span>Valeur moyenne par appro</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <TrendingUp size={22} className="stroke-[2.2]" />
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
               SNEAT STYLE - EN-TÊTE APPROVISIONNEMENTS (TABS)
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
                color: #4fb922;
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

        <div className={`table-nav ${selectedPurchaseIds.length > 0 ? 'has-selection' : ''}`}>
          {/* VIEW A: Standard Filters */}
          <div className="nav-default-view flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full gap-4">
            {/* Left Side: Entries Selector + Create Purchase Button */}
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

              {/* Create Sourcing Button conforming to dashboard style guide */}
              <Link
                to="/add-supplier-purchase"
                className="bg-[#696cff] h-[38px] hover:bg-[#5f61e6] text-[#ffffff] font-semibold text-[13.5px] px-5 rounded-[6px] flex items-center justify-center gap-2 transition-all shadow-[0_2px_4px_0_rgba(105,108,255,0.4)] whitespace-nowrap"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span>Saisir un Achat</span>
              </Link>

              {/* PDF Scanner button styled with Settings/Cog icon as requested by user */}
              <button
                type="button"
                onClick={() => setIsScanModalOpen(true)}
                className="border border-[#d9dee3] hover:bg-slate-50 dark:hover:bg-slate-800/50 dark:border-[#434460]/40 text-[#566a7f] dark:text-[#dbdade] px-3.5 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm cursor-pointer whitespace-nowrap"
                title="Scanner/Importer PDF d'Achat"
              >
                <Settings size={15} strokeWidth={2.5} className="text-[#696cff]" />
                <span>Scanner PDF</span>
              </button>
            </div>

            {/* Right Side: Tab Filters, Search bar and Sorting Deck */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* Search Text Input */}
              <div className="relative">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Purchase"
                  className="search-input w-full sm:w-[180px] h-[38px]"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold text-xs"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Date Period Popover */}
              <div className="relative text-left min-w-[170px]">
                <button
                  id="purchase-date-dropdown-btn"
                  type="button"
                  onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
                  className="w-full appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none flex items-center justify-between shadow-xs transition-all tracking-wide h-[38px] hover:border-[#696cff] focus:border-[#696cff] active:border-[#696cff]"
                >
                  <span className="truncate">
                    {(() => {
                      if (datePeriodFilter === 'all' && dateYearFilter === 'all') {
                        return "Date de l'achat";
                      }
                      let label = '';
                      if (datePeriodFilter !== 'all') {
                        if (datePeriodFilter.startsWith('month:')) {
                          const mNum = parseInt(datePeriodFilter.split(':')[1]);
                          const monthsFr = [
                            'Janvier',
                            'Février',
                            'Mars',
                            'Avril',
                            'Mai',
                            'Juin',
                            'Juillet',
                            'Août',
                            'Septembre',
                            'Octobre',
                            'Novembre',
                            'Décembre',
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
                    <div className="absolute top-[110%] right-0 bg-white dark:bg-[#2c2d42] border border-[#d9dee3] dark:border-[#434460]/40 rounded-lg shadow-md w-[320px] z-50 py-3 flex flex-col font-sans">
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
                  id="purchase-status-dropdown-btn"
                  type="button"
                  onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                  className="w-full appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none flex items-center justify-between shadow-xs transition-all tracking-wide h-[38px] hover:border-[#696cff] focus:border-[#696cff] active:border-[#696cff]"
                >
                  <span className="truncate">
                    {activeTab === 'all' && 'Purchase Status'}
                    {activeTab === 'debt' && 'À Crédit'}
                    {activeTab === 'paid' && 'Paid'}
                    {activeTab === 'past_due' && 'Past Due'}
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
                    <div className="absolute top-[110%] right-0 bg-white dark:bg-[#2c2d42] border border-[#d9dee3] dark:border-[#434460]/40 rounded-lg shadow-md min-w-[190px] z-50 py-1 flex flex-col font-sans font-medium">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('all');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-semibold transition-all cursor-pointer border-l-[3px] ${activeTab === 'all' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Purchase Status
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('paid');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-semibold transition-all cursor-pointer border-l-[3px] ${activeTab === 'paid' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Paid
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('debt');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-semibold transition-all cursor-pointer border-l-[3px] ${activeTab === 'debt' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        À Crédit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('past_due');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-semibold transition-all cursor-pointer border-l-[3px] ${activeTab === 'past_due' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Past Due
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('exclu_compta');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-semibold transition-all cursor-pointer border-l-[3px] ${activeTab === 'exclu_compta' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Exclu Compta
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* VIEW B: Selection Bulk Actions Bar */}
          <div className="nav-selection-view">
            <button
              className="action-bar-btn flex items-center gap-1.5"
              onClick={() => setSelectedPurchaseIds([])}
            >
              <span>{selectedPurchaseIds.length} sélectionné(s)</span>
              <span className="text-lg leading-none">&times;</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={handleBulkDelete}
                className="action-bar-btn hover:text-[#ff3e1d] hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                <Trash2 size={15} />
                <span>Supprimer</span>
              </button>
            </div>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {filteredPurchases.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="py-16 text-center space-y-4 bg-white dark:bg-[#2b2c40] min-h-[300px] flex flex-col justify-center items-center"
            >
              <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800 border border-slate-150 dark:border-slate-700 rounded-2xl flex items-center justify-center mx-auto text-slate-300 dark:text-slate-600">
                <Package size={30} />
              </div>
              <div className="max-w-xs mx-auto">
                <h3 className="text-sm font-bold text-[#435971] dark:text-[#dbdade]">
                  Aucun achat enregistré
                </h3>
                <p className="text-slate-400 text-[12px] mt-1 leading-relaxed">
                  Ajustez vos filtres de recherche ou saisissez de nouveaux bons de stock auprès de
                  vos fournisseurs.
                </p>
              </div>
            </motion.div>
          ) : (
            <div className="space-y-0">
              {/* DESKTOP JOURNAL VIEW */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="bg-white dark:bg-[#2b2c40] border-b border-[#dbdade]/70 dark:border-[#434460]/40 text-[11px] uppercase tracking-widest font-black text-[#566a7f] dark:text-[#a3a4cc] select-none h-12">
                      <th className="py-3 px-4 text-center w-12">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = isSomeSelected;
                          }}
                          onChange={handleSelectAll}
                          className="w-4 h-4 text-[#696cff] border-[#dbdade] rounded focus:ring-[#696cff] cursor-pointer"
                        />
                      </th>
                      <th className="py-3 px-6 text-left">N° Achat Interne</th>
                      <th className="py-3 px-6 text-left">Fournisseur</th>
                      <th className="py-3 px-6 text-left">Date</th>
                      <th className="py-3 px-6 text-right">Reste / Total</th>
                      <th className="py-3 px-6 text-left">Paiement</th>
                      <th className="py-3 px-6 text-left">Etat</th>
                      <th className="py-3 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedPurchases.map((purchase, idx) => {
                      const isLastRows =
                        idx >= paginatedPurchases.length - 2 && paginatedPurchases.length > 3;
                      const supplierName =
                        suppliersMap[purchase.supplierId] || 'Fournisseur Inconnu';
                      const avatar = getAvatarStyle(supplierName);
                      const initials = supplierName
                        ? supplierName
                            .split(' ')
                            .slice(0, 2)
                            .map((n: string) => n[0])
                            .join('')
                        : '?';

                      const { total, paid, credited, debt, percentPaid } = calculatePurchaseBalance(purchase);
                      const isSelected = selectedPurchaseIds.includes(purchase.id);

                      return (
                        <tr
                          key={purchase.id + "_" + idx}
                          className="border-b border-[#dbdade]/70 dark:border-[#434460]/40 hover:bg-[#f5f5f9]/40 dark:hover:bg-[#232333]/30 transition-colors group cursor-pointer h-[72px]"
                          onClick={() =>
                            navigate(`/supplier-purchase/${purchase.supplierId}/${purchase.id}`)
                          }
                        >
                          <td
                            className="px-4 text-center w-12"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedPurchaseIds((prev) => [...prev, purchase.id]);
                                } else {
                                  setSelectedPurchaseIds((prev) =>
                                    prev.filter((id) => id !== purchase.id)
                                  );
                                }
                              }}
                              className="w-4 h-4 text-[#696cff] border-[#dbdade] rounded focus:ring-[#696cff] cursor-pointer"
                            />
                          </td>

                          <td className="px-6">
                            <span className="font-mono font-bold text-sm text-slate-700 dark:text-slate-300">
                              {purchase.id.slice(0, 8).toUpperCase()}
                            </span>
                          </td>

                          <td className="px-6">
                            <div className="flex items-center gap-4">
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
                                      navigate(`/supplier/${purchase.supplierId}`);
                                    }}
                                  >
                                    {supplierName.toUpperCase()}
                                    <ChevronRight
                                      size={14}
                                      className="text-[#a1acb8] group-hover:text-[#696cff] transition-colors"
                                    />
                                  </h4>
                                  {(purchase.excludeFromAccounting || suppliers.some((s: any) => s.id === purchase.supplierId && s.excludeFromAccounting)) && (
                                    <div className="flex items-center gap-1.5 leading-none mt-1">
                                      <span className="text-[9px] font-black text-rose-500 tracking-wider">
                                        (EXCLU COMPTA)
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-[13px] text-[#435971] dark:text-[#dbdade] font-bold font-mono">
                                {parseToDate(purchase.date)?.toLocaleDateString('fr-FR', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                }) || '---'}
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
                            {debt > 0 ? (
                              <span className="inline-flex items-center gap-1.5 text-[#ffab00] dark:text-orange-400 text-[11px] font-extrabold uppercase tracking-wide">
                                <AlertCircle size={13} className="shrink-0" /> Partiel / Dette
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-[#71dd37] text-[11px] font-extrabold uppercase tracking-wide">
                                <CheckCircle2 size={13} className="shrink-0" /> Payé / Soldé
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
                                        navigate(
                                          `/supplier-purchase/${purchase.supplierId}/${purchase.id}`
                                        );
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
                                          `/edit-supplier-purchase/${purchase.supplierId}/${purchase.id}`
                                        );
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                    >
                                      <Pencil size={14} />
                                      <span>Modifier</span>
                                    </button>

                                    <hr className="border-[#eceef1] dark:border-[#434460]/40 my-1" />

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        confirm({
                                          title: "Retirer l'achat ?",
                                          message:
                                            "Cette opération dévastera définitivement la pièce de stock et l'historique lié des règlements.",
                                          onConfirm: async () => {
                                            try {
                                              const batch = writeBatch(db);
                                              const paymentsSnap = await getDocs(
                                                query(
                                                  collection(
                                                    db,
                                                    'suppliers',
                                                    purchase.supplierId,
                                                    'payments'
                                                  ),
                                                  where('purchaseId', '==', purchase.id),
                                                  where('ownerId', '==', user.uid)
                                                )
                                              );
                                              paymentsSnap.forEach((d) => batch.delete(d.ref));

                                              // Detach associated bank reconciliations
                                              const reconciliationsSnap = await getDocs(
                                                query(
                                                  collection(db, 'bank_reconciliations'),
                                                  where('matchedDocId', '==', purchase.id),
                                                  where('ownerId', '==', user.uid)
                                                )
                                              );
                                              reconciliationsSnap.forEach((d) => {
                                                batch.update(d.ref, {
                                                  isReconciled: false,
                                                  matchedDocument: '',
                                                  matchedDocId: '',
                                                  matchedDocParentType: '',
                                                  matchedDocParentId: '',
                                                  matchedDocTotalAmount: 0,
                                                });
                                              });

                                              batch.delete(
                                                doc(
                                                  db,
                                                  'suppliers',
                                                  purchase.supplierId,
                                                  'purchases',
                                                  purchase.id
                                                )
                                              );
                                              await batch.commit();
                                              showToast('Achat révoqué avec succès du registre.');
                                            } catch (err) {
                                              showToast('Erreur lors de la révocation', 'error');
                                            }
                                          },
                                        });
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

              {/* MOBILE SOURCING JOURNAL LIST */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:hidden gap-4 p-4">
                {paginatedPurchases.map((purchase, idx) => {
                  const supplierName = suppliersMap[purchase.supplierId] || 'Fournisseur Inconnu';
                  const avatar = getAvatarStyle(supplierName);
                  const initials = supplierName
                    ? supplierName
                        .split(' ')
                        .slice(0, 2)
                        .map((n: string) => n[0])
                        .join('')
                    : '?';

                  const { total, paid, credited, debt } = calculatePurchaseBalance(purchase);

                  return (
                    <motion.div
                      key={purchase.id + "_" + idx}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 p-5 rounded-lg hover:shadow-md transition-all duration-200 flex flex-col justify-between space-y-4"
                      onClick={() =>
                        navigate(`/supplier-purchase/${purchase.supplierId}/${purchase.id}`)
                      }
                    >
                      {/* Header card info */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-9 h-9 ${avatar.bg} ${avatar.text} ring-4 ${avatar.ring} rounded-full flex items-center justify-center shrink-0 font-extrabold text-[11px] uppercase shadow-sm`}
                          >
                            {initials.slice(0, 2)}
                          </div>
                          <div className="min-w-0">
                            <h4
                              className="font-bold text-slate-900 text-[13px] leading-tight truncate pr-1 hover:text-[#696cff] dark:text-[#b1b4ff] transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/supplier/${purchase.supplierId}`);
                              }}
                            >
                              {supplierName}
                            </h4>
                            <div className="flex flex-col gap-0.5 mt-1 font-mono text-[10px]">
                              <span className="text-[#566a7f] dark:text-[#707194] font-bold">
                                N° Interne:{' '}
                                <span className="text-slate-700 dark:text-slate-300 font-extrabold">
                                  {purchase.id.slice(0, 8).toUpperCase()}
                                </span>
                              </span>
                              {(purchase.excludeFromAccounting || suppliers.some((s: any) => s.id === purchase.supplierId && s.excludeFromAccounting)) && (
                                <span className="text-rose-500 font-black tracking-wider text-[9px] uppercase mt-0.5">
                                  (EXCLU DE LA COMPTA)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <span
                          className={
                            debt <= 0
                              ? 'badge-emerald-soft transform scale-90 origin-top-right px-3 py-1 text-emerald-600 bg-emerald-50 rounded font-bold text-xs'
                              : 'badge-rose-soft transform scale-90 origin-top-right px-3 py-1 text-rose-500 bg-rose-50 rounded font-bold text-xs'
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
                              {parseToDate(purchase.date)?.toLocaleDateString('fr-FR', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              }) || '---'}
                            </span>
                          </div>
                          <span>•</span>
                          <span className="font-mono">{purchase.items?.length || 0} POSTE(S)</span>
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
                              className={`h-full transition-all duration-1000 ${debt <= 0 ? 'bg-[#71dd37] dark:bg-transparent' : 'bg-rose-400'}`}
                              style={{ width: `${Math.min(100, (paid / total) * 100 || 0)}%` }}
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
                              {((paid / total) * 100 || 0).toFixed(0)}%
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
                          {debt <= 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-[#71dd37] text-[10px] font-extrabold uppercase tracking-wide mt-1.5 ml-2.5">
                              <CheckCircle2 size={11} className="shrink-0" /> Payé
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[#ffab00] dark:text-orange-400 text-[10px] font-extrabold uppercase tracking-wide mt-1.5 ml-2.5">
                              <AlertCircle size={11} className="shrink-0" /> Restant
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <Link
                            to={`/edit-supplier-purchase/${purchase.supplierId}/${purchase.id}`}
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
                                  if (!purchase.supplierId || !purchase.id) return;
                                  try {
                                    const batch = writeBatch(db);
                                    const paymentsSnap = await getDocs(
                                      query(
                                        collection(
                                          db,
                                          'suppliers',
                                          purchase.supplierId,
                                          'payments'
                                        ),
                                        where('purchaseId', '==', purchase.id),
                                        where('ownerId', '==', user.uid)
                                      )
                                    );
                                    paymentsSnap.forEach((d) => batch.delete(d.ref));

                                    // Detach associated bank reconciliations
                                    const reconciliationsSnap = await getDocs(
                                      query(
                                        collection(db, 'bank_reconciliations'),
                                        where('matchedDocId', '==', purchase.id),
                                        where('ownerId', '==', user.uid)
                                      )
                                    );
                                    reconciliationsSnap.forEach((d) => {
                                      batch.update(d.ref, {
                                        isReconciled: false,
                                        matchedDocument: '',
                                        matchedDocId: '',
                                        matchedDocParentType: '',
                                        matchedDocParentId: '',
                                        matchedDocTotalAmount: 0,
                                      });
                                    });

                                    batch.delete(
                                      doc(
                                        db,
                                        'suppliers',
                                        purchase.supplierId,
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
                      fiches
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
            </div>
          )}
        </AnimatePresence>

        {/* Odoo Supplier Purchases Import Modal */}
        <SupplierPurchaseXlsxModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          existingSuppliers={suppliers}
          ownerId={user?.uid || ''}
          showToast={showToast}
        />

        <SupplierPurchaseMotchoXlsxModal
          isOpen={isMotchoImportModalOpen}
          onClose={() => setIsMotchoImportModalOpen(false)}
          existingSuppliers={suppliers}
          ownerId={user?.uid || ''}
          showToast={showToast}
        />

        {/* PDF Invoice Scanning Modal for Supplier Purchases */}
        <PurchasePdfScanModal
          isOpen={isScanModalOpen}
          onClose={() => setIsScanModalOpen(false)}
          onSuccess={() => {
            // Nothing special needed as the onSnapshot listener automatically pulls new records
          }}
        />
      </div>
    </div>
  );
}

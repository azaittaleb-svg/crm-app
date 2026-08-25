import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  collectionGroup,
  writeBatch,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { Link, useNavigate } from 'react-router-dom';
import {
  Scale,
  ArrowUpRight,
  ArrowDownLeft,
  TrendingUp,
  TrendingDown,
  UserCircle2,
  Building2,
  Info,
  Calendar,
  DollarSign,
  Search,
  ArrowUpDown,
  Phone,
  Mail,
  Sparkles,
  RefreshCcw,
  MessageSquare,
  Check,
  X,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  FileText,
  Plus,
  FileSignature,
  FileSpreadsheet,
  AlertCircle,
  Copy,
  ChevronRight,
  HandCoins,
  Receipt,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { PageHeader } from '../components/PageHeader';
import { usePartnersBalance, PartnerBalance } from "../hooks/usePartnersBalance";


export default function PartnersBalancePage() {
  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();


  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<
    'all' | 'receivables' | 'payables' | 'linked' | 'settled'
  >('all');
  const [sortBy, setSortBy] = useState<
    'net-highest' | 'net-lowest' | 'trade-volume' | 'receivable-only' | 'payable-only' | 'name'
  >('net-highest');
  const { balances, allPurchases, allPayments, isLoading } = usePartnersBalance(user);

  // States for interactive modals
  const [selectedPartnerForClearing, setSelectedPartnerForClearing] =
    useState<PartnerBalance | null>(null);
  const [copiedDraft, setCopiedDraft] = useState(false);
  const [isRegisteringComp, setIsRegisteringComp] = useState(false);

  // Track expanded row IDs
  const [expandedPartnerId, setExpandedPartnerId] = useState<string | null>(null);


  // Overall statistics
  const stats = useMemo(() => {
    let receivable = 0;
    let payable = 0;
    let netDebitCount = 0;
    let netCreditCount = 0;
    let compensationPotential = 0;

    balances.forEach((b) => {
      receivable += b.receivable;
      payable += b.payable;
      if (b.receivable - b.payable > 0.01) netDebitCount++;
      if (b.receivable - b.payable < -0.01) netCreditCount++;

      // A partner with mixed trade profile can compensate the minimum of both balances
      if (b.type === 'both' || b.linkedPartnerId) {
        if (b.receivable > 0.01 && b.payable > 0.01) {
          compensationPotential += Math.min(b.receivable, b.payable);
        }
      }
    });

    return {
      receivable,
      payable,
      net: receivable - payable,
      netDebitCount,
      netCreditCount,
      compensationPotential,
    };
  }, [balances]);

  // Handle client + supplier searches & category tabs
  const filteredBalances = useMemo(() => {
    return balances.filter((b) => {
      const matchSearch =
        b.name.toLowerCase().includes(search.toLowerCase()) ||
        (b.phone && b.phone.includes(search)) ||
        (b.email && b.email.toLowerCase().includes(search.toLowerCase())) ||
        b.id.toLowerCase().includes(search.toLowerCase());

      if (!matchSearch) return false;

      const net = b.receivable - b.payable;

      if (activeTab === 'receivables') return net > 0.01;
      if (activeTab === 'payables') return net < -0.01;
      if (activeTab === 'linked') return b.type === 'both' && (b.payable > 0 || b.receivable > 0);
      if (activeTab === 'settled')
        return Math.abs(net) <= 0.01 && (b.receivable > 0 || b.payable > 0);

      // default: 'all' hides the completely inactive partners showing either receivable or payable
      return Math.abs(b.receivable) > 0.01 || Math.abs(b.payable) > 0.01;
    });
  }, [balances, search, activeTab]);

  // Advanced listings sorting
  const sortedBalances = useMemo(() => {
    const list = [...filteredBalances];
    list.sort((a, b) => {
      const netA = a.receivable - a.payable;
      const netB = b.receivable - b.payable;

      if (sortBy === 'net-highest') {
        return netB - netA;
      }
      if (sortBy === 'net-lowest') {
        return netA - netB;
      }
      if (sortBy === 'trade-volume') {
        const volA = a.receivable + a.payable;
        const volB = b.receivable + b.payable;
        return volB - volA;
      }
      if (sortBy === 'receivable-only') {
        // Highest receivables
        return b.receivable - a.receivable;
      }
      if (sortBy === 'payable-only') {
        // Highest payables
        return b.payable - a.payable;
      }
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      return netB - netA;
    });
    return list;
  }, [filteredBalances, sortBy]);

  // Compensation drafting protocol structure
  const compensationDraftText = useMemo(() => {
    if (!selectedPartnerForClearing) return '';
    const X = selectedPartnerForClearing.receivable;
    const Y = selectedPartnerForClearing.payable;
    const Z = Math.min(X, Y);
    const dateStr = new Date().toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    let residue: string;
    if (X > Y) {
      residue = `• Le compte Client restera créditeur d'un solde débiteur résiduel en notre faveur de : ${(X - Z).toLocaleString('fr-MA')} DH.\n• Le compte Fournisseur sera soldé en totalité (0,00 DH).`;
    } else if (Y > X) {
      residue = `• Le compte Fournisseur restera créditeur d'un solde créditeur résiduel en faveur de [${selectedPartnerForClearing.name}] de : ${(Y - Z).toLocaleString('fr-MA')} DH.\n• Le compte Client sera soldé en totalité (0,00 DH).`;
    } else {
      residue =
        '• Les deux comptes (Client et Fournisseur) seront intégralement soldés (0,00 DH) par extinction réciproque totale.';
    }

    return (
      `PROTOCOLE D'ACCORD DE COMPENSATION BILATÉRALE\n` +
      `---------------------------------------------\n` +
      `Date : ${dateStr}\n\n` +
      `PARTIES CONVENANTES :\n` +
      `1. Maître d'œuvre (Nous/Créancier-Débiteur)\n` +
      `2. Partenaire Mixte : ${selectedPartnerForClearing.name.toUpperCase()}\n\n` +
      `SITUATION COMPTABLE CONCERNÉ :\n` +
      `- Encours Créance Client (Dû par le partenaire): ${X.toLocaleString('fr-MA')} DH\n` +
      `- Encours Dette Fournisseur (Dû au partenaire): ${Y.toLocaleString('fr-MA')} DH\n\n` +
      `TERMES DE LA COMPENSATION :\n` +
      `Conformément au code des obligations et des contrats (DOC) régissant la compensation légale, les deux parties acceptent formellement d'éteindre réciproquement leurs obligations comptables à hauteur de la somme de :\n` +
      `>>> ${Z.toLocaleString('fr-MA')} DH <<<\n\n` +
      `SITUATION DES COMPTES APRÈS COMPENSATION :\n` +
      `${residue}\n\n` +
      `Pour accord commercial, signé en deux exemplaires,\n` +
      `Bon pour compensation mutuelle d'écritures,\n\n` +
      `Signature Entreprise                           Signature Partenaire`
    );
  }, [selectedPartnerForClearing]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(compensationDraftText);
    setCopiedDraft(true);
    showToast("Protocole d'accord de compensation copié dans le presse-papiers !", 'success');
    setTimeout(() => setCopiedDraft(false), 3000);
  };

  const handleExecuteCompensation = async () => {
    if (!selectedPartnerForClearing || !user) return;

    const partner = selectedPartnerForClearing;
    const X = partner.receivable;
    const Y = partner.payable;
    const Z = Math.round(Math.min(X, Y) * 100) / 100;

    if (Z <= 0.01) {
      showToast('Le montant compensable est trop faible pour être exécuté.', 'error');
      return;
    }

    confirm({
      title: "Confirmer la compensation d'écritures",
      message: `Êtes-vous sûr de vouloir appliquer et enregistrer une compensation réciproque de ${Z.toLocaleString('fr-MA')} DH ? Les encours de ce partenaire seront ajustés et les paiements de compensation correspondants seront générés en arrière-plan.`,
      onConfirm: async () => {
        setIsRegisteringComp(true);
        try {
          const batch = writeBatch(db);
          const dateStr = new Date().toLocaleDateString('fr-FR');
          const compNotes = `Compensation bilatérale automatique d'écritures - Accord du ${dateStr}`;

          // Get the transactions
          const txs = getPartnerTransactions(partner);

          // 1. Client side adjustments
          // Filter purchases that are not fully paid
          const clientPurchasesEligible = txs.client.purchases
            .map((pc) => {
              const subtotal = Number(pc.total) || 0;
              const creditedPart = Number(pc.creditNotesTotal) || 0;
              const pymPaid = txs.client.payments
                .filter((pym) => pym.purchaseId === pc.id)
                .reduce((sum, pym) => sum + (Number(pym.amount) || 0), 0);
              const directPaid =
                pc.amountPaid !== undefined && pc.amountPaid !== null
                  ? Number(pc.amountPaid) || 0
                  : pc.paymentStatus === 'paid' || pc.status === 'Payée' || pc.status === 'payée'
                    ? subtotal
                    : 0;
              const paidPart = Math.max(pymPaid, directPaid);
              const due = Math.max(0, subtotal - paidPart - creditedPart);
              return { ...pc, due, paidPart };
            })
            .filter((pc) => pc.due > 0.01)
            // Sort by date (oldest first)
            .sort((a, b) => {
              const dateA = a.date?.toDate ? a.date.toDate().getTime() : 0;
              const dateB = b.date?.toDate ? b.date.toDate().getTime() : 0;
              return dateA - dateB;
            });

          let remainingClientComp = Z;
          for (const pc of clientPurchasesEligible) {
            if (remainingClientComp <= 0.01) break;
            const toApply = Math.round(Math.min(pc.due, remainingClientComp) * 100) / 100;
            if (toApply > 0.01) {
              // Create payment ref
              const paymentRef = doc(collection(db, 'clients', partner.id, 'payments'));
              batch.set(paymentRef, {
                ownerId: user.uid,
                amount: toApply,
                date: serverTimestamp(),
                purchaseId: pc.id,
                notes: compNotes,
              });

              // Update purchase ref
              const purchaseRef = doc(db, 'clients', partner.id, 'purchases', pc.id);
              const newAmountPaid = Math.round((Number(pc.amountPaid || 0) + toApply) * 100) / 100;
              const isPaid = newAmountPaid >= Math.round(Number(pc.total) * 100) / 100;

              const updateData: any = {
                amountPaid: newAmountPaid,
                paymentStatus: isPaid ? 'paid' : 'credit',
              };
              if (isPaid) {
                updateData.paymentDate = new Date();
              }
              batch.update(purchaseRef, updateData);

              remainingClientComp -= toApply;
            }
          }

          // 2. Supplier side adjustments
          const supplierId = partner.linkedPartnerId || partner.id;
          const supplierPurchasesEligible = txs.supplier.purchases
            .map((pc) => {
              const subtotal = Number(pc.total) || 0;
              const creditedPart = Number(pc.creditNotesTotal) || 0;
              const pymPaid = txs.supplier.payments
                .filter((pym) => pym.purchaseId === pc.id)
                .reduce((sum, pym) => sum + (Number(pym.amount) || 0), 0);
              const directPaid =
                pc.amountPaid !== undefined && pc.amountPaid !== null
                  ? Number(pc.amountPaid) || 0
                  : pc.paymentStatus === 'paid' || pc.status === 'Payée' || pc.status === 'payée'
                    ? subtotal
                    : 0;
              const paidPart = Math.max(pymPaid, directPaid);
              const due = Math.max(0, subtotal - paidPart - creditedPart);
              return { ...pc, due, paidPart };
            })
            .filter((pc) => pc.due > 0.01)
            // Sort by date (oldest first)
            .sort((a, b) => {
              const dateA = a.date?.toDate ? a.date.toDate().getTime() : 0;
              const dateB = b.date?.toDate ? b.date.toDate().getTime() : 0;
              return dateA - dateB;
            });

          let remainingSupplierComp = Z;
          for (const pc of supplierPurchasesEligible) {
            if (remainingSupplierComp <= 0.01) break;
            const toApply = Math.round(Math.min(pc.due, remainingSupplierComp) * 100) / 100;
            if (toApply > 0.01) {
              // Create payment ref
              const paymentRef = doc(collection(db, 'suppliers', supplierId, 'payments'));
              batch.set(paymentRef, {
                ownerId: user.uid,
                amount: toApply,
                date: serverTimestamp(),
                purchaseId: pc.id,
                notes: compNotes,
              });

              // Update purchase ref
              const purchaseRef = doc(db, 'suppliers', supplierId, 'purchases', pc.id);
              const newAmountPaid = Math.round((Number(pc.amountPaid || 0) + toApply) * 100) / 100;
              const isPaid = newAmountPaid >= Math.round(Number(pc.total) * 100) / 100;

              const updateData: any = {
                amountPaid: newAmountPaid,
                paymentStatus: isPaid ? 'paid' : 'credit',
              };
              if (isPaid) {
                updateData.paymentDate = new Date();
              }
              batch.update(purchaseRef, updateData);

              remainingSupplierComp -= toApply;
            }
          }

          // Commit batch!
          await batch.commit();
          showToast(
            `Compensation de ${Z.toLocaleString('fr-MA')} DH enregistrée avec succès !`,
            'success'
          );
          setSelectedPartnerForClearing(null);
        } catch (error: any) {
          console.error('Error committing compensation batch:', error);
          showToast(
            `Erreur lors de l'enregistrement de la compensation: ${error.message}`,
            'error'
          );
        } finally {
          setIsRegisteringComp(false);
        }
      },
    });
  };

  const getAvatarStyle = (name: string) => {
    const char = name ? name.trim().charAt(0).toUpperCase() : '?';
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      A: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent dark:border-transparent',
      },
      B: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent dark:border-transparent',
      },
      C: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent dark:border-transparent',
      },
      D: {
        bg: 'bg-transparent',
        text: 'text-[#ff3e1d] dark:text-[#ff3e1d]',
        border: 'border-transparent dark:border-transparent',
      },
      E: {
        bg: 'bg-transparent',
        text: 'text-[#ff3e1d] dark:text-[#ff3e1d]',
        border: 'border-transparent dark:border-transparent',
      },
      F: { bg: 'bg-transparent', text: 'text-fuchsia-600', border: 'border-fuchsia-100' },
      G: { bg: 'bg-transparent', text: 'text-violet-600', border: 'border-violet-100' },
      H: {
        bg: 'bg-transparent',
        text: 'text-[#696cff] dark:text-[#b1b4ff]',
        border: 'border-transparent dark:border-transparent',
      },
      I: {
        bg: 'bg-transparent',
        text: 'text-[#03c3ec] dark:text-[#03c3ec]',
        border: 'border-transparent dark:border-transparent',
      },
      J: {
        bg: 'bg-transparent',
        text: 'text-[#71dd37] dark:text-[#71dd37]',
        border: 'border-transparent dark:border-transparent',
      },
      K: {
        bg: 'bg-transparent',
        text: 'text-[#71dd37] dark:text-[#71dd37]',
        border: 'border-transparent dark:border-transparent',
      },
      L: {
        bg: 'bg-transparent',
        text: 'text-[#ffab00] dark:text-[#ffab00]',
        border: 'border-transparent dark:border-transparent',
      },
      M: {
        bg: 'bg-transparent',
        text: 'text-[#ffab00] dark:text-[#ffab00]',
        border: 'border-transparent dark:border-transparent',
      },
      N: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-100' },
      O: { bg: 'bg-neutral-50', text: 'text-neutral-600', border: 'border-neutral-150' },
    };
    return (
      colors[char] || { bg: 'bg-stone-50', text: 'text-stone-600', border: 'border-stone-100' }
    );
  };

  const getPartnerTransactions = (partner: PartnerBalance) => {
    // 1- Client details
    const clPurchases = allPurchases.filter(
      (p) =>
        p.clientId === partner.id &&
        p.type !== 'devis' &&
        p.status !== 'Annulée' &&
        p.status !== 'Brouillon'
    );
    const clPayments = allPayments.filter((pay) => {
      const p = allPurchases.find((pr) => pr.id === pay.purchaseId);
      return p && p.clientId === partner.id;
    });

    // 2- Supplier details
    // Match either partner's root id or their specific linkedPartnerId property
    const supId = partner.linkedPartnerId || partner.id;
    const spPurchases = allPurchases.filter(
      (p) =>
        p.supplierId === supId &&
        p.type !== 'devis' &&
        p.status !== 'Annulée' &&
        p.status !== 'Brouillon'
    );
    const spPayments = allPayments.filter((pay) => {
      const p = allPurchases.find((pr) => pr.id === pay.purchaseId);
      return p && p.supplierId === supId;
    });

    return {
      client: {
        purchases: clPurchases,
        payments: clPayments,
      },
      supplier: {
        purchases: spPurchases,
        payments: spPayments,
      },
    };
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <div className="w-12 h-12 border-[3.5px] border-slate-200 border-t-brand-600 rounded-full animate-spin"></div>
        <p className="text-slate-400 font-extrabold uppercase tracking-widest text-[10px]">
          Analyse des balances comptables...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-transparent custom-scrollbar">
      <PageHeader
        title="Balance des Partenaires"
        subtitle="Suivi unifié des positions nettes et compensations"
        icon={<Scale size={20} />}
        actions={
          <div className="flex items-center gap-2">
            {stats.compensationPotential > 0 && (
              <button
                onClick={() => {
                  // Pre-load prompt for first eligible partner
                  const firstEligible = balances.find(
                    (b) =>
                      (b.type === 'both' || b.linkedPartnerId) && b.receivable > 1 && b.payable > 1
                  );
                  if (firstEligible) {
                    setSelectedPartnerForClearing(firstEligible);
                  }
                }}
                className="bg-[#696cff]/10 hover:bg-[#696cff]/15 text-[#696cff] border border-[#696cff]/20 px-4 py-2 rounded-lg font-bold uppercase tracking-wider text-[10px] flex items-center gap-1.5 transition-all shadow-sm"
              >
                <Sparkles size={14} className="text-[#696cff] animate-pulse" />
                <span>Simuler compensation</span>
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 space-y-6">
        <div className="w-full space-y-6">
          {/* Top Level Financial Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 font-sans">
            {/* 1. Receivables Card */}
            <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-800/40 rounded-xl p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] hover:shadow-[0_4px_16px_rgba(15,23,42,0.08)] transition-all relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold text-[#566a7f] dark:text-[#a3a4cc] uppercase tracking-wider">
                    Créances Actives
                  </p>
                  <p className="text-xl font-mono font-bold text-[#222222] dark:text-[#dbdade] tracking-tight mt-1.5">
                    {stats.receivable.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-xs font-sans font-medium text-slate-400">DH</span>
                  </p>
                  <p className="text-[11px] text-[#4fb922] dark:text-[#71dd37] font-medium mt-2 flex items-center gap-1">
                    <TrendingUp size={12} />
                    <span>Chez {stats.netDebitCount} clients</span>
                  </p>
                </div>
                <div className="w-10 h-10 bg-[#71dd37]/10 dark:bg-[#71dd37]/15 text-[#4fb922] dark:text-[#71dd37] flex items-center justify-center rounded-lg shrink-0">
                  <ArrowUpRight size={18} />
                </div>
              </div>
            </div>

            {/* 2. Payables Card */}
            <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-800/40 rounded-xl p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] hover:shadow-[0_4px_16px_rgba(15,23,42,0.08)] transition-all relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold text-[#566a7f] dark:text-[#a3a4cc] uppercase tracking-wider">
                    Dettes Fournisseurs
                  </p>
                  <p className="text-xl font-mono font-bold text-[#222222] dark:text-[#dbdade] tracking-tight mt-1.5">
                    {stats.payable.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-xs font-sans font-medium text-slate-400">DH</span>
                  </p>
                  <p className="text-[11px] text-[#ff3e1d] dark:text-[#ff3e1d] font-medium mt-2 flex items-center gap-1">
                    <TrendingDown size={12} />
                    <span>Chez {stats.netCreditCount} fournisseurs</span>
                  </p>
                </div>
                <div className="w-10 h-10 bg-[#ff3e1d]/10 dark:bg-[#ff3e1d]/15 text-[#ff3e1d] flex items-center justify-center rounded-lg shrink-0">
                  <ArrowDownLeft size={18} />
                </div>
              </div>
            </div>

            {/* 3. Compensation Opportunity Badge */}
            <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-800/40 rounded-xl p-5 shadow-[0_2px_12px_rgba(15,23,42,0.04)] hover:shadow-[0_4px_16px_rgba(15,23,42,0.08)] transition-all relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold text-[#566a7f] dark:text-[#a3a4cc] uppercase tracking-wider">
                    Compensations Possibles
                  </p>
                  <p className="text-xl font-mono font-bold text-[#ffab00] dark:text-[#ffab00] tracking-tight mt-1.5">
                    {stats.compensationPotential.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-xs font-sans font-medium text-orange-400/80">DH</span>
                  </p>
                  <p className="text-[11px] text-[#ffab00] font-medium mt-2 flex items-center gap-1">
                    <Sparkles size={12} className="animate-pulse" />
                    <span>Rapprochement en attente</span>
                  </p>
                </div>
                <div className="w-10 h-10 bg-[#ffab00]/10 dark:bg-[#ffab00]/15 text-[#ffab00] flex items-center justify-center rounded-lg shrink-0">
                  <HandCoins size={18} />
                </div>
              </div>
            </div>

            {/* 4. Virtual Cash Flow Summary (Net Overall) */}
            <div className="bg-[#1e1e2d] dark:bg-[#232333] border border-slate-800 dark:border-slate-700/50 rounded-xl p-5 shadow-[0_2px_12px_rgba(15,23,42,0.12)] hover:shadow-[0_4px_16px_rgba(15,23,42,0.18)] transition-all relative overflow-hidden group">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold text-[#a1acb8] dark:text-[#a1acb8] uppercase tracking-wider">
                    Trésorerie d'Échange Nette
                  </p>
                  <p
                    className={`text-xl font-mono font-bold tracking-tight mt-1.5 ${stats.net >= 0 ? 'text-[#71dd37]' : 'text-[#ff3e1d]'}`}
                  >
                    {stats.net >= 0 ? '+' : ''}
                    {stats.net.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-xs font-sans font-medium text-slate-500">DH</span>
                  </p>
                  <p className="text-[10px] text-[#a1acb8]/80 font-bold mt-2 uppercase tracking-wide">
                    {stats.net >= 0 ? 'SOLDE DÉBITEUR GLOBAL' : 'SOLDE CRÉDITEUR GLOBAL'}
                  </p>
                </div>
                <div
                  className={`w-10 h-10 flex items-center justify-center rounded-lg shrink-0 ${stats.net >= 0 ? 'bg-[#71dd37]/10 text-[#71dd37]' : 'bg-[#ff3e1d]/10 text-[#ff3e1d]'}`}
                >
                  <Scale size={18} />
                </div>
              </div>
            </div>
          </div>

          {/* Quick Notice detailing the compensation potential and strategic utility */}
          {stats.compensationPotential > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#696cff]/10 dark:bg-[#696cff]/15 border border-[#696cff]/20 dark:border-[#696cff]/30 p-5 rounded-xl text-[#696cff] dark:text-[#b1b4ff] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm"
            >
              <div className="flex items-start gap-3.5">
                <div className="p-3 bg-[#696cff]/15 rounded-xl text-[#696cff] dark:text-[#b1b4ff] border border-[#696cff]/10 shrink-0 mt-0.5">
                  <FileSignature size={20} />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[#696cff] dark:text-[#b1b4ff]">
                    Régularisation optimisée sans décaissement
                  </h4>
                  <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 max-w-2xl font-medium">
                    Vous disposez de{' '}
                    <strong className="text-[#696cff] dark:text-[#b1b4ff] font-mono">
                      {stats.compensationPotential.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </strong>{' '}
                    de factures compensables réciproquement chez vos partenaires à double profil.
                    Conclure ces rapprochements éteint vos dettes tout en réduisant vos créances
                    clients, sans aucun flux de trésorerie sortant.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  const firstEligible = balances.find(
                    (b) =>
                      (b.type === 'both' || b.linkedPartnerId) && b.receivable > 1 && b.payable > 1
                  );
                  if (firstEligible) setSelectedPartnerForClearing(firstEligible);
                }}
                className="bg-[#696cff] text-white px-4 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider hover:bg-[#696cff]/90 active:scale-95 transition-all self-stretch md:self-auto text-center shrink-0 cursor-pointer shadow-[0_2px_4px_rgba(105,108,255,0.4)]"
              >
                Lancer le Rapprochement
              </button>
            </motion.div>
          )}

          {/* MERGED CONTROLS & TABLE DIRECTORY */}
          <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-800/40 rounded-lg shadow-[0_2px_12px_rgba(15,23,42,0.04)] overflow-hidden">
            {/* Table Filters & Live Search Panel */}
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800/50 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              {/* Quick tabs - scrollable on mobile and compact on desktop */}
              <div className="flex flex-wrap gap-1.5 items-center overflow-x-auto overflow-y-hidden max-w-full flex-nowrap scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none]">
                <button
                  onClick={() => setActiveTab('all')}
                  className={`h-9 px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'all'
                      ? 'bg-[#696cff]/10 text-[#696cff] border-[#696cff]/20'
                      : 'bg-transparent text-[#566a7f] dark:text-[#a3a4cc] hover:bg-slate-50 dark:hover:bg-[#232333]/60 border-transparent'
                  }`}
                >
                  <span>Tous</span>
                  <span
                    className={`font-mono px-1.5 py-0.5 rounded text-[10px] font-bold ${activeTab === 'all' ? 'bg-[#696cff]/15 text-[#696cff]' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}
                  >
                    {
                      balances.filter(
                        (b) => Math.abs(b.receivable) > 0.01 || Math.abs(b.payable) > 0.01
                      ).length
                    }
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('receivables')}
                  className={`h-9 px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'receivables'
                      ? 'bg-[#71dd37]/10 text-[#4fb922] dark:text-[#71dd37] border-[#71dd37]/20'
                      : 'bg-transparent text-[#566a7f] dark:text-[#a3a4cc] hover:bg-slate-50 dark:hover:bg-[#232333]/60 border-transparent'
                  }`}
                >
                  <span>Créances</span>
                  <span
                    className={`font-mono px-1.5 py-0.5 rounded text-[10px] font-bold ${activeTab === 'receivables' ? 'bg-[#71dd37]/15 text-[#4fb922] dark:text-[#71dd37]' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}
                  >
                    {balances.filter((b) => b.receivable - b.payable > 0.01).length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('payables')}
                  className={`h-9 px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'payables'
                      ? 'bg-[#ff3e1d]/10 text-[#ff3e1d] border-[#ff3e1d]/20'
                      : 'bg-transparent text-[#566a7f] dark:text-[#a3a4cc] hover:bg-slate-50 dark:hover:bg-[#232333]/60 border-transparent'
                  }`}
                >
                  <span>Dettes</span>
                  <span
                    className={`font-mono px-1.5 py-0.5 rounded text-[10px] font-bold ${activeTab === 'payables' ? 'bg-[#ff3e1d]/15 text-[#ff3e1d]' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}
                  >
                    {balances.filter((b) => b.receivable - b.payable < -0.01).length}
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('linked')}
                  className={`h-9 px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'linked'
                      ? 'bg-[#ffab00]/10 text-[#ffab00] border-[#ffab00]/20'
                      : 'bg-transparent text-[#566a7f] dark:text-[#a3a4cc] hover:bg-slate-50 dark:hover:bg-[#232333]/60 border-transparent'
                  }`}
                >
                  <span>Mixtes</span>
                  <span
                    className={`font-mono px-1.5 py-0.5 rounded text-[10px] font-bold ${activeTab === 'linked' ? 'bg-[#ffab00]/15 text-[#ffab00]' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}
                  >
                    {
                      balances.filter(
                        (b) => b.type === 'both' && (b.payable > 0 || b.receivable > 0)
                      ).length
                    }
                  </span>
                </button>

                <button
                  onClick={() => setActiveTab('settled')}
                  className={`h-9 px-3 py-1.5 rounded-lg border text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer ${
                    activeTab === 'settled'
                      ? 'bg-[#566a7f]/10 text-[#566a7f] border-[#566a7f]/20'
                      : 'bg-transparent text-[#566a7f] dark:text-[#a3a4cc] hover:bg-slate-50 dark:hover:bg-[#232333]/60 border-transparent'
                  }`}
                >
                  <span>Soldés</span>
                  <span
                    className={`font-mono px-1.5 py-0.5 rounded text-[10px] font-bold ${activeTab === 'settled' ? 'bg-[#566a7f]/15 text-[#566a7f]' : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500'}`}
                  >
                    {
                      balances.filter(
                        (b) =>
                          Math.abs(b.receivable - b.payable) <= 0.01 &&
                          (b.payable > 0 || b.receivable > 0)
                      ).length
                    }
                  </span>
                </button>
              </div>

              {/* Live Search only */}
              <div className="flex items-center gap-3 w-full xl:w-72 self-stretch xl:self-auto shrink-0">
                <div className="relative flex-1 w-full">
                  <Search
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
                    size={14}
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher par nom, tél..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-850/40 border border-slate-200/60 dark:border-slate-800/40 rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:ring-1 focus:ring-[#696cff] focus:border-[#696cff] outline-none transition-all font-medium"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 rounded-full transition-all"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Master Listing Panel */}
            <div className="space-y-0 text-left">
              <AnimatePresence mode="wait">
                {sortedBalances.length === 0 ? (
                  <motion.div
                    key="empty-ledger"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="py-16 text-center space-y-4 bg-white"
                  >
                    <div className="w-16 h-16 bg-slate-50 border border-slate-150 rounded-2xl flex items-center justify-center mx-auto text-slate-350">
                      <Scale size={32} />
                    </div>
                    <div className="max-w-xs mx-auto">
                      <h3 className="text-sm font-bold text-slate-800">Aucun partenaire trouvé</h3>
                      <p className="text-slate-450 text-[11px] font-bold uppercase tracking-widest mt-1 leading-relaxed">
                        Modifiez votre filtre ou entrez un autre terme de recherche pour trouver vos
                        relations commerciales.
                      </p>
                    </div>
                  </motion.div>
                ) : (
                  <div className="space-y-4">
                    <div className="hidden lg:block overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-100/70 dark:bg-[#232333]/50 border-b border-slate-200/60 dark:border-slate-800/40 text-[11px] uppercase tracking-widest font-semibold text-[#566a7f] dark:text-[#a3a4cc] select-none">
                            <th className="py-3 px-5 text-left">Partenaire & Identité</th>
                            <th className="py-3 px-5 text-center">Type de Profil</th>
                            <th className="py-3 px-5 text-right">Créance Client</th>
                            <th className="py-3 px-5 text-right">Dette Fournisseur</th>
                            <th className="py-3 px-5 text-right">Situation Nette</th>
                            <th className="py-3 px-5 text-center">Indicateur d'Échange</th>
                            <th className="py-3 px-5 text-center">Actions Directes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedBalances.map((item) => {
                            const net = item.receivable - item.payable;
                            const tradeVolume = item.receivable + item.payable;
                            const isBoth = item.type === 'both' || !!item.linkedPartnerId;
                            const canCompensate =
                              isBoth && item.receivable > 0.01 && item.payable > 0.01;

                            const avatar = getAvatarStyle(item.name);
                            const initials = item.name
                              ? item.name
                                  .split(' ')
                                  .slice(0, 2)
                                  .map((n) => n[0])
                                  .join('')
                              : '?';

                            const isExpanded = expandedPartnerId === item.id;
                            const txs = isExpanded ? getPartnerTransactions(item) : null;

                            return (
                              <React.Fragment key={item.id}>
                                <tr
                                  className={`border-b border-slate-100 dark:border-slate-800/50 hover:bg-[#f5f5f9]/40 dark:hover:bg-[#232333]/30 transition-colors group h-14 cursor-pointer ${isExpanded ? 'bg-slate-50/60 dark:bg-[#232333]/10' : ''}`}
                                  onClick={() => setExpandedPartnerId(isExpanded ? null : item.id)}
                                >
                                  {/* Profile Details */}
                                  <td className="px-5 py-3">
                                    <div
                                      className="flex items-center gap-3.5 group/profile cursor-pointer"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const route =
                                          item.type === 'supplier'
                                            ? `/supplier/${item.linkedPartnerId || item.id}`
                                            : `/client/${item.id}`;
                                        navigate(route);
                                      }}
                                      title="Voir la fiche de profil complet"
                                    >
                                      <div
                                        className={`w-8.5 h-8.5 ${avatar.bg} ${avatar.text} ring-4 ring-slate-50 dark:ring-[#2b2c40] rounded-lg flex items-center justify-center shrink-0 font-bold text-[11px] uppercase transition-transform duration-300 group-hover:scale-105 shadow-2xs`}
                                      >
                                        {initials.slice(0, 2)}
                                      </div>
                                      <div className="min-w-0 flex flex-col">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-[13px] font-bold text-[#566a7f] dark:text-[#dbdade] hover:text-[#696cff] dark:hover:text-[#b1b4ff] leading-tight truncate max-w-[180px] transition-colors flex items-center gap-1">
                                            {item.name}
                                            <ExternalLink
                                              size={10}
                                              className="opacity-0 group-hover/profile:opacity-100 transition-opacity text-[#696cff] dark:text-[#b1b4ff]"
                                            />
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-2 text-[9px] font-mono text-[#a1acb8] dark:text-[#707194] mt-0.5 leading-none uppercase">
                                          <span>ID: {item.id.slice(0, 7)}</span>
                                          {item.phone && (
                                            <>
                                              <span>•</span>
                                              <span className="text-[#a1acb8] dark:text-[#707194] font-sans">
                                                {item.phone}
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </td>

                                  {/* Profile Status Badge */}
                                  <td className="px-5 py-3 text-center">
                                    <span
                                      className={`text-[11px] font-bold uppercase tracking-wider ${item.type === 'both' ? 'text-[#ffab00]' : item.type === 'client' ? 'text-[#696cff]' : 'text-slate-500 dark:text-slate-400'}`}
                                    >
                                      {item.type === 'both'
                                        ? 'Mixte'
                                        : item.type === 'client'
                                          ? 'Client'
                                          : 'Fournisseur'}
                                    </span>
                                  </td>

                                  {/* Client side (Receivables) */}
                                  <td className="px-5 py-3 text-right whitespace-nowrap">
                                    <span
                                      className={`font-mono text-[13px] font-bold ${item.receivable > 0.01 ? 'text-[#222222] dark:text-[#dbdade]' : 'text-[#a1acb8] dark:text-[#707194]'}`}
                                    >
                                      {item.receivable.toLocaleString('fr-FR', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}
                                    </span>
                                    <span className="text-[10px] text-[#a1acb8] dark:text-[#707194] font-sans font-medium ml-1">
                                      DH
                                    </span>
                                  </td>

                                  {/* Supplier side (Payables) */}
                                  <td className="px-5 py-3 text-right whitespace-nowrap">
                                    <span
                                      className={`font-mono text-[13px] font-bold ${item.payable > 0.01 ? 'text-[#222222] dark:text-[#dbdade]' : 'text-[#a1acb8] dark:text-[#707194]'}`}
                                    >
                                      {item.payable.toLocaleString('fr-FR', {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}
                                    </span>
                                    <span className="text-[10px] text-[#a1acb8] dark:text-[#707194] font-sans font-medium ml-1">
                                      DH
                                    </span>
                                  </td>

                                  {/* Situation Nette */}
                                  <td className="px-5 py-3 text-right whitespace-nowrap">
                                    <div className="space-y-0.5">
                                      <span
                                        className={`font-mono text-[13px] font-bold ${net > 0.01 ? 'text-[#4fb922] dark:text-[#71dd37]' : net < -0.01 ? 'text-[#ff3e1d]' : 'text-[#566a7f] dark:text-[#a3a4cc]'}`}
                                      >
                                        {net > 0.01 ? '+' : ''}
                                        {net.toLocaleString('fr-FR', {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        })}{' '}
                                        DH
                                      </span>
                                      <p
                                        className={`text-[8.5px] font-semibold uppercase tracking-wider ${net > 0.01 ? 'text-[#4fb922] dark:text-[#71dd37]' : net < -0.01 ? 'text-[#ff3e1d]' : 'text-slate-400 dark:text-slate-500'}`}
                                      >
                                        {net > 0.01
                                          ? 'Solde Débiteur'
                                          : net < -0.01
                                            ? 'Solde Créditeur'
                                            : 'Compte Soldé'}
                                      </p>
                                    </div>
                                  </td>

                                  {/* Trade slider view */}
                                  <td className="px-5 py-3 text-center min-w-[140px]">
                                    {tradeVolume > 0.01 ? (
                                      <div className="flex flex-col items-center justify-center max-w-[110px] mx-auto space-y-1">
                                        <div className="w-full bg-[#f5f5f9] dark:bg-[#232333]/50 h-1.5 rounded-full overflow-hidden flex">
                                          <div
                                            className="bg-[#696cff] h-full"
                                            style={{
                                              width: `${(item.receivable / tradeVolume) * 100}%`,
                                            }}
                                            title={`Volume Client: ${Math.round((item.receivable / tradeVolume) * 100)}%`}
                                          />
                                          <div
                                            className="bg-[#ffab00] h-full"
                                            style={{
                                              width: `${(item.payable / tradeVolume) * 100}%`,
                                            }}
                                            title={`Volume Fournisseur: ${Math.round((item.payable / tradeVolume) * 100)}%`}
                                          />
                                        </div>
                                        <div className="flex items-center justify-between w-full text-[8px] font-mono text-[#a1acb8] dark:text-[#707194]">
                                          <span>
                                            Cl: {Math.round((item.receivable / tradeVolume) * 100)}%
                                          </span>
                                          <span>
                                            Fou: {Math.round((item.payable / tradeVolume) * 100)}%
                                          </span>
                                        </div>
                                      </div>
                                    ) : (
                                      <span className="text-[10px] text-[#a1acb8] dark:text-[#707194] font-semibold uppercase">
                                        Sans activité
                                      </span>
                                    )}
                                  </td>

                                  {/* Custom Action triggers */}
                                  <td
                                    className="px-5 py-3 text-center"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="flex items-center justify-center gap-1.5">
                                      {/* Phone Actions */}
                                      {item.phone ? (
                                        <a
                                          href={`tel:${item.phone}`}
                                          className="p-1.5 text-[#566a7f] hover:text-[#696cff] dark:text-[#a3a4cc] dark:hover:text-[#b1b4ff] hover:bg-slate-50 dark:hover:bg-[#232333] rounded-lg transition-colors"
                                          title="Appeler"
                                        >
                                          <Phone size={14} strokeWidth={2.2} />
                                        </a>
                                      ) : null}

                                      {/* Instant Compensation simulator for double profile */}
                                      {canCompensate && (
                                        <button
                                          onClick={() => setSelectedPartnerForClearing(item)}
                                          className="p-1.5 text-[#ffab00] hover:text-[#ffab00]/80 hover:bg-[#ffab00]/10 rounded-lg transition-colors cursor-pointer"
                                          title="Calculer Compensation"
                                        >
                                          <Sparkles
                                            size={14}
                                            strokeWidth={2.2}
                                            className="animate-pulse"
                                          />
                                        </button>
                                      )}

                                      {/* Accordion trigger icon */}
                                      <button
                                        onClick={() =>
                                          setExpandedPartnerId(isExpanded ? null : item.id)
                                        }
                                        className="p-1.5 text-[#566a7f] hover:text-[#696cff] dark:text-[#a3a4cc] dark:hover:text-[#dbdade] hover:bg-slate-50 dark:hover:bg-[#232333] rounded-lg transition-colors cursor-pointer"
                                        title={isExpanded ? 'Replier' : 'Déplier les bons'}
                                      >
                                        {isExpanded ? (
                                          <ChevronUp size={14} strokeWidth={2.2} />
                                        ) : (
                                          <ChevronDown size={14} strokeWidth={2.2} />
                                        )}
                                      </button>
                                    </div>
                                  </td>
                                </tr>

                                {/* COLLAPSIBLE LEDGER EXPANDER DETAILS */}
                                <AnimatePresence>
                                  {isExpanded && txs && (
                                    <tr className="bg-transparent">
                                      <td
                                        colSpan={7}
                                        className="border-t border-b border-slate-100 dark:border-slate-800/50 p-5"
                                      >
                                        <motion.div
                                          initial={{ opacity: 0, height: 0 }}
                                          animate={{ opacity: 1, height: 'auto' }}
                                          exit={{ opacity: 0, height: 0 }}
                                          className="overflow-hidden font-sans"
                                        >
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {/* LEFT GRID: Client transactions ledger */}
                                            <div className="bg-white dark:bg-[#1e1e2d] border border-slate-150 dark:border-slate-800 p-4 rounded-xl shadow-xs">
                                              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-3">
                                                <div className="flex items-center gap-1.5">
                                                  <div className="bg-transparent dark:bg-transparent text-[#696cff] dark:text-[#b1b4ff]">
                                                    <UserCircle2 size={15} />
                                                  </div>
                                                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#dbdade]">
                                                    Facturation Client (Nos Ventes)
                                                  </span>
                                                </div>
                                                <div className="text-right">
                                                  <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                                                    Encours Brut
                                                  </p>
                                                  <p className="text-xs font-mono font-bold text-[#222222] dark:text-[#dbdade]">
                                                    {item.receivable.toLocaleString('fr-FR', {
                                                      minimumFractionDigits: 2,
                                                      maximumFractionDigits: 2,
                                                    })}{' '}
                                                    DH
                                                  </p>
                                                </div>
                                              </div>

                                              {txs.client.purchases.length === 0 ? (
                                                <div className="text-center py-6">
                                                  <Receipt
                                                    size={18}
                                                    className="mx-auto text-slate-300 dark:text-slate-600 mb-1"
                                                  />
                                                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                                                    Aucune facture émise
                                                  </p>
                                                </div>
                                              ) : (
                                                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                                                  {txs.client.purchases.map((pc) => {
                                                    // calculate remaining direct
                                                    const subtotal = Number(pc.total) || 0;
                                                    const creditedPart = Number(pc.creditNotesTotal) || 0;
                                                    const pymPaid = txs.client.payments
                                                      .filter((pym) => pym.purchaseId === pc.id)
                                                      .reduce(
                                                        (sum, pym) =>
                                                          sum + (Number(pym.amount) || 0),
                                                        0
                                                      );
                                                    const directPaid =
                                                      pc.amountPaid !== undefined && pc.amountPaid !== null
                                                        ? Number(pc.amountPaid) || 0
                                                        : pc.paymentStatus === 'paid' || pc.status === 'Payée' || pc.status === 'payée'
                                                          ? subtotal
                                                          : 0;
                                                    const paidPart = Math.max(pymPaid, directPaid);
                                                    const dueForThis = Math.max(
                                                      0,
                                                      subtotal - paidPart - creditedPart
                                                    );

                                                    return (
                                                      <div
                                                        key={pc.id}
                                                        className="p-2.5 bg-slate-50 dark:bg-slate-800/30 border border-slate-150/40 dark:border-slate-800/40 rounded-lg hover:bg-[#696cff]/5 dark:hover:bg-[#696cff]/10 transition-all flex items-center justify-between gap-1 cursor-pointer"
                                                        onClick={() =>
                                                          navigate(`/purchase/${item.id}/${pc.id}`)
                                                        }
                                                      >
                                                        <div className="min-w-0">
                                                          <div className="flex items-center gap-1.5">
                                                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">
                                                              {pc.description || 'Vente de Stock'}
                                                            </p>
                                                            <span
                                                              className={`text-[9px] font-bold uppercase tracking-wider ${dueForThis <= 0 ? 'text-[#4fb922] dark:text-[#71dd37]' : 'text-[#ffab00]'}`}
                                                            >
                                                              {dueForThis <= 0
                                                                ? 'Payée'
                                                                : 'À crédit'}
                                                            </span>
                                                          </div>
                                                          <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 flex items-center gap-1 mt-0.5 font-mono">
                                                            <Calendar size={10} />
                                                            <span>
                                                              {pc.date?.toDate
                                                                ? pc.date
                                                                    .toDate()
                                                                    .toLocaleDateString('fr-FR', {
                                                                      day: '2-digit',
                                                                      month: 'short',
                                                                    })
                                                                : '---'}
                                                            </span>
                                                            <span>• Ref: ''</span>
                                                          </p>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                          <p className="text-[11px] font-mono font-bold text-[#222222] dark:text-[#dbdade]">
                                                            {subtotal.toLocaleString('fr-FR', {
                                                              minimumFractionDigits: 2,
                                                              maximumFractionDigits: 2,
                                                            })}{' '}
                                                            DH
                                                          </p>
                                                          {dueForThis > 0 && (
                                                            <p className="text-[9px] font-mono font-bold text-[#ff3e1d]">
                                                              Reste:{' '}
                                                              {dueForThis.toLocaleString('fr-FR', {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                              })}{' '}
                                                              DH
                                                            </p>
                                                          )}
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                            </div>

                                            {/* RIGHT GRID: Supplier transactions ledger */}
                                            <div className="bg-white dark:bg-[#1e1e2d] border border-slate-150 dark:border-slate-800 p-4 rounded-xl shadow-xs">
                                              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-3">
                                                <div className="flex items-center gap-1.5">
                                                  <div className="bg-transparent dark:bg-transparent text-[#ff3e1d] dark:text-[#ff3e1d]">
                                                    <Building2 size={15} />
                                                  </div>
                                                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#dbdade]">
                                                    Sourcing Fournisseur (Nos Approvisionnements)
                                                  </span>
                                                </div>
                                                <div className="text-right">
                                                  <p className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                                                    Encours Brut
                                                  </p>
                                                  <p className="text-xs font-mono font-bold text-[#222222] dark:text-[#dbdade]">
                                                    {item.payable.toLocaleString('fr-FR', {
                                                      minimumFractionDigits: 2,
                                                      maximumFractionDigits: 2,
                                                    })}{' '}
                                                    DH
                                                  </p>
                                                </div>
                                              </div>

                                              {txs.supplier.purchases.length === 0 ? (
                                                <div className="text-center py-6">
                                                  <Building2
                                                    size={18}
                                                    className="mx-auto text-slate-300 dark:text-slate-600 mb-1"
                                                  />
                                                  <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                                                    Aucune facture enregistrée
                                                  </p>
                                                </div>
                                              ) : (
                                                <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                                                  {txs.supplier.purchases.map((pc) => {
                                                    const subtotal = Number(pc.total) || 0;
                                                    const creditedPart = Number(pc.creditNotesTotal) || 0;
                                                    const pymPaid = txs.supplier.payments
                                                      .filter((pym) => pym.purchaseId === pc.id)
                                                      .reduce(
                                                        (sum, pym) =>
                                                          sum + (Number(pym.amount) || 0),
                                                        0
                                                      );
                                                    const directPaid =
                                                      pc.amountPaid !== undefined && pc.amountPaid !== null
                                                        ? Number(pc.amountPaid) || 0
                                                        : pc.paymentStatus === 'paid' || pc.status === 'Payée' || pc.status === 'payée'
                                                          ? subtotal
                                                          : 0;
                                                    const paidPart = Math.max(pymPaid, directPaid);
                                                    const dueForThis = Math.max(
                                                      0,
                                                      subtotal - paidPart - creditedPart
                                                    );
                                                    const relativeSupplierId =
                                                      item.linkedPartnerId || item.id;

                                                    return (
                                                      <div
                                                        key={pc.id}
                                                        className="p-2.5 bg-slate-50 dark:bg-slate-800/30 border border-slate-150/40 dark:border-slate-800/40 rounded-lg hover:bg-[#696cff]/5 dark:hover:bg-[#696cff]/10 transition-all flex items-center justify-between gap-1 cursor-pointer"
                                                        onClick={() =>
                                                          navigate(
                                                            `/supplier-purchase/${relativeSupplierId}/${pc.id}`
                                                          )
                                                        }
                                                      >
                                                        <div className="min-w-0">
                                                          <div className="flex items-center gap-1.5">
                                                            <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">
                                                              {pc.description || 'Achat de Stock'}
                                                            </p>
                                                            <span
                                                              className={`text-[9px] font-bold uppercase tracking-wider ${dueForThis <= 0 ? 'text-[#4fb922] dark:text-[#71dd37]' : 'text-[#ff3e1d]'}`}
                                                            >
                                                              {dueForThis <= 0
                                                                ? 'Réglé'
                                                                : 'À crédit'}
                                                            </span>
                                                          </div>
                                                          <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 flex items-center gap-1 mt-0.5 font-mono">
                                                            <Calendar size={10} />
                                                            <span>
                                                              {pc.date?.toDate
                                                                ? pc.date
                                                                    .toDate()
                                                                    .toLocaleDateString('fr-FR', {
                                                                      day: '2-digit',
                                                                      month: 'short',
                                                                    })
                                                                : '---'}
                                                            </span>
                                                            <span>• Ref: ''</span>
                                                          </p>
                                                        </div>
                                                        <div className="text-right shrink-0">
                                                          <p className="text-[11px] font-mono font-bold text-[#222222] dark:text-[#dbdade]">
                                                            {subtotal.toLocaleString('fr-FR', {
                                                              minimumFractionDigits: 2,
                                                              maximumFractionDigits: 2,
                                                            })}{' '}
                                                            DH
                                                          </p>
                                                          {dueForThis > 0 && (
                                                            <p className="text-[9px] font-mono font-bold text-[#ff3e1d]">
                                                              Dû:{' '}
                                                              {dueForThis.toLocaleString('fr-FR', {
                                                                minimumFractionDigits: 2,
                                                                maximumFractionDigits: 2,
                                                              })}{' '}
                                                              DH
                                                            </p>
                                                          )}
                                                        </div>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </motion.div>
                                      </td>
                                    </tr>
                                  )}
                                </AnimatePresence>
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* MOBILE VIEW FOR LEDGER BALANCES */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:hidden gap-4">
                      {sortedBalances.map((item) => {
                        const net = item.receivable - item.payable;
                        const avatar = getAvatarStyle(item.name);
                        const isBoth = item.type === 'both' || !!item.linkedPartnerId;
                        const initials = item.name
                          ? item.name
                              .split(' ')
                              .slice(0, 2)
                              .map((n) => n[0])
                              .join('')
                          : '?';

                        return (
                          <div
                            key={item.id}
                            className="bg-white dark:bg-[#1e1e2d] border border-slate-150 dark:border-slate-800 rounded-xl p-5 shadow-xs space-y-4 hover:shadow-sm transition-all"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`w-8.5 h-8.5 ${avatar.bg} ${avatar.text} rounded-lg flex items-center justify-center font-bold text-[11px] uppercase`}
                                >
                                  {initials.slice(0, 2)}
                                </div>
                                <div>
                                  <h4 className="font-bold text-[#566a7f] dark:text-[#dbdade] text-xs tracking-tight">
                                    {item.name}
                                  </h4>
                                  <p className="text-[9px] text-[#a1acb8] dark:text-[#707194] font-bold uppercase mt-0.5">
                                    {isBoth
                                      ? 'Tiers Mixte'
                                      : item.type === 'client'
                                        ? 'Client'
                                        : 'Fournisseur'}
                                  </p>
                                </div>
                              </div>

                              <span
                                className={`text-[11px] font-bold uppercase tracking-wider ${net > 0.01 ? 'text-[#4fb922] dark:text-[#71dd37]' : net < -0.01 ? 'text-[#ff3e1d]' : 'text-slate-400 dark:text-slate-500'}`}
                              >
                                {net > 0.01 ? 'Créance' : net < -0.01 ? 'Dette' : 'Solder'}
                              </span>
                            </div>

                            <div className="space-y-2.5">
                              <div className="grid grid-cols-2 gap-2 text-center">
                                <div className="border-r border-slate-150 dark:border-slate-800">
                                  <span className="text-[9px] font-bold uppercase text-[#a1acb8] dark:text-[#707194] block pb-0.5">
                                    Pour Client
                                  </span>
                                  <span className="font-mono text-xs font-bold text-[#566a7f] dark:text-[#dbdade] block">
                                    {item.receivable.toLocaleString('fr-MA')} DH
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[9px] font-bold uppercase text-[#a1acb8] dark:text-[#707194] block pb-0.5">
                                    Pour Fournisseur
                                  </span>
                                  <span className="font-mono text-xs font-bold text-[#566a7f] dark:text-[#dbdade] block">
                                    {item.payable.toLocaleString('fr-MA')} DH
                                  </span>
                                </div>
                              </div>

                              <div className="border-t border-slate-100 dark:border-slate-800 pt-2.5 flex items-center justify-between">
                                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">
                                  Situation nette
                                </span>
                                <span
                                  className={`font-mono text-xs font-bold ${net > 0.01 ? 'text-[#4fb922] dark:text-[#71dd37]' : net < -0.01 ? 'text-[#ff3e1d]' : 'text-slate-500 dark:text-slate-400'}`}
                                >
                                  {net > 0.01 ? '+' : ''}
                                  {net.toLocaleString('fr', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  DH
                                </span>
                              </div>
                            </div>

                            {/* Quick interactions */}
                            <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800">
                              <div className="flex items-center gap-1.5">
                                {item.phone && (
                                  <a
                                    href={`tel:${item.phone}`}
                                    className="p-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/30 dark:hover:bg-slate-800/50 border border-slate-150 dark:border-slate-800 rounded-lg text-slate-500 dark:text-slate-400 transition-colors"
                                  >
                                    <Phone size={12} />
                                  </a>
                                )}
                                <button
                                  onClick={() =>
                                    navigate(
                                      item.type === 'supplier' && !item.linkedPartnerId
                                        ? `/supplier/${item.id}`
                                        : `/client/${item.id}`
                                    )
                                  }
                                  className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/30 dark:hover:bg-slate-800/50 text-[#566a7f] dark:text-[#dbdade] rounded-lg font-bold text-[9px] uppercase tracking-wider transition-colors cursor-pointer"
                                >
                                  Fiche Profil
                                </button>
                              </div>

                              {isBoth && item.receivable > 0.01 && item.payable > 0.01 && (
                                <button
                                  onClick={() => setSelectedPartnerForClearing(item)}
                                  className="px-3 py-1.5 bg-[#ffab00]/10 hover:bg-[#ffab00]/25 text-[#ffab00] font-bold text-[9px] uppercase tracking-wider flex items-center gap-1.5 rounded-lg transition-colors cursor-pointer"
                                >
                                  <Sparkles size={11} />
                                  <span>Balancers</span>
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      {/* DETAILED INTERACTIVE COMPENSATION SIMULATOR MODAL */}
      <AnimatePresence>
        {selectedPartnerForClearing && (
          <div className="fixed inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#1e1e2d] rounded-xl w-full max-w-2xl overflow-hidden shadow-xl border border-slate-150 dark:border-slate-800 font-sans text-left"
            >
              {/* Header */}
              <div className="bg-slate-900 dark:bg-[#2b2c40] p-5 text-white flex items-center justify-between border-b border-slate-800 dark:border-slate-750">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-white/10 text-amber-400 rounded-lg">
                      <Scale size={15} />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-widest text-amber-300">
                      Simulateur de Compensation Légale
                    </span>
                  </div>
                  <h3 className="text-sm font-bold tracking-tight text-white uppercase">
                    {selectedPartnerForClearing.name}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedPartnerForClearing(null)}
                  className="p-1.5 hover:bg-white/10 text-slate-300 hover:text-white rounded-lg transition-all cursor-pointer"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Account Comparison Graphics */}
              <div className="p-5 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  {/* Client debit panel */}
                  <div className="bg-emerald-50/40 dark:bg-[#71dd37]/5 border border-[#71dd37]/25 p-4 rounded-lg relative overflow-hidden">
                    <span className="text-[10px] font-bold text-[#4fb922] dark:text-[#71dd37] uppercase tracking-wider block">
                      Position Client
                    </span>
                    <p className="text-lg font-mono font-bold text-[#4fb922] dark:text-[#71dd37] mt-2">
                      {selectedPartnerForClearing.receivable.toLocaleString('fr-MA')}{' '}
                      <span className="text-xs font-sans font-bold">DH</span>
                    </p>
                    <p className="text-[9.5px] text-slate-500 dark:text-slate-400 font-medium mt-1">
                      Facturation de ventes non-soldées
                    </p>
                  </div>

                  {/* Supplier credit panel */}
                  <div className="bg-rose-50/40 dark:bg-[#ff3e1d]/5 border border-[#ff3e1d]/25 p-4 rounded-lg relative overflow-hidden">
                    <span className="text-[10px] font-bold text-[#ff3e1d] uppercase tracking-wider block">
                      Position Fournisseur
                    </span>
                    <p className="text-lg font-mono font-bold text-[#ff3e1d] mt-2">
                      {selectedPartnerForClearing.payable.toLocaleString('fr-MA')}{' '}
                      <span className="text-xs font-sans font-bold">DH</span>
                    </p>
                    <p className="text-[9.5px] text-slate-500 dark:text-slate-400 font-medium mt-1">
                      Sourcing d'achats non-soldés
                    </p>
                  </div>
                </div>

                {/* Central math balance visualizer */}
                <div className="space-y-3 bg-slate-50/50 dark:bg-[#2b2c40]/30 border border-slate-100 dark:border-slate-800 p-4 rounded-lg">
                  <div className="flex items-center justify-between text-xs font-bold text-[#566a7f] dark:text-[#dbdade]">
                    <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 uppercase text-[10px]">
                      <HandCoins size={14} className="text-[#ffab00]" />
                      <span>Montant Compensable Réciproquement</span>
                    </span>
                    <span className="font-mono text-sm font-bold text-[#ffab00]">
                      {Math.min(
                        selectedPartnerForClearing.receivable,
                        selectedPartnerForClearing.payable
                      ).toLocaleString('fr-MA')}{' '}
                      DH
                    </span>
                  </div>

                  <div className="relative pt-1">
                    {/* Progress Slider Track indicator */}
                    <div className="w-full bg-slate-200 dark:bg-slate-800 h-2 rounded-full overflow-hidden flex">
                      <div
                        className="bg-[#ffab00] h-full transition-all"
                        style={{
                          width: `${(Math.min(selectedPartnerForClearing.receivable, selectedPartnerForClearing.payable) / Math.max(selectedPartnerForClearing.receivable, selectedPartnerForClearing.payable)) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[9px] font-bold text-slate-400 dark:text-slate-500 mt-1 uppercase">
                      <span>0,00 DH</span>
                      <span>
                        Compensable:{' '}
                        {Math.min(
                          selectedPartnerForClearing.receivable,
                          selectedPartnerForClearing.payable
                        ).toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        DH
                      </span>
                      <span>
                        Max Trade:{' '}
                        {Math.max(
                          selectedPartnerForClearing.receivable,
                          selectedPartnerForClearing.payable
                        ).toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        DH
                      </span>
                    </div>
                  </div>

                  {/* Projected Remaining outstanding values */}
                  <div className="border-t border-slate-150 dark:border-slate-800 pt-3 space-y-1.5 mt-2">
                    <p className="text-[9.5px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider pb-0.5">
                      Position résiduelle après règlement réciproque (Projeté)
                    </p>
                    <div className="flex justify-between items-center text-xs text-[#566a7f] dark:text-[#dbdade]">
                      <span className="font-medium">Compte Client résiduel</span>
                      <span className="font-mono font-bold">
                        {Math.max(
                          0,
                          selectedPartnerForClearing.receivable -
                            Math.min(
                              selectedPartnerForClearing.receivable,
                              selectedPartnerForClearing.payable
                            )
                        ).toLocaleString('fr-MA')}{' '}
                        DH
                      </span>
                    </div>
                    <div className="flex justify-between items-center text-xs text-[#566a7f] dark:text-[#dbdade]">
                      <span className="font-medium">Compte Fournisseur résiduel</span>
                      <span className="font-mono font-bold">
                        {Math.max(
                          0,
                          selectedPartnerForClearing.payable -
                            Math.min(
                              selectedPartnerForClearing.receivable,
                              selectedPartnerForClearing.payable
                            )
                        ).toLocaleString('fr-MA')}{' '}
                        DH
                      </span>
                    </div>
                  </div>
                </div>

                {/* Draft agreement document */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider flex items-center gap-1">
                      <FileText size={14} />
                      <span>Brouillon d'Accord Administratif Légitime</span>
                    </p>
                    <button
                      onClick={copyToClipboard}
                      className="text-[#696cff] border border-slate-150 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 font-bold px-2.5 py-1 rounded-lg text-[9.5px] uppercase tracking-wider flex items-center gap-1 transition-all cursor-pointer"
                    >
                      {copiedDraft ? (
                        <>
                          <Check size={11} className="text-[#4fb922] dark:text-[#71dd37]" />
                          <span>Copié !</span>
                        </>
                      ) : (
                        <>
                          <Copy size={11} />
                          <span>Copier le texte</span>
                        </>
                      )}
                    </button>
                  </div>

                  <textarea
                    readOnly
                    value={compensationDraftText}
                    className="w-full h-36 p-3 bg-[#13131e] dark:bg-[#0c0c14] text-slate-200 border border-slate-950 font-mono text-[9.5px] rounded-lg outline-none select-all overflow-y-auto leading-relaxed custom-scrollbar shadow-inner"
                  />
                  <p className="text-[9px] font-medium text-slate-400 dark:text-slate-500 leading-relaxed text-center">
                    💡 En copiant cet accord, vous disposez d'un document prêt à l'emploi. Vos
                    partenaires apprécieront la clarté de vos compensations.
                  </p>
                </div>
              </div>

              {/* Action buttons footer */}
              <div className="bg-slate-50 dark:bg-[#2b2c40]/20 border-t border-slate-100 dark:border-slate-800 p-5 flex flex-col sm:flex-row items-center justify-between gap-3">
                <span className="text-[9px] font-bold text-slate-450 dark:text-slate-500 uppercase flex items-center gap-1 max-w-[280px]">
                  <Info size={11} />
                  <span>
                    La compensation s'opère légalement sans frais fiscaux ou transactionnels.
                  </span>
                </span>

                <div className="flex items-center gap-1.5 w-full sm:w-auto justify-end">
                  <button
                    onClick={() => setSelectedPartnerForClearing(null)}
                    className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 bg-white dark:bg-[#1e1e2d] hover:bg-slate-50 dark:hover:bg-slate-800/30 rounded-lg text-[10.5px] font-bold uppercase tracking-wider transition-colors cursor-pointer"
                  >
                    Fermer
                  </button>
                  <button
                    onClick={handleExecuteCompensation}
                    disabled={isRegisteringComp}
                    className="px-4 py-2 bg-[#696cff] disabled:bg-slate-400 text-white hover:bg-[#696cff]/85 rounded-lg text-[10.5px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors shadow-md cursor-pointer active:scale-95"
                  >
                    {isRegisteringComp ? (
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <FileSignature size={13} />
                    )}
                    <span>
                      {isRegisteringComp ? 'Enregistrement...' : 'Appliquer la Compensation'}
                    </span>
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

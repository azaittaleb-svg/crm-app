import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import {
  collection,
  onSnapshot,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDocs,
  collectionGroup,
  serverTimestamp,
  runTransaction,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import {
  CheckCircle2,
  XCircle,
  Plus,
  Search,
  FileText,
  RefreshCw,
  Download,
  Upload,
  Trash2,
  Paperclip,
  ExternalLink,
  X,
  AlertTriangle,
  Check,
  Wallet,
  Coins,
  Scale,
  Settings,
  SlidersHorizontal,
  ArrowUpRight,
  ArrowDownRight,
  HelpCircle,
  Pin,
  Wand2,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';

interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  hasAttachment: boolean;
  partnerName: string;
  partnerRef: string;
  label: string;
  matchedDocument: string;
  isReconciled: boolean;
  amount: number;
  journal: 'UMNIA BANK' | 'Espèces';
  ownerId: string;
}

interface SuggestedDoc {
  id: string;
  refId: string; // e.g. INV/2026/00045
  type: 'Vente' | 'Achat';
  clientOrSupplierName: string;
  amount: number;
  date: string;
  status: string;
  parentType: 'clients' | 'suppliers';
  parentId: string;
  totalAmount: number;
  amountPaid: number;
}

function isSamePartner(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;

  const clean = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9]/g, ' ') // keep only alphanumeric
      .replace(/\b(sarl|ste|sa|eurl|sasu|cie|etablissement|mr|mme|dr|client|fournisseur)\b/g, '')
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);

  const words1 = clean(name1);
  const words2 = clean(name2);

  if (words1.length === 0 || words2.length === 0) {
    const n1 = name1.toLowerCase().trim();
    const n2 = name2.toLowerCase().trim();
    return n1.includes(n2) || n2.includes(n1);
  }

  return words1.some((w) => words2.includes(w)) || words2.some((w) => words1.includes(w));
}

function calculateTextSimilarityScore(
  txLabel: string,
  txPartner: string,
  docPartner: string
): number {
  if (!docPartner) return 0;

  const cleanString = (str: string) => {
    return str
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9]/g, ' ') // keep only alphanumeric
      .replace(
        /\b(sarl|ste|sa|eurl|sasu|cie|etablissement|mr|mme|dr|client|fournisseur|virement|en|faveur|de|pour|facture|fac|reglement|versement|paiement|cheque|remise|prlv|prelevement|bancaire)\b/g,
        ' '
      ) // remove noise words
      .trim()
      .split(/\s+/)
      .filter((word) => word.length >= 2); // only keep words of length >= 2
  };

  const docWords = cleanString(docPartner);
  const txPartnerWords = cleanString(txPartner || '');
  const txLabelWords = cleanString(txLabel || '');

  if (docWords.length === 0) return 0;

  let score = 0;

  const normDocPartner = docPartner.toLowerCase().trim();
  const normTxPartner = (txPartner || '').toLowerCase().trim();
  const normTxLabel = (txLabel || '').toLowerCase().trim();

  // If exact partner match
  if (normTxPartner && normDocPartner === normTxPartner) {
    score += 150;
  }

  // If partner is a substring of the document or vice-versa
  if (
    normTxPartner &&
    (normTxPartner.includes(normDocPartner) || normDocPartner.includes(normTxPartner))
  ) {
    score += 100;
  }

  // If document partner name is in the transaction label
  if (normTxLabel && normTxLabel.includes(normDocPartner)) {
    score += 120;
  }

  // Check word-by-word overlaps
  let matchingWordsCount = 0;
  docWords.forEach((dw) => {
    if (txPartnerWords.includes(dw) || txLabelWords.includes(dw)) {
      matchingWordsCount++;
    }
  });

  if (matchingWordsCount > 0) {
    score += (matchingWordsCount / docWords.length) * 80;
  }

  return score;
}

export default function RapprochementPage() {
  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();

  // State management
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedJournal, setSelectedJournal] = useState<'UMNIA BANK' | 'Espèces'>('UMNIA BANK');
  const [isSettingsDropdownOpen, setIsSettingsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'reconciled' | 'unreconciled'>('all');
  const [isLoading, setIsLoading] = useState(true);

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isReconcileModalOpen, setIsReconcileModalOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [suggestedDocs, setSuggestedDocs] = useState<SuggestedDoc[]>([]);
  const [reconcileTab, setReconcileTab] = useState<'invoice' | 'charge'>('invoice');
  const [chargeCategory, setChargeCategory] = useState('Frais bancaires');
  const [chargeTvaRate, setChargeTvaRate] = useState(10);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [docSearchQuery, setDocSearchQuery] = useState('');
  const [filterSameType, setFilterSameType] = useState(false);
  const [selectedDocsForReconcile, setSelectedDocsForReconcile] = useState<SuggestedDoc[]>([]);
  const [allocatedAmounts, setAllocatedAmounts] = useState<Record<string, string>>({});
  const [autoMatchSuggestion, setAutoMatchSuggestion] = useState<{
    invoice: SuggestedDoc;
    otherTransactions: Transaction[];
  } | null>(null);
  const [isApplyingAutoMatch, setIsApplyingAutoMatch] = useState(false);

  // Form state for adding transaction
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newPartner, setNewPartner] = useState('');
  const [newRef, setNewRef] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newHasAttachment, setNewHasAttachment] = useState(false);

  // Form state for adjusting total balance
  const [isAdjustBalanceModalOpen, setIsAdjustBalanceModalOpen] = useState(false);
  const [targetBalanceInput, setTargetBalanceInput] = useState('');
  const [adjustmentDate, setAdjustmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [adjustmentLabel, setAdjustmentLabel] = useState('Solde initial / Ajustement bancaire');

  // CSV Import State
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        settingsDropdownRef.current &&
        !settingsDropdownRef.current.contains(event.target as Node)
      ) {
        setIsSettingsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Dynamically set charge TVA rate based on category
  useEffect(() => {
    if (
      chargeCategory === 'CNSS' ||
      chargeCategory === 'Impôts et taxes' ||
      chargeCategory === 'Assurances'
    ) {
      setChargeTvaRate(0);
    } else if (chargeCategory === 'Frais bancaires') {
      setChargeTvaRate(10);
    } else if (chargeCategory === 'Autre charge') {
      setChargeTvaRate(20);
    }
  }, [chargeCategory]);

  // Fetch real-time transactions from Firestore
  useEffect(() => {
    if (!user) return;

    setIsLoading(true);
    const q = query(collection(db, 'bank_reconciliations'), where('ownerId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      async (snapshot) => {
        const list: Transaction[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const matchedDocStr =
            data.matchedDocument ||
            (Array.isArray(data.matchedDocs)
              ? data.matchedDocs
                  .map((m: any) => m.refId || m.id)
                  .filter(Boolean)
                  .join(', ')
              : '') ||
            '';

          list.push({
            id: docSnap.id,
            date: data.date || '',
            hasAttachment: !!data.hasAttachment,
            partnerName: data.partnerName || '',
            partnerRef: data.partnerRef || '',
            label: data.label || '',
            matchedDocument: matchedDocStr,
            isReconciled: !!data.isReconciled,
            amount: Number(data.amount) || 0,
            journal: data.journal || 'UMNIA BANK',
            ownerId: data.ownerId || user.uid,
          });
        });

        // Sort chronologically (newest first)
        list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setTransactions(list);
        setIsLoading(false);
      },
      (error) => {
        console.error('Error reading bank_reconciliations:', error);
        showToast('Erreur lors de la lecture des écritures.', 'error');
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Seeding realistic default data
  const seedDefaultData = async (uid: string) => {
    try {
      const defaults: Omit<Transaction, 'id'>[] = [
        // UMNIA BANK
        {
          date: '2026-06-20',
          hasAttachment: true,
          partnerName: 'SOCIETE MAROCAINE DE COMMERCE',
          partnerRef: '9893177',
          label: 'Virement reçu',
          matchedDocument: 'INV/2026/00045',
          isReconciled: true,
          amount: 12500,
          journal: 'UMNIA BANK',
          ownerId: uid,
        },
        {
          date: '2026-06-21',
          hasAttachment: false,
          partnerName: 'PROMO-IMPORT SARL',
          partnerRef: '4321908',
          label: 'Virement fournisseur',
          matchedDocument: 'BL/SUP/2026/0012',
          isReconciled: true,
          amount: -8400,
          journal: 'UMNIA BANK',
          ownerId: uid,
        },
        {
          date: '2026-06-22',
          hasAttachment: true,
          partnerName: 'AL JADID SARL',
          partnerRef: '5566712',
          label: 'Virement client',
          matchedDocument: '',
          isReconciled: false,
          amount: 4200,
          journal: 'UMNIA BANK',
          ownerId: uid,
        },
        {
          date: '2026-06-23',
          hasAttachment: false,
          partnerName: 'TANGER METROPOLE',
          partnerRef: '8899011',
          label: 'Abonnement internet',
          matchedDocument: '',
          isReconciled: false,
          amount: -450,
          journal: 'UMNIA BANK',
          ownerId: uid,
        },
        {
          date: '2026-06-24',
          hasAttachment: true,
          partnerName: 'SOCIETE GLOBALE',
          partnerRef: '1022394',
          label: 'Virement reçu',
          matchedDocument: '',
          isReconciled: false,
          amount: 18000,
          journal: 'UMNIA BANK',
          ownerId: uid,
        },
        // Espèces
        {
          date: '2026-06-18',
          hasAttachment: true,
          partnerName: 'Achat Fournisseur Comptant',
          partnerRef: '7766551',
          label: 'Espèces versées',
          matchedDocument: 'BL/SUP/2026/0008',
          isReconciled: true,
          amount: -1500,
          journal: 'Espèces',
          ownerId: uid,
        },
        {
          date: '2026-06-19',
          hasAttachment: false,
          partnerName: 'Vente Client Comptant',
          partnerRef: '1122334',
          label: 'Espèces reçues',
          matchedDocument: 'INV/2026/00048',
          isReconciled: true,
          amount: 850,
          journal: 'Espèces',
          ownerId: uid,
        },
        {
          date: '2026-06-22',
          hasAttachment: true,
          partnerName: 'BUREAU VALLEE',
          partnerRef: '4455667',
          label: 'Fournitures bureau',
          matchedDocument: '',
          isReconciled: false,
          amount: -320,
          journal: 'Espèces',
          ownerId: uid,
        },
        {
          date: '2026-06-23',
          hasAttachment: false,
          partnerName: 'Client Retrait Comptant',
          partnerRef: '8899776',
          label: 'Avancement espèce',
          matchedDocument: '',
          isReconciled: false,
          amount: 1200,
          journal: 'Espèces',
          ownerId: uid,
        },
      ];

      for (const item of defaults) {
        await addDoc(collection(db, 'bank_reconciliations'), item);
      }
      showToast('Données de démonstration chargées avec succès.', 'success');
    } catch (e) {
      console.error('Could not seed data:', e);
      showToast("Erreur lors de l'initialisation des écritures.", 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Switch between Bank and Cash journals
  const handleChangeJournal = (journalType: 'UMNIA BANK' | 'Espèces') => {
    setSelectedJournal(journalType);
    showToast(`Journal commuté sur ${journalType}`, 'success');
  };

  // Add a manual bank transaction
  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!newAmount) {
      showToast('Veuillez remplir les champs obligatoires.', 'error');
      return;
    }

    try {
      const parsedAmount = parseFloat(newAmount);
      if (isNaN(parsedAmount)) {
        showToast('Montant invalide.', 'error');
        return;
      }

      await addDoc(collection(db, 'bank_reconciliations'), {
        date: newDate,
        partnerName: newPartner || 'Divers',
        partnerRef: newRef || 'N/A',
        label: newLabel || 'Transaction manuelle',
        amount: parsedAmount,
        hasAttachment: newHasAttachment,
        isReconciled: false,
        matchedDocument: '',
        journal: selectedJournal,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
      });

      showToast('Opération enregistrée avec succès !', 'success');
      setIsAddModalOpen(false);

      // Reset form
      setNewDate(new Date().toISOString().split('T')[0]);
      setNewPartner('');
      setNewRef('');
      setNewLabel('');
      setNewAmount('');
      setNewHasAttachment(false);
    } catch (err) {
      console.error('Could not add transaction:', err);
      showToast("Erreur lors de l'ajout.", 'error');
    }
  };

  // Adjust bank journal total balance to match actual real-life bank balance
  const handleConfirmAdjustBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const target = parseFloat(targetBalanceInput);
    if (isNaN(target)) {
      showToast('Veuillez saisir un solde valide.', 'error');
      return;
    }
    const currentVal = stats.totalBalance;
    const diff = target - currentVal;
    if (Math.abs(diff) < 0.01) {
      showToast('Le solde actuel correspond déjà au solde cible.', 'info');
      setIsAdjustBalanceModalOpen(false);
      return;
    }

    try {
      await addDoc(collection(db, 'bank_reconciliations'), {
        date: adjustmentDate,
        partnerName: 'Ajustement Banque',
        partnerRef: 'SOLDE-INIT',
        label: adjustmentLabel || 'Solde initial / Ajustement bancaire',
        amount: diff,
        hasAttachment: false,
        isReconciled: true,
        matchedDocument: 'Ajustement de solde',
        journal: selectedJournal,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
      });
      showToast(
        `Solde du journal ${selectedJournal} ajusté avec succès à ${target.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH !`,
        'success'
      );
      setIsAdjustBalanceModalOpen(false);
    } catch (e: any) {
      showToast(e.message || "Erreur lors de l'ajustement du solde.", 'error');
    }
  };

  // Delete a transaction
  const handleDeleteTransaction = async (id: string, isReconciled: boolean) => {
    const doDelete = async () => {
      try {
        const txRef = doc(db, 'bank_reconciliations', id);
        const txSnap = await getDoc(txRef);

        if (txSnap.exists()) {
          const txData = txSnap.data();
          if (txData.isReconciled) {
            // Re-use same logic as unreconcile to safely detach payments
            const matchedItems = [];
            if (txData.isMultiReconciled && txData.matchedDocs) {
              matchedItems.push(...txData.matchedDocs);
            } else if (
              txData.matchedDocId &&
              txData.matchedDocParentType &&
              txData.matchedDocParentId
            ) {
              matchedItems.push({
                id: txData.matchedDocId,
                parentType: txData.matchedDocParentType,
                parentId: txData.matchedDocParentId,
              });
            }

            const paymentsToDelete = [];
            for (const item of matchedItems) {
              if (item.parentType === 'direct_charge') continue;
              const oldPaymentsSnap = await getDocs(
                query(
                  collection(db, item.parentType, item.parentId, 'payments'),
                  where('purchaseId', '==', item.id),
                  where('ownerId', '==', user?.uid)
                )
              );
              for (const pDoc of oldPaymentsSnap.docs) {
                const pData = pDoc.data();
                if (pData.reconciliationId === id) {
                  paymentsToDelete.push(pDoc);
                } else if (
                  !pData.reconciliationId &&
                  pData.notes &&
                  pData.notes.includes('lettré')
                ) {
                  paymentsToDelete.push(pDoc);
                }
              }
            }

            const exactMatches = paymentsToDelete.filter((p) => p.data().reconciliationId === id);
            const finalPaymentsToDelete = exactMatches.length > 0 ? exactMatches : paymentsToDelete;

            // Update purchases
            for (const pDoc of finalPaymentsToDelete) {
              const pData = pDoc.data();
              const parts = pDoc.ref.path.split('/');
              const parentType = parts[0];
              const parentId = parts[1];
              const purchaseId = pData.purchaseId;

              if (parentType && parentId && purchaseId) {
                const purchaseRef = doc(db, parentType, parentId, 'purchases', purchaseId);
                const purchaseSnap = await getDoc(purchaseRef);
                if (purchaseSnap.exists()) {
                  const pDocData = purchaseSnap.data();
                  const deletedAmount = Number(pData.amount || 0);
                  const newAmountPaid = Math.max(0, (pDocData.amountPaid || 0) - deletedAmount);
                  const total = Number(
                    pDocData.total || pDocData.totalAmount || pDocData.amount || 0
                  );
                  const newStatus = newAmountPaid >= total - 0.01 ? 'paid' : 'credit';

                  const updateData: any = {
                    amountPaid: newAmountPaid,
                    paymentStatus: newStatus,
                  };
                  if (newStatus !== 'paid') {
                    updateData.paymentDate = null;
                  }

                  await updateDoc(purchaseRef, updateData);
                }
              }
              await deleteDoc(pDoc.ref);
            }
          }
        }

        await deleteDoc(txRef);
        showToast("Ligne d'écriture supprimée.", 'success');
      } catch (e) {
        console.error('Delete failed:', e);
        showToast('Erreur lors de la suppression.', 'error');
      }
    };

    if (isReconciled) {
      confirm({
        title: 'Opération Rapprochée !',
        message:
          'Cette écriture est déjà lettrée avec un document. Êtes-vous sûr de vouloir la supprimer ? Cela annulera le lettrage associé.',
        confirmText: 'Supprimer quand même',
        cancelText: 'Annuler',
        onConfirm: doDelete,
      });
    } else {
      confirm({
        title: 'Confirmation de suppression',
        message: "Voulez-vous supprimer cette ligne d'écriture ?",
        confirmText: 'Supprimer',
        cancelText: 'Conserver',
        onConfirm: doDelete,
      });
    }
  };

  // Toggle attachment status
  const handleToggleAttachment = async (tx: Transaction) => {
    try {
      await updateDoc(doc(db, 'bank_reconciliations', tx.id), {
        hasAttachment: !tx.hasAttachment,
      });
      showToast(tx.hasAttachment ? 'Pièce jointe retirée.' : 'Pièce jointe ajoutée !', 'success');
    } catch (e) {
      showToast('Erreur lors de la modification de la pièce jointe.', 'error');
    }
  };

  // Unreconcile: Detach a transaction from an invoice
  const handleUnreconcile = async (transactionId: string) => {
    confirm({
      title: 'Annulation de lettrage',
      message: "Voulez-vous détacher les pièces de cette ligne d'opération financière ?",
      confirmText: 'Détacher',
      cancelText: 'Laisser lettré',
      onConfirm: async () => {
        try {
          const txRef = doc(db, 'bank_reconciliations', transactionId);
          const txSnap = await getDoc(txRef);

          if (!txSnap.exists()) return;
          const txData = txSnap.data();

          // First, identify all documents that were matched
          const matchedItems = [];
          if (txData.isMultiReconciled && txData.matchedDocs) {
            matchedItems.push(...txData.matchedDocs);
          } else if (
            txData.matchedDocId &&
            txData.matchedDocParentType &&
            txData.matchedDocParentId
          ) {
            matchedItems.push({
              id: txData.matchedDocId,
              parentType: txData.matchedDocParentType,
              parentId: txData.matchedDocParentId,
            });
          }

          // Gather all payments related to this reconciliation
          const paymentsToDelete = [];
          for (const item of matchedItems) {
            // direct_charge doesn't have payments
            if (item.parentType === 'direct_charge') continue;

            const oldPaymentsSnap = await getDocs(
              query(
                collection(db, item.parentType, item.parentId, 'payments'),
                where('purchaseId', '==', item.id),
                where('ownerId', '==', user?.uid)
              )
            );

            for (const pDoc of oldPaymentsSnap.docs) {
              const pData = pDoc.data();
              // Check if payment belongs to this reconciliation
              if (pData.reconciliationId === transactionId) {
                paymentsToDelete.push(pDoc);
              } else if (!pData.reconciliationId && pData.notes && pData.notes.includes('lettré')) {
                // Fallback: If no reconciliationId but it looks like a lettrage, we take it if the amount is similar
                // But only if we don't already have one
                paymentsToDelete.push(pDoc);
              }
            }
          }

          // Filter fallback documents if we found exact matches
          const exactMatches = paymentsToDelete.filter(
            (p) => p.data().reconciliationId === transactionId
          );
          const finalPaymentsToDelete = exactMatches.length > 0 ? exactMatches : paymentsToDelete;

          // Execute everything atomically
          await runTransaction(db, async (transaction) => {
            // Re-read inside transaction to guarantee atomic state
            const currentTxSnap = await transaction.get(txRef);
            if (!currentTxSnap.exists() || !currentTxSnap.data().isReconciled) {
              throw new Error("La transaction n'est pas lettrée ou n'existe plus.");
            }

            // 1. Gather all reads first to respect Firestore transaction constraints
            const purchaseReads = [];
            for (const pDoc of finalPaymentsToDelete) {
              const pData = pDoc.data();
              const parts = pDoc.ref.path.split('/');
              const parentType = parts[0];
              const parentId = parts[1];
              const purchaseId = pData.purchaseId;

              if (parentType && parentId && purchaseId) {
                const purchaseRef = doc(db, parentType, parentId, 'purchases', purchaseId);
                purchaseReads.push({
                  pDoc,
                  purchaseRef,
                });
              }
            }

            // Perform all reads (gets) sequentially inside the transaction before any writes
            const purchaseSnapshots = [];
            for (const item of purchaseReads) {
              const snap = await transaction.get(item.purchaseRef);
              purchaseSnapshots.push({
                ...item,
                snap,
              });
            }

            // 2. Perform all writes (updates/deletes) after all reads are completed
            for (const item of purchaseSnapshots) {
              const pDoc = item.pDoc;
              const pData = pDoc.data();
              const purchaseRef = item.purchaseRef;
              const purchaseSnap = item.snap;

              if (purchaseSnap.exists()) {
                const pDocData = purchaseSnap.data();
                const deletedAmount = Number(pData.amount || 0);
                const newAmountPaid = Math.max(0, (pDocData.amountPaid || 0) - deletedAmount);
                const total = Number(
                  pDocData.total || pDocData.totalAmount || pDocData.amount || 0
                );
                const newStatus = newAmountPaid >= total - 0.01 ? 'paid' : 'credit';

                const updateData: any = {
                  amountPaid: newAmountPaid,
                  paymentStatus: newStatus,
                };
                if (newStatus !== 'paid') {
                  updateData.paymentDate = null;
                }

                transaction.update(purchaseRef, updateData);
              }
            }

            // Delete the payment documents
            for (const pDoc of finalPaymentsToDelete) {
              transaction.delete(pDoc.ref);
            }

            // Update bank_reconciliations doc to clear match fields
            transaction.update(txRef, {
              isReconciled: false,
              matchedDocument: null,
              matchedDocId: null,
              matchedDocParentType: null,
              matchedDocParentId: null,
              matchedDocTotalAmount: null,
              isMultiReconciled: null,
              matchedDocs: null,
            });
          });

          showToast('Lettrage annulé avec succès.', 'success');
        } catch (e: any) {
          console.error('Could not unreconcile:', e);
          showToast(e.message || "Erreur lors de l'annulation du lettrage.", 'error');
        }
      },
    });
  };

  // Open reconciliation suggestions
  const handleOpenReconcileModal = async (tx: Transaction) => {
    setSelectedTransaction(tx);
    setIsReconcileModalOpen(true);

    // Check if the transaction description contains CNSS
    const labelUpper = (tx.label || '').toUpperCase();
    const partnerUpper = (tx.partnerName || '').toUpperCase();
    const isCnss = labelUpper.includes('CNSS') || partnerUpper.includes('CNSS');

    if (isCnss) {
      setReconcileTab('charge');
      const amtAbs = Math.abs(tx.amount);
      if (amtAbs <= 50) {
        // This is the bank commission / fee on the CNSS operation (10% TVA)
        setChargeCategory('Frais bancaires');
        setChargeTvaRate(10);
      } else {
        // This is the main CNSS payment (0% TVA)
        setChargeCategory('CNSS');
        setChargeTvaRate(0);
      }
    } else {
      setReconcileTab('invoice');
      setChargeCategory('Frais bancaires');
      setChargeTvaRate(tx.amount < 0 ? 10 : 0);
    }

    setIsLoadingDocs(true);
    setSuggestedDocs([]);
    setSelectedDocsForReconcile([]);
    setAllocatedAmounts({});

    try {
      const list: SuggestedDoc[] = [];

      // Fetch clients, suppliers, and all purchases in parallel (O(1) database queries)
      const [clientsSnap, suppliersSnap, purchasesSnap] = await Promise.all([
        getDocs(query(collection(db, 'clients'), where('ownerId', '==', user?.uid))),
        getDocs(query(collection(db, 'suppliers'), where('ownerId', '==', user?.uid))),
        getDocs(query(collectionGroup(db, 'purchases'), where('ownerId', '==', user?.uid))),
      ]);

      // Map partners for fast O(1) lookup
      const partnersMap: Record<
        string,
        { name: string; type: 'client' | 'supplier'; excludeFromAccounting?: boolean }
      > = {};
      clientsSnap.forEach((docSnap) => {
        const cData = docSnap.data();
        partnersMap[docSnap.id] = {
          name: cData.name || 'Client Inconnu',
          type: 'client',
          excludeFromAccounting: !!cData.excludeFromAccounting,
        };
      });
      suppliersSnap.forEach((docSnap) => {
        const sData = docSnap.data();
        partnersMap[docSnap.id] = {
          name: sData.name || 'Fournisseur Inconnu',
          type: 'supplier',
          excludeFromAccounting: !!sData.excludeFromAccounting,
        };
      });

      // Process purchases
      purchasesSnap.forEach((pDoc) => {
        const pData = pDoc.data();
        const pathSegments = pDoc.ref.path.split('/');
        const parentType = pathSegments[0]; // 'clients' or 'suppliers'
        const parentId = pathSegments[1];

        // Skip if purchase or partner is excluded from accounting
        if (pData.excludeFromAccounting) return;

        const partner = partnersMap[parentId];
        if (partner?.excludeFromAccounting) return;

        if (pData.supplierId && partnersMap[pData.supplierId]?.excludeFromAccounting) return;
        if (pData.clientId && partnersMap[pData.clientId]?.excludeFromAccounting) return;

        const partnerName = partner
          ? partner.name
          : parentType === 'clients'
            ? 'Client Inconnu'
            : 'Fournisseur Inconnu';

        if (parentType === 'clients') {
          const validStatuses = [
            'Valide',
            'Validée',
            'Payée',
            'Draft',
            'Brouillon',
            'Envoyée',
            'En retard',
          ];
          const isValide = !pData.status || validStatuses.includes(pData.status);
          const tot = Number(
            pData.total || pData.totalAmount || pData.subtotal || pData.amount || 0
          );
          const paid = Number(pData.amountPaid || 0);
          const isFullyPaid = pData.paymentStatus === 'paid' || paid >= tot - 0.01;

          if (isValide && !isFullyPaid) {
            list.push({
              id: pDoc.id,
              refId: pData.refId || pData.invoice_no || '',
              type: 'Vente',
              clientOrSupplierName: partnerName,
              amount: tot - paid,
              date: pData.date
                ? pData.date.toDate
                  ? pData.date.toDate().toISOString().split('T')[0]
                  : pData.date
                : '',
              status: pData.status,
              parentType: 'clients',
              parentId: parentId,
              totalAmount: tot,
              amountPaid: paid,
            });
          }
        } else if (parentType === 'suppliers') {
          const tot = Math.abs(Number(pData.total || pData.totalAmount || pData.amount || 0));
          const paid = Number(pData.amountPaid || 0);
          const isFullyPaid = pData.paymentStatus === 'paid' || paid >= tot - 0.01;

          if (!isFullyPaid) {
            list.push({
              id: pDoc.id,
              refId: pData.refId || pData.orderNumber || '',
              type: 'Achat',
              clientOrSupplierName: partnerName,
              amount: -(tot - paid), // Show remaining amount
              date: pData.date
                ? pData.date.toDate
                  ? pData.date.toDate().toISOString().split('T')[0]
                  : pData.date
                : '',
              status: pData.status || 'Confirmé',
              parentType: 'suppliers',
              parentId: parentId,
              totalAmount: tot,
              amountPaid: paid,
            });
          }
        }
      });

      // Sort by similarity score first (highest first), then by closest absolute amount, then by date
      const targetAmount = tx.amount;
      const txLabel = tx.label || '';
      const txPartner = tx.partnerName || '';

      list.sort((a, b) => {
        const scoreA = calculateTextSimilarityScore(txLabel, txPartner, a.clientOrSupplierName);
        const scoreB = calculateTextSimilarityScore(txLabel, txPartner, b.clientOrSupplierName);

        if (scoreA !== scoreB) {
          return scoreB - scoreA; // Descending score (best match first)
        }

        const diffA = Math.abs(Math.abs(a.amount) - Math.abs(targetAmount));
        const diffB = Math.abs(Math.abs(b.amount) - Math.abs(targetAmount));
        if (diffA !== diffB) return diffA - diffB;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      setSuggestedDocs(list);
      setAutoMatchSuggestion(null);

      const targetAmountAbs = Math.abs(tx.amount);
      let foundAutoMatch = false;

      // 1. Get ALL other unreconciled transactions of the same direction (positive/positive or negative/negative)
      const otherUnreconciledTxs = transactions.filter(
        (t) => t.id !== tx.id && !t.isReconciled && (tx.amount > 0 ? t.amount > 0 : t.amount < 0)
      );

      // Smart Auto-Match Discovery Engine: Search across ALL unpaid documents (invoices/purchases) in list
      let bestSuggestion: {
        invoice: SuggestedDoc;
        otherTransactions: Transaction[];
        score: number;
      } | null = null;

      for (const inv of list) {
        const invRemaining = Math.abs(inv.amount);
        const invName = inv.clientOrSupplierName;

        // Score of current transaction with this invoice
        const baseScore = calculateTextSimilarityScore(txLabel, txPartner, invName);

        // Scenario A.1: This transaction + 1 other transaction = 1 invoice
        for (const otherTx of otherUnreconciledTxs) {
          const otherAmt = Math.abs(otherTx.amount);
          if (Math.abs(targetAmountAbs + otherAmt - invRemaining) < 0.05) {
            const otherScore = calculateTextSimilarityScore(
              otherTx.label || '',
              otherTx.partnerName || '',
              invName
            );
            const totalScore = baseScore + otherScore;

            // Update if better score, or if no suggestion exists yet
            if (!bestSuggestion || totalScore > bestSuggestion.score) {
              bestSuggestion = {
                invoice: inv,
                otherTransactions: [otherTx],
                score: totalScore,
              };
            }
          }
        }

        // Scenario A.2: This transaction + 2 other transactions = 1 invoice
        for (let i = 0; i < otherUnreconciledTxs.length; i++) {
          for (let j = i + 1; j < otherUnreconciledTxs.length; j++) {
            const sumAmt =
              targetAmountAbs +
              Math.abs(otherUnreconciledTxs[i].amount) +
              Math.abs(otherUnreconciledTxs[j].amount);
            if (Math.abs(sumAmt - invRemaining) < 0.05) {
              const scoreI = calculateTextSimilarityScore(
                otherUnreconciledTxs[i].label || '',
                otherUnreconciledTxs[i].partnerName || '',
                invName
              );
              const scoreJ = calculateTextSimilarityScore(
                otherUnreconciledTxs[j].label || '',
                otherUnreconciledTxs[j].partnerName || '',
                invName
              );
              const totalScore = baseScore + scoreI + scoreJ;

              if (!bestSuggestion || totalScore > bestSuggestion.score) {
                bestSuggestion = {
                  invoice: inv,
                  otherTransactions: [otherUnreconciledTxs[i], otherUnreconciledTxs[j]],
                  score: totalScore,
                };
              }
            }
          }
        }
      }

      if (bestSuggestion) {
        setAutoMatchSuggestion({
          invoice: bestSuggestion.invoice,
          otherTransactions: bestSuggestion.otherTransactions,
        });
        foundAutoMatch = true;
      }

      // Case B: One Transaction to Multi-Invoices
      if (!foundAutoMatch) {
        let bestMultiInvoices: {
          invoices: SuggestedDoc[];
          score: number;
        } | null = null;

        // Filter list to only match the transaction type/direction (Vente for positive transactions, Achat for negative transactions)
        const combinationList = list.filter((d) => {
          if (tx.amount > 0) return d.type === 'Vente';
          return d.type === 'Achat';
        });

        // Try combinations of 2 invoices from combinationList
        for (let i = 0; i < combinationList.length; i++) {
          for (let j = i + 1; j < combinationList.length; j++) {
            const combinedInvsSum =
              Math.abs(combinationList[i].amount) + Math.abs(combinationList[j].amount);
            if (Math.abs(combinedInvsSum - targetAmountAbs) < 0.05) {
              const scoreI = calculateTextSimilarityScore(
                txLabel,
                txPartner,
                combinationList[i].clientOrSupplierName
              );
              const scoreJ = calculateTextSimilarityScore(
                txLabel,
                txPartner,
                combinationList[j].clientOrSupplierName
              );
              const totalScore = scoreI + scoreJ;

              if (!bestMultiInvoices || totalScore > bestMultiInvoices.score) {
                bestMultiInvoices = {
                  invoices: [combinationList[i], combinationList[j]],
                  score: totalScore,
                };
              }
            }
          }
        }

        // Try combinations of 3 invoices from combinationList
        if (!bestMultiInvoices) {
          for (let i = 0; i < combinationList.length; i++) {
            for (let j = i + 1; j < combinationList.length; j++) {
              for (let k = j + 1; k < combinationList.length; k++) {
                const combinedInvsSum =
                  Math.abs(combinationList[i].amount) +
                  Math.abs(combinationList[j].amount) +
                  Math.abs(combinationList[k].amount);
                if (Math.abs(combinedInvsSum - targetAmountAbs) < 0.05) {
                  const scoreI = calculateTextSimilarityScore(
                    txLabel,
                    txPartner,
                    combinationList[i].clientOrSupplierName
                  );
                  const scoreJ = calculateTextSimilarityScore(
                    txLabel,
                    txPartner,
                    combinationList[j].clientOrSupplierName
                  );
                  const scoreK = calculateTextSimilarityScore(
                    txLabel,
                    txPartner,
                    combinationList[k].clientOrSupplierName
                  );
                  const totalScore = scoreI + scoreJ + scoreK;

                  if (!bestMultiInvoices || totalScore > bestMultiInvoices.score) {
                    bestMultiInvoices = {
                      invoices: [combinationList[i], combinationList[j], combinationList[k]],
                      score: totalScore,
                    };
                  }
                }
              }
            }
          }
        }

        // Do not pre-select combination of invoices automatically to let user choose manually
        if (bestMultiInvoices && bestMultiInvoices.score > 40) {
          foundAutoMatch = true;
        }
      }
    } catch (e) {
      console.error('Could not fetch documents for suggestion:', e);
      showToast('Erreur lors de la récupération des pièces suggérées.', 'error');
    } finally {
      setIsLoadingDocs(false);
    }
  };

  // Reconcile multiple transactions with one document
  const handleApplyCombinedAutoMatch = async () => {
    if (!selectedTransaction || !autoMatchSuggestion || !user) return;

    setIsApplyingAutoMatch(true);
    try {
      const { invoice, otherTransactions } = autoMatchSuggestion;
      const allTxsToReconcile = [selectedTransaction, ...otherTransactions];

      await runTransaction(db, async (transaction) => {
        // Read invoice/purchase first
        const purchaseRef = doc(db, invoice.parentType, invoice.parentId, 'purchases', invoice.id);
        const purchaseSnap = await transaction.get(purchaseRef);
        if (!purchaseSnap.exists()) {
          throw new Error(`Document ${invoice.refId} introuvable`);
        }

        // Read all transactions
        const txSnaps = [];
        for (const tx of allTxsToReconcile) {
          const txRef = doc(db, 'bank_reconciliations', tx.id);
          const snap = await transaction.get(txRef);
          if (!snap.exists()) {
            throw new Error(`Transaction ${tx.label} introuvable`);
          }
          if (snap.data().isReconciled) {
            throw new Error(`La transaction ${tx.label} est déjà lettrée.`);
          }
          txSnaps.push({ ref: txRef, snap });
        }

        const pData = purchaseSnap.data();
        const totalAmount = Number(
          pData.total || pData.totalAmount || pData.subtotal || pData.amount || 0
        );
        const amountPaid = Number(pData.amountPaid || 0);

        let cumulativePaid = amountPaid;

        // Let's update each transaction and create payments
        for (const tx of allTxsToReconcile) {
          const txAmtAbs = Math.abs(tx.amount);

          // Use the actual bank transaction date instead of today's date
          const txDateObj = tx.date?.toDate
            ? tx.date.toDate()
            : tx.date
              ? new Date(tx.date)
              : new Date();

          // Create payment doc inside payments subcollection
          const paymentsRef = doc(collection(db, invoice.parentType, invoice.parentId, 'payments'));
          const notesLabel =
            invoice.parentType === 'clients'
              ? `Règlement combiné lettré via ${tx.journal}`
              : `Règlement combiné lettré via ${tx.journal}`;

          transaction.set(paymentsRef, {
            ownerId: user.uid,
            amount: txAmtAbs,
            date: txDateObj,
            purchaseId: invoice.id,
            notes: notesLabel,
            reconciliationId: tx.id,
          });

          // Update the bank reconciliation transaction
          transaction.update(doc(db, 'bank_reconciliations', tx.id), {
            isReconciled: true,
            matchedDocument: invoice.refId,
            matchedDocId: invoice.id,
            matchedDocParentType: invoice.parentType,
            matchedDocParentId: invoice.parentId,
            matchedDocTotalAmount: totalAmount,
            isMultiReconciled: false,
          });

          cumulativePaid += txAmtAbs;
        }

        // Update purchase invoice status & amountPaid
        const isFullyPaid = cumulativePaid >= totalAmount - 0.01;
        const updateData: any = {
          amountPaid: cumulativePaid,
          paymentStatus: isFullyPaid ? 'paid' : 'partial',
        };
        if (isFullyPaid) {
          // Find latest transaction date
          const latestTxDateObj = allTxsToReconcile.reduce((latest, current) => {
            const currentD = current.date?.toDate
              ? current.date.toDate()
              : current.date
                ? new Date(current.date)
                : new Date();
            return currentD > latest ? currentD : latest;
          }, new Date(0));
          updateData.paymentDate = latestTxDateObj;
        }
        transaction.update(purchaseRef, updateData);
      });

      showToast(
        `Lettrage combiné de ${allTxsToReconcile.length} écritures validé avec succès !`,
        'success'
      );
      setIsReconcileModalOpen(false);
      setSelectedTransaction(null);
      setAutoMatchSuggestion(null);
    } catch (e: any) {
      console.error('Combined auto-match application failed:', e);
      showToast(e.message || "Erreur lors de l'application du lettrage combiné.", 'error');
    } finally {
      setIsApplyingAutoMatch(false);
    }
  };

  // Create a direct charge and reconcile
  const handleLettrerCharge = async () => {
    if (!selectedTransaction || !user) return;

    try {
      const amountTTC = Math.abs(selectedTransaction.amount);
      const subtotal = amountTTC / (1 + chargeTvaRate / 100);
      const tvaAmount = amountTTC - subtotal;

      const txRef = doc(db, 'bank_reconciliations', selectedTransaction.id);
      await updateDoc(txRef, {
        isReconciled: true,
        matchedDocument: `Charge: ${chargeCategory} (TVA ${chargeTvaRate}%)`,
        matchedDocId: 'direct_charge',
        matchedDocParentType: 'direct_charge',
        matchedDocParentId: 'direct_charge',
        matchedDocTotalAmount: amountTTC,
        chargeCategory,
        tvaRate: chargeTvaRate,
        tvaAmount,
        subtotal,
      });

      showToast(`L'opération a été lettrée comme charge (${chargeCategory}).`, 'success');
      setIsReconcileModalOpen(false);
      setSelectedTransaction(null);
    } catch (e) {
      console.error('Error creating direct charge:', e);
      showToast('Erreur lors de la création de la charge.', 'error');
    }
  };

  // Reconcile: Link transaction with selected document
  const handleLinkDocument = async (docItem: SuggestedDoc) => {
    if (!selectedTransaction || !user) return;

    try {
      const txAmount = Math.abs(selectedTransaction.amount);
      const remainingAmount = docItem.totalAmount - docItem.amountPaid;

      if (txAmount > remainingAmount + 0.01) {
        showToast('Le montant de la transaction dépasse le reste à payer de la facture.', 'error');
        return;
      }

      await runTransaction(db, async (transaction) => {
        const txRef = doc(db, 'bank_reconciliations', selectedTransaction.id);
        const purchaseRef = doc(db, docItem.parentType, docItem.parentId, 'purchases', docItem.id);

        const txSnap = await transaction.get(txRef);
        const purchaseSnap = await transaction.get(purchaseRef);

        if (!txSnap.exists() || !purchaseSnap.exists()) {
          throw new Error('Document introuvable');
        }

        const txData = txSnap.data();
        if (txData.isReconciled) {
          throw new Error('Cette transaction bancaire est déjà lettrée.');
        }

        const pData = purchaseSnap.data();
        const totalAmount = Number(
          pData.total || pData.totalAmount || pData.subtotal || pData.amount || 0
        );
        const amountPaid = Number(pData.amountPaid || 0);
        const currentRemainingAmount = totalAmount - amountPaid;

        if (txAmount > currentRemainingAmount + 0.01) {
          throw new Error('Le montant de la transaction dépasse le reste à payer de la facture.');
        }

        // Use the actual bank transaction date instead of today's date
        const txDateObj = selectedTransaction.date?.toDate
          ? selectedTransaction.date.toDate()
          : selectedTransaction.date
            ? new Date(selectedTransaction.date)
            : new Date();

        const newAmountPaid = amountPaid + txAmount;
        const newPaymentStatus = newAmountPaid >= totalAmount - 0.01 ? 'paid' : 'credit';

        // 1. Update the target purchase/invoice status & amountPaid
        const updateData: any = {
          amountPaid: newAmountPaid,
          paymentStatus: newPaymentStatus,
        };
        if (newPaymentStatus === 'paid') {
          updateData.paymentDate = txDateObj;
        }

        transaction.update(purchaseRef, updateData);

        // 2. Add a payment tracking record in the subcollection
        const paymentsRef = doc(collection(db, docItem.parentType, docItem.parentId, 'payments'));
        const notesLabel =
          docItem.parentType === 'clients'
            ? `Règlement lettré via ${selectedTransaction.journal}`
            : `Règlement lettré via ${selectedTransaction.journal}`;

        transaction.set(paymentsRef, {
          ownerId: user.uid,
          amount: txAmount,
          date: txDateObj,
          purchaseId: docItem.id,
          notes: notesLabel,
          reconciliationId: selectedTransaction.id,
        });

        // 3. Update the bank reconciliation transaction with metadata
        transaction.update(txRef, {
          isReconciled: true,
          matchedDocument: docItem.refId,
          matchedDocId: docItem.id,
          matchedDocParentType: docItem.parentType,
          matchedDocParentId: docItem.parentId,
          matchedDocTotalAmount: totalAmount,
        });
      });

      showToast(
        `Écriture lettrée et payée avec succès avec la pièce ${docItem.refId} !`,
        'success'
      );
      setIsReconcileModalOpen(false);
      setSelectedTransaction(null);
    } catch (e: any) {
      console.error('Reconciliation link failed:', e);
      showToast(e.message || 'Erreur lors du lettrage de la pièce.', 'error');
    }
  };

  // Reconcile multiple documents linked to the transaction
  const handleLinkDocuments = async (
    selectedItems: SuggestedDoc[],
    amounts: Record<string, number>
  ) => {
    if (!selectedTransaction || !user) return;
    if (selectedItems.length === 0) {
      showToast('Veuillez sélectionner au moins un document.', 'error');
      return;
    }

    try {
      const txAmount = Math.abs(selectedTransaction.amount);
      let totalAllocated = 0;
      for (const item of selectedItems) {
        const allocated = amounts[item.id] || 0;
        if (allocated <= 0) {
          showToast(`Le montant alloué pour ${item.refId} doit être supérieur à 0.`, 'error');
          return;
        }
        totalAllocated += allocated;
      }

      if (totalAllocated > txAmount + 0.05) {
        showToast('Le total alloué dépasse le montant de la transaction.', 'error');
        return;
      }

      await runTransaction(db, async (transaction) => {
        const txRef = doc(db, 'bank_reconciliations', selectedTransaction.id);
        const txSnap = await transaction.get(txRef);

        if (!txSnap.exists()) {
          throw new Error('Mouvement de rapprochement introuvable');
        }

        const txData = txSnap.data();
        if (txData.isReconciled) {
          throw new Error('Cette transaction bancaire est déjà lettrée.');
        }

        // Standard Firestore transaction requirement: read all documents first
        const purchaseSnaps: Record<string, any> = {};
        for (const item of selectedItems) {
          const purchaseRef = doc(db, item.parentType, item.parentId, 'purchases', item.id);
          const snap = await transaction.get(purchaseRef);
          if (!snap.exists()) {
            throw new Error(`Document ${item.refId} introuvable`);
          }
          purchaseSnaps[item.id] = snap;
        }

        // Perform updates
        const matchedDocumentRefs: string[] = [];
        const matchedDocsMeta: any[] = [];

        for (const item of selectedItems) {
          const purchaseRef = doc(db, item.parentType, item.parentId, 'purchases', item.id);
          const pSnap = purchaseSnaps[item.id];
          const pData = pSnap.data();

          const totalAmount = Number(
            pData.total || pData.totalAmount || pData.subtotal || pData.amount || 0
          );
          const amountPaid = Number(pData.amountPaid || 0);
          const currentRemainingAmount = totalAmount - amountPaid;
          const allocated = amounts[item.id] || 0;

          if (allocated > currentRemainingAmount + 0.05) {
            throw new Error(
              `Le montant alloué (${allocated} DH) dépasse le reste à payer de la facture ${item.refId} (${currentRemainingAmount} DH).`
            );
          }

          // Use the actual bank transaction date instead of today's date
          const txDateObj = selectedTransaction.date?.toDate
            ? selectedTransaction.date.toDate()
            : selectedTransaction.date
              ? new Date(selectedTransaction.date)
              : new Date();

          const newAmountPaid = amountPaid + allocated;
          const newPaymentStatus = newAmountPaid >= totalAmount - 0.01 ? 'paid' : 'credit';

          // Update target purchase
          const updateData: any = {
            amountPaid: newAmountPaid,
            paymentStatus: newPaymentStatus,
          };
          if (newPaymentStatus === 'paid') {
            updateData.paymentDate = txDateObj;
          }

          transaction.update(purchaseRef, updateData);

          // Add a payment tracking record in the subcollection
          const paymentsRef = doc(collection(db, item.parentType, item.parentId, 'payments'));
          const notesLabel =
            item.parentType === 'clients'
              ? `Règlement lettré via ${selectedTransaction.journal}`
              : `Règlement lettré via ${selectedTransaction.journal}`;

          transaction.set(paymentsRef, {
            ownerId: user.uid,
            amount: allocated,
            date: txDateObj,
            purchaseId: item.id,
            notes: notesLabel,
            reconciliationId: selectedTransaction.id,
          });

          matchedDocumentRefs.push(item.refId);
          matchedDocsMeta.push({
            id: item.id,
            refId: item.refId,
            parentType: item.parentType,
            parentId: item.parentId,
            amountAllocated: allocated,
          });
        }

        // Update the bank reconciliation transaction with metadata
        const updatePayload: any = {
          isReconciled: true,
          matchedDocument: matchedDocumentRefs.join(', '),
          isMultiReconciled: selectedItems.length > 1,
          matchedDocs: matchedDocsMeta,
        };

        // Populate root values of the first one for backward compatibility
        const first = selectedItems[0];
        updatePayload.matchedDocId = first.id;
        updatePayload.matchedDocParentType = first.parentType;
        updatePayload.matchedDocParentId = first.parentId;
        updatePayload.matchedDocTotalAmount = first.totalAmount;

        transaction.update(txRef, updatePayload);
      });

      showToast(`Mouvement lettré avec succès (${selectedItems.length} pièce(s)) !`, 'success');
      setIsReconcileModalOpen(false);
      setSelectedTransaction(null);
      // Reset state
      setSelectedDocsForReconcile([]);
      setAllocatedAmounts({});
    } catch (e: any) {
      console.error('Reconciliation link failed:', e);
      showToast(e.message || 'Erreur lors du lettrage des pièces.', 'error');
    }
  };

  // Toggle selection of a suggested document
  const handleToggleSelectDoc = (docItem: SuggestedDoc) => {
    if (!selectedTransaction) return;

    const isSelected = selectedDocsForReconcile.some((d) => d.id === docItem.id);
    const txAmount = Math.abs(selectedTransaction.amount);

    if (isSelected) {
      // Remove it
      setSelectedDocsForReconcile((prev) => prev.filter((d) => d.id !== docItem.id));
      setAllocatedAmounts((prev) => {
        const next = { ...prev };
        delete next[docItem.id];
        return next;
      });
    } else {
      // Add it
      // Compute currently allocated sum before adding this one
      const currentAllocatedSum = selectedDocsForReconcile.reduce((sum, d) => {
        return sum + (parseFloat(allocatedAmounts[d.id]) || 0);
      }, 0);

      const remainingTxAmount = Math.max(0, txAmount - currentAllocatedSum);
      const remainingDocAmount = Math.abs(docItem.amount);
      const defaultAllocation = Math.min(remainingTxAmount, remainingDocAmount);

      setSelectedDocsForReconcile((prev) => [...prev, docItem]);
      setAllocatedAmounts((prev) => ({
        ...prev,
        [docItem.id]: defaultAllocation.toFixed(2),
      }));
    }
  };

  // Handle change in user-entered allocated amount
  const handleAllocatedAmountChange = (docId: string, value: string) => {
    setAllocatedAmounts((prev) => ({
      ...prev,
      [docId]: value,
    }));
  };

  // Compute live multi-reconciliation summary stats
  const reconciliationSummary = useMemo(() => {
    if (!selectedTransaction)
      return { totalAllocated: 0, remainingToAllocate: 0, isAllocatedValid: false };
    const txAmount = Math.abs(selectedTransaction.amount);

    let totalAllocated = 0;
    selectedDocsForReconcile.forEach((d) => {
      const amt = parseFloat(allocatedAmounts[d.id]) || 0;
      totalAllocated += amt;
    });

    const remainingToAllocate = Math.max(0, txAmount - totalAllocated);
    const isAllocatedValid =
      selectedDocsForReconcile.length > 0 && Math.abs(totalAllocated - txAmount) < 0.05;

    return {
      totalAllocated,
      remainingToAllocate,
      isAllocatedValid,
    };
  }, [selectedTransaction, selectedDocsForReconcile, allocatedAmounts]);

  // Export journal as a clean CSV file
  const handleExportAll = () => {
    const journalRows = transactions.filter((t) => t.journal === selectedJournal);
    if (journalRows.length === 0) {
      showToast('Aucune donnée à exporter pour ce journal.', 'error');
      return;
    }

    try {
      const headers = [
        'ID',
        'Date',
        'Tiers / Partenaire',
        'Référence',
        'Libellé',
        'Pièce Lettrée',
        'Rapproché (Oui/Non)',
        'Montant (DH)',
        'Journal',
      ];
      const csvContent = [
        headers.join(','),
        ...journalRows.map((row) =>
          [
            `"${row.id}"`,
            `"${row.date}"`,
            `"${row.partnerName.replace(/"/g, '""')}"`,
            `"${row.partnerRef}"`,
            `"${row.label.replace(/"/g, '""')}"`,
            `"${row.matchedDocument}"`,
            `"${row.isReconciled ? 'Oui' : 'Non'}"`,
            row.amount,
            `"${row.journal}"`,
          ].join(',')
        ),
      ].join('\n');

      const blob = new Blob([new Uint8Array([0xef, 0xbb, 0xbf]), csvContent], {
        type: 'text/csv;charset=utf-8;',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute(
        'download',
        `Rapprochement_${selectedJournal.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Fichier CSV généré et téléchargé !', 'success');
      setIsSettingsDropdownOpen(false);
    } catch (e) {
      showToast("Erreur lors de l'export CSV.", 'error');
    }
  };

  // Import from CSV
  const handleImportRecords = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    const parseImportDate = (val: any): string => {
      if (val instanceof Date) {
        return val.toISOString().split('T')[0];
      }
      if (val === undefined || val === null) {
        return new Date().toISOString().split('T')[0];
      }

      const numVal = Number(val);
      if (!isNaN(numVal) && typeof val !== 'boolean' && String(val).trim() !== '') {
        if (numVal > 30000 && numVal < 60000) {
          return new Date(Math.round((numVal - 25569) * 86400 * 1000)).toISOString().split('T')[0];
        }
      }

      const str = String(val).trim();
      if (!str) return new Date().toISOString().split('T')[0];

      // Try YYYY-MM-DD
      const ymd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
      if (ymd) {
        const y = parseInt(ymd[1], 10);
        const m = String(parseInt(ymd[2], 10)).padStart(2, '0');
        const d = String(parseInt(ymd[3], 10)).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }

      // Try DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
      const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
      if (dmy) {
        const y = parseInt(dmy[3], 10);
        const m = String(parseInt(dmy[2], 10)).padStart(2, '0');
        const d = String(parseInt(dmy[1], 10)).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }

      const parsed = Date.parse(str);
      if (!isNaN(parsed)) {
        return new Date(parsed).toISOString().split('T')[0];
      }

      return new Date().toISOString().split('T')[0];
    };

    const parseImportNumber = (val: any): number => {
      if (typeof val === 'number') return val;
      if (val === undefined || val === null) return 0;

      let str = String(val)
        .trim()
        .replace(/[\s\u00A0\u202F]/g, '');
      if (!str) return 0;

      str = str.replace(/[DHdh$€£]/g, '');

      const hasComma = str.includes(',');
      const hasDot = str.includes('.');

      if (hasComma && hasDot) {
        if (str.indexOf(',') < str.indexOf('.')) {
          str = str.replace(/,/g, '');
        } else {
          str = str.replace(/\./g, '').replace(',', '.');
        }
      } else if (hasComma) {
        str = str.replace(',', '.');
      }

      const num = parseFloat(str);
      return isNaN(num) ? 0 : num;
    };

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = event.target?.result;
        if (!data) return;

        // Read using XLSX so that we support both Excel & CSV beautifully
        const workbook = XLSX.read(data, { type: 'binary', codepage: 65001 });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
        if (rawRows.length < 2) {
          showToast('Le fichier est vide ou manque de données.', 'error');
          return;
        }

        // Search for header row in the first 10 rows
        let headerRowIndex = 0;
        let foundHeader = false;
        for (let r = 0; r < Math.min(10, rawRows.length); r++) {
          const row = rawRows[r];
          if (
            row &&
            row.some((cell) => {
              const str = String(cell || '').toLowerCase();
              return (
                str.includes('date') ||
                str.includes('tiers') ||
                str.includes('partenaire') ||
                str.includes('montant') ||
                str.includes('libellé') ||
                str.includes('libelle') ||
                str.includes('reference')
              );
            })
          ) {
            headerRowIndex = r;
            foundHeader = true;
            break;
          }
        }

        const headers = foundHeader
          ? (rawRows[headerRowIndex] || []).map((h) =>
              String(h || '')
                .trim()
                .toLowerCase()
            )
          : [];

        const findColumnIndex = (synonyms: string[]) => {
          if (!foundHeader) return -1;
          const exactIdx = headers.findIndex((h) => synonyms.some((syn) => h === syn));
          if (exactIdx >= 0) return exactIdx;
          return headers.findIndex((h) => synonyms.some((syn) => h.includes(syn)));
        };

        const idxDate = findColumnIndex([
          'date',
          'opération',
          'operation',
          'valeur',
          'transaction',
          "date d'opération",
          'date de transaction',
        ]);
        const idxPartner = findColumnIndex([
          'partenaire',
          'tiers',
          'bénéficiaire',
          'beneficiaire',
          'nom',
          'partner',
          'payee',
          'client',
          'fournisseur',
          'vendor',
          'destinataire',
          'emetteur',
        ]);
        const idxRef = findColumnIndex([
          'référence',
          'reference',
          'ref',
          'n°',
          'numero',
          'numéro',
          'id',
          'pièce',
          'piece',
        ]);
        const idxLabel = findColumnIndex([
          'libellé',
          'libelle',
          'motif',
          'description',
          'label',
          'détails',
          'details',
          'commentaire',
        ]);
        const idxAmount = findColumnIndex(['montant', 'amount', 'solde', 'montant (dh)', 'valeur']);
        const idxDebit = findColumnIndex(['débit', 'debit']);
        const idxCredit = findColumnIndex(['crédit', 'credit']);

        let importCount = 0;

        // Skip headers, parse each line
        for (let i = headerRowIndex + (foundHeader ? 1 : 0); i < rawRows.length; i++) {
          const row = rawRows[i];
          if (!row || row.length === 0) continue;

          // If it's an empty line (e.g. trailing row)
          if (
            row.every((cell) => cell === null || cell === undefined || String(cell).trim() === '')
          ) {
            continue;
          }

          // Helper to get raw cell value safely
          const getCellVal = (idx: number) => {
            if (idx < 0 || idx >= row.length) return '';
            return row[idx] === null || row[idx] === undefined ? '' : String(row[idx]).trim();
          };

          // Parse values with robust synonyms and position-based fallbacks
          let dateStr = '';
          if (idxDate >= 0) {
            dateStr = parseImportDate(row[idxDate]);
          } else {
            // Fallback: try column 1 or column 0
            dateStr = parseImportDate(row[1] !== undefined ? row[1] : row[0]);
          }

          let partnerName = 'Tiers Importé';
          if (idxPartner >= 0) {
            partnerName = getCellVal(idxPartner) || 'Tiers Importé';
          } else if (row.length > 2) {
            partnerName = getCellVal(2) || 'Tiers Importé';
          } else if (row.length > 1) {
            partnerName = getCellVal(1) || 'Tiers Importé';
          }

          let partnerRef = '';
          if (idxRef >= 0) {
            partnerRef = getCellVal(idxRef);
          } else if (row.length > 3) {
            partnerRef = getCellVal(3);
          }
          if (!partnerRef || partnerRef === 'N/A') {
            partnerRef = 'REF-' + Math.floor(100000 + Math.random() * 900000);
          }

          let label = 'Transaction CSV';
          if (idxLabel >= 0) {
            label = getCellVal(idxLabel) || 'Transaction CSV';
          } else if (row.length > 4) {
            label = getCellVal(4) || 'Transaction CSV';
          }

          let amount = 0;
          if (idxDebit >= 0 || idxCredit >= 0) {
            const deb = idxDebit >= 0 ? parseImportNumber(row[idxDebit]) : 0;
            const cred = idxCredit >= 0 ? parseImportNumber(row[idxCredit]) : 0;
            if (cred !== 0) {
              amount = cred;
            } else if (deb !== 0) {
              amount = -Math.abs(deb);
            }
          } else if (idxAmount >= 0) {
            amount = parseImportNumber(row[idxAmount]);
          } else if (row.length > 7) {
            amount = parseImportNumber(row[7]);
          } else if (row.length > 5) {
            amount = parseImportNumber(row[5]);
          } else if (row.length > 0) {
            // Try to find the first numeric cell that looks like an amount
            for (let c = row.length - 1; c >= 0; c--) {
              const val = parseImportNumber(row[c]);
              if (val !== 0) {
                amount = val;
                break;
              }
            }
          }

          await addDoc(collection(db, 'bank_reconciliations'), {
            date: dateStr,
            partnerName,
            partnerRef,
            label,
            amount,
            hasAttachment: false,
            isReconciled: false,
            matchedDocument: '',
            journal: selectedJournal,
            ownerId: user.uid,
            createdAt: serverTimestamp(),
          });
          importCount++;
        }

        showToast(
          `${importCount} écritures importées avec succès dans le journal ${selectedJournal} !`,
          'success'
        );
        setIsSettingsDropdownOpen(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (err) {
        console.error('Parse failed:', err);
        showToast(
          'Erreur lors de la lecture du fichier. Assurez-vous du format Excel ou CSV.',
          'error'
        );
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleResetData = async () => {
    if (!user) return;
    confirm({
      title: 'Vider toutes les écritures',
      message:
        'Êtes-vous sûr de vouloir supprimer TOUTES vos écritures bancaires et de caisse ? Cette action est irréversible et annulera les lettrages associés.',
      confirmText: 'Vider',
      cancelText: 'Annuler',
      variant: 'danger',
      onConfirm: async () => {
        try {
          setIsLoading(true);
          const q = query(collection(db, 'bank_reconciliations'), where('ownerId', '==', user.uid));
          const snap = await getDocs(q);
          for (const d of snap.docs) {
            await deleteDoc(doc(db, 'bank_reconciliations', d.id));
          }
          showToast('Toutes les écritures ont été supprimées avec succès !', 'success');
          setIsSettingsDropdownOpen(false);
        } catch (e) {
          showToast('Erreur lors de la suppression.', 'error');
        } finally {
          setIsLoading(false);
        }
      },
    });
  };

  const handleLoadDemoData = async () => {
    if (!user) return;
    confirm({
      title: 'Charger les données de démo',
      message: "Voulez-vous charger des écritures de démonstration pour tester l'application ?",
      confirmText: 'Charger',
      cancelText: 'Annuler',
      onConfirm: async () => {
        setIsLoading(true);
        await seedDefaultData(user.uid);
        setIsSettingsDropdownOpen(false);
      },
    });
  };

  // Filter transactions for visual rendering
  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => {
      // 1. Journal filter
      if (t.journal !== selectedJournal) return false;

      // 2. Search query filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          t.partnerName.toLowerCase().includes(q) ||
          t.partnerRef.toLowerCase().includes(q) ||
          t.label.toLowerCase().includes(q) ||
          t.matchedDocument.toLowerCase().includes(q) ||
          String(t.amount).includes(q);
        if (!matchesSearch) return false;
      }

      // 3. Status filter
      if (statusFilter === 'reconciled') return t.isReconciled;
      if (statusFilter === 'unreconciled') return !t.isReconciled;

      return true;
    });
  }, [transactions, selectedJournal, searchQuery, statusFilter]);

  // Suggested docs filtered inside modal search
  const filteredSuggestedDocs = useMemo(() => {
    let result = suggestedDocs;

    if (selectedTransaction) {
      const isPositive = selectedTransaction.amount > 0;
      result = result.filter((d) => {
        if (isPositive) return d.type === 'Vente';
        return d.type === 'Achat';
      });
    }

    if (docSearchQuery) {
      const q = docSearchQuery.toLowerCase();
      result = result.filter(
        (d) =>
          d.refId.toLowerCase().includes(q) ||
          d.clientOrSupplierName.toLowerCase().includes(q) ||
          String(d.amount).includes(q)
      );
    }

    if (selectedTransaction) {
      const absTx = Math.abs(selectedTransaction.amount);
      const txLabel = selectedTransaction.label || '';
      const txPartner = selectedTransaction.partnerName || '';

      result = [...result].sort((a, b) => {
        const absA = Math.abs(a.amount);
        const absB = Math.abs(b.amount);

        // 1. Exact match (PIN to top)
        const exactA = Math.abs(absA - absTx) < 0.01;
        const exactB = Math.abs(absB - absTx) < 0.01;
        if (exactA && !exactB) return -1;
        if (!exactA && exactB) return 1;

        // 2. Text Similarity Score match
        const scoreA = calculateTextSimilarityScore(txLabel, txPartner, a.clientOrSupplierName);
        const scoreB = calculateTextSimilarityScore(txLabel, txPartner, b.clientOrSupplierName);
        if (scoreA !== scoreB) {
          return scoreB - scoreA; // highest score first
        }

        // 3. Date: newest first (date jedida lfo9)
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return dateB - dateA;
      });
    }

    return result;
  }, [suggestedDocs, docSearchQuery, selectedTransaction]);

  // Compute stats metrics based on current journal
  const stats = useMemo(() => {
    const journalRows = transactions.filter((t) => t.journal === selectedJournal);
    let reconciledSum = 0;
    let unreconciledSum = 0;
    let pendingAttachments = 0;
    let totalBalance = 0;

    journalRows.forEach((t) => {
      totalBalance += t.amount;
      if (t.isReconciled) {
        reconciledSum += t.amount;
      } else {
        unreconciledSum += t.amount;
        if (t.hasAttachment) {
          pendingAttachments++;
        }
      }
    });

    return {
      reconciledSum,
      unreconciledSum,
      pendingAttachments,
      totalBalance,
    };
  }, [transactions, selectedJournal]);

  return (
    <div
      className="w-full py-6 md:py-10 space-y-6"
      style={{ fontFamily: "'Public Sans', sans-serif" }}
    >
      {/* Hidden file input for CSV/Excel Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".csv,.xlsx,.xls"
        className="hidden"
      />

      {/* KPI Cards section (Inspired by Sneat Cockpit) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* KPI 1: Active Journal Balance */}
        <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-5 shadow-2xs relative overflow-hidden flex flex-col justify-between min-h-[110px]">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[12px] font-semibold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                Solde du journal
              </span>
              <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 font-mono">
                {stats.totalBalance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
              </h3>
            </div>
            <div className="p-2.5 bg-[#696cff]/10 text-[#696cff] rounded-lg flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center justify-between text-[12px] text-slate-400 mt-2.5">
            <span className="font-semibold text-slate-500 dark:text-slate-300 capitalize">
              {selectedJournal.toLowerCase()}
            </span>
            <button
              type="button"
              onClick={() => {
                setTargetBalanceInput('151076.80');
                setIsAdjustBalanceModalOpen(true);
              }}
              className="text-[#696cff] hover:underline font-semibold flex items-center gap-1 cursor-pointer transition-colors"
              title="Ajuster le solde initial ou réel"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Ajuster le solde
            </button>
          </div>
        </div>

        {/* KPI 2: Reconciled Total */}
        <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-5 shadow-2xs relative overflow-hidden flex flex-col justify-between min-h-[110px]">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[12px] font-semibold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                Mouvements lettrés
              </span>
              <h3 className="text-xl font-bold text-emerald-600 font-mono">
                {stats.reconciledSum.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
              </h3>
            </div>
            <div className="p-2.5 bg-emerald-50 text-emerald-600 dark:bg-emerald-950/20 dark:text-emerald-400 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-2.5">
            <span className="text-emerald-500 font-bold">✔ Cohérence validée</span>
          </div>
        </div>

        {/* KPI 3: Unreconciled Total */}
        <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-5 shadow-2xs relative overflow-hidden flex flex-col justify-between min-h-[110px]">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[12px] font-semibold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                Reste à lettrer
              </span>
              <h3 className="text-xl font-bold text-orange-500 font-mono">
                {stats.unreconciledSum.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
              </h3>
            </div>
            <div className="p-2.5 bg-orange-50 text-orange-500 dark:bg-orange-950/20 dark:text-orange-400 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-2.5">
            <span className="text-orange-400 font-medium">⚠ En attente de justificatif</span>
          </div>
        </div>

        {/* KPI 4: Pending Attachments */}
        <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-5 shadow-2xs relative overflow-hidden flex flex-col justify-between min-h-[110px]">
          <div className="flex justify-between items-start">
            <div className="space-y-1">
              <span className="text-[12px] font-semibold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                Pièces jointes orphelines
              </span>
              <h3 className="text-xl font-bold text-[#222222] dark:text-slate-100 font-mono">
                {stats.pendingAttachments} docs
              </h3>
            </div>
            <div className="p-2.5 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 rounded-lg flex items-center justify-center">
              <Paperclip className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-2.5">
            <span>Documents chargés sans rapprochement</span>
          </div>
        </div>
      </div>

      {/* Main Content Area: Tab switcher, search, filters & table */}
      <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg shadow-xs overflow-hidden">
        {/* Table Header: Search, tabs, and filters in a single elegant row */}
        <div className="border-b border-slate-100 dark:border-slate-700/50 p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          {/* Journal Tabs */}
          <div className="flex bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg self-start">
            <button
              onClick={() => handleChangeJournal('UMNIA BANK')}
              className={`flex items-center gap-2 px-4 py-2 font-semibold text-[13px] rounded-md transition-colors ${
                selectedJournal === 'UMNIA BANK'
                  ? 'bg-white dark:bg-[#2b2c40] text-[#696cff] shadow-2xs'
                  : 'text-[#566a7f] dark:text-[#a3a4cc] hover:text-slate-800 dark:hover:text-slate-100'
              }`}
            >
              <Coins className="w-4 h-4" />
              UMNIA BANK
            </button>
            <button
              onClick={() => handleChangeJournal('Espèces')}
              className={`flex items-center gap-2 px-4 py-2 font-semibold text-[13px] rounded-md transition-colors ${
                selectedJournal === 'Espèces'
                  ? 'bg-white dark:bg-[#2b2c40] text-[#696cff] shadow-2xs'
                  : 'text-[#566a7f] dark:text-[#a3a4cc] hover:text-slate-800 dark:hover:text-slate-100'
              }`}
            >
              <Wallet className="w-4 h-4" />
              Caisse (Espèces)
            </button>
          </div>

          {/* Search bar, state filter, and action buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full xl:w-auto xl:justify-end">
            {/* Search Input */}
            <div className="relative w-full sm:w-[320px] md:w-[380px]">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Rechercher tiers, réf, libellé..."
                className="w-full text-[13px] pl-9 pr-4 py-2 h-[38px] bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#696cff] focus:border-[#696cff] transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Reconciliation State Filter */}
            <select
              value={statusFilter}
              onChange={(e: any) => setStatusFilter(e.target.value)}
              className="w-full sm:w-[150px] px-3 py-2 text-[13px] h-[38px] bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#696cff] cursor-pointer"
            >
              <option value="all">Tous les états</option>
              <option value="reconciled">Lettrés</option>
              <option value="unreconciled">À lettrer</option>
            </select>

            {/* Actions: Button & Settings */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#696cff] text-white font-medium text-[13px] rounded-lg transition-transform hover:scale-[1.02] shadow-[0_2px_4px_rgba(105,108,255,0.2)] h-[38px] whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Saisir un mouvement
              </button>

              {/* Dropdown for Import / Export */}
              <div className="relative" ref={settingsDropdownRef}>
                <button
                  onClick={() => setIsSettingsDropdownOpen(!isSettingsDropdownOpen)}
                  className="flex items-center justify-center w-[38px] h-[38px] bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 text-[#566a7f] dark:text-[#a3a4cc] rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="Options d'import/export"
                >
                  <Settings className="w-4 h-4 animate-hover-spin" />
                </button>

                <AnimatePresence>
                  {isSettingsDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 w-56 bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg shadow-lg z-50 overflow-hidden text-left"
                    >
                      <div className="py-1 divide-y divide-slate-100 dark:divide-slate-700/50">
                        <div className="py-1">
                          <button
                            onClick={handleImportRecords}
                            className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-[13px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <Upload className="w-4 h-4 text-[#696cff]" />
                            Importer un relevé CSV
                          </button>
                          <button
                            onClick={() => navigate('/rapprochement/import')}
                            className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-[13px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <FileText className="w-4 h-4 text-orange-500" />
                            Importer un relevé bancaire
                          </button>
                          <button
                            onClick={handleExportAll}
                            className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-[13px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <Download className="w-4 h-4 text-emerald-500" />
                            Exporter en CSV (.csv)
                          </button>
                        </div>
                        <div className="py-1">
                          <button
                            onClick={handleLoadDemoData}
                            className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-[13px] text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <RefreshCw className="w-4 h-4 text-emerald-500" />
                            Charger données démo
                          </button>
                          <button
                            onClick={handleResetData}
                            className="flex items-center gap-2.5 w-full text-left px-4 py-2 text-[13px] text-rose-500 hover:bg-rose-50/50 dark:hover:bg-rose-950/20 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4 text-rose-500" />
                            Vider toutes les écritures
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>

        {/* Real Table */}
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="py-20 flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-2 border-[#696cff] border-t-transparent rounded-full animate-spin"></div>
              <p className="text-[12px] text-slate-400 uppercase tracking-widest font-bold">
                Chargement des opérations...
              </p>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="py-20 text-center space-y-3">
              <HelpCircle className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto" />
              <h4 className="text-[15px] font-semibold text-slate-600 dark:text-slate-300">
                Aucune transaction trouvée
              </h4>
              <p className="text-[13px] text-slate-400 max-w-sm mx-auto">
                Modifiez vos filtres ou ajoutez une nouvelle écriture pour commencer le
                rapprochement.
              </p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-100/70 dark:bg-slate-800/40 text-[11px] text-slate-500 dark:text-[#707194] uppercase tracking-wider border-b border-slate-100 dark:border-slate-700/50">
                <tr>
                  <th className="px-5 py-3 font-semibold">Date</th>
                  <th className="px-5 py-3 font-semibold">Tiers / Partenaire</th>
                  <th className="px-5 py-3 font-semibold">Libellé & Référence</th>
                  <th className="px-5 py-3 font-semibold">Justificatif</th>
                  <th className="px-5 py-3 font-semibold">Statut Lettrage</th>
                  <th className="px-5 py-3 font-semibold text-right">Montant</th>
                  <th className="px-5 py-3 font-semibold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/30 text-[13px]">
                {filteredTransactions.map((tx, idx) => {
                  const isPositive = tx.amount > 0;
                  return (
                    <tr
                      key={tx.id + "_" + idx}
                      className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20 transition-colors"
                    >
                      {/* Date */}
                      <td className="px-5 py-3 text-slate-600 dark:text-slate-300 font-mono whitespace-nowrap">
                        {new Date(tx.date).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </td>

                      {/* Partner */}
                      <td className="px-5 py-3 font-semibold text-slate-800 dark:text-slate-200">
                        <div>{tx.partnerName}</div>
                        {tx.partnerRef && tx.partnerRef !== 'N/A' && (
                          <div className="text-[11px] text-slate-400 font-mono">
                            Ref: {tx.partnerRef}
                          </div>
                        )}
                      </td>

                      {/* Label & Type */}
                      <td className="px-5 py-3 text-slate-600 dark:text-slate-300">
                        <div className="font-medium">{tx.label}</div>
                        {tx.isReconciled ? (
                          <div className="flex items-center gap-1 mt-1 text-[11px] text-[#696cff] font-semibold">
                            <FileText className="w-3 h-3" />
                            {tx.matchedDocument ? `Lettré avec : ${tx.matchedDocument}` : 'Lettré (Document lié)'}
                          </div>
                        ) : (
                          <div className="text-[11px] text-orange-400 italic">Aucune liaison</div>
                        )}
                      </td>

                      {/* Attachment */}
                      <td className="px-5 py-3">
                        <button
                          onClick={() => handleToggleAttachment(tx)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded border transition-colors ${
                            tx.hasAttachment
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400 dark:border-emerald-900/30'
                              : 'bg-slate-50 text-slate-400 border-slate-100 dark:bg-slate-800 dark:text-slate-500 dark:border-slate-700/50 hover:text-slate-600'
                          }`}
                          title={
                            tx.hasAttachment
                              ? 'Pièce jointe validée. Cliquez pour retirer.'
                              : 'Aucune pièce jointe. Cliquez pour ajouter un reçu simulé.'
                          }
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                          <span className="text-[11px] font-medium">
                            {tx.hasAttachment ? 'Justifié' : 'Manquant'}
                          </span>
                        </button>
                      </td>

                      {/* Status */}
                      <td className="px-5 py-3 whitespace-nowrap">
                        {tx.isReconciled ? (
                          <span className="inline-flex items-center gap-1.5 font-bold text-emerald-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            LETTRÉ
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 font-bold text-orange-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
                            NON LETTRÉ
                          </span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="px-5 py-3 text-right font-mono font-bold">
                        <span className={isPositive ? 'text-emerald-600' : 'text-rose-500'}>
                          {isPositive ? '+' : ''}
                          {tx.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-center gap-1.5">
                          {tx.isReconciled ? (
                            <button
                              onClick={() => handleUnreconcile(tx.id)}
                              className="p-1.5 hover:bg-rose-50 text-rose-500 dark:hover:bg-rose-950/20 rounded-lg transition-colors border border-transparent hover:border-rose-100"
                              title="Annuler le lettrage"
                            >
                              <XCircle className="w-4 h-4" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleOpenReconcileModal(tx)}
                              className="flex items-center gap-1 px-2.5 py-1.5 bg-[#696cff]/10 hover:bg-[#696cff] text-[#696cff] hover:text-white rounded-lg transition-all text-[11px] font-semibold border border-transparent"
                              title="Lettrer avec une facture"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Lettrer
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteTransaction(tx.id, tx.isReconciled)}
                            className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors"
                            title="Supprimer la transaction"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* MODAL 1: Add manual bank transaction */}
      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-2xs z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-slate-700/60 shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base flex items-center gap-2">
                  <Plus className="w-4 h-4 text-[#696cff]" />
                  Nouveau mouvement ({selectedJournal})
                </h3>
                <button
                  onClick={() => setIsAddModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddTransaction} className="p-5 space-y-4 text-left">
                {/* Date */}
                <div>
                  <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Date de l'opération <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full text-[13px] px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] font-mono text-slate-700 dark:text-slate-200"
                  />
                </div>

                {/* Partner Name */}
                <div>
                  <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Tiers / Bénéficiaire
                  </label>
                  <input
                    type="text"
                    placeholder="ex: SOCIETE MAROCAINE..."
                    value={newPartner}
                    onChange={(e) => setNewPartner(e.target.value)}
                    className="w-full text-[13px] px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] text-slate-700 dark:text-slate-200"
                  />
                </div>

                {/* Ref & Label */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      Référence bancaire
                    </label>
                    <input
                      type="text"
                      placeholder="ex: 9893177"
                      value={newRef}
                      onChange={(e) => setNewRef(e.target.value)}
                      className="w-full text-[13px] px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] font-mono text-slate-700 dark:text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                      Libellé
                    </label>
                    <input
                      type="text"
                      placeholder="ex: Virement client"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      className="w-full text-[13px] px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] text-slate-700 dark:text-slate-200"
                    />
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Montant (DH) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="Saisissez un nombre (négatif pour une sortie)"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    className="w-full text-[13px] px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] font-mono text-slate-700 dark:text-slate-200"
                  />
                  <span className="text-[11px] text-slate-400 mt-1 block">
                    Utilisez le signe "-" pour les dépenses / décaissements (ex: -1500)
                  </span>
                </div>

                {/* Attachment Toggle */}
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="newHasAttachment"
                    checked={newHasAttachment}
                    onChange={(e) => setNewHasAttachment(e.target.checked)}
                    className="rounded border-slate-300 text-[#696cff] focus:ring-[#696cff]"
                  />
                  <label
                    htmlFor="newHasAttachment"
                    className="text-[13px] text-slate-600 dark:text-slate-300 select-none"
                  >
                    Justificatif (pièce jointe) disponible
                  </label>
                </div>

                {/* Submit buttons */}
                <div className="flex justify-end gap-2.5 pt-4 border-t border-slate-100 dark:border-slate-700/50">
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 dark:text-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-[13px] font-medium"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#696cff] hover:bg-[#5f61e6] text-white rounded-lg text-[13px] font-medium transition-colors"
                  >
                    Enregistrer
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: Adjust Total Bank Balance */}
      <AnimatePresence>
        {isAdjustBalanceModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-2xs z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-slate-700/60 shadow-xl max-w-md w-full overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base flex items-center gap-2">
                  <Scale className="w-4 h-4 text-[#696cff]" />
                  Ajuster le solde ({selectedJournal})
                </h3>
                <button
                  onClick={() => setIsAdjustBalanceModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleConfirmAdjustBalance} className="p-5 space-y-4 text-left">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg text-xs space-y-1">
                  <div className="flex justify-between text-slate-500">
                    <span>Solde actuel calculé :</span>
                    <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                      {stats.totalBalance.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                    </span>
                  </div>
                  {targetBalanceInput && !isNaN(parseFloat(targetBalanceInput)) && (
                    <div className="flex justify-between text-slate-500 pt-1 border-t border-slate-200/40 dark:border-slate-700/40">
                      <span>Écriture d'ajustement calculée :</span>
                      <span
                        className={`font-mono font-bold ${
                          parseFloat(targetBalanceInput) - stats.totalBalance >= 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-500'
                        }`}
                      >
                        {(parseFloat(targetBalanceInput) - stats.totalBalance >= 0 ? '+' : '') +
                          (parseFloat(targetBalanceInput) - stats.totalBalance).toLocaleString(
                            'fr-FR',
                            { minimumFractionDigits: 2 }
                          )}{' '}
                        DH
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Solde bancaire réel (DH) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="ex: 151076.80"
                    value={targetBalanceInput}
                    onChange={(e) => setTargetBalanceInput(e.target.value)}
                    className="w-full text-[14px] px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] font-mono font-bold text-slate-800 dark:text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Date de l'ajustement
                  </label>
                  <input
                    type="date"
                    required
                    value={adjustmentDate}
                    onChange={(e) => setAdjustmentDate(e.target.value)}
                    className="w-full text-[13px] px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] font-mono text-slate-700 dark:text-slate-200"
                  />
                </div>

                <div>
                  <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">
                    Intitulé de l'opération
                  </label>
                  <input
                    type="text"
                    value={adjustmentLabel}
                    onChange={(e) => setAdjustmentLabel(e.target.value)}
                    className="w-full text-[13px] px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] text-slate-700 dark:text-slate-200"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-700/50">
                  <button
                    type="button"
                    onClick={() => setIsAdjustBalanceModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 dark:text-slate-300 rounded-lg transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#696cff] hover:bg-[#5f61e6] rounded-lg shadow-2xs transition-colors"
                  >
                    Valider l'ajustement
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: Dynamic Document Lettrage Selection */}
      <AnimatePresence>
        {isReconcileModalOpen && selectedTransaction && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-2xs z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-slate-700/60 shadow-xl max-w-2xl w-full overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-base">
                    Lettrer l'opération financière
                  </h3>
                  <p className="text-[12px] text-slate-400 mt-0.5">
                    Sélectionnez un document d'achat ou de vente pour le rapprocher de ce mouvement
                    de {selectedTransaction.amount.toLocaleString('fr-FR')} DH.
                  </p>
                </div>
                <button
                  onClick={() => setIsReconcileModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Transaction details panel */}
              <div className="bg-slate-50 dark:bg-slate-800/40 px-5 py-3 border-b border-slate-100 dark:border-slate-700/30 grid grid-cols-2 sm:grid-cols-4 gap-4 text-left">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Date</span>
                  <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 font-mono">
                    {new Date(selectedTransaction.date).toLocaleDateString('fr-FR')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Bénéficiaire
                  </span>
                  <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 truncate block">
                    {selectedTransaction.partnerName}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Libellé
                  </span>
                  <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 block truncate">
                    {selectedTransaction.label}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Montant
                  </span>
                  <span
                    className={`text-[13px] font-black font-mono block ${selectedTransaction.amount > 0 ? 'text-emerald-600' : 'text-rose-500'}`}
                  >
                    {selectedTransaction.amount.toLocaleString('fr-FR')} DH
                  </span>
                </div>
              </div>

              {/* TABS */}
              {selectedTransaction.amount < 0 && (
                <div className="flex border-b border-slate-100 dark:border-slate-700/50">
                  <button
                    onClick={() => setReconcileTab('invoice')}
                    className={`flex-1 py-3 text-sm font-semibold text-center border-b-2 transition-colors ${
                      reconcileTab === 'invoice'
                        ? 'border-[#696cff] text-[#696cff]'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    Chercher une facture/pièce
                  </button>
                  <button
                    onClick={() => setReconcileTab('charge')}
                    className={`flex-1 py-3 text-sm font-semibold text-center border-b-2 transition-colors ${
                      reconcileTab === 'charge'
                        ? 'border-[#696cff] text-[#696cff]'
                        : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                  >
                    Enregistrer comme charge (Frais)
                  </button>
                </div>
              )}

              {reconcileTab === 'invoice' ? (
                <>
                  {/* Document suggestions search */}
                  <div className="p-4 border-b border-slate-100 dark:border-slate-700/50">
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                        <Search className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        value={docSearchQuery}
                        onChange={(e) => setDocSearchQuery(e.target.value)}
                        placeholder="Filtrer les pièces comptables par numéro, tiers ou montant..."
                        className="w-full text-[13px] pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Suggestions List */}
                  <div className="flex-1 overflow-y-auto p-5 text-left space-y-3">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                      Pièces comptables trouvées
                    </span>

                    {autoMatchSuggestion && (
                      <div className="p-4 border border-indigo-100 dark:border-indigo-900/40 rounded-lg bg-indigo-50/40 dark:bg-indigo-950/20 space-y-3.5 mb-2 text-left">
                        <div className="flex items-start gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-indigo-100 dark:bg-indigo-950 text-[#696cff] flex items-center justify-center shrink-0 mt-0.5">
                            <Wand2 className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-[13px] flex items-center gap-1.5">
                              💡 Suggestion de Lettrage Intelligent
                            </h4>
                            <p className="text-[12px] text-slate-600 dark:text-slate-300 mt-1">
                              La facture{' '}
                              <strong className="font-semibold text-slate-800 dark:text-slate-100">
                                {autoMatchSuggestion.invoice.refId}
                              </strong>{' '}
                              ({autoMatchSuggestion.invoice.clientOrSupplierName}) de{' '}
                              <strong className="font-mono text-[13px] text-slate-800 dark:text-slate-100">
                                {autoMatchSuggestion.invoice.totalAmount.toLocaleString('fr-FR')} DH
                              </strong>{' '}
                              correspond parfaitement à la somme des règlements suivants :
                            </p>
                          </div>
                        </div>

                        <div className="space-y-1.5 pl-9">
                          <div className="flex justify-between items-center text-[12px] text-slate-600 dark:text-slate-400 py-1 border-b border-dashed border-indigo-100 dark:border-indigo-900/30">
                            <span className="font-medium">
                              Ce mouvement ({selectedTransaction.label}) :
                            </span>
                            <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                              {Math.abs(selectedTransaction.amount).toLocaleString('fr-FR')} DH
                            </span>
                          </div>
                          {autoMatchSuggestion.otherTransactions.map((tx, idx) => (
                            <div
                              key={tx.id + "_" + idx}
                              className="flex justify-between items-center text-[12px] text-slate-600 dark:text-slate-400 py-1"
                            >
                              <span className="font-medium">
                                Mouvement du {new Date(tx.date).toLocaleDateString('fr-FR')} (
                                {tx.label}) :
                              </span>
                              <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                                {Math.abs(tx.amount).toLocaleString('fr-FR')} DH
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="pl-9 flex justify-end">
                          <button
                            type="button"
                            onClick={handleApplyCombinedAutoMatch}
                            disabled={isApplyingAutoMatch}
                            className="px-4 py-2 bg-[#696cff] text-white hover:bg-[#5f61e6] text-[12px] font-semibold rounded-md shadow-xs flex items-center gap-1.5 disabled:opacity-50 cursor-pointer animate-pulse hover:animate-none"
                          >
                            {isApplyingAutoMatch ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                Application...
                              </>
                            ) : (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                Valider ce lettrage combiné
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    {isLoadingDocs ? (
                      <div className="py-12 flex flex-col items-center gap-3">
                        <div className="w-8 h-8 border-2 border-[#696cff] border-t-transparent rounded-full animate-spin"></div>
                        <span className="text-[12px] text-slate-400">
                          Analyse de la base de données...
                        </span>
                      </div>
                    ) : filteredSuggestedDocs.length === 0 ? (
                      <div className="py-12 text-center text-slate-400">
                        <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                        Aucun document correspondant trouvé. Créez des ventes/achats validés pour
                        pouvoir lettrer.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {(() => {
                          const bestPartialDoc = filteredSuggestedDocs.find((docItem) => {
                            const score = calculateTextSimilarityScore(
                              selectedTransaction.label || '',
                              selectedTransaction.partnerName || '',
                              docItem.clientOrSupplierName
                            );
                            return (
                              score > 20 &&
                              Math.abs(selectedTransaction.amount) < Math.abs(docItem.amount) - 0.01
                            );
                          });

                          return (
                            <>
                              {bestPartialDoc && !autoMatchSuggestion && (
                                <div className="p-3.5 border border-orange-100 dark:border-orange-900/30 rounded-lg bg-orange-50/20 dark:bg-orange-950/10 flex items-start gap-2.5 mb-3 text-left">
                                  <div className="w-6 h-6 rounded-md bg-orange-50 dark:bg-orange-950/40 text-orange-500 flex items-center justify-center shrink-0 mt-0.5">
                                    <Wand2 className="w-3.5 h-3.5" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h4 className="font-bold text-orange-600 dark:text-orange-400 text-[12.5px] flex items-center gap-1.5">
                                      💡 Suggestion de règlement partiel
                                    </h4>
                                    <p className="text-[11.5px] text-slate-600 dark:text-slate-300 mt-1">
                                      Le mouvement de{' '}
                                      <strong className="font-mono text-slate-800 dark:text-slate-200">
                                        {Math.abs(selectedTransaction.amount).toLocaleString(
                                          'fr-FR'
                                        )}{' '}
                                        DH
                                      </strong>{' '}
                                      semble correspondre à la pièce{' '}
                                      <strong className="font-semibold text-slate-800 dark:text-slate-200">
                                        {bestPartialDoc.refId}
                                      </strong>{' '}
                                      de{' '}
                                      <strong className="font-semibold text-slate-800 dark:text-slate-200">
                                        {bestPartialDoc.clientOrSupplierName}
                                      </strong>{' '}
                                      (
                                      <span className="font-mono">
                                        {Math.abs(bestPartialDoc.amount).toLocaleString('fr-FR')} DH
                                      </span>{' '}
                                      restant). Vous pouvez cliquer sur la pièce ci-dessous pour
                                      l'enregistrer comme paiement partiel.
                                    </p>
                                  </div>
                                </div>
                              )}

                              {filteredSuggestedDocs.map((docItem) => {
                                // Calculate difference absolute amount
                                const txAmtAbs = Math.abs(selectedTransaction.amount);
                                const docAmtRemaining = Math.abs(docItem.amount);
                                const amountDiff = Math.abs(docAmtRemaining - txAmtAbs);
                                const isPerfectMatch = amountDiff < 0.01;
                                const isSelected = selectedDocsForReconcile.some(
                                  (d) => d.id === docItem.id
                                );

                                // Similarity Score
                                const score = calculateTextSimilarityScore(
                                  selectedTransaction.label || '',
                                  selectedTransaction.partnerName || '',
                                  docItem.clientOrSupplierName
                                );

                                const isPotentialPartial =
                                  score > 20 && txAmtAbs < docAmtRemaining - 0.01;

                                return (
                                  <div
                                    key={`${docItem.type}-${docItem.id}`}
                                    onClick={() => handleToggleSelectDoc(docItem)}
                                    className={`p-3.5 border rounded-lg cursor-pointer transition-all relative overflow-hidden ${
                                      isSelected
                                        ? 'bg-indigo-50/20 border-[#696cff] dark:bg-indigo-950/25 dark:border-indigo-500 shadow-[0_0_15px_rgba(105,108,255,0.08)]'
                                        : isPerfectMatch
                                          ? 'bg-emerald-50/50 border-emerald-400 dark:bg-emerald-900/20 dark:border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)] hover:bg-emerald-50 dark:hover:bg-emerald-900/30'
                                          : isPotentialPartial
                                            ? 'bg-orange-50/10 border-orange-300 dark:bg-orange-950/5 dark:border-orange-500/30 shadow-[0_0_15px_rgba(249,115,22,0.04)] hover:bg-orange-50/20 dark:hover:bg-orange-900/10'
                                            : 'bg-white dark:bg-[#2b2c40] border-slate-200/60 dark:border-slate-700/60 hover:border-[#696cff] hover:bg-slate-50/40 dark:hover:bg-slate-800/30'
                                    }`}
                                  >
                                    {isPerfectMatch && !isSelected && (
                                      <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500"></div>
                                    )}
                                    {isPotentialPartial && !isSelected && (
                                      <div className="absolute top-0 left-0 w-1 h-full bg-orange-400"></div>
                                    )}
                                    {isSelected && (
                                      <div className="absolute top-0 left-0 w-1 h-full bg-[#696cff]"></div>
                                    )}

                                    <div className="flex items-center justify-between gap-4">
                                      <div className="flex items-center gap-3 min-w-0">
                                        {/* Checkbox selector */}
                                        <div
                                          className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 transition-all ${
                                            isSelected
                                              ? 'bg-[#696cff] border-[#696cff] text-white'
                                              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800'
                                          }`}
                                        >
                                          {isSelected && (
                                            <Check className="w-3.5 h-3.5 stroke-[3px]" />
                                          )}
                                        </div>

                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-bold text-slate-800 dark:text-slate-200 text-[13px]">
                                              {docItem.refId}
                                            </span>
                                            <span
                                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                                docItem.type === 'Vente'
                                                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400'
                                                  : 'bg-rose-50 text-rose-500 border border-rose-100 dark:bg-rose-950/20 dark:text-rose-400'
                                              }`}
                                            >
                                              {docItem.type}
                                            </span>
                                            {isPerfectMatch && (
                                              <span className="bg-emerald-500 text-white flex items-center gap-1 text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide shadow-sm">
                                                <Pin className="w-2.5 h-2.5" />
                                                MATCH IDÉAL
                                              </span>
                                            )}
                                            {docItem.amountPaid > 0 && (
                                              <span className="text-orange-400 text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wide">
                                                PAIEMENT PARTIEL
                                              </span>
                                            )}
                                            {isPotentialPartial && (
                                              <span className="text-orange-400 text-[9px] font-black uppercase tracking-wide flex items-center gap-1 border border-orange-100 dark:border-orange-900/30 px-1.5 py-0.5 rounded">
                                                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></span>
                                                POSSIBLE PARTIEL
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 flex flex-wrap items-center gap-x-2">
                                            <span className="font-semibold">
                                              {docItem.clientOrSupplierName}
                                            </span>
                                            <span className="text-slate-300 dark:text-slate-600">
                                              |
                                            </span>
                                            <span className="font-mono">
                                              Date :{' '}
                                              {docItem.date
                                                ? new Date(docItem.date).toLocaleDateString('fr-FR')
                                                : 'N/A'}
                                            </span>
                                          </div>
                                        </div>
                                      </div>

                                      <div className="text-right shrink-0">
                                        <div className="font-bold font-mono text-[13px] text-slate-800 dark:text-slate-200">
                                          {docItem.totalAmount.toLocaleString('fr-FR')} DH
                                        </div>
                                        {docItem.amountPaid > 0 ? (
                                          <div className="text-[10px] font-semibold text-orange-400 mt-0.5">
                                            Reste à payer :{' '}
                                            {Math.abs(docItem.amount).toLocaleString('fr-FR')} DH
                                          </div>
                                        ) : (
                                          !isPerfectMatch && (
                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                              Écart : {amountDiff.toLocaleString('fr-FR')} DH
                                            </div>
                                          )
                                        )}
                                        {isPotentialPartial && (
                                          <div className="text-[10px] font-semibold text-orange-400 mt-0.5">
                                            Reste après lettrage :{' '}
                                            {(docAmtRemaining - txAmtAbs).toLocaleString('fr-FR')}{' '}
                                            DH
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>

                  {/* Real-time multi-reconciliation summary panel */}
                  {selectedDocsForReconcile.length > 0 && (
                    <div className="bg-slate-50 dark:bg-slate-800/80 p-4 border-t border-slate-200/60 dark:border-slate-700/60 space-y-3 text-left">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
                            Résumé du lettrage multi-pièces
                          </span>
                          <p className="text-[12px] text-slate-600 dark:text-slate-300">
                            Vous avez sélectionné{' '}
                            <span className="font-bold text-[#696cff]">
                              {selectedDocsForReconcile.length} pièce(s)
                            </span>
                            .
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                              Total réparti
                            </span>
                            <span className="text-[14px] font-bold font-mono text-slate-700 dark:text-slate-200">
                              {reconciliationSummary.totalAllocated.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                              })}{' '}
                              /{' '}
                              {Math.abs(selectedTransaction.amount).toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                              })}{' '}
                              DH
                            </span>
                          </div>
                          <div className="text-right">
                            <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                              Reste à répartir
                            </span>
                            <span
                              className={`text-[14px] font-bold font-mono ${reconciliationSummary.remainingToAllocate > 0.05 ? 'text-amber-500' : 'text-emerald-500'}`}
                            >
                              {reconciliationSummary.remainingToAllocate.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                              })}{' '}
                              DH
                            </span>
                          </div>
                        </div>
                      </div>

                      {reconciliationSummary.remainingToAllocate > 0.05 && (
                        <div className="flex justify-between items-center bg-amber-50/70 border border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/30 p-2.5 rounded-lg">
                          <span className="text-[11px] text-amber-700 dark:text-amber-300 flex items-center gap-1.5 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Il reste {reconciliationSummary.remainingToAllocate.toFixed(2)} DH non
                            alloués.
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              // Spread the remainder to the first document that has remaining unpaid balance
                              const totalTx = Math.abs(selectedTransaction.amount);
                              let allocatedSoFar = 0;
                              selectedDocsForReconcile.forEach((d) => {
                                if (d.id !== selectedDocsForReconcile[0].id) {
                                  allocatedSoFar += parseFloat(allocatedAmounts[d.id]) || 0;
                                }
                              });
                              const firstDoc = selectedDocsForReconcile[0];
                              const maxPossible = Math.min(
                                totalTx - allocatedSoFar,
                                Math.abs(firstDoc.amount)
                              );
                              setAllocatedAmounts((prev) => ({
                                ...prev,
                                [firstDoc.id]: maxPossible.toFixed(2),
                              }));
                            }}
                            className="text-[11px] font-bold text-[#696cff] hover:underline"
                          >
                            Ajuster sur la 1ère pièce
                          </button>
                        </div>
                      )}

                      <div className="flex gap-2.5 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedDocsForReconcile([]);
                            setAllocatedAmounts({});
                          }}
                          className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-[13px] font-semibold transition-colors"
                        >
                          Réinitialiser la sélection
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            // Convert string amounts to numbers
                            const numericAmounts: Record<string, number> = {};
                            selectedDocsForReconcile.forEach((d) => {
                              numericAmounts[d.id] = parseFloat(allocatedAmounts[d.id]) || 0;
                            });
                            handleLinkDocuments(selectedDocsForReconcile, numericAmounts);
                          }}
                          disabled={
                            reconciliationSummary.totalAllocated <= 0 ||
                            reconciliationSummary.totalAllocated >
                              Math.abs(selectedTransaction.amount) + 0.05
                          }
                          className="flex-1 py-2 bg-[#696cff] text-white hover:bg-[#5f61e6] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-[13px] font-semibold text-center transition-all flex items-center justify-center gap-1.5"
                        >
                          <Check className="w-4 h-4" />
                          Confirmer le lettrage de ces {selectedDocsForReconcile.length} pièce(s)
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex-1 overflow-y-auto p-5">
                  <div className="space-y-4 max-w-sm mx-auto mt-4">
                    <div className="text-center mb-6">
                      <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 className="w-6 h-6" />
                      </div>
                      <h4 className="text-slate-800 dark:text-slate-200 font-bold text-[15px]">
                        Enregistrer une charge directe
                      </h4>
                      <p className="text-[12px] text-slate-500 mt-1">
                        Créez une écriture pour lettrer automatiquement ce mouvement bancaire de{' '}
                        {Math.abs(selectedTransaction.amount).toLocaleString('fr-FR')} DH.
                      </p>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        Catégorie de la charge
                      </label>
                      <select
                        value={chargeCategory}
                        onChange={(e) => {
                          const cat = e.target.value;
                          setChargeCategory(cat);
                          if (cat === 'CNSS') {
                            setChargeTvaRate(0);
                          } else if (cat === 'Frais bancaires') {
                            setChargeTvaRate(10);
                          }
                        }}
                        className="w-full text-[13px] px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#696cff]"
                      >
                        <option value="Frais bancaires">Frais bancaires</option>
                        <option value="CNSS">CNSS / Charges sociales</option>
                        <option value="Impôts et taxes">Impôts et taxes</option>
                        <option value="Assurances">Assurances</option>
                        <option value="Autre charge">Autre charge</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                        Taux de TVA appliqué
                      </label>
                      <select
                        value={chargeTvaRate}
                        onChange={(e) => setChargeTvaRate(Number(e.target.value))}
                        className="w-full text-[13px] px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:border-[#696cff]"
                      >
                        <option value={0}>0% (Exonéré / Sans TVA)</option>
                        <option value={10}>10%</option>
                        <option value={14}>14%</option>
                        <option value={20}>20%</option>
                      </select>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-100 dark:border-slate-700/50 mt-4">
                      <div className="flex justify-between text-[12px] text-slate-500 mb-1">
                        <span>Montant TTC (issu du relevé)</span>
                        <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                          {Math.abs(selectedTransaction.amount).toLocaleString('fr-FR')} DH
                        </span>
                      </div>
                      <div className="flex justify-between text-[12px] text-slate-500 mb-1">
                        <span>Base HT calculée</span>
                        <span className="font-mono">
                          {(
                            Math.abs(selectedTransaction.amount) /
                            (1 + chargeTvaRate / 100)
                          ).toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                      </div>
                      <div className="flex justify-between text-[12px] text-emerald-600 dark:text-emerald-400 font-semibold mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                        <span>TVA récupérable ({chargeTvaRate}%)</span>
                        <span className="font-mono">
                          {(
                            Math.abs(selectedTransaction.amount) -
                            Math.abs(selectedTransaction.amount) / (1 + chargeTvaRate / 100)
                          ).toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={handleLettrerCharge}
                      className="w-full mt-4 flex items-center justify-center gap-2 px-4 py-2.5 bg-[#696cff] text-white rounded-lg text-[13px] font-semibold shadow-[0_2px_12px_rgba(105,108,255,0.3)] hover:bg-[#5f61e6] hover:shadow-[0_4px_16px_rgba(105,108,255,0.4)] transition-all"
                    >
                      Enregistrer et lettrer
                    </button>
                  </div>
                </div>
              )}

              {/* Close footer */}
              <div className="p-5 border-t border-slate-100 dark:border-slate-700/50 flex justify-end">
                <button
                  type="button"
                  onClick={() => setIsReconcileModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 dark:text-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-[13px] font-medium"
                >
                  Fermer
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

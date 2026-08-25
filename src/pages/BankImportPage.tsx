import React, { useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Trash2,
  Search,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  FileText,
  Play,
  FileSpreadsheet,
  HelpCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  getDocs,
  query,
  where,
  addDoc,
  serverTimestamp,
  writeBatch,
  doc,
  collectionGroup,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import * as XLSX from 'xlsx';

interface ParsedTransaction {
  id: string;
  selected: boolean;
  date: string;
  description: string;
  amount: number;
  debit: number;
  credit: number;
  journal: 'UMNIA BANK' | 'Espèces';
  status: 'new' | 'duplicate' | 'error';
  partnerName?: string;
  partnerRef?: string;
  isReconciled?: boolean;
  matchedDocument?: string;
}

export default function BankImportPage() {
  const [activeTab, setActiveTab] = useState<'excel' | 'text'>('excel');
  const [rawText, setRawText] = useState('');
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { user } = useAuth();
  const { showToast } = useNotification();
  const navigate = useNavigate();

  const handleAnalyze = async () => {
    if (!rawText.trim()) {
      showToast('Veuillez coller le texte du relevé bancaire.', 'error');
      return;
    }

    setIsAnalyzing(true);
    try {
      const lines = rawText
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l);
      let currentDate = new Date().toISOString().split('T')[0];
      const parsedTx: ParsedTransaction[] = [];
      let pendingDescription = '';

      for (const line of lines) {
        // Match Date
        const dateMatch = line.match(/Date.*?(\d{2})\/(\d{2})\/(\d{4})/i);
        if (dateMatch) {
          if (!/valeur/i.test(line)) {
            currentDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
          }
          continue;
        }

        // Match Amount
        const isAmount = /^[+-]\s*[\d\s]+([.,]\d{1,2})?\s*(MAD|mad|Mad)?$/i.test(line);
        if (isAmount) {
          const cleanStr = line.replace(/[^\d.,\+-]/g, '').replace(',', '.');
          const amount = parseFloat(cleanStr);

          if (!isNaN(amount)) {
            parsedTx.push({
              id: Math.random().toString(36).substring(2, 9),
              selected: true,
              date: currentDate,
              description: pendingDescription.trim() || 'Opération sans description',
              amount: amount,
              debit: amount < 0 ? Math.abs(amount) : 0,
              credit: amount > 0 ? amount : 0,
              journal: 'UMNIA BANK',
              status: 'new',
            });
          }
          pendingDescription = ''; // Reset
        } else {
          pendingDescription = pendingDescription ? pendingDescription + ' ' + line : line;
        }
      }

      await checkDuplicatesAndSet(parsedTx);
    } catch (error) {
      console.error('Analyse error:', error);
      showToast("Erreur lors de l'analyse du relevé.", 'error');
      setIsAnalyzing(false);
    }
  };

  const checkDuplicatesAndSet = async (parsedTx: ParsedTransaction[]) => {
    if (!user) {
      setTransactions(parsedTx);
      setIsAnalyzing(false);
      return;
    }

    try {
      if (parsedTx.length > 0) {
        const bankRef = collection(db, 'bank_reconciliations');
        const q = query(bankRef, where('ownerId', '==', user.uid));
        const snapshot = await getDocs(q);
        const existingTx = snapshot.docs.map((d) => d.data());

        for (const tx of parsedTx) {
          const isDuplicate = existingTx.some(
            (e) =>
              e.date === tx.date &&
              e.label === tx.description &&
              Math.abs(e.amount - tx.amount) < 0.01
          );

          if (isDuplicate) {
            tx.status = 'duplicate';
            tx.selected = false; // Deselect duplicates by default
          }
        }
      }

      setTransactions(parsedTx);
      if (parsedTx.length === 0) {
        showToast("Aucune transaction n'a été trouvée.", 'error');
      } else {
        showToast(`${parsedTx.length} opérations analysées avec succès.`, 'success');
      }
    } catch (error) {
      console.error('Duplicate check error:', error);
      showToast('Erreur lors de la vérification des doublons.', 'error');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExcelImport = (file: File) => {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(extension || '')) {
      showToast('Veuillez sélectionner un fichier Excel (.xlsx, .xls) ou CSV.', 'error');
      return;
    }

    setIsAnalyzing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        let workbook: XLSX.WorkBook;
        if (extension === 'csv') {
          workbook = XLSX.read(data, { type: 'binary', codepage: 65001 });
        } else {
          workbook = XLSX.read(data, { type: 'binary' });
        }

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to array of arrays
        const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
        if (rawRows.length < 2) {
          showToast('Le fichier est vide ou manque de données.', 'error');
          setIsAnalyzing(false);
          return;
        }

        // Find header row containing important keywords
        let headerRowIndex = 0;
        for (let r = 0; r < Math.min(15, rawRows.length); r++) {
          const row = rawRows[r];
          if (
            row &&
            row.some((cell) => {
              const str = String(cell || '').toLowerCase();
              return (
                str.includes('date') ||
                str.includes('montant') ||
                str.includes('libellé') ||
                str.includes('id') ||
                str.includes('partenaire')
              );
            })
          ) {
            headerRowIndex = r;
            break;
          }
        }

        const headers = (rawRows[headerRowIndex] || []).map((h) => String(h || '').trim());

        const findIndex = (syns: string[]) => {
          return headers.findIndex((h) => {
            const hLower = h.toLowerCase().trim();
            return syns.some(
              (s) => hLower === s.toLowerCase().trim() || hLower.includes(s.toLowerCase().trim())
            );
          });
        };

        const dateIdx = findIndex(['date']);
        const labelIdx = findIndex([
          'libellé',
          'libelle',
          'communication',
          'label',
          'description',
          "nom de l'écriture",
        ]);
        const amountIdx = findIndex(['montant', 'montant (dh)', 'montant net', 'amount']);
        const partnerIdx = findIndex(['partenaire', 'tiers', 'client', 'fournisseur', 'partner']);
        const refIdx = findIndex([
          'pièce comptable',
          'piece comptable',
          'référence',
          'reference',
          'ref',
        ]);
        const reconciledIdx = findIndex([
          'est lettré',
          'est lettre',
          'lettré',
          'rapproché',
          'reconciled',
        ]);
        const matchIdx = findIndex([
          'écritures comptables',
          'ecritures comptables',
          'pièce lettrée',
          'matching',
          'journal items',
        ]);
        const journalIdx = findIndex(['journal']);
        const idIdx = findIndex(['id', 'ligne de relevé']);

        const parsedTx: ParsedTransaction[] = [];
        let lastTx: ParsedTransaction | null = null;

        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          if (!row || row.length === 0) continue;

          const cellVal = (idx: number) => (idx >= 0 && idx < row.length ? row[idx] : undefined);

          const idVal = cellVal(idIdx);
          const dateVal = cellVal(dateIdx);
          const amountRaw = cellVal(amountIdx);
          const labelVal = cellVal(labelIdx);
          const partnerVal = cellVal(partnerIdx);
          const refVal = cellVal(refIdx);
          const reconciledVal = cellVal(reconciledIdx);
          const matchVal = cellVal(matchIdx);
          const journalVal = cellVal(journalIdx);

          const hasDate = dateVal !== undefined && dateVal !== '';
          const hasAmount = amountRaw !== undefined && amountRaw !== '';
          const hasId = idVal !== undefined && idVal !== '';

          if (hasDate || hasAmount || hasId) {
            // Date Parsing
            let dateStr = '';
            if (dateVal) {
              if (typeof dateVal === 'number') {
                try {
                  const dateObj = XLSX.SSF.parse_date_code(dateVal);
                  dateStr = `${dateObj.y}-${String(dateObj.m).padStart(2, '0')}-${String(dateObj.d).padStart(2, '0')}`;
                } catch (err) {
                  dateStr = new Date().toISOString().split('T')[0];
                }
              } else {
                const str = String(dateVal).trim();
                const dMatch = str.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
                if (dMatch) {
                  dateStr = `${dMatch[3]}-${dMatch[2]}-${dMatch[1]}`;
                } else {
                  const ymdMatch = str.match(/(\d{4})[/-](\d{2})[/-](\d{2})/);
                  if (ymdMatch) {
                    dateStr = `${ymdMatch[1]}-${ymdMatch[2]}-${ymdMatch[3]}`;
                  } else {
                    dateStr = str;
                  }
                }
              }
            }
            if (!dateStr) {
              dateStr = new Date().toISOString().split('T')[0];
            }

            // Amount Parsing
            let amount = 0;
            if (amountRaw !== undefined) {
              if (typeof amountRaw === 'number') {
                amount = amountRaw;
              } else {
                const cleanStr = String(amountRaw).replace(/\s/g, '').replace(',', '.');
                amount = parseFloat(cleanStr) || 0;
              }
            }

            // Reconciled Check
            let isReconciled = false;
            if (reconciledVal !== undefined) {
              const recStr = String(reconciledVal).toUpperCase().trim();
              isReconciled =
                recStr === 'VRAI' ||
                recStr === 'TRUE' ||
                recStr === 'OUI' ||
                recStr === '1' ||
                reconciledVal === true;
            }

            // Match Document extraction from initial line
            const matchText = matchVal ? String(matchVal).trim() : '';
            let matchedDoc = '';
            if (matchText) {
              const invMatch = matchText.match(
                /(INV\/\d{4}\/\d+|FAC\/\d{4}\/\d+|BL\/SUP\/\d{4}\/\d+|BL\/\d{4}\/\d+)/i
              );
              if (invMatch) {
                matchedDoc = invMatch[1].toUpperCase();
              }
            }

            // Journal detect
            let journal: 'UMNIA BANK' | 'Espèces' = 'UMNIA BANK';
            if (journalVal) {
              const jStr = String(journalVal).toUpperCase();
              if (
                jStr.includes('ESPÈCES') ||
                jStr.includes('ESPECES') ||
                jStr.includes('CAISSE') ||
                jStr.includes('CASH')
              ) {
                journal = 'Espèces';
              }
            }

            const tx: ParsedTransaction = {
              id: String(idVal || Math.random().toString(36).substring(2, 9)),
              selected: true,
              date: dateStr,
              description: labelVal ? String(labelVal).trim() : 'Opération sans description',
              amount: amount,
              debit: amount < 0 ? Math.abs(amount) : 0,
              credit: amount > 0 ? amount : 0,
              journal: journal,
              status: 'new',
              partnerName: partnerVal ? String(partnerVal).trim() : 'Divers',
              partnerRef: refVal ? String(refVal).trim() : 'N/A',
              isReconciled: isReconciled,
              matchedDocument: matchedDoc,
            };

            parsedTx.push(tx);
            lastTx = tx;
          } else if (lastTx && matchVal) {
            // Append details from sub-row
            const matchText = String(matchVal).trim();
            if (matchText) {
              lastTx.description += ` | ${matchText}`;
              if (!lastTx.matchedDocument) {
                const invMatch = matchText.match(
                  /(INV\/\d{4}\/\d+|FAC\/\d{4}\/\d+|BL\/SUP\/\d{4}\/\d+|BL\/\d{4}\/\d+)/i
                );
                if (invMatch) {
                  lastTx.matchedDocument = invMatch[1].toUpperCase();
                  lastTx.isReconciled = true;
                }
              }
            }
          }
        }

        checkDuplicatesAndSet(parsedTx);
      } catch (err) {
        console.error('Error reading file:', err);
        showToast('Erreur lors de la lecture du fichier.', 'error');
        setIsAnalyzing(false);
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleClear = () => {
    setRawText('');
    setTransactions([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const toggleSelection = (id: string) => {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t)));
  };

  const toggleAll = () => {
    const allSelected = transactions.every((t) => t.selected);
    setTransactions((prev) =>
      prev.map((t) => (t.status === 'duplicate' ? t : { ...t, selected: !allSelected }))
    );
  };

  const handleChangeJournal = (id: string, journal: 'UMNIA BANK' | 'Espèces') => {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, journal } : t)));
  };

  const handleImport = async () => {
    const toImport = transactions.filter((t) => t.selected && t.status !== 'duplicate');
    if (toImport.length === 0) {
      showToast("Aucune opération valide sélectionnée pour l'import.", 'error');
      return;
    }

    if (!user) return;

    setIsImporting(true);
    try {
      // Fetch all purchases and partners to link Odoo matches
      const [clientsSnap, suppliersSnap, purchasesSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'clients'), where('ownerId', '==', user.uid))),
        getDocs(query(collection(db, 'suppliers'), where('ownerId', '==', user.uid))),
        getDocs(query(collectionGroup(db, 'purchases'), where('ownerId', '==', user.uid))),
      ]);

      const excludedPartnerIds = new Set<string>();
      clientsSnap.forEach((d) => {
        if (d.data().excludeFromAccounting) excludedPartnerIds.add(d.id);
      });
      suppliersSnap.forEach((d) => {
        if (d.data().excludeFromAccounting) excludedPartnerIds.add(d.id);
      });

      const allPurchases = purchasesSnapshot.docs
        .filter((dDoc) => {
          const data = dDoc.data();
          if (data.excludeFromAccounting) return false;
          const parts = dDoc.ref.path.split('/');
          const parentId = parts[1];
          if (excludedPartnerIds.has(parentId)) return false;
          if (data.supplierId && excludedPartnerIds.has(data.supplierId)) return false;
          if (data.clientId && excludedPartnerIds.has(data.clientId)) return false;
          return true;
        })
        .map((dDoc) => {
          const parts = dDoc.ref.path.split('/');
          return {
            id: dDoc.id,
            refId: dDoc.data().refId,
            amountPaid: Number(dDoc.data().amountPaid) || 0,
            total: Number(
              dDoc.data().total ||
                dDoc.data().totalAmount ||
                dDoc.data().subtotal ||
                dDoc.data().amount ||
                0
            ),
            parentType: parts[0], // 'clients' or 'suppliers'
            parentId: parts[1], // client/supplier ID
            ref: dDoc.ref,
          };
        });

      const batch = writeBatch(db);

      for (const tx of toImport) {
        const docRef = doc(collection(db, 'bank_reconciliations'));

        let isReconciled = !!tx.isReconciled;
        let matchedDocument = tx.matchedDocument || '';
        let matchedDocId = '';
        let matchedDocParentType = '';
        let matchedDocParentId = '';
        let matchedDocTotalAmount = 0;

        // Sync with local invoices if Odoo says it is reconciled
        if (isReconciled && matchedDocument) {
          const matchPurchase = allPurchases.find(
            (p) => p.refId && p.refId.toLowerCase().trim() === matchedDocument.toLowerCase().trim()
          );
          if (matchPurchase) {
            matchedDocId = matchPurchase.id;
            matchedDocParentType = matchPurchase.parentType;
            matchedDocParentId = matchPurchase.parentId;
            matchedDocTotalAmount = matchPurchase.total;

            const txAmount = Math.abs(tx.amount);
            const newAmountPaid = matchPurchase.amountPaid + txAmount;
            const newPaymentStatus =
              newAmountPaid >= matchPurchase.total - 0.01 ? 'paid' : 'credit';

            // Update matching invoice
            batch.update(matchPurchase.ref, {
              amountPaid: newAmountPaid,
              paymentStatus: newPaymentStatus,
              ...(newPaymentStatus === 'paid' ? { paymentDate: new Date() } : {}),
            });

            // Add payment record in subcollection
            const paymentsRef = doc(
              collection(db, matchPurchase.parentType, matchPurchase.parentId, 'payments')
            );
            batch.set(paymentsRef, {
              ownerId: user.uid,
              amount: txAmount,
              date: new Date(tx.date),
              purchaseId: matchPurchase.id,
              notes: `Règlement lettré Odoo via ${tx.journal}`,
              reconciliationId: docRef.id,
            });

            // Sync in memory for multiple rows matching the same invoice
            matchPurchase.amountPaid = newAmountPaid;
          }
        }

        batch.set(docRef, {
          ownerId: user.uid,
          date: tx.date,
          label: tx.description,
          partnerName: tx.partnerName || 'Divers',
          partnerRef: tx.partnerRef || 'N/A',
          amount: tx.amount,
          journal: tx.journal,
          hasAttachment: false,
          isReconciled: isReconciled,
          matchedDocument: matchedDocument,
          matchedDocId: matchedDocId,
          matchedDocParentType: matchedDocParentType,
          matchedDocParentId: matchedDocParentId,
          matchedDocTotalAmount: matchedDocTotalAmount,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();
      showToast('Import et lettrage terminés avec succès !', 'success');
      navigate('/rapprochement');
    } catch (error) {
      console.error('Import error:', error);
      showToast("Erreur lors de l'importation.", 'error');
    } finally {
      setIsImporting(false);
    }
  };

  // Stats
  const totalDetected = transactions.length;
  const duplicatesCount = transactions.filter((t) => t.status === 'duplicate').length;
  const validCount = transactions.filter((t) => t.selected && t.status !== 'duplicate').length;
  const totalCredit = transactions
    .filter((t) => t.selected && t.status !== 'duplicate')
    .reduce((acc, t) => acc + t.credit, 0);
  const totalDebit = transactions
    .filter((t) => t.selected && t.status !== 'duplicate')
    .reduce((acc, t) => acc + t.debit, 0);

  return (
    <div className="w-full py-6 md:py-10 space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/rapprochement')}
            className="p-2 bg-white dark:bg-[#2b2c40] text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg border border-slate-200/60 dark:border-slate-700/60 transition-colors shadow-2xs"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-white font-sans flex items-center gap-3">
              <FileText className="w-6 h-6 text-[#696cff]" />
              Importer un relevé bancaire
            </h1>
            <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">
              Collez le texte de votre relevé bancaire brut, analysez-le et importez les opérations
              dans votre rapprochement.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Input options */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-slate-700/60 p-5 shadow-2xs flex flex-col h-[520px]">
            {/* Tabs */}
            <div className="flex border-b border-slate-100 dark:border-slate-800 mb-4 p-1 bg-slate-50 dark:bg-[#1e1e2d] rounded-lg gap-1">
              <button
                onClick={() => setActiveTab('excel')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-semibold transition-all ${activeTab === 'excel' ? 'bg-white dark:bg-[#2b2c40] text-[#696cff] shadow-2xs border border-slate-200/40 dark:border-slate-700/40' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Importer Excel / CSV
              </button>
              <button
                onClick={() => setActiveTab('text')}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-md text-xs font-semibold transition-all ${activeTab === 'text' ? 'bg-white dark:bg-[#2b2c40] text-[#696cff] shadow-2xs border border-slate-200/40 dark:border-slate-700/40' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
              >
                <FileText className="w-3.5 h-3.5" />
                Saisie texte brut
              </button>
            </div>

            {activeTab === 'excel' ? (
              <div className="flex-1 flex flex-col justify-between">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleExcelImport(file);
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex-1 border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${isDragging ? 'border-[#696cff] bg-[#696cff]/5 dark:bg-[#696cff]/5' : 'border-slate-200 dark:border-slate-700/60 hover:border-[#696cff] dark:hover:border-[#696cff] hover:bg-slate-50/50 dark:hover:bg-[#232333]/30'}`}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleExcelImport(file);
                    }}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                  />
                  <Upload className="w-10 h-10 text-[#696cff] mb-3 animate-pulse" />
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Glissez-déposez votre fichier
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                    Prend en charge Excel (.xlsx, .xls) et CSV d'Odoo ou standards
                  </span>
                </div>

                <div className="bg-slate-50 dark:bg-[#1e1e2d] border border-slate-100 dark:border-slate-800 rounded-lg p-3 mt-4">
                  <span className="text-[11px] font-bold text-[#696cff] flex items-center gap-1.5 uppercase tracking-wider mb-1.5">
                    <HelpCircle className="w-3.5 h-3.5" /> Thème Odoo Match (Option A)
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Identifie automatiquement les colonnes d'Odoo (<strong>Date</strong>,{' '}
                    <strong>Partenaire</strong>, <strong>Montant</strong>,{' '}
                    <strong>Est Lettré</strong> et <strong>Écritures Comptables</strong>) pour
                    relier directement vos lettrages.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col h-full">
                <textarea
                  className="flex-1 w-full bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-3 text-sm font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:border-[#696cff] dark:focus:border-[#696cff] resize-none h-[280px]"
                  placeholder={`Exemple :\nDate opération : 26/06/2026\nVIR RECU SIMT EN PROV DE - AIMPOWER\n\n+ 41 000,00 MAD`}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                />

                <div className="flex items-center gap-3 mt-4">
                  <button
                    onClick={handleAnalyze}
                    disabled={isAnalyzing || !rawText.trim()}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-[#696cff] text-white rounded-lg text-sm font-semibold shadow-[0_2px_12px_rgba(105,108,255,0.3)] hover:bg-[#5f61e6] hover:shadow-[0_4px_16px_rgba(105,108,255,0.4)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAnalyzing ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Play className="w-4 h-4" />
                    )}
                    Analyser
                  </button>
                </div>
              </div>
            )}

            {transactions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  onClick={handleClear}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-rose-50 dark:bg-rose-950/20 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-950/40 rounded-lg text-xs font-semibold border border-rose-200/40 dark:border-rose-800/40 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Réinitialiser / Vider la sélection
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Preview */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-slate-700/60 p-5 shadow-2xs h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Prévisualisation des opérations
              </h2>
              {transactions.length > 0 && (
                <button
                  onClick={handleImport}
                  disabled={isImporting || validCount === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-semibold shadow-[0_2px_12px_rgba(16,185,129,0.3)] hover:bg-emerald-600 hover:shadow-[0_4px_16px_rgba(16,185,129,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isImporting ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  Importer ({validCount})
                </button>
              )}
            </div>

            {/* Stats Summary */}
            {transactions.length > 0 && (
              <div className="grid grid-cols-5 gap-3 mb-4">
                <div className="bg-slate-50 dark:bg-[#232333] p-3 rounded-lg border border-slate-100 dark:border-slate-700/50">
                  <div className="text-[10px] uppercase font-bold text-slate-400">Total</div>
                  <div className="text-lg font-bold text-slate-700 dark:text-slate-200">
                    {totalDetected}
                  </div>
                </div>
                <div className="bg-orange-50/50 dark:bg-orange-900/10 p-3 rounded-lg border border-orange-100 dark:border-orange-900/30">
                  <div className="text-[10px] uppercase font-bold text-orange-400">Doublons</div>
                  <div className="text-lg font-bold text-orange-500">{duplicatesCount}</div>
                </div>
                <div className="bg-[#696cff]/5 dark:bg-[#696cff]/10 p-3 rounded-lg border border-[#696cff]/20">
                  <div className="text-[10px] uppercase font-bold text-[#696cff]">Valides</div>
                  <div className="text-lg font-bold text-[#696cff]">{validCount}</div>
                </div>
                <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-3 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                  <div className="text-[10px] uppercase font-bold text-emerald-500">Crédit</div>
                  <div className="text-sm font-bold text-emerald-600 font-mono mt-1">
                    +{totalCredit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                  </div>
                </div>
                <div className="bg-rose-50/50 dark:bg-rose-900/10 p-3 rounded-lg border border-rose-100 dark:border-rose-900/30">
                  <div className="text-[10px] uppercase font-bold text-rose-400">Débit</div>
                  <div className="text-sm font-bold text-rose-500 font-mono mt-1">
                    -{totalDebit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-auto border border-slate-200/60 dark:border-slate-700/60 rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="text-[11px] uppercase text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-[#232333] sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={transactions.length > 0 && transactions.every((t) => t.selected)}
                        onChange={toggleAll}
                        className="rounded border-slate-300 text-[#696cff] focus:ring-[#696cff]"
                      />
                    </th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Débit</th>
                    <th className="px-4 py-3 text-right">Crédit</th>
                    <th className="px-4 py-3">Journal</th>
                    <th className="px-4 py-3">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                  {transactions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                      >
                        <div className="flex flex-col items-center justify-center">
                          <Search className="w-8 h-8 text-slate-300 mb-2" />
                          <p>Aucune donnée à afficher. Collez un relevé et analysez-le.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    transactions.map((tx, idx) => (
                      <tr
                        key={tx.id + "_" + String(idx)}
                        className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${tx.status === 'duplicate' ? 'opacity-60 bg-slate-50/50 dark:bg-[#232333]/50' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={tx.selected}
                            disabled={tx.status === 'duplicate'}
                            onChange={() => toggleSelection(tx.id)}
                            className="rounded border-slate-300 text-[#696cff] focus:ring-[#696cff] disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-700 dark:text-slate-300">
                          {tx.date}
                        </td>
                        <td
                          className="px-4 py-3 text-slate-600 dark:text-slate-400 max-w-[200px] truncate"
                          title={tx.description}
                        >
                          {tx.description}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-rose-500">
                          {tx.debit > 0
                            ? tx.debit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })
                            : '-'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-emerald-500">
                          {tx.credit > 0
                            ? tx.credit.toLocaleString('fr-FR', { minimumFractionDigits: 2 })
                            : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={tx.journal}
                            onChange={(e) => handleChangeJournal(tx.id, e.target.value as any)}
                            disabled={tx.status === 'duplicate'}
                            className="bg-transparent border-0 text-slate-700 dark:text-slate-300 text-sm focus:ring-0 cursor-pointer disabled:cursor-not-allowed"
                          >
                            <option value="UMNIA BANK">UMNIA BANK</option>
                            <option value="Espèces">Espèces</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">
                          {tx.status === 'new' && (
                            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#696cff] bg-[#696cff]/10 px-2 py-1 rounded-full w-fit">
                              <CheckCircle className="w-3 h-3" />
                              Nouveau
                            </span>
                          )}
                          {tx.status === 'duplicate' && (
                            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-orange-500 bg-orange-500/10 px-2 py-1 rounded-full w-fit">
                              <AlertCircle className="w-3 h-3" />
                              Déjà importé
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

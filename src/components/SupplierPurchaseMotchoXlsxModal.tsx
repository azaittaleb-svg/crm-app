import React, { useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  Check,
  AlertCircle,
  Loader2,
  Coffee,
  HelpCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import { useNotification } from '../context/NotificationContext';
import {
  collection,
  doc,
  writeBatch,
  collectionGroup,
  query,
  where,
  getDocs,
} from 'firebase/firestore';

interface SupplierPurchaseMotchoXlsxModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingSuppliers: any[];
  ownerId: string;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === ',' || char === ';') && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseExcelDate(val: any): Date {
  if (val instanceof Date) return val;
  if (val === undefined || val === null) return new Date();

  const numVal = Number(val);
  if (!isNaN(numVal) && typeof val !== 'boolean' && String(val).trim() !== '') {
    if (numVal > 30000 && numVal < 60000) {
      return new Date(Math.round((numVal - 25569) * 86400 * 1000));
    }
  }

  const str = String(val).trim();
  if (!str) return new Date();

  const ymd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    return new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10));
  }

  const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) {
    return new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
  }

  const parsed = Date.parse(str);
  if (!isNaN(parsed)) return new Date(parsed);

  return new Date();
}

function parseExcelNumber(val: any): number {
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
}

export const SupplierPurchaseMotchoXlsxModal: React.FC<SupplierPurchaseMotchoXlsxModalProps> = ({
  isOpen,
  onClose,
  existingSuppliers,
  ownerId,
  showToast,
}) => {
  const { confirm } = useNotification();
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [createMissingSuppliers, setCreateMissingSuppliers] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stats
  const [parsedPurchases, setParsedPurchases] = useState<any[]>([]);
  const [totalLinesParsed, setTotalLinesParsed] = useState(0);
  const [suppliersToCreate, setSuppliersToCreate] = useState<string[]>([]);
  const [existingSuppliersCount, setExistingSuppliersCount] = useState(0);
  const [totalImportAmount, setTotalImportAmount] = useState(0);
  const [isDeletingImports, setIsDeletingImports] = useState(false);

  const handleDeletePreviousOdooImports = async () => {
    confirm({
      title: 'Supprimer les imports',
      message: "Êtes-vous sûr de vouloir supprimer TOUS les achats et règlements de fournisseurs précédemment importés d'Odoo ? Cette opération est irréversible.",
      onConfirm: async () => {
        setIsDeletingImports(true);
        try {
          const BATCH_SIZE = 400;
      let batch = writeBatch(db);
      let operationCount = 0;
      let deletedPurchasesCount = 0;
      let deletedPaymentsCount = 0;

      // 1. Fetch and delete purchases from subcollections
      const purchasesQuery = query(
        collectionGroup(db, 'purchases'),
        where('ownerId', '==', ownerId),
        where('importedFromOdoo', '==', true)
      );
      const purchasesSnap = await getDocs(purchasesQuery);

      // Pre-fetch all reconciled bank reconciliations to detach in memory (highly efficient)
      const reconciliationsQuery = query(
        collection(db, 'bank_reconciliations'),
        where('ownerId', '==', ownerId),
        where('isReconciled', '==', true)
      );
      const reconciliationsSnap = await getDocs(reconciliationsQuery);
      const reconciliationsByPurchaseId = new Map<string, any[]>();
      reconciliationsSnap.forEach((rDoc) => {
        const rData = rDoc.data();
        if (rData.matchedDocId) {
          const list = reconciliationsByPurchaseId.get(rData.matchedDocId) || [];
          list.push(rDoc);
          reconciliationsByPurchaseId.set(rData.matchedDocId, list);
        }
      });

      for (const d of purchasesSnap.docs) {
        // Double check path contains suppliers to avoid deleting client purchases
        if (d.ref.path.includes('suppliers/')) {
          batch.delete(d.ref);
          operationCount++;
          deletedPurchasesCount++;

          // Detach reconciliations linked to this purchase
          const linkedRecons = reconciliationsByPurchaseId.get(d.id);
          if (linkedRecons) {
            linkedRecons.forEach((rDoc) => {
              batch.update(rDoc.ref, {
                isReconciled: false,
                matchedDocument: '',
                matchedDocId: '',
                matchedDocParentType: '',
                matchedDocParentId: '',
                matchedDocTotalAmount: 0,
              });
              operationCount++;
            });
          }
        }

        if (operationCount >= BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db);
          operationCount = 0;
        }
      }

      // 2. Fetch and delete supplier payments
      const paymentsQuery = query(
        collectionGroup(db, 'payments'),
        where('ownerId', '==', ownerId),
        where('importedFromOdoo', '==', true)
      );
      const paymentsSnap = await getDocs(paymentsQuery);

      for (const d of paymentsSnap.docs) {
        if (d.ref.path.includes('suppliers/')) {
          batch.delete(d.ref);
          operationCount++;
          deletedPaymentsCount++;
        }

        if (operationCount >= BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db);
          operationCount = 0;
        }
      }

      if (operationCount > 0) {
        await batch.commit();
      }

      showToast(
        `Nettoyage réussi : ${deletedPurchasesCount} achat(s) et ${deletedPaymentsCount} règlement(s) de fournisseurs d'Odoo ont été supprimés.`,
        'success'
      );
    } catch (err) {
      console.error('Clean error:', err);
      showToast('Une erreur est survenue lors de la suppression.', 'error');
    } finally {
      setIsDeletingImports(false);
    }
  }
});
};

  const resetState = () => {
    setFile(null);
    setParsedPurchases([]);
    setTotalLinesParsed(0);
    setSuppliersToCreate([]);
    setExistingSuppliersCount(0);
    setTotalImportAmount(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (isImporting || isParsing) return;
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      processFile(selectedFile);
    }
  };


  const processFile = (selectedFile: File) => {
    const extension = selectedFile.name.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(extension || '')) {
      showToast('Veuillez sélectionner un fichier Excel (.xlsx, .xls) ou CSV.', 'error');
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);

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

        const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
        if (rawRows.length < 5) {
          showToast('Le fichier est trop petit pour être un fichier d\'achat Motcho.', 'error');
          resetState();
          setIsParsing(false);
          return;
        }

        setTotalLinesParsed(rawRows.length);

        // Motcho header info extraction
        let typeDoc = '';
        let ref = '';
        let dateEmission = '';
        let fournisseur = '';
        let statutPaiement = '';

        for (let i = 0; i < Math.min(10, rawRows.length); i++) {
          const row = rawRows[i];
          if (!row || !row[0]) continue;
          const label = String(row[0]).toLowerCase().trim();
          if (label === 'type de document') typeDoc = String(row[1] || '');
          if (label === 'référence' || label === 'reference') ref = String(row[1] || '');
          if (label === "date d'émission" || label === "date d'emission") dateEmission = String(row[1] || '');
          if (label.includes('fournisseur') || label.includes('partenaire')) fournisseur = String(row[1] || '');
          if (label === 'statut paiement') statutPaiement = String(row[1] || '');
        }

        // Find the lines header
        let headerRowIndex = -1;
        for (let i = 0; i < rawRows.length; i++) {
          const row = rawRows[i];
          if (row && row[0] && String(row[0]).toLowerCase().includes('lignes de facture')) {
            headerRowIndex = i + 1; // The actual column headers are usually the next line
            // Check if next line has the headers, if not, maybe it's on the same line or next next
            if (rawRows[i+1] && rawRows[i+1].some((c: any) => String(c).toLowerCase().includes('description'))) {
                headerRowIndex = i + 1;
            } else if (row.some((c: any) => String(c).toLowerCase().includes('description'))) {
                headerRowIndex = i;
            }
            break;
          }
        }
        
        if (headerRowIndex === -1) {
            // Fallback: just find the row with description
            for (let i = 0; i < rawRows.length; i++) {
                const row = rawRows[i];
                if (row && row.some((c: any) => String(c).toLowerCase().includes('description'))) {
                    headerRowIndex = i;
                    break;
                }
            }
        }

        if (headerRowIndex === -1) {
          showToast('Impossible de trouver la ligne des entêtes (Description/Libellé, Quantité, etc.)', 'error');
          resetState();
          setIsParsing(false);
          return;
        }

        const headers = (rawRows[headerRowIndex] || []).map((h: any) => String(h || '').trim());
        const findColumnIndex = (synonyms: string[]) => {
          const exactIdx = headers.findIndex((h: string) => {
            const hClean = h.toLowerCase().trim();
            return synonyms.some((syn) => hClean === syn.toLowerCase().trim());
          });
          if (exactIdx >= 0) return exactIdx;
          return headers.findIndex((h: string) => {
            const hClean = h.toLowerCase().trim();
            return synonyms.some((syn) => hClean.includes(syn.toLowerCase().trim()));
          });
        };

        const idxDesc = findColumnIndex(['description/libellé', 'description', 'libellé', 'libelle']);
        const idxQty = findColumnIndex(['quantité', 'quantite', 'qty']);
        const idxPu = findColumnIndex(['prix unitaire', 'prix', 'pu']);
        const idxTax = findColumnIndex(['taxe (%)', 'taxe', 'tva']);
        const idxDiw = findColumnIndex(['diw (dh)', 'diw']);
        const idxTransport = findColumnIndex(['transport (usd)', 'transport']);
        const idxPrixRev = findColumnIndex(['prix revient (dh)', 'prix revient', 'prix de revient']);
        const idxTotal = findColumnIndex(['total ht (dh)', 'total ht', 'total']);

        const items = [];
        let totalFactureHT = 0;

        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          if (!row || row.length === 0 || !row.some((c: any) => !!c)) continue;
          const desc = idxDesc >= 0 ? String(row[idxDesc] || '') : '';
          if (!desc) continue; // Skip empty rows

          const qty = idxQty >= 0 ? parseExcelNumber(row[idxQty]) : 1;
          const pu = idxPu >= 0 ? parseExcelNumber(row[idxPu]) : 0;
          const tax = idxTax >= 0 ? parseExcelNumber(row[idxTax]) : 0;
          const diw = idxDiw >= 0 ? parseExcelNumber(row[idxDiw]) : 0;
          const transport = idxTransport >= 0 ? parseExcelNumber(row[idxTransport]) : 0;
          const prixRevient = idxPrixRev >= 0 ? parseExcelNumber(row[idxPrixRev]) : 0;
          const totalHT = idxTotal >= 0 ? parseExcelNumber(row[idxTotal]) : (qty * pu);

          totalFactureHT += totalHT;

          items.push({
            id: `line-${i}`,
            description: desc,
            quantity: qty,
            price: pu,
            taxRate: tax,
            diw: diw,
            transport: transport,
            prixRevient: prixRevient,
            subtotal: totalHT
          });
        }
        
        let pDate = new Date();
        if (dateEmission) {
            pDate = parseExcelDate(dateEmission) || new Date();
        }

        const purchase = {
          supplierName: fournisseur || 'MOTCHO',
          refId: ref || `MOTCHO-${Date.now()}`,
          date: pDate,
          dueDate: pDate,
          items: items,
          subtotal: totalFactureHT,
          taxAmount: items.reduce((acc, it) => acc + (it.subtotal * (it.taxRate/100)), 0),
          total: items.reduce((acc, it) => acc + (it.subtotal * (1 + it.taxRate/100)), 0),
          paymentStatus: (statutPaiement.toLowerCase().includes('pay') || statutPaiement.toLowerCase().includes('régularisé')) ? 'paid' : 'debt',
          amountPaid: (statutPaiement.toLowerCase().includes('pay') || statutPaiement.toLowerCase().includes('régularisé')) ? items.reduce((acc, it) => acc + (it.subtotal * (1 + it.taxRate/100)), 0) : 0,
        };

        setParsedPurchases([purchase]);
        setIsParsing(false);
      } catch (error) {
        console.error('Error parsing file:', error);
        showToast('Erreur lors de la lecture du fichier', 'error');
        setIsParsing(false);
      }
    };

    reader.onerror = () => {
      showToast('Erreur de lecture du fichier.', 'error');
      setIsParsing(false);
    };

    reader.readAsBinaryString(selectedFile);
  };

  const handleStartImport = async () => {
    if (parsedPurchases.length === 0) {
      showToast('Aucun achat à importer.', 'error');
      return;
    }

    setIsImporting(true);
    try {
      const supplierMap = new Map<string, string>();
      existingSuppliers.forEach((c) => {
        supplierMap.set(
          String(c.name || '')
            .toLowerCase()
            .trim(),
          c.id
        );
      });

      const BATCH_SIZE = 400;
      let batch = writeBatch(db);
      let operationCount = 0;

      // Create missing suppliers
      if (createMissingSuppliers && suppliersToCreate.length > 0) {
        for (const supplierName of suppliersToCreate) {
          const supNorm = supplierName.toLowerCase().trim();
          if (supplierMap.has(supNorm)) continue;

          const newSupplierRef = doc(collection(db, 'suppliers'));
          batch.set(newSupplierRef, {
            ownerId,
            name: supplierName,
            phone: null,
            email: null,
            addressLine1: null,
            addressLine2: null,
            city: null,
            ice: null,
            notes: "Créé automatiquement lors de l'import d'achats Odoo",
            createdAt: new Date(),
          });

          supplierMap.set(supNorm, newSupplierRef.id);
          operationCount++;

          if (operationCount >= BATCH_SIZE) {
            await batch.commit();
            batch = writeBatch(db);
            operationCount = 0;
          }
        }
      }

      // Import vendor bills / purchases
      let importedCount = 0;
      let skippedCount = 0;

      for (const purchase of parsedPurchases) {
        const supNorm = String(purchase.supplierName).toLowerCase().trim();
        const targetSupplierId = supplierMap.get(supNorm);

        if (!targetSupplierId) {
          skippedCount++;
          continue;
        }

        const newPurchaseRef = doc(collection(db, 'suppliers', targetSupplierId, 'purchases'));

        batch.set(newPurchaseRef, {
          ownerId,
          supplierId: targetSupplierId,
          items: purchase.items,
          isInternational: true,
          exchangeRate: 10.0, // Assuming 10 MAD = 1 USD roughly if needed
          totalShippingUsd: purchase.items.reduce((acc: number, it: any) => acc + (it.transport || 0), 0),
          totalDiwMad: purchase.items.reduce((acc: number, it: any) => acc + (it.diw || 0), 0),
          totalFraisDouaneUsd: null,
          totalQteGlobal: purchase.items.reduce(
            (acc: number, it: any) => acc + (it.quantity || 1),
            0
          ),
          description:
            purchase.items.length === 1
              ? purchase.items[0].description
              : purchase.items.length === 0
                ? "Note d'achat uniquement"
                : `${purchase.items.length} Articles en stock`,
          price: purchase.items.length === 1 ? purchase.items[0].price : 0,
          quantity: purchase.items.reduce((acc: number, it: any) => acc + (it.quantity || 1), 0),
          subtotal: purchase.subtotal,
          taxAmount: purchase.taxAmount,
          taxRate: purchase.items.length > 0 ? purchase.items[0].taxRate || 20 : 20,
          total: purchase.total,
          paymentStatus: purchase.paymentStatus,
          amountPaid: purchase.amountPaid,
          dueDate: purchase.dueDate,
          date: purchase.date,
          refId: purchase.refId,
          status: purchase.status || 'Reçue',
          notes:
            purchase.notesList && purchase.notesList.length > 0
              ? purchase.notesList.join('\n')
              : null,
          notesList: purchase.notesList && purchase.notesList.length > 0 ? purchase.notesList : [],
          importedFromOdoo: true,
          importedAt: new Date(),
          createdAt: new Date(),
        });

        operationCount++;
        importedCount++;

        // Log payment in supplier's payments collection if paid > 0
        if (purchase.amountPaid > 0) {
          const paymentRef = doc(collection(db, 'suppliers', targetSupplierId, 'payments'));
          batch.set(paymentRef, {
            ownerId,
            supplierId: targetSupplierId,
            purchaseId: newPurchaseRef.id,
            amount: purchase.amountPaid,
            date: purchase.date || new Date(),
            notes: `Règlement d'acompte initial importé d'Odoo pour Facture ${purchase.refId || 'sans réf'}`,
            createdAt: new Date(),
            importedFromOdoo: true,
          });
          operationCount++;
        }

        if (operationCount >= BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db);
          operationCount = 0;
        }
      }

      if (operationCount > 0) {
        await batch.commit();
      }

      showToast(
        `${importedCount} achat(s) importé(s) avec succès. ${skippedCount > 0 ? skippedCount + ' sautés.' : ''}`,
        'success'
      );
      resetState();
      onClose();
    } catch (error) {
      console.error('Import error:', error);
      showToast("Une erreur est survenue lors de l'enregistrement.", 'error');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={!isImporting ? onClose : undefined}
            className="fixed inset-0 bg-transparent backdrop-blur-xs z-[9999]"
          />

          <div className="fixed inset-0 flex items-center justify-center pointer-events-none z-[10000] p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white dark:bg-[#2b2c40] rounded-xl shadow-[0_4px_24px_rgba(15,23,42,0.1)] w-full max-w-lg pointer-events-auto overflow-hidden border border-slate-200 dark:border-slate-700/60"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#696cff]/10 text-[#696cff] dark:text-[#b1b4ff] flex items-center justify-center font-sans shrink-0">
                    <FileSpreadsheet size={18} />
                  </div>
                  <div>
                    <h3 className="text-md font-bold text-slate-900 dark:text-slate-100 font-sans tracking-tight">
                      Importer Achats (Odoo / Excel)
                    </h3>
                    <p className="text-[10px] text-[#8592a3] dark:text-[#a3afbb] font-bold uppercase tracking-wider font-sans">
                      Fichier XLSX / XLS / CSV
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isImporting}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded-lg text-slate-400 dark:text-slate-500 transition-all cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                {!file && (
                  <div className="space-y-4">
                    <p className="text-slate-500 dark:text-slate-400 text-[13px] leading-relaxed">
                      Importez vos achats et factures fournisseurs depuis Odoo ou un tableau Excel
                      personnalisé. Le système regroupe automatiquement les lignes d'articles par
                      numéro de facture.
                    </p>

                    <div
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-[#696cff] dark:hover:border-[#696cff] transition-all rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50/50 dark:bg-[#232333]/30 min-h-[160px] group"
                    >
                      <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        accept=".xlsx, .xls, .csv"
                        className="hidden"
                      />
                      <Upload
                        size={32}
                        className="text-slate-400 group-hover:text-[#696cff] group-hover:scale-110 transition-all mb-3 stroke-[1.8]"
                      />
                      <span className="font-semibold text-sm text-[#435971] dark:text-[#dbdade] mb-1">
                        Glissez votre document Odoo ici ou cliquez
                      </span>
                      <span className="text-xs text-[#8592a3] dark:text-[#707194]">
                        Prend en charge Excel (.xlsx, .xls) et CSV
                      </span>
                    </div>

                    <div className="flex items-start gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-700/50 text-xs text-slate-600 dark:text-slate-300">
                      <HelpCircle size={18} className="text-[#696cff] shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold block mb-1 text-slate-800 dark:text-white">
                          Comment exporter de Odoo ?
                        </span>
                        <p className="leading-relaxed">
                          Allez dans Odoo ➔ Facturation ➔ Fournisseurs ➔ Factures. Sélectionnez les
                          lignes d'achats, cliquez sur <strong>Action ➔ Exporter</strong>.
                          Assurez-vous d'exporter les colonnes Partenaire (Fournisseur), Date de
                          facturation, Numéro, Lignes de facture/Description, Lignes/Quantité,
                          Lignes/Prix unitaire et Lignes/Taxes.
                        </p>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-xl bg-rose-50/40 dark:bg-rose-950/5 border border-rose-100 dark:border-rose-800/20 text-xs gap-3">
                        <div className="space-y-1">
                          <span className="font-bold text-rose-600 block">
                            Recommencer l'importation d'achats ?
                          </span>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-normal">
                            Vous pouvez supprimer tous les achats importés d'Odoo ainsi que leurs
                            règlements en un seul clic pour repartir de zéro.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleDeletePreviousOdooImports}
                          disabled={isDeletingImports}
                          className="px-3 py-2 bg-rose-500 hover:bg-rose-600 disabled:bg-rose-300 disabled:cursor-not-allowed text-white rounded-lg font-bold text-[10px] uppercase tracking-wider shrink-0 transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          {isDeletingImports ? (
                            <>
                              <Loader2 size={11} className="animate-spin" />
                              <span>Suppression...</span>
                            </>
                          ) : (
                            <span>Tout Nettoyer</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {isParsing && (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                    <Loader2 size={32} className="text-[#696cff] animate-spin stroke-[2]" />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      Analyse de la feuille d'achats en cours ...
                    </p>
                  </div>
                )}

                {file && !isParsing && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-[#232333]/40 border border-slate-100 dark:border-slate-700/50">
                      <div className="flex items-center gap-2.5 truncate">
                        <FileSpreadsheet size={16} className="text-emerald-500" />
                        <span className="text-xs font-semibold text-[#435971] dark:text-[#dbdade] truncate">
                          {file.name}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={resetState}
                        className="text-[11px] font-bold text-rose-500 hover:text-rose-600 uppercase cursor-pointer"
                      >
                        Changer
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-slate-50 dark:bg-[#232333]/20 border border-slate-100 dark:border-slate-800 text-center">
                        <span className="text-[10px] block font-bold text-[#8592a3] uppercase mb-0.5">
                          Achats à Importer
                        </span>
                        <span className="text-lg font-bold text-slate-900 dark:text-white font-mono">
                          {parsedPurchases.length}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg bg-emerald-50/40 dark:bg-emerald-950/5 border border-emerald-100/50 dark:border-emerald-800/30 text-center">
                        <span className="text-[10px] block font-bold text-emerald-600 uppercase mb-0.5">
                          Valeur Totale
                        </span>
                        <span className="text-lg font-bold text-emerald-600 font-mono">
                          {totalImportAmount.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                      </div>
                    </div>

                    {suppliersToCreate.length > 0 && (
                      <div className="p-3.5 rounded-xl bg-amber-50/40 dark:bg-amber-950/5 border border-amber-100 dark:border-amber-800/20 text-xs space-y-2">
                        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-bold">
                          <AlertCircle size={16} />
                          <span>{suppliersToCreate.length} nouveaux fournisseurs détectés</span>
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-relaxed">
                          Ces fournisseurs n'existent pas dans votre base de données. Ils seront
                          automatiquement créés lors du lancement de l'importation.
                        </p>
                        <label className="relative inline-flex items-center cursor-pointer pt-1">
                          <input
                            type="checkbox"
                            checked={createMissingSuppliers}
                            onChange={(e) => setCreateMissingSuppliers(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-[#d9dee3] dark:bg-[#434460]/40 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:height-4 after:h-4 after:w-4 after:transition-all peer-checked:bg-[#696cff]"></div>
                          <span className="ml-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
                            Créer automatiquement les fiches fournisseurs
                          </span>
                        </label>
                      </div>
                    )}

                    <div className="space-y-1">
                      <span className="text-[11px] text-[#8592a3] font-bold uppercase tracking-wider block">
                        Aperçu des 3 premiers achats :
                      </span>
                      <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden text-[11px]">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-[#232333]/50 border-b border-slate-100 dark:border-slate-800 font-semibold text-slate-500">
                              <th className="p-2">Facture</th>
                              <th className="p-2">Fournisseur</th>
                              <th className="p-2">Date</th>
                              <th className="p-2 text-right">Total TTC</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parsedPurchases.slice(0, 3).map((r, index) => (
                              <tr
                                key={index}
                                className="border-b border-slate-50 dark:border-slate-800/40 text-slate-600 dark:text-slate-300"
                              >
                                <td className="p-2 font-mono font-medium truncate max-w-[90px]">
                                  {r.refId}
                                </td>
                                <td className="p-2 truncate max-w-[120px]">{r.supplierName}</td>
                                <td className="p-2">
                                  {r.date
                                    ? r.date.toLocaleDateString('fr-FR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                      })
                                    : '—'}
                                </td>
                                <td className="p-2 text-right font-mono font-bold">
                                  {r.total.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/20 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isImporting}
                  className="px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold uppercase tracking-wide rounded-lg transition-all cursor-pointer"
                >
                  Annuler
                </button>
                {file && !isParsing && (
                  <button
                    type="button"
                    onClick={handleStartImport}
                    disabled={isImporting || parsedPurchases.length === 0}
                    className="px-5 py-2 bg-[#696cff] hover:bg-[#5f61e6] active:bg-[#5f61e6] text-white text-xs font-bold uppercase tracking-wide rounded-lg transition-all shadow-[0_2px_4px_rgba(105,108,255,0.4)] hover:shadow-md cursor-pointer flex items-center gap-1.5"
                  >
                    {isImporting ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        <span>Importation ...</span>
                      </>
                    ) : (
                      <>
                        <Check size={13} strokeWidth={2.5} />
                        <span>Lancer l'import ({parsedPurchases.length})</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

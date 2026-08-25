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

interface SupplierPurchaseXlsxModalProps {
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

export const SupplierPurchaseXlsxModal: React.FC<SupplierPurchaseXlsxModalProps> = ({
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
        if (rawRows.length < 2) {
          showToast('Le fichier est vide ou manque de données.', 'error');
          resetState();
          setIsParsing(false);
          return;
        }

        setTotalLinesParsed(rawRows.length);

        // Find headers row
        let headerRowIndex = 0;
        for (let r = 0; r < Math.min(10, rawRows.length); r++) {
          const row = rawRows[r];
          if (
            row &&
            row.some((cell) => {
              const str = String(cell || '').toLowerCase();
              return (
                str.includes('ref') ||
                str.includes('fournisseur') ||
                str.includes('facture') ||
                str.includes('partenaire') ||
                str.includes('supplier')
              );
            })
          ) {
            headerRowIndex = r;
            break;
          }
        }

        const headers = (rawRows[headerRowIndex] || []).map((h) => String(h || '').trim());
        const isSingleColumnCsv =
          headers.length === 1 && (headers[0].includes(',') || headers[0].includes(';'));

        const findColumnIndex = (synonyms: string[]) => {
          const exactIdx = headers.findIndex((h) => {
            const hClean = h.toLowerCase().trim();
            return synonyms.some((syn) => hClean === syn.toLowerCase().trim());
          });
          if (exactIdx >= 0) return exactIdx;

          return headers.findIndex((h) => {
            const hClean = h.toLowerCase().trim();
            return synonyms.some((syn) => {
              const synClean = syn.toLowerCase().trim();

              if (['taxes', 'taxe', 'tax', 'tva', 'vat'].includes(synClean)) {
                if (
                  hClean.includes('montant') ||
                  hClean.includes('total') ||
                  hClean.includes('hors')
                ) {
                  return false;
                }
              }

              if (['sous-total', 'subtotal'].includes(synClean)) {
                if (
                  hClean.includes('montant') ||
                  hClean.includes('hors') ||
                  hClean.includes('signé') ||
                  hClean.includes('signe')
                ) {
                  if (!hClean.includes('ligne')) return false;
                }
              }

              if (synClean === 'total') {
                if (
                  hClean.includes('signé') ||
                  hClean.includes('signe') ||
                  hClean.includes('devises')
                ) {
                  return false;
                }
              }

              if (hClean === synClean) return true;
              if (hClean.includes(synClean) || synClean.includes(hClean)) return true;
              return false;
            });
          });
        };

        const idxInvoiceNum = findColumnIndex([
          'numéro',
          'numero',
          'name',
          'référence',
          'reference',
          'id',
          'number',
        ]);

        const idxSupplier = findColumnIndex([
          "nom d'affichage du partenaire de la facture",
          'partenaire de la facture',
          'fournisseur',
          'partenaire',
          'partner',
          'supplier',
          'vendor',
        ]);

        const idxDate = findColumnIndex([
          'date de facturation',
          'date facturation',
          'date',
          'invoice date',
          'bill date',
        ]);

        const idxDueDate = findColumnIndex([
          "date d'échéance",
          "date d'echeance",
          'échéance',
          'echeance',
          'due date',
          'date de règlement',
          'date de reglement',
          'date reglement',
        ]);

        const idxDescription = findColumnIndex([
          'lignes de facture/libellé',
          'lignes de facture/libelle',
          'lignes de facture/description',
          'lignes de facture/nom',
          'lignes de facture/label',
          'lignes de facture/produit',
          'lignes de facture/article',
          'libellé',
          'libelle',
          'description',
          'label',
          'produit',
          'article',
          'lignes de facture',
        ]);

        const idxQuantity = findColumnIndex([
          'lignes de facture/quantité',
          'quantité',
          'quantite',
          'qty',
          'quantity',
        ]);

        const idxUnitPrice = findColumnIndex([
          'lignes de facture/prix unitaire',
          'prix unitaire',
          'unit price',
        ]);

        const idxTax = findColumnIndex([
          'lignes de facture/taxes/nom de la',
          'lignes de facture/taxes',
          'tax_ids',
          'taxe',
          'taxes',
          'tva',
          'tax',
        ]);

        const idxSubtotal = findColumnIndex([
          'lignes de facture/sous-total',
          'sous-total',
          'subtotal',
        ]);

        const idxOdooTotal = findColumnIndex([
          'amount_total',
          'amount_total_signed',
          'amount_total_in_currency_signed',
          'total signé en devises',
          'total signé',
          'total en devises',
          'total',
          'montant total',
          'ttc',
          'montant ttc',
          'total ttc',
        ]);

        const idxStatus = findColumnIndex(['statut', 'état', 'etat', 'status', 'state']);

        const idxStatusInPayment = findColumnIndex([
          'statut en cours de paiement',
          'status_in_payment',
          'statut paiement',
        ]);

        const idxOdooResidual = findColumnIndex([
          'amount_residual',
          'amount_residual_signed',
          'residual_signed',
          'montant dû',
          'montant du',
          'residual',
          'reste',
        ]);

        const idxAmountPaid = findColumnIndex([
          'montant payé',
          'montant paye',
          'payé',
          'paye',
          'amount paid',
          'paid',
        ]);

        if (idxSupplier < 0) {
          showToast('Impossible de trouver la colonne du Fournisseur.', 'error');
          resetState();
          setIsParsing(false);
          return;
        }

        const rawPurchaseLines: any[] = [];
        let lastRefId = '';
        let lastSupplierName = '';
        let lastDateStr = '';
        let lastDueDateStr = '';
        let lastStatusStr = '';
        let lastStatusInPaymentStr = '';
        let lastAmountResidualVal = '';
        let lastAmountPaidVal = '';
        let lastRowTotal = 0;

        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          if (!row || row.length === 0) continue;

          let cells: string[] = [];
          if (isSingleColumnCsv) {
            cells = parseCsvLine(String(row[0] || ''));
          } else {
            cells = row.map((c) => (c === null || c === undefined ? '' : String(c)));
          }

          if (cells.length === 0 || cells.every((c) => !c)) continue;

          const getValue = (idx: number) => {
            if (idx < 0 || idx >= cells.length) return '';
            const val = cells[idx];
            if (val === undefined || val === null) return '';
            return String(val)
              .trim()
              .replace(/^["']|["']$/g, '')
              .trim();
          };

          let refId = getValue(idxInvoiceNum);
          let supplierName = getValue(idxSupplier);
          let dateStr = getValue(idxDate);
          let dueDateStr = getValue(idxDueDate);
          let statusStr = getValue(idxStatus);
          let statusInPaymentStr = getValue(idxStatusInPayment);
          let amountResidualVal = getValue(idxOdooResidual);
          let amountPaidVal = getValue(idxAmountPaid);

          let rowTotalVal = idxOdooTotal >= 0 ? getValue(idxOdooTotal) : '';
          let rowTotal = rowTotalVal ? Math.abs(parseExcelNumber(rowTotalVal)) : 0;

          if (refId || supplierName) {
            lastRefId = refId || `BILL-${Date.now()}-${i}`;
            lastSupplierName = supplierName;
            lastDateStr = dateStr;
            lastDueDateStr = dueDateStr;
            lastStatusStr = statusStr;
            lastStatusInPaymentStr = statusInPaymentStr;
            lastAmountResidualVal = amountResidualVal;
            lastAmountPaidVal = amountPaidVal;
            lastRowTotal = rowTotal;
          }

          if (!lastSupplierName) continue;

          const finalRefId = refId || lastRefId;
          const finalSupplierName = supplierName || lastSupplierName;
          const finalDateStr = dateStr || lastDateStr;
          const finalDueDateStr = dueDateStr || lastDueDateStr;
          const finalStatusStr = statusStr || lastStatusStr;
          const finalStatusInPaymentStr = statusInPaymentStr || lastStatusInPaymentStr;
          const finalAmountResidualVal = amountResidualVal || lastAmountResidualVal;
          const finalAmountPaidVal = amountPaidVal || lastAmountPaidVal;
          const finalRowTotal = rowTotal || lastRowTotal;

          const rawDescription = getValue(idxDescription);
          const description = rawDescription || 'Articles en stock / Fourniture';
          const qty = parseExcelNumber(getValue(idxQuantity)) || 1;
          const unitPrice = parseExcelNumber(getValue(idxUnitPrice));
          const taxStr = getValue(idxTax);

          if (!rawDescription && qty === 0 && unitPrice === 0) continue;

          let taxRate = 20; // Default to 20% global
          if (taxStr) {
            const taxStrClean = taxStr.toLowerCase().trim();
            if (taxStrClean.includes('20')) {
              taxRate = 20;
            } else if (taxStrClean === '100') {
              taxRate = 20;
            } else if (taxStrClean.includes('0')) {
              taxRate = 0;
            } else {
              const match = taxStr.match(/(\d+)\s*%/);
              if (match) {
                const parsed = parseInt(match[1], 10);
                taxRate = parsed === 100 ? 20 : parsed;
              }
            }
          }

          let lineSubtotalVal = getValue(idxSubtotal);
          let lineSubtotal = lineSubtotalVal
            ? parseExcelNumber(lineSubtotalVal)
            : unitPrice * qty;

          let calculatedPrice = unitPrice || (qty ? lineSubtotal / qty : lineSubtotal);

          // Robust fallback: if price and subtotal are 0 but we have a row total, back-calculate them
          if (lineSubtotal === 0 && finalRowTotal > 0) {
            lineSubtotal = finalRowTotal / (1 + taxRate / 100);
            calculatedPrice = qty ? lineSubtotal / qty : lineSubtotal;
          }

          const lineTotal = lineSubtotal * (1 + taxRate / 100);

          const isNote = !!rawDescription && calculatedPrice === 0 && lineSubtotal === 0;

          rawPurchaseLines.push({
            refId: finalRefId,
            supplierName: finalSupplierName,
            date: parseExcelDate(finalDateStr),
            dueDate: finalDueDateStr ? parseExcelDate(finalDueDateStr) : null,
            description,
            quantity: qty,
            price: calculatedPrice,
            taxRate,
            subtotal: lineSubtotal,
            total: lineTotal,
            status: finalStatusStr,
            rawAmountPaidVal: finalAmountPaidVal,
            rawAmountResidualVal: finalAmountResidualVal,
            rawStatusInPaymentStr: finalStatusInPaymentStr,
            rawRowTotal: finalRowTotal,
            isNote,
          });
        }

        if (rawPurchaseLines.length === 0) {
          showToast("Aucun achat valide n'a pu être lu.", 'error');
          resetState();
          setIsParsing(false);
          return;
        }

        // Group rows by refId
        const groupedMap = new Map<string, any>();
        for (const line of rawPurchaseLines) {
          const key = line.refId;
          if (!groupedMap.has(key)) {
            groupedMap.set(key, {
              refId: line.refId,
              supplierName: line.supplierName,
              date: line.date,
              dueDate: line.dueDate,
              status: line.status,
              rawAmountPaidVal: line.rawAmountPaidVal,
              rawAmountResidualVal: line.rawAmountResidualVal,
              rawStatusInPaymentStr: line.rawStatusInPaymentStr,
              rawRowTotal: line.rawRowTotal,
              items: [],
              notesList: [],
            });
          }

          const group = groupedMap.get(key);
          if (line.isNote) {
            group.notesList.push(line.description);
          } else {
            group.items.push({
              id: String(group.items.length + 1),
              description: line.description,
              price: line.price,
              quantity: line.quantity,
              taxRate: line.taxRate,
            });
          }
        }

        const groupedList = Array.from(groupedMap.values());

        let grandTotal = 0;
        const missingSuppliersSet = new Set<string>();
        let existingCount = 0;

        const supplierNamesLowercaseMap = new Map<string, any>();
        existingSuppliers.forEach((c) => {
          supplierNamesLowercaseMap.set(
            String(c.name || '')
              .toLowerCase()
              .trim(),
            c
          );
        });

        const finalizedPurchases = groupedList.map((inv) => {
          let subtotal = 0;
          let taxAmount = 0;

          inv.items.forEach((it: any) => {
            const lineSub = it.price * it.quantity;
            const lineTax = lineSub * (it.taxRate / 100);
            subtotal += lineSub;
            taxAmount += lineTax;
          });

          const total =
            inv.rawRowTotal !== undefined && inv.rawRowTotal !== 0
              ? inv.rawRowTotal
              : subtotal + taxAmount;
          const taxAmountAdjusted = total >= subtotal ? total - subtotal : taxAmount;
          grandTotal += total;

          const supNormName = String(inv.supplierName).toLowerCase().trim();
          const foundSup = supplierNamesLowercaseMap.get(supNormName);

          if (foundSup) {
            existingCount++;
          } else {
            missingSuppliersSet.add(inv.supplierName.trim());
          }

          const rawStatus = String(inv.status || '').toLowerCase();
          let finalStatus = 'posted';
          if (rawStatus.includes('draft') || rawStatus.includes('brouillon')) {
            finalStatus = 'draft';
          } else if (rawStatus.includes('cancel') || rawStatus.includes('annul')) {
            finalStatus = 'cancelled';
          }

          const residual = inv.rawAmountResidualVal
            ? Math.abs(parseExcelNumber(inv.rawAmountResidualVal))
            : 0;
          let actualAmountPaid = Math.max(0, total - residual);
          let payStatus: 'paid' | 'credit' | 'partiel' = 'credit';

          const finalStatusInPaymentStr = String(inv.rawStatusInPaymentStr || '')
            .trim()
            .toLowerCase();

          if (
            residual <= 0.05 ||
            actualAmountPaid >= total - 0.05 ||
            finalStatusInPaymentStr.includes('paid') ||
            finalStatusInPaymentStr.includes('paye') ||
            finalStatusInPaymentStr.includes('payé') ||
            finalStatusInPaymentStr.includes('in_payment') ||
            finalStatusInPaymentStr.includes('en paiement') ||
            rawStatus.includes('paid') ||
            rawStatus.includes('payé')
          ) {
            actualAmountPaid = total;
            payStatus = 'paid';
          } else if (actualAmountPaid > 0.05) {
            payStatus = 'partiel';
          } else {
            payStatus = 'credit';
            actualAmountPaid = 0;
          }

          return {
            ...inv,
            subtotal,
            taxAmount: taxAmountAdjusted,
            total,
            status: finalStatus,
            paymentStatus: payStatus,
            amountPaid: actualAmountPaid,
          };
        });

        setParsedPurchases(finalizedPurchases);
        setSuppliersToCreate(Array.from(missingSuppliersSet));
        setExistingSuppliersCount(existingCount);
        setTotalImportAmount(grandTotal);
        setIsParsing(false);
        showToast('Analyse du fichier effectuée !', 'success');
      } catch (err) {
        console.error(err);
        setIsParsing(false);
        showToast("Erreur lors de l'analyse du fichier Excel/CSV.", 'error');
        resetState();
      }
    };

    reader.onerror = () => {
      setIsParsing(false);
      showToast('Impossible de lire le fichier.', 'error');
      resetState();
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
          isInternational: false,
          exchangeRate: null,
          totalShippingUsd: null,
          totalDiwMad: null,
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
          status: purchase.status,
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

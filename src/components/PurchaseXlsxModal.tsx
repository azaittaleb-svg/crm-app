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
  CheckCircle2,
  Coffee,
  HelpCircle,
  TrendingUp,
  UserPlus,
  ArrowRight,
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

interface PurchaseXlsxModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingClients: any[];
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

  // If it's a number or a string that contains a pure integer number representing an Excel serial date
  const numVal = Number(val);
  if (!isNaN(numVal) && typeof val !== 'boolean' && String(val).trim() !== '') {
    if (numVal > 30000 && numVal < 60000) {
      // Excel serial date representation
      return new Date(Math.round((numVal - 25569) * 86400 * 1000));
    }
  }

  const str = String(val).trim();
  if (!str) return new Date();

  // Try parsing YYYY-MM-DD
  const ymd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    return new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10));
  }

  // Try DD/MM/YYYY or DD.MM.YYYY
  const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) {
    return new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
  }

  // Fallback to JS standard Date parsing
  const parsed = Date.parse(str);
  if (!isNaN(parsed)) return new Date(parsed);

  return new Date();
}

function parseExcelNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (val === undefined || val === null) return 0;

  // Convert to string and remove all types of spaces (including non-breaking spaces)
  let str = String(val)
    .trim()
    .replace(/[\s\u00A0\u202F]/g, '');
  if (!str) return 0;

  // Remove currency signs
  str = str.replace(/[DHdh$€£]/g, '');

  // Detect formatting pattern
  const hasComma = str.includes(',');
  const hasDot = str.includes('.');

  if (hasComma && hasDot) {
    // Both separators exist, e.g., "1,234.56" or "1.234,56"
    if (str.indexOf(',') < str.indexOf('.')) {
      // Comma is thousands, dot is decimal (US/UK)
      str = str.replace(/,/g, '');
    } else {
      // Dot is thousands, comma is decimal (FR/EU)
      str = str.replace(/\./g, '').replace(',', '.');
    }
  } else if (hasComma) {
    // Only comma exists, e.g. "1234,56" or "1,234"
    // In French/Moroccan context, comma is always the decimal separator
    str = str.replace(',', '.');
  } else if (hasDot) {
    // Only dot exists, e.g., "1234.56" or "1.234" (quantity or whole amount)
    // If it is followed by exactly 3 digits, we need to be careful.
    // However, JS parseFloat expects a dot as decimal, so "1.000" is parsed as 1, which is correct.
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

export const PurchaseXlsxModal: React.FC<PurchaseXlsxModalProps> = ({
  isOpen,
  onClose,
  existingClients,
  ownerId,
  showToast,
}) => {
  const { confirm } = useNotification();
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [createMissingClients, setCreateMissingClients] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parsed invoices list
  const [parsedInvoices, setParsedInvoices] = useState<any[]>([]);
  const [totalLinesParsed, setTotalLinesParsed] = useState(0);

  // Clients mapping analysis
  const [clientsToCreate, setClientsToCreate] = useState<string[]>([]);
  const [existingClientsCount, setExistingClientsCount] = useState(0);
  const [totalImportAmount, setTotalImportAmount] = useState(0);
  const [isDeletingImports, setIsDeletingImports] = useState(false);
  const [isSyncingHistorical, setIsSyncingHistorical] = useState(false);

  const handleSyncAndCorrectHistoricalOdooImports = async () => {
    confirm({
      title: 'Synchroniser et corriger Odoo',
      message: "Voulez-vous lancer la migration pour corriger et synchroniser tous les enregistrements historiques importés d'Odoo ? Cela corrigera automatiquement les anomalies de TVA (100% ramenée à 20%, etc.) et recalculera les totaux et restes.",
      onConfirm: async () => {
        setIsSyncingHistorical(true);
        try {
          const BATCH_SIZE = 400;
          let batch = writeBatch(db);
          let operationCount = 0;
          let updatedCount = 0;

          // Fetch all imported purchases
          const purchasesQuery = query(
            collectionGroup(db, 'purchases'),
            where('ownerId', '==', ownerId),
            where('importedFromOdoo', '==', true)
          );
          const purchasesSnap = await getDocs(purchasesQuery);

          for (const docSnap of purchasesSnap.docs) {
            const data = docSnap.data();
            let changed = false;

            // 1. Correct item-level taxes
            let items = data.items ? [...data.items] : [];
            let itemsChanged = false;
            items = items.map((it: any) => {
              if (it.taxRate === 100) {
                itemsChanged = true;
                return { ...it, taxRate: 20 };
              }
              return it;
            });

            let taxRate = data.taxRate || 0;
            if (taxRate === 100) {
              taxRate = 20;
              changed = true;
            }

            if (itemsChanged) {
              changed = true;
            }

            // Recalculate if changed
            if (changed) {
              let subtotal = 0;
              let taxAmount = 0;
              items.forEach((it: any) => {
                const lineSub = (Number(it.price) || 0) * (Number(it.quantity) || 1);
                const lineTax = lineSub * ((Number(it.taxRate) || 0) / 100);
                subtotal += lineSub;
                taxAmount += lineTax;
              });

              const total = subtotal + taxAmount;

              // Compute remaining (reste) and amountPaid if needed
              let amountPaid = Number(data.amountPaid) || 0;
              if (amountPaid > total) {
                amountPaid = total;
              }

              batch.update(docSnap.ref, {
                items,
                taxRate,
                subtotal,
                taxAmount,
                total,
                amountPaid,
              });
              operationCount++;
              updatedCount++;

              if (operationCount >= BATCH_SIZE) {
                await batch.commit();
                batch = writeBatch(db);
                operationCount = 0;
              }
            }
          }

          if (operationCount > 0) {
            await batch.commit();
          }

          showToast(
            `Migration terminée : ${updatedCount} facture(s) historique(s) d'Odoo ont été synchronisées et corrigées avec succès.`,
            'success'
          );
        } catch (err) {
          console.error('Migration error:', err);
          showToast('Une erreur est survenue lors de la migration de la base de données.', 'error');
        } finally {
          setIsSyncingHistorical(false);
        }
      }
    });
  };

  const handleDeletePreviousOdooImports = async () => {
    confirm({
      title: 'Supprimer les imports Odoo',
      message: "Êtes-vous sûr de vouloir supprimer TOUTES les factures et règlements précédemment importés d'Odoo ? Cette opération est irréversible.",
      onConfirm: async () => {
        setIsDeletingImports(true);
        try {
          const BATCH_SIZE = 400;
          let batch = writeBatch(db);
          let operationCount = 0;
          let deletedPurchasesCount = 0;
          let deletedPaymentsCount = 0;

          // 1. Fetch and delete purchases
          const purchasesQuery = query(
            collectionGroup(db, 'purchases'),
            where('ownerId', '==', ownerId),
            where('importedFromOdoo', '==', true)
          );
          const purchasesSnap = await getDocs(purchasesQuery);

          for (const d of purchasesSnap.docs) {
            batch.delete(d.ref);
            operationCount++;
            deletedPurchasesCount++;

            if (operationCount >= BATCH_SIZE) {
              await batch.commit();
              batch = writeBatch(db);
              operationCount = 0;
            }
          }

          // 2. Fetch and delete payments
          const paymentsQuery = query(
            collectionGroup(db, 'payments'),
            where('ownerId', '==', ownerId),
            where('importedFromOdoo', '==', true)
          );
          const paymentsSnap = await getDocs(paymentsQuery);

          for (const d of paymentsSnap.docs) {
            batch.delete(d.ref);
            operationCount++;
            deletedPaymentsCount++;

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
            `Nettoyage réussi : ${deletedPurchasesCount} facture(s) et ${deletedPaymentsCount} règlement(s) d'Odoo ont été supprimés.`,
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
    setParsedInvoices([]);
    setTotalLinesParsed(0);
    setClientsToCreate([]);
    setExistingClientsCount(0);
    setTotalImportAmount(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const downloadOdooHelp = () => {
    showToast("Consultez les explications dans le volet d'aide ci-dessous.", 'info');
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

        // Convert to array of arrays
        const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, { header: 1 });
        if (rawRows.length < 2) {
          showToast('Le fichier est vide ou manque de données.', 'error');
          resetState();
          setIsParsing(false);
          return;
        }

        setTotalLinesParsed(rawRows.length);

        // Find the header row (typically row 0, but could be lower)
        let headerRowIndex = 0;
        for (let r = 0; r < Math.min(10, rawRows.length); r++) {
          const row = rawRows[r];
          if (
            row &&
            row.some((cell) => {
              const str = String(cell || '').toLowerCase();
              return (
                str.includes('ref') ||
                str.includes('client') ||
                str.includes('facture') ||
                str.includes('partenaire')
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

        // Helper synonym matcher with guards to prevent mismatching invoice-level vs line-level columns
        const findColumnIndex = (synonyms: string[]) => {
          // 1. First try to find a perfect/exact match
          const exactIdx = headers.findIndex((h) => {
            const hClean = h.toLowerCase().trim();
            return synonyms.some((syn) => hClean === syn.toLowerCase().trim());
          });
          if (exactIdx >= 0) return exactIdx;

          // 2. Otherwise, look for a smart substring match with guards
          return headers.findIndex((h) => {
            const hClean = h.toLowerCase().trim();
            return synonyms.some((syn) => {
              const synClean = syn.toLowerCase().trim();

              // Guard 1: Prevent a tax synonym ("taxes", "taxe", "tax", "tva") from matching an overall invoice-level amount/total (e.g. "montant hors taxes")
              if (['taxes', 'taxe', 'tax', 'tva', 'vat'].includes(synClean)) {
                if (
                  hClean.includes('montant') ||
                  hClean.includes('total') ||
                  hClean.includes('hors')
                ) {
                  return false;
                }
              }

              // Guard 2: Prevent a line subtotal synonym ("sous-total", "subtotal") from matching invoice-level untaxed amount ("montant hors taxes")
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

              // Guard 3: Prevent a line total synonym ("total") from matching "total signé en devises" or "total en devises"
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

        const idxClient = findColumnIndex([
          "nom d'affichage du partenaire de la facture",
          'partenaire de la facture',
          'client',
          'partenaire',
          'partner',
          'customer',
        ]);

        const idxDate = findColumnIndex([
          'date de facturation',
          'date facturation',
          'date',
          'invoice date',
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

        const idxPaymentTerms = findColumnIndex([
          'conditions de paiement',
          'conditions paiement',
          'payment terms',
          'conditions_paiement',
          'condition de paiement',
          'conditions',
        ]);

        const idxPaymentMethod = findColumnIndex([
          'méthode de règlement',
          'methode de reglement',
          'mode de règlement',
          'mode de reglement',
          'mode_reglement',
          'payment method',
        ]);

        // Invoice-level totals for fallback
        const idxInvoiceSubtotal = findColumnIndex([
          'montant hors taxes signé',
          'montant hors taxes',
          'montant ht',
          'total ht',
          'untaxed amount',
          'ht',
        ]);
        const idxInvoiceTotal = findColumnIndex([
          'total signé en devises',
          'total signé',
          'total en devises',
          'amount_total_in_currency_signed',
        ]);

        if (idxClient < 0) {
          showToast('Impossible de trouver la colonne du Client.', 'error');
          resetState();
          setIsParsing(false);
          return;
        }

        // Parse individual rows
        const rawInvoiceLines: any[] = [];

        // Carry-forward states for Odoo multi-line invoice format
        let lastRefId = '';
        let lastClientName = '';
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

          // Read current row fields
          let refId = getValue(idxInvoiceNum);
          let clientName = getValue(idxClient);
          let dateStr = getValue(idxDate);
          let dueDateStr = getValue(idxDueDate);
          let statusStr = getValue(idxStatus);
          let statusInPaymentStr = getValue(idxStatusInPayment);
          let amountResidualVal = getValue(idxOdooResidual);
          let amountPaidVal = getValue(idxAmountPaid);
          let paymentTermsVal = getValue(idxPaymentTerms);
          let paymentMethodVal = getValue(idxPaymentMethod);

          let rowTotalVal = idxOdooTotal >= 0 ? getValue(idxOdooTotal) : '';
          let rowTotal = rowTotalVal ? Math.abs(parseExcelNumber(rowTotalVal)) : 0;

          // Carry forward parent row metadata if we see a row with header metadata
          if (refId || clientName) {
            lastRefId = refId || `OD-${Date.now()}-${i}`;
            lastClientName = clientName;
            lastDateStr = dateStr;
            lastDueDateStr = dueDateStr;
            lastStatusStr = statusStr;
            lastStatusInPaymentStr = statusInPaymentStr;
            lastAmountResidualVal = amountResidualVal;
            lastAmountPaidVal = amountPaidVal;
            lastRowTotal = rowTotal;
            // Hack to attach the newly added fields to the last state dynamically
            (window as any).lastPaymentTermsVal = paymentTermsVal;
            (window as any).lastPaymentMethodVal = paymentMethodVal;
          }

          // If no client name has been carried forward yet, skip this row
          if (!lastClientName) continue;

          const finalRefId = refId || lastRefId;
          const finalClientName = clientName || lastClientName;
          const finalDateStr = dateStr || lastDateStr;
          const finalDueDateStr = dueDateStr || lastDueDateStr;
          const finalStatusStr = statusStr || lastStatusStr;
          const finalStatusInPaymentStr = statusInPaymentStr || lastStatusInPaymentStr;
          const finalAmountResidualVal = amountResidualVal || lastAmountResidualVal;
          const finalAmountPaidVal = amountPaidVal || lastAmountPaidVal;
          const finalPaymentTermsVal = paymentTermsVal || (window as any).lastPaymentTermsVal;
          const finalPaymentMethodVal = paymentMethodVal || (window as any).lastPaymentMethodVal;
          const finalRowTotal = rowTotal || lastRowTotal;

          const description = getValue(idxDescription) || 'Produit / Prestation';
          const qty = parseExcelNumber(getValue(idxQuantity));
          const unitPrice = parseExcelNumber(getValue(idxUnitPrice));
          const taxStr = getValue(idxTax);

          // Skip completely empty rows
          if (!getValue(idxDescription) && qty === 0 && unitPrice === 0) continue;

          // If quantity is missing/zero AND unit price is missing/zero, it's a note row
          // BUT if we have a valid row total, it's a product line whose details are summarized
          const type = (qty === 0 && unitPrice === 0 && finalRowTotal === 0) ? 'note' : 'product';

          const finalQty = (type === 'product' && qty === 0) ? 1 : qty;

          // Securely parse taxRate percentage from strings like "20% 81" or "20% (vente)"
          let taxRate = 0; // Default to 0% (instead of 20%)
          if (taxStr) {
            const taxStrClean = taxStr.toLowerCase().trim();
            if (taxStrClean.includes('20')) {
              taxRate = 20;
            } else if (taxStrClean === '100') {
              // Odoo database ID 100 typically means 20% VAT in the user's setup
              taxRate = 20;
            } else if (taxStrClean.includes('0')) {
              taxRate = 0;
            } else {
              const match = taxStr.match(/(\d+)\s*%/);
              if (match) {
                const parsed = parseInt(match[1], 10);
                if (parsed === 100) {
                  // Avoid 100% VAT bug
                  taxRate = 20;
                } else {
                  taxRate = parsed;
                }
              } else {
                const digits = taxStr.replace(/[^\d]/g, '');
                if (digits) {
                  const parsedDigits = parseInt(digits, 10);
                  if (parsedDigits === 100) {
                    taxRate = 20;
                  } else if (parsedDigits > 0 && parsedDigits < 100) {
                    taxRate = parsedDigits;
                  } else if (parsedDigits > 100) {
                    const firstTwo = parseInt(digits.substring(0, 2), 10);
                    if (firstTwo > 0 && firstTwo < 100) {
                      taxRate = firstTwo;
                    }
                  }
                }
              }
            }
          }

          let lineSubtotalVal = getValue(idxSubtotal);
          let lineSubtotal = lineSubtotalVal
            ? parseExcelNumber(lineSubtotalVal)
            : unitPrice * finalQty;

          let calculatedPrice = unitPrice || (finalQty ? lineSubtotal / finalQty : lineSubtotal);

          // Robust fallback: if price and subtotal are 0 but we have a row total, back-calculate them
          if (lineSubtotal === 0 && finalRowTotal > 0) {
            lineSubtotal = finalRowTotal / (1 + taxRate / 100);
            calculatedPrice = finalQty ? lineSubtotal / finalQty : lineSubtotal;
          }

          const lineTotal = lineSubtotal * (1 + taxRate / 100);

          // Build row detail
          rawInvoiceLines.push({
            refId: finalRefId,
            clientName: finalClientName,
            date: parseExcelDate(finalDateStr),
            dueDate: finalDueDateStr ? parseExcelDate(finalDueDateStr) : null,
            paymentTerms: finalPaymentTermsVal,
            paymentMethod: finalPaymentMethodVal,
            description,
            type,
            quantity: finalQty,
            price: calculatedPrice,
            taxRate,
            subtotal: lineSubtotal,
            total: lineTotal,
            status: finalStatusStr,
            rawAmountPaidVal: finalAmountPaidVal,
            rawAmountResidualVal: finalAmountResidualVal,
            rawStatusInPaymentStr: finalStatusInPaymentStr,
            rawRowTotal: finalRowTotal,
          });
        }

        if (rawInvoiceLines.length === 0) {
          showToast("Aucune facture valide n'a pu être lue.", 'error');
          resetState();
          setIsParsing(false);
          return;
        }

        // Group rows by refId to support multiple line items per invoice
        const groupedMap = new Map<string, any>();
        for (const line of rawInvoiceLines) {
          const key = line.refId;
          if (!groupedMap.has(key)) {
            groupedMap.set(key, {
              refId: line.refId,
              clientName: line.clientName,
              date: line.date,
              dueDate: line.dueDate,
              paymentTerms: line.paymentTerms,
              paymentMethod: line.paymentMethod,
              status: line.status,
              rawAmountPaidVal: line.rawAmountPaidVal,
              rawAmountResidualVal: line.rawAmountResidualVal,
              rawStatusInPaymentStr: line.rawStatusInPaymentStr,
              rawRowTotal: line.rawRowTotal,
              items: [],
            });
          }

          const group = groupedMap.get(key);
          group.items.push({
            id: String(group.items.length + 1),
            type: line.type,
            description: line.description,
            price: line.price,
            quantity: line.quantity,
            taxRate: line.taxRate,
          });
        }

        const groupedList = Array.from(groupedMap.values());

        // Compute subtotal, tax and total for each invoice
        let grandTotal = 0;
        const missingClientsSet = new Set<string>();
        let existingCount = 0;

        const clientNamesLowercaseMap = new Map<string, any>();
        existingClients.forEach((c) => {
          clientNamesLowercaseMap.set(
            String(c.name || '')
              .toLowerCase()
              .trim(),
            c
          );
        });

        const finalizedInvoices = groupedList.map((inv) => {
          let subtotal = 0;
          let taxAmount = 0;

          inv.items.forEach((it: any) => {
            const lineSub = it.price * it.quantity;
            const lineTax = lineSub * (it.taxRate / 100);
            subtotal += lineSub;
            taxAmount += lineTax;
          });

          // Stop recalculating total and reste manually: fetch the exact final total directly from Odoo account.move header
          const total =
            inv.rawRowTotal !== undefined && inv.rawRowTotal !== 0
              ? inv.rawRowTotal
              : subtotal + taxAmount;
          const taxAmountAdjusted = total >= subtotal ? total - subtotal : taxAmount;
          grandTotal += total;

          // Match client
          const clientNormName = String(inv.clientName).toLowerCase().trim();
          const foundClient = clientNamesLowercaseMap.get(clientNormName);

          if (foundClient) {
            existingCount++;
          } else {
            missingClientsSet.add(inv.clientName.trim());
          }

          // Parse status mapping from Odoo to our ERP
          const rawStatus = String(inv.status || '').toLowerCase();
          let finalStatus = 'Valide';
          if (rawStatus.includes('draft') || rawStatus.includes('brouillon')) {
            finalStatus = 'Brouillon';
          } else if (rawStatus.includes('cancel') || rawStatus.includes('annul')) {
            finalStatus = 'Annulée';
          }

          // Map CSV/System Reste strictly to Odoo's amount_residual field (Montant dû)
          const residual = inv.rawAmountResidualVal
            ? Math.abs(parseExcelNumber(inv.rawAmountResidualVal))
            : 0;
          let actualAmountPaid = Math.max(0, total - residual);
          let payStatus: 'paid' | 'credit' = 'credit';

          const finalStatusInPaymentStr = String(inv.rawStatusInPaymentStr || '')
            .trim()
            .toLowerCase();

          // Force paid status if residual is zero or status indicates paid
          if (
            residual <= 0.05 ||
            actualAmountPaid >= total - 0.05 ||
            finalStatusInPaymentStr.includes('paid') ||
            finalStatusInPaymentStr.includes('paye') ||
            finalStatusInPaymentStr.includes('payé') ||
            finalStatusInPaymentStr.includes('in_payment') ||
            finalStatusInPaymentStr.includes('en paiement') ||
            rawStatus.includes('paid') ||
            rawStatus.includes('payé') ||
            rawStatus.includes('posted_paid') ||
            rawStatus.includes('posted_paye')
          ) {
            actualAmountPaid = total;
            payStatus = 'paid';
          } else if (actualAmountPaid > 0) {
            payStatus = 'credit';
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

        setParsedInvoices(finalizedInvoices);
        setClientsToCreate(Array.from(missingClientsSet));
        setExistingClientsCount(existingCount);
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
    if (parsedInvoices.length === 0) {
      showToast('Aucune facture à importer.', 'error');
      return;
    }

    setIsImporting(true);
    try {
      // Step 1: Handle Client creation if required
      const clientMap = new Map<string, string>(); // Name -> ClientId
      existingClients.forEach((c) => {
        clientMap.set(
          String(c.name || '')
            .toLowerCase()
            .trim(),
          c.id
        );
      });

      const BATCH_SIZE = 400;
      let batch = writeBatch(db);
      let operationCount = 0;

      if (createMissingClients && clientsToCreate.length > 0) {
        for (const clientName of clientsToCreate) {
          const clientNorm = clientName.toLowerCase().trim();
          if (clientMap.has(clientNorm)) continue;

          const newClientRef = doc(collection(db, 'clients'));
          batch.set(newClientRef, {
            ownerId,
            name: clientName,
            phone: null,
            email: null,
            addressLine1: null,
            addressLine2: null,
            city: null,
            ice: null,
            notes: "Créé automatiquement lors de l'import de factures Odoo",
            createdAt: new Date(),
          });

          clientMap.set(clientNorm, newClientRef.id);
          operationCount++;

          if (operationCount >= BATCH_SIZE) {
            await batch.commit();
            batch = writeBatch(db);
            operationCount = 0;
          }
        }
      }

      // Step 2: Import Invoices
      let importedCount = 0;
      let skippedCount = 0;

      for (const invoice of parsedInvoices) {
        const clientNorm = String(invoice.clientName).toLowerCase().trim();
        const targetClientId = clientMap.get(clientNorm);

        if (!targetClientId) {
          // If we choose not to create missing clients and client is missing, we skip
          skippedCount++;
          continue;
        }

        const newPurchaseRef = doc(collection(db, 'clients', targetClientId, 'purchases'));

        batch.set(newPurchaseRef, {
          ownerId,
          clientId: targetClientId,
          type: 'facture',
          conditions_paiement: invoice.paymentTerms || 'Paiement immédiat',
          mode_reglement: invoice.paymentMethod || 'Virement',
          items: invoice.items,
          description:
            invoice.items.length === 1
              ? invoice.items[0].description
              : `${invoice.items.length} Produits`,
          price: invoice.items.length === 1 ? invoice.items[0].price : 0,
          quantity: invoice.items.reduce((acc: number, it: any) => acc + (it.quantity || 1), 0),
          subtotal: invoice.subtotal,
          taxAmount: invoice.taxAmount,
          taxRate: invoice.items.length > 0 ? invoice.items[0].taxRate || 20 : 20,
          total: invoice.total,
          paymentStatus: invoice.paymentStatus,
          amountPaid: invoice.amountPaid,
          dueDate: invoice.dueDate,
          date: invoice.date,
          refId: invoice.refId,
          status: invoice.status,
          importedFromOdoo: true,
          importedAt: new Date(),
        });

        operationCount++;
        importedCount++;

        // Add corresponding payment document under clients/{clientId}/payments
        if (invoice.amountPaid > 0) {
          const paymentRef = doc(collection(db, 'clients', targetClientId, 'payments'));
          batch.set(paymentRef, {
            ownerId,
            clientId: targetClientId,
            purchaseId: newPurchaseRef.id,
            amount: invoice.amountPaid,
            date: invoice.date || new Date(),
            notes: `Paiement d'acompte initial importé depuis Odoo pour Facture ${invoice.refId || 'sans réf'}`,
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
        `${importedCount} facture(s) importée(s) avec succès. ${skippedCount > 0 ? skippedCount + ' sautée(s) car client absent.' : ''}`,
        'success'
      );
      resetState();
      onClose();
    } catch (error) {
      console.error('Import error:', error);
      showToast("Erreur lors de l'enregistrement sur Firebase.", 'error');
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
              className="bg-white dark:bg-[#2b2c40] rounded-xl shadow-[0_4px_24px_rgba(15,23,42,0.1)] w-full max-w-xl pointer-events-auto overflow-hidden border border-slate-200 dark:border-slate-700/60"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-700/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#696cff]/10 text-[#696cff] dark:text-[#b1b4ff] flex items-center justify-center font-sans shrink-0">
                    <FileSpreadsheet size={18} />
                  </div>
                  <div>
                    <h3 className="text-md font-bold text-slate-900 dark:text-slate-100 font-sans tracking-tight">
                      Importer Factures Odoo
                    </h3>
                    <p className="text-[10px] text-[#8592a3] dark:text-[#a3afbb] font-bold uppercase tracking-wider font-sans">
                      Fichier XLSX / XLS / CSV (Multi-lignes)
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

              {/* Body */}
              <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
                {!file && (
                  <div className="space-y-4">
                    <p className="text-slate-500 dark:text-slate-400 text-[13px] leading-relaxed">
                      Importez instantanément vos ventes et factures depuis Odoo. Le système analyse
                      automatiquement les colonnes et regroupe intelligemment les lignes par numéro
                      de facture.
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
                          Allez dans Odoo ➔ Facturation ➔ Clients ➔ Factures. Sélectionnez les
                          lignes souhaitées, puis cliquez sur <strong>Action ➔ Exporter</strong>.
                          Cochez les champs recommandés décrits ci-dessous dans la rubrique
                          explicative pour un import optimal.
                        </p>
                      </div>
                    </div>

                    {/* Section de nettoyage et régularisation des imports Odoo */}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60 space-y-4">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-xl bg-rose-50/40 dark:bg-rose-950/5 border border-rose-100 dark:border-rose-800/20 text-xs gap-3">
                        <div className="space-y-1">
                          <span className="font-bold text-rose-600 block">
                            Recommencer l'importation ?
                          </span>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-normal">
                            Si vous avez déjà importé vos factures d'Odoo avec des erreurs, vous
                            pouvez supprimer toutes ces anciennes factures importées ainsi que leurs
                            règlements en un clic.
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

                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3.5 rounded-xl bg-indigo-50/40 dark:bg-indigo-950/5 border border-indigo-100 dark:border-indigo-800/20 text-xs gap-3">
                        <div className="space-y-1">
                          <span className="font-bold text-indigo-600 dark:text-[#b1b4ff] block">
                            Régulariser l'historique Odoo ?
                          </span>
                          <p className="text-slate-500 dark:text-slate-400 text-[11px] leading-normal">
                            Corrigez rétroactivement les anomalies de calcul de TVA d'Odoo
                            (correction du taux 100% à 20% et recalcul automatique des restes et
                            totaux).
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleSyncAndCorrectHistoricalOdooImports}
                          disabled={isSyncingHistorical}
                          className="px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white rounded-lg font-bold text-[10px] uppercase tracking-wider shrink-0 transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          {isSyncingHistorical ? (
                            <>
                              <Loader2 size={11} className="animate-spin" />
                              <span>Migration...</span>
                            </>
                          ) : (
                            <span>Régulariser</span>
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
                      Analyse de l'export en cours ...
                    </p>
                  </div>
                )}

                {file && !isParsing && (
                  <div className="space-y-4">
                    {/* Selected File */}
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

                    {/* Stats */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="p-3 rounded-lg text-center bg-slate-50 dark:bg-[#232333]/20 border border-slate-100 dark:border-slate-800">
                        <span className="text-[9px] block font-bold text-[#8592a3] uppercase mb-0.5">
                          Lignes
                        </span>
                        <span className="text-md font-bold text-slate-900 dark:text-white font-mono">
                          {totalLinesParsed - 1}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg text-center bg-emerald-50/40 dark:bg-emerald-950/5 border border-emerald-100/50 dark:border-emerald-800/30">
                        <span className="text-[9px] block font-bold text-emerald-600 uppercase mb-0.5">
                          Factures
                        </span>
                        <span className="text-md font-bold text-emerald-600 font-mono">
                          {parsedInvoices.length}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg text-center bg-[#e7e7ff] dark:bg-[#696cff]/10 border border-[#b1b4ff]/40">
                        <span className="text-[9px] block font-bold text-[#696cff] uppercase mb-0.5">
                          Montant
                        </span>
                        <span className="text-xs font-bold text-[#696cff] font-mono leading-tight block truncate mt-1">
                          {totalImportAmount.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                      </div>
                      <div className="p-3 rounded-lg text-center bg-amber-50/40 dark:bg-amber-950/5 border border-amber-100/50 dark:border-amber-800/30">
                        <span className="text-[9px] block font-bold text-amber-600 uppercase mb-0.5">
                          Nouv. Clients
                        </span>
                        <span className="text-md font-bold text-amber-600 font-mono">
                          {clientsToCreate.length}
                        </span>
                      </div>
                    </div>

                    {/* New Clients auto-creation toggle */}
                    {clientsToCreate.length > 0 && (
                      <div className="flex items-center justify-between p-3.5 rounded-xl bg-amber-50/50 dark:bg-amber-950/5 border border-amber-100/60 dark:border-amber-800/20 text-xs">
                        <div className="flex gap-2">
                          <UserPlus size={16} className="text-amber-500 mt-0.5 shrink-0" />
                          <div>
                            <span className="font-bold text-slate-800 dark:text-white block">
                              Création automatique de {clientsToCreate.length} client(s)
                            </span>
                            <span className="text-slate-500 block leading-normal">
                              Ces contacts n'existent pas encore dans votre application Spire.
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer ml-4">
                          <input
                            type="checkbox"
                            checked={createMissingClients}
                            onChange={(e) => setCreateMissingClients(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-[#d9dee3] dark:bg-[#434460]/40 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:height-4 after:h-4 after:w-4 after:transition-all peer-checked:bg-[#696cff]"></div>
                        </label>
                      </div>
                    )}

                    {/* Preview list */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] text-[#8592a3] font-bold uppercase tracking-wider block">
                        Aperçu des factures à importer ({Math.min(3, parsedInvoices.length)}{' '}
                        affichées) :
                      </span>
                      <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden text-xs">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-[#232333]/50 border-b border-slate-100 dark:border-slate-800 font-semibold text-slate-500">
                              <th className="p-2">Réf / Facture</th>
                              <th className="p-2">Client</th>
                              <th className="p-2">Date</th>
                              <th className="p-2 text-right">Total (TTC)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {parsedInvoices.slice(0, 3).map((inv, idx) => (
                              <tr
                                key={idx}
                                className="border-b border-slate-50 dark:border-slate-800/40 text-slate-600 dark:text-slate-300"
                              >
                                <td className="p-2 font-mono truncate max-w-[100px]">
                                  {inv.refId}
                                </td>
                                <td className="p-2 font-medium truncate max-w-[120px]">
                                  {inv.clientName}
                                </td>
                                <td className="p-2">{inv.date.toLocaleDateString('fr-FR')}</td>
                                <td className="p-2 text-right font-mono font-bold text-slate-800 dark:text-white">
                                  {inv.total.toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  DH
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

              {/* Footer */}
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
                    disabled={isImporting || parsedInvoices.length === 0}
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
                        <span>Importer ({parsedInvoices.length})</span>
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

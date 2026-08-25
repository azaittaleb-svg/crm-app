import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  Check,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import { collection, doc, writeBatch, getDocs, query, where } from 'firebase/firestore';

interface ExpensesXlsxModalProps {
  isOpen: boolean;
  onClose: () => void;
  ownerId: string;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

function parseExcelDate(val: any): string {
  let d = new Date();
  if (val instanceof Date) {
    d = val;
  } else {
    const numVal = Number(val);
    if (!isNaN(numVal) && typeof val !== 'boolean' && String(val).trim() !== '') {
      if (numVal > 30000 && numVal < 60000) {
        d = new Date(Math.round((numVal - 25569) * 86400 * 1000));
      }
    } else {
      const str = String(val).trim();
      if (str) {
        const ymd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
        if (ymd) {
          d = new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10));
        } else {
          const dmy = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
          if (dmy) {
            d = new Date(parseInt(dmy[3], 10), parseInt(dmy[2], 10) - 1, parseInt(dmy[1], 10));
          } else {
            const parsed = Date.parse(str);
            if (!isNaN(parsed)) d = new Date(parsed);
          }
        }
      }
    }
  }

  // Format YYYY-MM-DD
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

export const ExpensesXlsxModal: React.FC<ExpensesXlsxModalProps> = ({
  isOpen,
  onClose,
  ownerId,
  showToast,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalRows: 0,
    validRows: 0,
    errorCount: 0,
  });

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFile = e.dataTransfer.files[0];
      const ext = droppedFile.name.split('.').pop()?.toLowerCase();
      if (['xlsx', 'xls', 'csv'].includes(ext || '')) {
        setFile(droppedFile);
        analyzeFile(droppedFile);
      } else {
        showToast('Format de fichier non supporté (.xlsx, .xls, .csv)', 'error');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      analyzeFile(selectedFile);
    }
  };

  const parseSheetsData = (workbook: XLSX.WorkBook) => {
    let expensesRawData: any[][] = [];
    let templatesRawData: any[][] = [];
    let advancesRawData: any[][] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheetData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 }) as any[][];
      if (sheetData.length < 2) continue;

      const headers = (sheetData[0] || []).map((h) =>
        String(h).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      );

      const isTemplateSheet = headers.some(h => h.includes('jour') || h.includes('debut') || h.includes('fin') || h.includes('activite')) && !headers.some(h => h.includes('statut') || h.includes('periode'));
      const isExpenseSheet = headers.some(h => h.includes('statut') || h.includes('periode') || h.includes('reglement'));
      const isAdvanceSheet = headers.some(h => h.includes('ouvrier') || h.includes('personnel') || h.includes('avance') || h.includes('remboursement'));

      if (isAdvanceSheet) {
        if (advancesRawData.length === 0) {
          advancesRawData = sheetData;
        }
      } else if (isTemplateSheet) {
        if (templatesRawData.length === 0) {
          templatesRawData = sheetData;
        }
      } else if (isExpenseSheet) {
        // Prefer historique (which has more data usually) or take the first one
        if (expensesRawData.length === 0 || sheetName.toLowerCase().includes('historique')) {
          expensesRawData = sheetData;
        }
      }
    }

    // Fallback if no robust match
    if (expensesRawData.length === 0 && workbook.SheetNames.length > 0) {
      expensesRawData = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }) as any[][];
    }

    return { expensesRawData, templatesRawData, advancesRawData };
  };

  const processExpensesData = (rawData: any[][]) => {
    if (rawData.length < 2) return [];

    const headers = (rawData[0] || []).map((h) => 
      String(h).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    );
    
    let nameIdx = headers.findIndex((h) => h.includes('designation') || h.includes('nom') || h.includes('libelle') || h.includes('titre') || h.includes('expense') || h.includes('charge'));
    let amountIdx = headers.findIndex((h) => h.includes('montant') || h.includes('somme') || h.includes('amount') || h.includes('valeur'));
    let dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('jour') || h.includes('echea'));
    let periodIdx = headers.findIndex((h) => h.includes('periode') || h.includes('mois'));
    let statusIdx = headers.findIndex((h) => h.includes('statut') || h.includes('status') || h.includes('paye') || h.includes('regle'));
    let categoryIdx = headers.findIndex((h) => h.includes('cat') || h.includes('type'));
    let originIdx = headers.findIndex((h) => h.includes('origine'));

    if (nameIdx === -1) nameIdx = 0;
    if (amountIdx === -1) amountIdx = 1;
    if (dateIdx === -1) dateIdx = 2;

    const rowsToProcess = rawData.slice(1);
    const parsedRows: any[] = [];

    for (const row of rowsToProcess) {
      if (row.length === 0 || row.every((cell) => cell === undefined || cell === null || String(cell).trim() === '')) {
        continue;
      }

      const rawName = String(row[nameIdx] || '').trim();
      if (!rawName) continue;

      const rawAmount = row[amountIdx];
      const rawDate = dateIdx !== -1 ? row[dateIdx] : null;
      const rawPeriod = periodIdx !== -1 ? row[periodIdx] : null;
      const rawStatus = statusIdx !== -1 ? String(row[statusIdx] || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : '';
      const rawCategory = categoryIdx !== -1 ? String(row[categoryIdx] || '').trim() : 'Général';
      const rawOrigin = originIdx !== -1 ? String(row[originIdx] || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : 'instant';

      const amount = parseExcelNumber(rawAmount);
      const dateStr = parseExcelDate(rawDate);
      
      // Extract period, handle Excel auto-converting YYYY-MM to Date objects
      const periodStr = rawPeriod ? parseExcelDate(rawPeriod).slice(0, 7) : dateStr.slice(0, 7);

      // Avoid matching 'regl' because 'à régler' means UNPAID. Match 'pay' or 'oui' or 'p' or 'paid'
      const isPaid = rawStatus.includes('paye') || rawStatus === 'pay' || rawStatus === 'p' || rawStatus.includes('paid') || rawStatus === 'oui';
      
      const isTemplate = rawOrigin.includes('modele') || rawOrigin.includes('recurrent');

      const parsedDueDay = dateStr ? parseInt(dateStr.split('-')[2], 10) : null;
      
      parsedRows.push({
        name: rawName,
        amount,
        date: dateStr,
        monthYear: periodStr,
        status: isPaid ? 'PAID' : 'PENDING',
        category: rawCategory,
        type: 'VARIABLE',
        templateId: isTemplate ? 'import_template' : 'instant', // Mark as template to potentially link later if needed
        dueDay: isNaN(parsedDueDay as number) ? null : parsedDueDay,
      });
    }
    return parsedRows;
  };

  const processTemplatesData = (rawData: any[][]) => {
    if (rawData.length < 2) return [];

    const headers = (rawData[0] || []).map((h) => 
      String(h).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    );
    
    let nameIdx = headers.findIndex((h) => h.includes('nom') || h.includes('modele') || h.includes('charge'));
    let amountIdx = headers.findIndex((h) => h.includes('montant') || h.includes('somme') || h.includes('amount'));
    let typeIdx = headers.findIndex((h) => h.includes('nature') || h.includes('type'));
    let categoryIdx = headers.findIndex((h) => h.includes('cat'));
    let dueDayIdx = headers.findIndex((h) => h.includes('jour') || h.includes('echea'));

    if (nameIdx === -1) nameIdx = 0;
    if (amountIdx === -1) amountIdx = 1;

    const rowsToProcess = rawData.slice(1);
    const parsedRows: any[] = [];

    for (const row of rowsToProcess) {
      if (row.length === 0 || row.every((cell) => cell === undefined || cell === null || String(cell).trim() === '')) {
        continue;
      }

      const rawName = String(row[nameIdx] || '').trim();
      if (!rawName) continue;

      const rawAmount = row[amountIdx];
      const rawType = typeIdx !== -1 ? String(row[typeIdx] || '').trim().toUpperCase() : 'FIXED';
      const rawCategory = categoryIdx !== -1 ? String(row[categoryIdx] || '').trim() : 'Général';
      const rawDueDay = dueDayIdx !== -1 ? parseInt(String(row[dueDayIdx] || ''), 10) : null;

      const amount = parseExcelNumber(rawAmount);

      parsedRows.push({
        name: rawName,
        amount,
        type: rawType.includes('VARIABLE') ? 'VARIABLE' : (rawType.includes('CONS') ? 'CONSUMPTION' : 'FIXED'),
        category: rawCategory,
        dueDay: !isNaN(rawDueDay as number) && (rawDueDay as number) > 0 ? rawDueDay : null,
      });
    }
    return parsedRows;
  };

  const processAdvancesData = (rawData: any[][]) => {
    if (rawData.length < 2) return [];
    const headers = (rawData[0] || []).map((h) => 
      String(h).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    );

    let dateIdx = headers.findIndex((h) => h.includes('date'));
    let periodIdx = headers.findIndex((h) => h.includes('mois'));
    let workerIdx = headers.findIndex((h) => h.includes('ouvrier') || h.includes('personnel'));
    let typeIdx = headers.findIndex((h) => h.includes('type'));
    let amountIdx = headers.findIndex((h) => h.includes('montant') || h.includes('somme'));
    let noteIdx = headers.findIndex((h) => h.includes('note') || h.includes('comment'));

    const rowsToProcess = rawData.slice(1);
    const parsedRows: any[] = [];
    
    for (const row of rowsToProcess) {
      if (row.length === 0 || row.every((cell) => cell === undefined || cell === null || String(cell).trim() === '')) {
        continue;
      }
      const workerName = workerIdx !== -1 ? String(row[workerIdx] || '').trim() : '';
      if (!workerName) continue;

      const rawAmount = amountIdx !== -1 ? row[amountIdx] : 0;
      const amount = parseExcelNumber(rawAmount);
      
      const rawDate = dateIdx !== -1 ? row[dateIdx] : null;
      const dateStr = parseExcelDate(rawDate);
      
      const rawType = typeIdx !== -1 ? String(row[typeIdx] || '').trim().toLowerCase() : '';
      const isRepayment = rawType.includes('remboursement') || rawType.includes('repay');

      parsedRows.push({
        date: dateStr,
        moisConcerné: periodIdx !== -1 ? String(row[periodIdx] || '').trim() : '',
        workerName,
        type: isRepayment ? 'remboursement' : 'avance',
        montant: amount,
        note: noteIdx !== -1 ? String(row[noteIdx] || '').trim() : '',
      });
    }
    return parsedRows;
  };

  const analyzeFile = async (selectedFile: File) => {
    setIsParsing(true);
    setPreviewRows([]);
    setStats({ totalRows: 0, validRows: 0, errorCount: 0 });

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target?.result;
          const workbook = XLSX.read(bstr, { type: 'binary', cellDates: true });
          
          const { expensesRawData, templatesRawData, advancesRawData } = parseSheetsData(workbook);
          
          const parsedExpenses = processExpensesData(expensesRawData);
          const parsedTemplates = processTemplatesData(templatesRawData);
          const parsedAdvances = processAdvancesData(advancesRawData);

          if (parsedExpenses.length === 0 && parsedTemplates.length === 0 && parsedAdvances.length === 0) {
            showToast('Le fichier Excel est vide ou invalide', 'error');
            setIsParsing(false);
            return;
          }

          setPreviewRows([...parsedExpenses, ...parsedTemplates, ...parsedAdvances].slice(0, 5));
          setStats({
            totalRows: (expensesRawData.length > 0 ? expensesRawData.length - 1 : 0) + (templatesRawData.length > 0 ? templatesRawData.length - 1 : 0) + (advancesRawData.length > 0 ? advancesRawData.length - 1 : 0),
            validRows: parsedExpenses.length + parsedTemplates.length + parsedAdvances.length,
            errorCount: 0,
          });
          
          // Store both so we can import both
          (window as any)._parsedExpensesForImport = parsedExpenses;
          (window as any)._parsedTemplatesForImport = parsedTemplates;
          (window as any)._parsedAdvancesForImport = parsedAdvances;
          
          setIsParsing(false);
        } catch (err) {
          console.error(err);
          showToast('Erreur lors du traitement des données Excel', 'error');
          setIsParsing(false);
        }
      };

      reader.readAsBinaryString(selectedFile);
    } catch (err) {
      console.error(err);
      showToast('Impossible de lire le fichier', 'error');
      setIsParsing(false);
    }
  };

  const handleDownloadTemplate = () => {
    try {
      const templateData = [
        {
          Designation: 'Péage Autoroute Casablanca',
          Montant: 42.0,
          Date: '2026-06-02',
          Statut: 'Payé',
          Categorie: 'Transport',
        },
        {
          Designation: 'Abonnement Internet Fibre',
          Montant: 350.0,
          Date: '2026-06-05',
          Statut: 'Non Payé',
          Categorie: 'Télécom',
        },
      ];

      const worksheet = XLSX.utils.json_to_sheet(templateData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Template Dépenses');
      XLSX.writeFile(workbook, 'gabarit_import_depenses.xlsx');
      showToast('Gabarit de téléchargement généré !', 'success');
    } catch (err) {
      console.error(err);
      showToast('Erreur lors de la génération du gabarit', 'error');
    }
  };

  const handleImport = async () => {
    if (previewRows.length === 0 || !ownerId) return;
    setIsImporting(true);

    try {
      const parsedExpenses: any[] = (window as any)._parsedExpensesForImport || [];
      const parsedTemplates: any[] = (window as any)._parsedTemplatesForImport || [];
      const parsedAdvances: any[] = (window as any)._parsedAdvancesForImport || [];

      if (parsedExpenses.length === 0 && parsedTemplates.length === 0 && parsedAdvances.length === 0) {
        showToast("Aucune donnée à importer", 'error');
        setIsImporting(false);
        return;
      }

      let batch = writeBatch(db);
      let count = 0;
      let totalCount = 0;

      // 0. Clear existing data to prevent duplicates
      if (parsedExpenses.length > 0) {
        const expSnap = await getDocs(query(collection(db, 'expenses'), where('ownerId', '==', ownerId)));
        for (const d of expSnap.docs) {
          batch.delete(d.ref);
          count++;
          if (count >= 490) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
      }

      if (parsedTemplates.length > 0) {
        const tmplSnap = await getDocs(query(collection(db, 'expense_templates'), where('ownerId', '==', ownerId)));
        for (const d of tmplSnap.docs) {
          batch.delete(d.ref);
          count++;
          if (count >= 490) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
      }

      if (parsedAdvances.length > 0) {
        const advSnap = await getDocs(query(collection(db, 'staff_advances'), where('ownerId', '==', ownerId)));
        for (const d of advSnap.docs) {
          batch.delete(d.ref);
          count++;
          if (count >= 490) { await batch.commit(); batch = writeBatch(db); count = 0; }
        }
      }

      // Map to keep track of worker templates
      const templateNameMap = new Map<string, string>();
      
      // Fetch existing templates to link advances if we didn't just delete them
      if (parsedAdvances.length > 0 && parsedTemplates.length === 0) {
        const existingTemplatesSnap = await getDocs(query(collection(db, 'expense_templates'), where('ownerId', '==', ownerId)));
        existingTemplatesSnap.docs.forEach(d => {
          const data = d.data();
          const nameKey = (data.name || data.titre || '').trim().toLowerCase();
          if (nameKey) templateNameMap.set(nameKey, d.id);
        });
      }

      // 1. Import Templates
      for (const tmpl of parsedTemplates) {
        const tmplRef = doc(collection(db, 'expense_templates'));
        batch.set(tmplRef, {
          ownerId,
          name: tmpl.name,
          titre: tmpl.name,
          amount: tmpl.amount,
          montant: tmpl.amount,
          type: tmpl.type,
          category: tmpl.category,
          dueDay: tmpl.dueDay,
          active: true,
          createdAt: new Date(),
        });
        // Add to map so advances and expenses can use newly created templates
        const nameKey = (tmpl.name || '').trim().toLowerCase();
        if (nameKey && !templateNameMap.has(nameKey)) {
          templateNameMap.set(nameKey, tmplRef.id);
        }
        
        count++;
        totalCount++;

        if (count >= 490) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      // 2. Import Advances
      for (const adv of parsedAdvances) {
        const advRef = doc(collection(db, 'staff_advances'));
        const workerKey = (adv.workerName || '').trim().toLowerCase();
        
        let chargeTemplateId = templateNameMap.get(workerKey);
        
        // If worker template doesn't exist, create it on the fly!
        if (!chargeTemplateId) {
          const newTmplRef = doc(collection(db, 'expense_templates'));
          batch.set(newTmplRef, {
            ownerId,
            name: adv.workerName,
            titre: adv.workerName,
            amount: 0, // Default 0 for worker
            montant: 0,
            type: 'FIXED',
            category: 'Salaires',
            categorie: 'SALAIRE',
            dueDay: 1,
            active: true,
            createdAt: new Date(),
          });
          chargeTemplateId = newTmplRef.id;
          templateNameMap.set(workerKey, chargeTemplateId);
          count++;
          totalCount++;
        }
        
        batch.set(advRef, {
          ownerId,
          chargeTemplateId,
          type: adv.type,
          montant: adv.montant,
          date: adv.date,
          moisConcerné: adv.moisConcerné,
          note: adv.note,
          createdAt: new Date(),
        });

        count++;
        totalCount++;

        if (count >= 490) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      // 3. Import Expenses
      for (const exp of parsedExpenses) {
        const expenseRef = doc(collection(db, 'expenses'));
        const expNameKey = (exp.name || '').trim().toLowerCase();
        const mappedTemplateId = templateNameMap.get(expNameKey);
        const isImportTemplate = exp.templateId === 'import_template';
        const finalTemplateId = isImportTemplate && mappedTemplateId ? mappedTemplateId : (exp.templateId || 'instant');

        batch.set(expenseRef, {
          ownerId,
          name: exp.name,
          amount: exp.amount,
          date: exp.date,
          monthYear: exp.monthYear,
          status: exp.status,
          category: exp.category,
          type: exp.type, // 'VARIABLE'
          templateId: finalTemplateId,
          dueDay: exp.dueDay || null,
          createdAt: new Date(),
          deleted: false,
        });

        count++;
        totalCount++;

        if (count >= 490) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
      
      // Cleanup
      delete (window as any)._parsedExpensesForImport;
      delete (window as any)._parsedTemplatesForImport;
      delete (window as any)._parsedAdvancesForImport;

      showToast(`Importation réussie de ${totalCount} éléments !`, 'success');
      window.dispatchEvent(new CustomEvent('trigger-expense-sync'));
      onClose();
    } catch (err) {
      console.error(err);
      showToast("Une erreur s'est produite pendant l'importation.", 'error');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white dark:bg-[#2b2c40] rounded-xl border border-slate-200 dark:border-slate-700 max-w-lg w-full overflow-hidden flex flex-col shadow-2xl text-left"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#232333]/45">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="text-[#ff3e1d] w-5 h-5" />
                <h3 className="font-bold text-slate-800 dark:text-white text-md">
                  Importer des Dépenses / Charges
                </h3>
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-[#ff3e1d] p-1.5 rounded-full transition-colors hover:bg-slate-100 dark:hover:bg-[#323450]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-5 overflow-y-auto max-h-[75vh] custom-scrollbar">
              <div className="text-xs text-slate-500 dark:text-[#a3a4cc] leading-relaxed">
                Importez vos charges et dépenses courantes en lot à partir d'un fichier Excel ou CSV.
              </div>

              {/* Drag n Drop block */}
              {!file ? (
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-205 dark:border-slate-700 rounded-xl py-8 px-4 text-center cursor-pointer hover:bg-slate-50 dark:hover:bg-[#232333]/30 hover:border-[#ff3e1d] dark:hover:border-[#ff3e1d] transition-all group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                  />
                  <Upload className="w-10 h-10 text-slate-400 group-hover:text-[#ff3e1d] mx-auto mb-3 transition-colors" />
                  <p className="text-sm font-bold text-slate-700 dark:text-white">
                    Glissez-déposez votre fichier ici ou cliquez pour parcourir
                  </p>
                  <p className="text-xs text-slate-400 dark:text-[#707194] mt-1">
                    Fichiers acceptés : Excel (.xlsx, .xls) ou CSV
                  </p>
                </div>
              ) : (
                <div className="bg-slate-50 dark:bg-[#232333]/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-rose-50 dark:bg-[#323249] rounded-lg flex items-center justify-center text-[#ff3e1d]">
                      <FileSpreadsheet size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-white max-w-[200px] truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-slate-400 dark:text-[#707194]">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setFile(null);
                      setPreviewRows([]);
                    }}
                    className="text-slate-400 hover:text-[#ff3e1d] font-bold text-xs uppercase"
                  >
                    Effacer
                  </button>
                </div>
              )}

              {/* Parsing status / Preview */}
              {isParsing && (
                <div className="flex items-center gap-2 text-xs font-bold text-[#ff3e1d]">
                  <Loader2 className="animate-spin w-4 h-4" />
                  <span>Analyse du document en cours...</span>
                </div>
              )}

              {!isParsing && file && stats.validRows > 0 && (
                <div className="space-y-3.5 pt-2">
                  <div className="grid grid-cols-2 gap-4 bg-[#f5f5f9] dark:bg-[#232333]/30 rounded-lg p-3 text-center">
                    <div>
                      <span className="block text-lg font-bold text-slate-800 dark:text-white font-mono">
                        {stats.validRows}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase">
                        Dépenses Valides
                      </span>
                    </div>
                    <div>
                      <span className="block text-lg font-bold text-[#ff3e1d] font-mono">
                        {stats.errorCount}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase">
                        Ignorées / Erreurs
                      </span>
                    </div>
                  </div>

                  {previewRows.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                        Aperçu des 5 premières lignes :
                      </p>
                      <div className="border border-slate-150 dark:border-slate-800 rounded-lg overflow-hidden text-xs">
                        <table className="w-full text-left">
                          <thead className="bg-slate-50 dark:bg-[#232333]/65 border-b border-slate-150 dark:border-slate-800">
                            <tr>
                              <th className="px-3 py-1.5 text-slate-500 font-bold">Désignation</th>
                              <th className="px-3 py-1.5 text-slate-500 font-bold text-right">Montant</th>
                              <th className="px-3 py-1.5 text-slate-500 font-bold text-center">Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-[#2b2c40]">
                            {previewRows.map((row, idx) => (
                              <tr key={idx}>
                                <td className="px-3 py-1.5 font-medium text-slate-700 dark:text-[#dbdade]">
                                  {row.name}
                                </td>
                                <td className="px-3 py-1.5 text-right font-semibold text-slate-800 dark:text-white font-mono">
                                  {row.amount.toFixed(2)} DH
                                </td>
                                <td className="px-3 py-1.5 text-center text-slate-500 font-mono">
                                  {row.date}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#232333]/45 flex justify-between items-center">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="text-xs font-bold text-[#ff3e1d] hover:underline flex items-center gap-1"
              >
                <Download size={13} /> Gabarit d'importation
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 bg-slate-50 hover:bg-slate-100 dark:bg-[#323450] dark:hover:bg-[#3d4062] rounded-lg text-slate-700 dark:text-[#dbdade] font-bold text-xs uppercase"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={!file || isParsing || isImporting || stats.validRows === 0}
                  className="px-5 py-2 bg-[#ff3e1d] hover:brightness-105 disabled:opacity-40 disabled:hover:brightness-100 text-white rounded-lg font-bold text-xs uppercase shadow-sm flex items-center gap-1.5"
                >
                  {isImporting ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Importation...</span>
                    </>
                  ) : (
                    <>
                      <Check size={13} />
                      <span>Importer</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Upload,
  FileSpreadsheet,
  Download,
  Check,
  Loader2,
  Heart,
  Coins,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';

interface ZakatXlsxModalProps {
  isOpen: boolean;
  onClose: () => void;
  ownerId: string;
  existingTemplates: any[];
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
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseExcelNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (val === undefined || val === null) return 0;
  let str = String(val).trim().replace(/[\s\u00A0\u202F]/g, '');
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

export const ZakatXlsxModal: React.FC<ZakatXlsxModalProps> = ({
  isOpen,
  onClose,
  ownerId,
  existingTemplates,
  showToast,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsedEnvelopes, setParsedEnvelopes] = useState<any[]>([]);
  const [parsedPayouts, setParsedPayouts] = useState<any[]>([]);
  const [previewTab, setPreviewTab] = useState<'envelopes' | 'payouts'>('payouts');
  const [stats, setStats] = useState({
    validEnvelopes: 0,
    validPayouts: 0,
    errorCount: 0,
  });

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

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

  const analyzeFile = async (selectedFile: File) => {
    setIsParsing(true);
    setParsedEnvelopes([]);
    setParsedPayouts([]);
    setStats({ validEnvelopes: 0, validPayouts: 0, errorCount: 0 });

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target?.result;
          const workbook = XLSX.read(bstr, { type: 'binary', cellDates: true });
          
          let envelopes: any[] = [];
          let payouts: any[] = [];
          let errorsCount = 0;

          // Parse all sheets
          for (const sheetName of workbook.SheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
            if (rawData.length < 2) continue;

            const headers = (rawData[0] || []).map((h) => String(h).trim().toLowerCase());
            const rowsToProcess = rawData.slice(1);
            
            // Determine if sheet is for Envelopes or Payouts based on headers or sheet name
            const isEnvelopeSheet = sheetName.toLowerCase().includes('enveloppe') || 
                                    headers.some(h => h.includes('budget') || h.includes('cible'));
            const isPayoutSheet = sheetName.toLowerCase().includes('versement') || 
                                  sheetName.toLowerCase().includes('paiement') || 
                                  headers.some(h => h.includes('bénéficiaire') || h.includes('beneficiaire') || h.includes('date du versement'));

            // Default to parsing both if we can't tell, or let's be smart
            let type: 'envelope' | 'payout' = 'envelope';
            if (isPayoutSheet && !isEnvelopeSheet) type = 'payout';
            else if (isEnvelopeSheet && !isPayoutSheet) type = 'envelope';
            else {
               // Mixed or unknown, guess based on headers
               if (headers.some(h => h.includes('date'))) type = 'payout';
            }

            if (type === 'envelope') {
              let nameIdx = headers.findIndex((h) => h.includes('enveloppe') || h.includes('designation') || h.includes('nom') || h.includes('libelle') || h.includes('budget'));
              let amountIdx = headers.findIndex((h) => h.includes('montant') || h.includes('somme') || h.includes('valeur') || h.includes('cible'));
              let dayIdx = headers.findIndex((h) => h.includes('jour') || h.includes('rappel') || h.includes('echeance') || h.includes('statut'));

              if (nameIdx === -1) nameIdx = 0;
              if (amountIdx === -1) amountIdx = 1;

              for (const row of rowsToProcess) {
                if (row.length === 0 || row.every((cell) => cell === undefined || cell === null || String(cell).trim() === '')) continue;
                
                const rawName = String(row[nameIdx] || '').trim();
                const rawAmount = row[amountIdx];
                const rawDay = dayIdx !== -1 ? row[dayIdx] : null;

                if (!rawName || rawName === 'Aucune enveloppe') continue; // skip dummy

                const amount = parseExcelNumber(rawAmount);
                const dueDay = rawDay !== null && !isNaN(Number(rawDay)) ? Math.min(31, Math.max(1, Number(rawDay))) : null;

                envelopes.push({
                  name: rawName,
                  amount,
                  dueDay,
                  category: 'Zakat',
                });
              }
            } else {
              let nameIdx = headers.findIndex((h) => h.includes('enveloppe') || h.includes('nom') || h.includes('source'));
              let benefIdx = headers.findIndex((h) => h.includes('bénéficiaire') || h.includes('beneficiaire') || h.includes('titre'));
              let amountIdx = headers.findIndex((h) => h.includes('montant') || h.includes('somme') || (h.includes('verse') && !h.includes('versement')) || h.includes('distribué'));
              let dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('jour') || h.includes('versement'));
              let notesIdx = headers.findIndex((h) => h.includes('note') || h.includes('remarque') || h.includes('commentaire') || h.includes('objet'));
              let hideIdx = headers.findIndex((h) => h.includes('confidentiel') || h.includes('masqué'));

              if (benefIdx === -1) benefIdx = 1;
              if (amountIdx === -1) amountIdx = 2;
              if (nameIdx === -1) nameIdx = 3;
              if (dateIdx === -1) dateIdx = 0;

              for (const row of rowsToProcess) {
                if (row.length === 0 || row.every((cell) => cell === undefined || cell === null || String(cell).trim() === '')) continue;

                const rawAmount = row[amountIdx];
                const amount = parseExcelNumber(rawAmount);
                if (amount === 0) continue; // Skip completely empty placeholder rows

                let benefName = String(row[benefIdx] || '').trim();
                if (benefName === 'Aucun versement enregistré') continue; // Skip dummy

                if (!benefName) {
                  benefName = '-';
                }

                const envName = String(row[nameIdx] || '').trim();
                const rawDate = dateIdx !== -1 ? row[dateIdx] : null;
                const rawNotes = notesIdx !== -1 ? String(row[notesIdx] || '') : '';
                const isHidden = hideIdx !== -1 ? String(row[hideIdx] || '').toLowerCase().includes('masqu') : false;

                const dateStr = parseExcelDate(rawDate);

                payouts.push({
                  titre: benefName,
                  templateName: envName,
                  montant: amount,
                  date: dateStr,
                  note: rawNotes,
                  hide: isHidden,
                });
              }
            }
          }

          if (envelopes.length === 0 && payouts.length === 0) {
            showToast('Le fichier Excel ne contient aucune donnée valide', 'error');
            setIsParsing(false);
            return;
          }

          setParsedEnvelopes(envelopes);
          setParsedPayouts(payouts);
          setStats({
            validEnvelopes: envelopes.length,
            validPayouts: payouts.length,
            errorCount: errorsCount,
          });
          if (payouts.length > 0) {
            setPreviewTab('payouts');
          } else if (envelopes.length > 0) {
            setPreviewTab('envelopes');
          }
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
      const workbook = XLSX.utils.book_new();

      const payoutsData = [
        {
          'Date du versement': '2026-06-01',
          'Bénéficiaire / Titre': 'Famille nécessiteuse 1',
          'Montant Distribué (DH)': 1500,
          'Enveloppe Source': 'Zakat Al Fitr',
          'Notes explicatives': 'Colis alimentaire',
        }
      ];
      const payoutsWorksheet = XLSX.utils.json_to_sheet(payoutsData);
      XLSX.utils.book_append_sheet(workbook, payoutsWorksheet, 'Détail des Versements');

      const envelopesData = [
        {
          'Nom de l\'Enveloppe': 'Zakat Al Fitr',
          'Montant Budgétisé (DH)': 5000,
          'Catégorie': 'Zakat',
        }
      ];
      const envelopesWorksheet = XLSX.utils.json_to_sheet(envelopesData);
      XLSX.utils.book_append_sheet(workbook, envelopesWorksheet, 'Enveloppes de Zakat');

      XLSX.writeFile(workbook, 'gabarit_import_zakat_complet.xlsx');
      showToast('Gabarit de téléchargement généré !', 'success');
    } catch (err) {
      console.error(err);
      showToast('Erreur lors de la génération du gabarit', 'error');
    }
  };

  const handleImport = async () => {
    if ((parsedEnvelopes.length === 0 && parsedPayouts.length === 0) || !ownerId) return;

    setIsImporting(true);
    try {
      const batch = writeBatch(db);
      const newTemplatesMap = new Map<string, string>();
      
      // Existing templates mapping
      existingTemplates.forEach((t) => newTemplatesMap.set(t.name.trim().toLowerCase(), t.id));

      // 1. Create Envelopes
      for (const env of parsedEnvelopes) {
        const lowerName = env.name.toLowerCase();
        if (!newTemplatesMap.has(lowerName)) {
          const templateRef = doc(collection(db, 'expense_templates'));
          const payload: any = {
            ownerId,
            name: env.name,
            amount: env.amount,
            category: 'Zakat',
            type: 'fixed',
            isActive: true,
            createdAt: new Date(),
          };
          if (env.dueDay !== null) payload.dueDay = env.dueDay;
          batch.set(templateRef, payload);
          newTemplatesMap.set(lowerName, templateRef.id); // Add to map so payouts can link to it
        }
      }

      // 2. Create Payouts
      for (const payout of parsedPayouts) {
        const envLowerName = (payout.templateName || '').toLowerCase();
        let templateId = newTemplatesMap.get(envLowerName);
        
        // Auto-create envelope if missing
        if (!templateId && envLowerName && envLowerName !== '-') {
          const templateRef = doc(collection(db, 'expense_templates'));
          batch.set(templateRef, {
            ownerId,
            name: payout.templateName,
            amount: 0, // 0 budget as placeholder
            category: 'Zakat',
            type: 'fixed',
            isActive: true,
            createdAt: new Date(),
          });
          templateId = templateRef.id;
          newTemplatesMap.set(envLowerName, templateId);
        }

        const payoutRef = doc(collection(db, 'zakat_payouts'));
        batch.set(payoutRef, {
          ownerId,
          templateId: templateId || '',
          titre: payout.titre,
          montant: payout.montant,
          date: payout.date,
          note: payout.note,
          hide: payout.hide || false,
          createdAt: new Date().toISOString(),
        });
      }

      await batch.commit();
      
      let msg = '';
      if (parsedEnvelopes.length > 0) msg += `${parsedEnvelopes.length} enveloppes `;
      if (parsedPayouts.length > 0) msg += `${msg ? 'et ' : ''}${parsedPayouts.length} versements `;
      showToast(`Importation réussie de ${msg}!`, 'success');
      
      setFile(null);
      setParsedEnvelopes([]);
      setParsedPayouts([]);
      onClose();
    } catch (err) {
      console.error(err);
      showToast('Erreur lors de la sauvegarde dans la base de données', 'error');
    } finally {
      setIsImporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-transparent backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-xl bg-white dark:bg-[#2b2c40] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-md font-bold text-slate-800 dark:text-white flex items-center gap-2">
                <Heart className="w-5 h-5 text-[#ffab00]" />
                Importer Données Zakat
              </h2>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto custom-scrollbar">
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                Importez vos enveloppes cibles et l'historique de vos versements de Zakat en un seul fichier. Les enveloppes manquantes seront créées automatiquement.
              </p>

              {!file ? (
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:bg-slate-50 dark:hover:bg-[#232333]/50 transition-colors group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                  />
                  <Upload className="w-10 h-10 text-slate-400 group-hover:text-[#ffab00] mx-auto mb-3 transition-colors" />
                  <p className="text-sm font-bold text-slate-700 dark:text-white">
                    Glissez-déposez votre fichier ici ou cliquez pour parcourir
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Fichiers acceptés : Excel (.xlsx, .xls) avec 2 feuilles (Enveloppes et Versements)
                  </p>
                </div>
              ) : (
                <div className="bg-slate-50 dark:bg-[#232333]/40 border border-slate-200 dark:border-slate-700 rounded-xl p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-amber-50 dark:bg-[#323249] rounded-lg flex items-center justify-center text-[#ffab00]">
                      <FileSpreadsheet size={20} />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-white max-w-[200px] truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setFile(null);
                      setParsedEnvelopes([]);
                      setParsedPayouts([]);
                    }}
                    className="text-slate-400 hover:text-[#ff3e1d] font-bold text-xs uppercase"
                  >
                    Effacer
                  </button>
                </div>
              )}

              {/* Parsing status / Preview */}
              {isParsing && (
                <div className="flex items-center gap-2 text-xs font-bold text-[#ffab00] mt-4">
                  <Loader2 className="animate-spin w-4 h-4" />
                  <span>Analyse du document en cours...</span>
                </div>
              )}

              {!isParsing && file && (stats.validEnvelopes > 0 || stats.validPayouts > 0) && (
                <div className="space-y-4 pt-4">
                  <div className="grid grid-cols-2 gap-4 bg-[#f5f5f9] dark:bg-[#232333]/30 rounded-lg p-3 text-center">
                    <div>
                      <span className="block text-xl font-black text-slate-800 dark:text-white font-mono">
                        {stats.validEnvelopes}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        Enveloppes Trouvées
                      </span>
                    </div>
                    <div>
                      <span className="block text-xl font-black text-slate-800 dark:text-white font-mono">
                        {stats.validPayouts}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                        Versements Trouvés
                      </span>
                    </div>
                  </div>

                  {/* Selector for Preview */}
                  <div className="space-y-3 pt-2">
                    <div className="flex border-b border-slate-150 dark:border-slate-800">
                      {stats.validPayouts > 0 && (
                        <button
                          type="button"
                          onClick={() => setPreviewTab('payouts')}
                          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                            previewTab === 'payouts'
                              ? 'border-[#ffab00] text-[#ffab00]'
                              : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                          }`}
                        >
                          Détail des Versements ({stats.validPayouts})
                        </button>
                      )}
                      {stats.validEnvelopes > 0 && (
                        <button
                          type="button"
                          onClick={() => setPreviewTab('envelopes')}
                          className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-all ${
                            previewTab === 'envelopes'
                              ? 'border-[#ffab00] text-[#ffab00]'
                              : 'border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                          }`}
                        >
                          Enveloppes de Zakat ({stats.validEnvelopes})
                        </button>
                      )}
                    </div>

                    <div className="border border-slate-200/60 dark:border-slate-800 rounded-lg overflow-hidden bg-white dark:bg-[#2b2c40]">
                      <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-100/70 dark:bg-[#232333]/65 border-b border-slate-200/60 dark:border-slate-800">
                          {previewTab === 'payouts' ? (
                            <tr>
                              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Bénéficiaire / Titre</th>
                              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right">Montant</th>
                              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Enveloppe Source</th>
                              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center">Date</th>
                            </tr>
                          ) : (
                            <tr>
                              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Nom de l'Enveloppe</th>
                              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-right">Montant Budgétisé</th>
                              <th className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 text-center">Jour Rappel</th>
                            </tr>
                          )}
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {previewTab === 'payouts' ? (
                            parsedPayouts.slice(0, 5).map((row, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-[#232333]/30">
                                <td className="px-4 py-2 text-xs text-slate-700 dark:text-[#dbdade] font-medium truncate max-w-[150px]">
                                  {row.titre}
                                </td>
                                <td className="px-4 py-2 text-right font-mono font-semibold text-slate-800 dark:text-white text-xs whitespace-nowrap">
                                  {row.montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
                                </td>
                                <td className="px-4 py-2 text-xs text-slate-500 dark:text-[#a3a4cc] truncate max-w-[120px]">
                                  {row.templateName || '---'}
                                </td>
                                <td className="px-4 py-2 text-center text-slate-500 dark:text-[#a3a4cc] font-mono text-xs">
                                  {row.date}
                                </td>
                              </tr>
                            ))
                          ) : (
                            parsedEnvelopes.slice(0, 5).map((row, idx) => (
                              <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-[#232333]/30">
                                <td className="px-4 py-2 text-xs text-slate-700 dark:text-[#dbdade] font-medium truncate max-w-[200px]">
                                  {row.name}
                                </td>
                                <td className="px-4 py-2 text-right font-mono font-semibold text-slate-800 dark:text-white text-xs whitespace-nowrap">
                                  {row.amount.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
                                </td>
                                <td className="px-4 py-2 text-center text-slate-500 dark:text-[#a3a4cc] font-mono text-xs">
                                  {row.dueDay || '---'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                      {(previewTab === 'payouts' ? parsedPayouts.length : parsedEnvelopes.length) > 5 && (
                        <div className="bg-slate-50 dark:bg-[#232333]/40 px-4 py-1.5 border-t border-slate-100 dark:border-slate-800 text-center text-[10px] text-slate-400 font-bold uppercase">
                          + {(previewTab === 'payouts' ? parsedPayouts.length : parsedEnvelopes.length) - 5} lignes supplémentaires
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-[#232333]/45 flex justify-between items-center">
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="text-xs font-bold text-[#ffab00] hover:underline flex items-center gap-1"
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
                  disabled={!file || isParsing || isImporting || (stats.validEnvelopes === 0 && stats.validPayouts === 0)}
                  className="px-5 py-2 bg-[#ffab00] hover:brightness-105 disabled:opacity-40 disabled:hover:brightness-100 text-white rounded-lg font-bold text-xs uppercase shadow-sm flex items-center gap-1.5"
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

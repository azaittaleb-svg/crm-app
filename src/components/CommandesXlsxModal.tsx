import React, { useState, useRef } from 'react';
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
  HelpCircle,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import { useNotification } from '../context/NotificationContext';
import {
  collection,
  doc,
  writeBatch,
  getDocs,
  query,
  where,
  addDoc,
} from 'firebase/firestore';

interface CommandesXlsxModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingClients: any[];
  ownerId: string;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
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

export const CommandesXlsxModal: React.FC<CommandesXlsxModalProps> = ({
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

  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalRows: 0,
    validRows: 0,
    newClientsCount: 0,
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

  const analyzeFile = async (selectedFile: File) => {
    setIsParsing(true);
    setPreviewRows([]);
    setStats({ totalRows: 0, validRows: 0, newClientsCount: 0, errorCount: 0 });

    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target?.result;
          const workbook = XLSX.read(bstr, { type: 'binary', cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          if (rawData.length < 2) {
            showToast('Le fichier Excel est vide ou invalide', 'error');
            setIsParsing(false);
            return;
          }

          const headers = (rawData[0] || []).map((h) => String(h).trim().toLowerCase());
          
          let clientIdx = headers.findIndex((h) => h.includes('client'));
          let totalIdx = headers.findIndex((h) => h.includes('total') || h.includes('montant') || h.includes('somme'));
          let paidIdx = headers.findIndex((h) => h.includes('pay') || h.includes('regle'));
          let dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('jour'));
          let descIdx = headers.findIndex((h) => h.includes('desc') || h.includes('objet') || h.includes('libelle') || h.includes('designation'));
          let refIdx = headers.findIndex((h) => h.includes('ref'));

          if (clientIdx === -1) clientIdx = 0;
          if (totalIdx === -1) totalIdx = 1;
          if (dateIdx === -1) dateIdx = 2;

          const rowsToProcess = rawData.slice(1);
          const parsedRows: any[] = [];
          let validCount = 0;
          let errorsCount = 0;
          const newClients = new Set<string>();

          for (const row of rowsToProcess) {
            if (row.length === 0 || row.every((cell) => cell === undefined || cell === null || String(cell).trim() === '')) {
              continue;
            }

            const rawClientName = String(row[clientIdx] || '').trim();
            const rawTotal = row[totalIdx];
            const rawPaid = paidIdx !== -1 ? row[paidIdx] : null;
            const rawDate = dateIdx !== -1 ? row[dateIdx] : null;
            const rawDesc = descIdx !== -1 ? String(row[descIdx] || '') : '';
            const rawRef = refIdx !== -1 ? String(row[refIdx] || '') : '';

            if (!rawClientName) {
              errorsCount++;
              continue;
            }

            const total = parseExcelNumber(rawTotal);
            const paid = parseExcelNumber(rawPaid);
            const date = parseExcelDate(rawDate);

            // Check if client exists
            const clientMatch = existingClients.find(
              (c) => c.name.trim().toLowerCase() === rawClientName.toLowerCase()
            );

            if (!clientMatch) {
              newClients.add(rawClientName);
            }

            parsedRows.push({
              clientName: rawClientName,
              clientId: clientMatch ? clientMatch.id : null,
              total,
              amountPaid: paid,
              date,
              description: rawDesc,
              refId: rawRef,
              status: paid >= total ? 'Payé' : paid > 0 ? 'Partiel' : 'À crédit',
            });

            validCount++;
          }

          setPreviewRows(parsedRows.slice(0, 5));
          setStats({
            totalRows: rowsToProcess.length,
            validRows: validCount,
            newClientsCount: newClients.size,
            errorCount: errorsCount,
          });
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
          Client: 'Client Exemple 1',
          Total: 1500.0,
          'Montant Paye': 1000.0,
          Date: '2026-06-15',
          Description: 'Commande de marchandises standards',
          Reference: 'C00123',
        },
        {
          Client: 'Client Exemple 2',
          Total: 3400.0,
          'Montant Paye': 3400.0,
          Date: '2026-06-16',
          Description: 'Prestation ou lot divers',
          Reference: '',
        },
      ];

      const worksheet = XLSX.utils.json_to_sheet(templateData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Template Commandes');
      XLSX.writeFile(workbook, 'gabarit_import_commandes.xlsx');
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
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const bstr = evt.target?.result;
          const workbook = XLSX.read(bstr, { type: 'binary', cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

          const headers = (rawData[0] || []).map((h) => String(h).trim().toLowerCase());
          
          let clientIdx = headers.findIndex((h) => h.includes('client'));
          let totalIdx = headers.findIndex((h) => h.includes('total') || h.includes('montant') || h.includes('somme'));
          let paidIdx = headers.findIndex((h) => h.includes('pay') || h.includes('regle'));
          let dateIdx = headers.findIndex((h) => h.includes('date') || h.includes('jour'));
          let descIdx = headers.findIndex((h) => h.includes('desc') || h.includes('objet') || h.includes('libelle') || h.includes('designation'));
          let refIdx = headers.findIndex((h) => h.includes('ref'));

          if (clientIdx === -1) clientIdx = 0;
          if (totalIdx === -1) totalIdx = 1;
          if (dateIdx === -1) dateIdx = 2;

          const rowsToProcess = rawData.slice(1);
          const batch = writeBatch(db);
          
          // Temporary dictionary to hold freshly created client IDs in this session
          const createdClientsMap = new Map<string, string>();

          for (const row of rowsToProcess) {
            if (row.length === 0 || row.every((cell) => cell === undefined || cell === null || String(cell).trim() === '')) {
              continue;
            }

            const rawClientName = String(row[clientIdx] || '').trim();
            if (!rawClientName) continue;

            const total = parseExcelNumber(row[totalIdx]);
            const paid = paidIdx !== -1 ? parseExcelNumber(row[paidIdx]) : 0;
            const date = dateIdx !== -1 ? parseExcelDate(row[dateIdx]) : new Date();
            const desc = descIdx !== -1 ? String(row[descIdx] || '') : '';
            const ref = refIdx !== -1 ? String(row[refIdx] || '') : '';

            let clientMatch = existingClients.find(
              (c) => c.name.trim().toLowerCase() === rawClientName.toLowerCase()
            );

            let finalClientId = clientMatch ? clientMatch.id : createdClientsMap.get(rawClientName.toLowerCase());

            if (!finalClientId) {
              if (createMissingClients) {
                // Instantly generate a new client document ID
                const newClientRef = doc(collection(db, 'clients'));
                finalClientId = newClientRef.id;
                
                batch.set(newClientRef, {
                  name: rawClientName,
                  ownerId,
                  phone: '---',
                  email: '',
                  city: '---',
                  ice: '',
                  balance: 0,
                  createdAt: new Date(),
                });
                
                createdClientsMap.set(rawClientName.toLowerCase(), finalClientId);
              } else {
                continue; // Skip because client is missing
              }
            }

            // Create command purchase under clients/{clientId}/purchases/
            const purchaseRef = doc(collection(db, 'clients', finalClientId, 'purchases'));
            const finalTaxRate = 20;
            const calculatedSubtotal = total / (1 + finalTaxRate / 100);
            const calculatedTaxAmount = total - calculatedSubtotal;
            const finalPaymentStatus = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'credit';

            const purchaseItems = [
              {
                id: '1',
                description: desc || 'Commande de marchandises',
                quantity: 1,
                price: calculatedSubtotal,
                taxRate: finalTaxRate,
                type: 'product',
              }
            ];

            batch.set(purchaseRef, {
              ownerId,
              clientId: finalClientId,
              type: 'commande',
              items: purchaseItems,
              price: calculatedSubtotal,
              quantity: 1,
              subtotal: calculatedSubtotal,
              taxAmount: calculatedTaxAmount,
              taxRate: finalTaxRate,
              total,
              amountPaid: paid,
              paymentStatus: finalPaymentStatus,
              date,
              description: desc || 'Commande de marchandises',
              refId: ref || null,
              createdAt: new Date(),
            });
          }

          await batch.commit();
          showToast(`Importation réussie de ${stats.validRows} commandes !`, 'success');
          onClose();
        } catch (err) {
          console.error(err);
          showToast("Une erreur s'est produite pendant l'importation.", 'error');
        } finally {
          setIsImporting(false);
        }
      };
      reader.readAsBinaryString(file!);
    } catch (err) {
      console.error(err);
      showToast('Impossible de lire le fichier', 'error');
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
                <FileSpreadsheet className="text-[#696cff] w-5 h-5" />
                <h3 className="font-bold text-slate-800 dark:text-white text-md">
                  Importer des Commandes Client
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
                Importez vos commandes au format Excel (.xlsx) ou CSV. Si le nom du client n'existe pas, il sera automatiquement créé pour vous.
              </div>

              {/* Drag n Drop block */}
              {!file ? (
                <div
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-205 dark:border-slate-700 rounded-xl py-8 px-4 text-center cursor-pointer hover:bg-slate-50 dark:hover:bg-[#232333]/30 hover:border-[#696cff] dark:hover:border-[#696cff] transition-all group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                  />
                  <Upload className="w-10 h-10 text-slate-400 group-hover:text-[#696cff] mx-auto mb-3 transition-colors" />
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
                    <div className="w-10 h-10 bg-[#e7e7ff] dark:bg-[#323249] rounded-lg flex items-center justify-center text-[#696cff]">
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

              {/* Options */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="createClients"
                  checked={createMissingClients}
                  onChange={(e) => setCreateMissingClients(e.target.checked)}
                  className="rounded text-[#696cff] focus:ring-[#696cff] cursor-pointer"
                />
                <label
                  htmlFor="createClients"
                  className="text-xs font-bold text-slate-700 dark:text-[#dbdade] cursor-pointer"
                >
                  Créer automatiquement les clients inexistants
                </label>
              </div>

              {/* Parsing status / Preview */}
              {isParsing && (
                <div className="flex items-center gap-2 text-xs font-bold text-[#696cff]">
                  <Loader2 className="animate-spin w-4 h-4" />
                  <span>Analyse du document en cours...</span>
                </div>
              )}

              {!isParsing && file && stats.validRows > 0 && (
                <div className="space-y-3.5 pt-2">
                  <div className="grid grid-cols-3 gap-2 bg-[#f5f5f9] dark:bg-[#232333]/30 rounded-lg p-3 text-center">
                    <div>
                      <span className="block text-lg font-bold text-slate-800 dark:text-white font-mono">
                        {stats.validRows}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase">
                        Commandes
                      </span>
                    </div>
                    <div>
                      <span className="block text-lg font-bold text-emerald-600 dark:text-[#71dd37] font-mono">
                        {stats.newClientsCount}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase">
                        Nouv. Clients
                      </span>
                    </div>
                    <div>
                      <span className="block text-lg font-bold text-[#ff3e1d] font-mono">
                        {stats.errorCount}
                      </span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase">
                        Ignorés / Erreurs
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
                              <th className="px-3 py-1.5 text-slate-500 font-bold">Client</th>
                              <th className="px-3 py-1.5 text-slate-500 font-bold text-right">Total</th>
                              <th className="px-3 py-1.5 text-slate-500 font-bold text-center">Statut</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-[#2b2c40]">
                            {previewRows.map((row, idx) => (
                              <tr key={idx}>
                                <td className="px-3 py-1.5 font-medium text-slate-700 dark:text-[#dbdade]">
                                  {row.clientName}
                                </td>
                                <td className="px-3 py-1.5 text-right font-semibold text-slate-800 dark:text-white font-mono">
                                  {row.total.toFixed(2)} DH
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  <span className={`text-[10px] font-bold ${
                                    row.status === 'Payé' ? 'text-emerald-500' : row.status === 'Partiel' ? 'text-orange-400' : 'text-[#ff3e1d]'
                                  }`}>
                                    {row.status}
                                  </span>
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
                className="text-xs font-bold text-[#696cff] hover:underline flex items-center gap-1"
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
                  className="px-5 py-2 bg-[#696cff] hover:bg-[#5f61e6] disabled:opacity-40 disabled:hover:bg-[#696cff] text-white rounded-lg font-bold text-xs uppercase shadow-sm flex items-center gap-1.5"
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

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
  Coffee,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { db } from '../lib/firebase';
import { collection, doc, writeBatch } from 'firebase/firestore';

interface SupplierXlsxModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingSuppliers: any[];
  ownerId: string;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

function detectCsvDelimiter(line: string): ',' | ';' | '\t' {
  let commaCount = 0;
  let semicolonCount = 0;
  let tabCount = 0;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === ',') commaCount++;
      else if (char === ';') semicolonCount++;
      else if (char === '\t') tabCount++;
    }
  }

  if (semicolonCount > commaCount && semicolonCount > tabCount) {
    return ';';
  }
  if (tabCount > commaCount && tabCount > semicolonCount) {
    return '\t';
  }
  return ',';
}

function parseCsvLine(line: string, delimiter: string = ','): string[] {
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
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

export const SupplierXlsxModal: React.FC<SupplierXlsxModalProps> = ({
  isOpen,
  onClose,
  existingSuppliers,
  ownerId,
  showToast,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Stats
  const [totalRows, setTotalRows] = useState(0);
  const [validRows, setValidRows] = useState<any[]>([]);
  const [duplicateNamesCount, setDuplicateNamesCount] = useState(0);

  const resetState = () => {
    setFile(null);
    setParsedData([]);
    setTotalRows(0);
    setValidRows([]);
    setDuplicateNamesCount(0);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const downloadImportTemplate = () => {
    const templateData = [
      {
        Nom: 'SOCIETE MAGHREB DISTRIB',
        Téléphone: '0522112233',
        Email: 'distribution@maghreb.ma',
        'Adresse Ligne 1': '45 Zone Industrielle Ain Sebaa',
        'Adresse Ligne 2': 'Bâtiment B',
        Ville: 'Casablanca',
        ICE: '12345678901234',
        Notes: 'Fournisseur principal emballage',
      },
      {
        Nom: 'GLOBAL TRADING S.A.',
        Téléphone: '0661998877',
        Email: 'info@globaltrading.co.ma',
        'Adresse Ligne 1': 'Avenue Hassan II',
        'Adresse Ligne 2': '',
        Ville: 'Rabat',
        ICE: '98765432101234',
        Notes: 'Délai de paiement 30 jours',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Fournisseurs Modèle');

    // Auto-adjust column widths
    const maxLens = Object.keys(templateData[0]).map((key) => Math.max(key.length, 25));
    ws['!cols'] = maxLens.map((w) => ({ wch: w }));

    XLSX.writeFile(wb, 'modele_import_fournisseurs.xlsx');
    showToast('Le modèle Excel a été téléchargé.', 'success');
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
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
    const allowedExtensions = ['xlsx', 'xls', 'csv'];
    const ext = selectedFile.name.split('.').pop()?.toLowerCase();

    if (!ext || !allowedExtensions.includes(ext)) {
      showToast('Veuillez sélectionner un fichier Excel (.xlsx ou .xls) ou CSV.', 'error');
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];

        const rawRows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        if (rawRows.length === 0) {
          showToast('Le fichier est vide.', 'error');
          setIsParsing(false);
          return;
        }

        // Find first non-empty row to act as header
        let headerRowIndex = 0;
        while (
          headerRowIndex < rawRows.length &&
          (!rawRows[headerRowIndex] || rawRows[headerRowIndex].length === 0)
        ) {
          headerRowIndex++;
        }

        if (headerRowIndex >= rawRows.length) {
          showToast('Aucune donnée trouvée dans le fichier.', 'error');
          setIsParsing(false);
          return;
        }

        const firstRow = rawRows[headerRowIndex];
        let isSingleColumnCsv = false;
        let csvDelimiter: ',' | ';' | '\t' = ',';
        let headers: string[] = [];

        // If the first row contains comma or semicolon in a single cell, it's CSV packaged as single col
        if (
          firstRow.length === 1 &&
          (String(firstRow[0]).includes(',') || String(firstRow[0]).includes(';'))
        ) {
          isSingleColumnCsv = true;
          csvDelimiter = detectCsvDelimiter(String(firstRow[0]));
          headers = parseCsvLine(String(firstRow[0]), csvDelimiter);
        } else {
          headers = firstRow.map((h) => String(h || ''));
        }

        // Clean quotes from headers
        headers = headers.map((h) => h.replace(/^["']|["']$/g, '').trim());

        // Precise scoring system to prevent scrambling
        const FIELD_MATCHERS = {
          firstName: {
            exact: [
              'prenom',
              'prénom',
              'first name',
              'firstname',
              'nom1',
              'given name',
              'first_name',
              'fname',
            ],
            contains: ['prenom', 'prénom', 'first'],
          },
          lastName: {
            exact: [
              'nom',
              'name',
              'fournisseur',
              'supplier',
              'contact',
              'nom complet',
              'raison sociale',
              'societe',
              'société',
              'nom de la société',
              'nom de la societe',
              'partner',
              'partenaire',
              'company',
              'entreprise',
              'nom entreprise',
              "nom de l'entreprise",
              'last name',
              'lastname',
              'family name',
              'surname',
              'last_name',
              'lname',
            ],
            contains: [
              'nom',
              'name',
              'fournisseur',
              'supplier',
              'contact',
              'raison',
              'societe',
              'société',
              'partner',
              'partenaire',
              'company',
              'entreprise',
              'last',
            ],
          },
          phone: {
            exact: [
              'téléphone',
              'telephone',
              'tel',
              'gsm',
              'mobile',
              'portable',
              'phone',
              'numéro',
              'numero',
              'num',
              'tél',
              'tél.',
              'phone number',
              'téléphone fournisseur',
              'tel fournisseur',
            ],
            contains: ['tel', 'phone', 'gsm', 'mobil', 'portab', 'tél'],
          },
          email: {
            exact: [
              'email',
              'mail',
              'courriel',
              'adresse email',
              'e-mail',
              'email address',
              'adresse e-mail',
            ],
            contains: ['email', 'mail'],
          },
          addressLine1: {
            exact: [
              'adresse',
              'address',
              'rue',
              'adresse 1',
              'adresse ligne 1',
              'adresse complete',
              'adresse complète',
              'address 1',
              'street',
              'adresse complète inline',
              'adresse complete inline',
            ],
            contains: ['adresse', 'address', 'rue', 'street'],
          },
          addressLine2: {
            exact: ['adresse 2', 'adresse ligne 2', 'appt', 'suite', 'address 2', 'étage', 'etage'],
            contains: ['adresse 2', 'address 2', 'appt', 'suite', 'etage', 'étage'],
          },
          city: {
            exact: ['ville', 'city', 'region', 'région', 'pays', 'country', 'localité', 'localite'],
            contains: ['ville', 'city', 'region', 'région', 'pays', 'country'],
          },
          ice: {
            exact: [
              'ice',
              'i.c.e.',
              'patente',
              'nif',
              'identifiant unique',
              'identifiant fiscal',
              "n° d'identification fiscale",
              'rc',
              'registre du commerce',
              'registre',
              'fiscal',
              'tax id',
              'tva',
              'vat',
              'identifiant commun',
              'entreprise ice',
              'id de la société',
              'id de la societe',
              "id de l'entreprise",
              "id de l'établissement",
              "id de l'etablissement",
              'id de societe',
              'id de société',
              'id de entreprise',
            ],
            contains: [
              'ice',
              'patente',
              'nif',
              'fiscal',
              'tax',
              'tva',
              'vat',
              'id de la',
              "id de l'",
            ],
          },
          notes: {
            exact: [
              'notes',
              'note',
              'description',
              'commentaire',
              'infos',
              'activities',
              'activités',
              'activites',
              'stats',
              'observation',
              'observations',
            ],
            contains: ['note', 'desc', 'comment', 'info', 'observ', 'activit'],
          },
        };

        const getFieldScore = (header: string, field: keyof typeof FIELD_MATCHERS): number => {
          const hClean = header.toLowerCase().trim();
          const matchers = FIELD_MATCHERS[field];

          // Rule 1: Exact match
          if (matchers.exact.includes(hClean)) {
            return 100;
          }

          // Rule 2: Normalization
          const hNorm = hClean.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // removes accents
          const exactNorm = matchers.exact.map((e) =>
            e.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
          );
          if (exactNorm.includes(hNorm)) {
            return 95;
          }

          // Rule 3: Substring search
          for (const s of matchers.contains) {
            const sNorm = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (hNorm.includes(sNorm)) {
              if (field === 'lastName' && hNorm.includes('prenom')) {
                return 10; // Low score for first name (prenom) if only checked as general last name
              }
              if (
                field === 'lastName' &&
                (hNorm.includes('tel') ||
                  hNorm.includes('phone') ||
                  hNorm.includes('mail') ||
                  hNorm.includes('ice') ||
                  hNorm.includes('id de') ||
                  hNorm.includes('id_de') ||
                  hNorm.includes('id de la') ||
                  hNorm.includes("id de l'"))
              ) {
                return 0; // Never map phone/mail/ice/id columns as supplier name
              }
              if (
                hNorm.startsWith(sNorm) ||
                hNorm.endsWith(sNorm) ||
                new RegExp(`\\b${sNorm}\\b`).test(hNorm)
              ) {
                return 80;
              }
              return 50;
            }
          }

          return 0;
        };

        const fields: (keyof typeof FIELD_MATCHERS)[] = [
          'firstName',
          'lastName',
          'phone',
          'email',
          'addressLine1',
          'addressLine2',
          'city',
          'ice',
          'notes',
        ];

        // Score all fields for all headers
        const fieldScores = fields.map((field) => {
          const scores = headers.map((h, colIdx) => ({
            colIdx,
            score: getFieldScore(h, field),
          }));
          scores.sort((a, b) => b.score - a.score);
          return { field, best: scores[0] };
        });

        // Resolve conflict by ranking them
        fieldScores.sort((a, b) => b.best.score - a.best.score);

        const matchedIndexes: Record<string, number> = {
          firstName: -1,
          lastName: -1,
          phone: -1,
          email: -1,
          addressLine1: -1,
          addressLine2: -1,
          city: -1,
          ice: -1,
          notes: -1,
        };

        const usedColIndexes = new Set<number>();

        for (const fScore of fieldScores) {
          const { field } = fScore;
          const scoresForField = headers
            .map((h, colIdx) => ({
              colIdx,
              score: getFieldScore(h, field),
            }))
            .sort((a, b) => b.score - a.score);

          for (const s of scoresForField) {
            if (s.score >= 40 && !usedColIndexes.has(s.colIdx)) {
              matchedIndexes[field] = s.colIdx;
              usedColIndexes.add(s.colIdx);
              break;
            }
          }
        }

        // Keep backup fallback if lastName column wasn't matched
        if (matchedIndexes.lastName === -1 && matchedIndexes.firstName === -1) {
          // Default to first column for lastName
          matchedIndexes.lastName = 0;
        }

        const idxFirstName = matchedIndexes.firstName;
        const idxLastName = matchedIndexes.lastName;
        const idxPhone = matchedIndexes.phone;
        const idxEmail = matchedIndexes.email;
        const idxAddress1 = matchedIndexes.addressLine1;
        const idxAddress2 = matchedIndexes.addressLine2;
        const idxCity = matchedIndexes.city;
        const idxIce = matchedIndexes.ice;
        const idxNotes = matchedIndexes.notes;

        const normalized: any[] = [];

        for (let i = headerRowIndex + 1; i < rawRows.length; i++) {
          const row = rawRows[i];
          if (!row || row.length === 0) continue;

          let cells: string[] = [];
          if (isSingleColumnCsv) {
            cells = parseCsvLine(String(row[0] || ''), csvDelimiter);
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

          const firstNameVal = idxFirstName >= 0 ? getValue(idxFirstName) : '';
          const lastNameVal = idxLastName >= 0 ? getValue(idxLastName) : '';

          let name = '';
          if (firstNameVal && lastNameVal) {
            name = `${firstNameVal} ${lastNameVal}`.toUpperCase();
          } else if (lastNameVal) {
            name = lastNameVal.toUpperCase();
          } else if (firstNameVal) {
            name = firstNameVal.toUpperCase();
          }

          if (!name) continue;

          const phone = getValue(idxPhone) || null;
          const email = getValue(idxEmail) || null;
          const addressLine1 = getValue(idxAddress1) || null;
          const addressLine2 = getValue(idxAddress2) || null;
          const city = getValue(idxCity) || null;
          const ice = getValue(idxIce) || null;

          const notesParts: string[] = [];
          if (
            idxNotes >= 0 &&
            idxNotes !== idxFirstName &&
            idxNotes !== idxLastName &&
            idxNotes !== idxPhone
          ) {
            const notesVal = getValue(idxNotes);
            if (notesVal) {
              notesParts.push(`Activité/Notes: ${notesVal}`);
            }
          }
          const idxStats = headers.findIndex(
            (h, colIdx) =>
              h.toLowerCase().includes('stat') &&
              colIdx !== idxNotes &&
              colIdx !== idxFirstName &&
              colIdx !== idxLastName &&
              colIdx !== idxPhone
          );
          if (idxStats >= 0) {
            const statsVal = getValue(idxStats);
            if (statsVal) {
              notesParts.push(`Stats: ${statsVal}`);
            }
          }
          const notes = notesParts.join(' | ') || null;

          normalized.push({
            name,
            phone,
            email,
            addressLine1,
            addressLine2,
            city,
            ice,
            notes,
          });
        }

        setTotalRows(normalized.length);

        const valid = normalized.filter((c) => c.name && c.name.length > 0);

        const existingNamesLowercase = new Set(
          existingSuppliers.map((c) =>
            String(c.name || '')
              .toLowerCase()
              .trim()
          )
        );

        let dupCount = 0;
        valid.forEach((c) => {
          if (existingNamesLowercase.has(c.name.toLowerCase().trim())) {
            dupCount++;
          }
        });

        setDuplicateNamesCount(dupCount);
        setValidRows(valid);
        setParsedData(normalized);
        setIsParsing(false);
        showToast('Fichier analysé avec succès.', 'success');
      } catch (err) {
        console.error(err);
        setIsParsing(false);
        showToast('Erreur lors de la lecture du fichier.', 'error');
        resetState();
      }
    };

    reader.onerror = () => {
      setIsParsing(false);
      showToast('Erreur de lecture.', 'error');
      resetState();
    };

    reader.readAsBinaryString(selectedFile);
  };

  const handleStartImport = async () => {
    if (validRows.length === 0) {
      showToast('Aucune donnée valide à importer.', 'error');
      return;
    }

    setIsImporting(true);
    try {
      const batch = writeBatch(db);
      const existingNamesLowercase = new Set(
        existingSuppliers.map((c) =>
          String(c.name || '')
            .toLowerCase()
            .trim()
        )
      );

      let importedCount = 0;
      let skippedCount = 0;
      const importedInThisBatch = new Set<string>();

      for (const supplierData of validRows) {
        const supNameNorm = supplierData.name.toLowerCase().trim();

        if (
          skipDuplicates &&
          (existingNamesLowercase.has(supNameNorm) || importedInThisBatch.has(supNameNorm))
        ) {
          skippedCount++;
          continue;
        }

        importedInThisBatch.add(supNameNorm);

        const newSupplierRef = doc(collection(db, 'suppliers'));
        batch.set(newSupplierRef, {
          ownerId,
          name: supplierData.name,
          phone: supplierData.phone,
          email: supplierData.email,
          address: supplierData.addressLine1, // For fallback compatibility
          addressLine1: supplierData.addressLine1,
          addressLine2: supplierData.addressLine2,
          city: supplierData.city,
          ice: supplierData.ice,
          notes: supplierData.notes,
          createdAt: new Date(),
        });

        importedCount++;
      }

      if (importedCount > 0) {
        await batch.commit();
        showToast(
          `${importedCount} fournisseur(s) importé(s) avec succès. ${skippedCount > 0 ? skippedCount + ' doublon(s) sauté(s).' : ''}`,
          'success'
        );
      } else {
        showToast('Aucun nouveau fournisseur importé (uniquement des doublons sautés).', 'info');
      }

      resetState();
      onClose();
    } catch (error) {
      console.error('Import error:', error);
      showToast('Erreur lors de la synchronisation avec Firebase.', 'error');
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
                      Importer Fournisseurs
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

              <div className="p-6 space-y-5">
                {!file && (
                  <div className="space-y-4">
                    <p className="text-slate-500 dark:text-slate-400 text-[13px] leading-relaxed">
                      Téléchargez et préparez votre fichier de fournisseurs. Vous pouvez inclure la
                      raison sociale, le téléphone, l'email, l'adresse, la ville, l'ICE, ainsi que
                      vos notes.
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
                        Glissez votre fichier ici ou cliquez pour choisir
                      </span>
                      <span className="text-xs text-[#8592a3] dark:text-[#707194]">
                        Prend en charge Excel (.xlsx, .xls) et CSV
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3.5 rounded-lg bg-[#e7e7ff]/30 dark:bg-[#696cff]/5 border border-[#e7e7ff] dark:border-[#696cff]/20">
                      <div className="flex items-center gap-2">
                        <Coffee size={18} className="text-[#696cff]" />
                        <span className="text-xs font-semibold text-[#566a7f] dark:text-[#a1acb8]">
                          Vous n'avez pas de document type ?
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={downloadImportTemplate}
                        className="text-xs font-bold text-[#696cff] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Download size={13} />
                        Modèle standard
                      </button>
                    </div>
                  </div>
                )}

                {isParsing && (
                  <div className="py-12 flex flex-col items-center justify-center text-center space-y-3">
                    <Loader2 size={32} className="text-[#696cff] animate-spin stroke-[2]" />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      Analyse de la feuille en cours ...
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
                        Vider / Changer
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3 rounded-lg text-center bg-slate-50 dark:bg-[#232333]/20 border border-slate-100 dark:border-slate-800">
                        <span className="text-[10px] block font-bold text-[#8592a3] uppercase mb-0.5">
                          Lignes
                        </span>
                        <span className="text-lg font-bold text-slate-900 dark:text-white font-mono">
                          {totalRows}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg text-center bg-emerald-50/40 dark:bg-emerald-950/5 border border-emerald-100/50 dark:border-emerald-800/30">
                        <span className="text-[10px] block font-bold text-emerald-600 uppercase mb-0.5">
                          Valides
                        </span>
                        <span className="text-lg font-bold text-emerald-600 font-mono">
                          {validRows.length}
                        </span>
                      </div>
                      <div className="p-3 rounded-lg text-center bg-amber-50/40 dark:bg-amber-950/5 border border-amber-100/50 dark:border-amber-800/30">
                        <span className="text-[10px] block font-bold text-amber-500 uppercase mb-0.5">
                          Doublons
                        </span>
                        <span className="text-lg font-bold text-amber-500 font-mono">
                          {duplicateNamesCount}
                        </span>
                      </div>
                    </div>

                    {duplicateNamesCount > 0 && (
                      <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-[#232333]/15 border border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2">
                          <AlertCircle size={15} className="text-amber-500" />
                          <div className="text-left">
                            <span className="text-[12px] block font-bold text-slate-700 dark:text-slate-300">
                              Doublons de nom détectés
                            </span>
                            <span className="text-[11px] text-slate-500">
                              Des fournisseurs du même nom existent déjà
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={skipDuplicates}
                            onChange={(e) => setSkipDuplicates(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-[#d9dee3] dark:bg-[#434460]/40 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:height-4 after:h-4 after:w-4 after:transition-all peer-checked:bg-[#696cff]"></div>
                          <span className="ml-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
                            Sauter
                          </span>
                        </label>
                      </div>
                    )}

                    <div className="space-y-1">
                      <span className="text-[11px] text-[#8592a3] font-bold uppercase tracking-wider block">
                        Aperçu des 3 premières lignes :
                      </span>
                      <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden text-xs">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-[#232333]/50 border-b border-slate-100 dark:border-slate-800 font-semibold text-slate-500">
                              <th className="p-2">Nom</th>
                              <th className="p-2">Téléphone</th>
                              <th className="p-2">Email</th>
                              <th className="p-2">Ville</th>
                            </tr>
                          </thead>
                          <tbody>
                            {validRows.slice(0, 3).map((r, index) => (
                              <tr
                                key={index}
                                className="border-b border-slate-50 dark:border-slate-800/40 text-slate-600 dark:text-slate-300"
                              >
                                <td className="p-2 font-medium truncate max-w-[120px]">{r.name}</td>
                                <td className="p-2 font-mono">{r.phone || '—'}</td>
                                <td className="p-2 truncate max-w-[100px]">{r.email || '—'}</td>
                                <td className="p-2">{r.city || '—'}</td>
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
                    disabled={isImporting || validRows.length === 0}
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
                        <span>
                          Lancer l'import (
                          {validRows.length - (skipDuplicates ? duplicateNamesCount : 0)})
                        </span>
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

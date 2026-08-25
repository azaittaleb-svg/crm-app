import React, { useState, useEffect, useMemo } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  collectionGroup,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  getDocs,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useNavigate } from 'react-router-dom';
import {
  Calculator,
  Receipt,
  Plus,
  Trash2,
  Calendar,
  FileText,
  Scale,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  AlertCircle,
  Info,
  CheckCircle,
  Percent,
  X,
  PlusCircle,
  HelpCircle,
  FileSpreadsheet,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { motion, AnimatePresence } from 'motion/react';
import XLSX from 'xlsx-js-style';

interface MiscOperation {
  id: string;
  label: string;
  date: string;
  amount: number;
  type: 'impot' | 'taxe' | 'cloture' | 'autre';
  ownerId: string;
}

export default function ComptabilitePage() {
  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();

  // Loaders & State
  const [isLoading, setIsLoading] = useState(true);
  const [rawPurchases, setRawPurchases] = useState<any[]>([]);
  const [excludedSupplierIds, setExcludedSupplierIds] = useState<Set<string>>(new Set());
  const [bankTransactions, setBankTransactions] = useState<any[]>([]);
  const [allPayments, setAllPayments] = useState<any[]>([]);
  const [miscOperations, setMiscOperations] = useState<MiscOperation[]>([]);
  const [tvaDeclarations, setTvaDeclarations] = useState<any[]>([]);

  // Mapping states for Client & Supplier names
  const [clientsMap, setClientsMap] = useState<Record<string, string>>({});
  const [suppliersMap, setSuppliersMap] = useState<Record<string, string>>({});

  const allPurchases = useMemo(() => {
    return rawPurchases.filter((p: any) => {
      if (p.excludeFromAccounting) return false;
      if (p.parentPath === 'suppliers' && excludedSupplierIds.has(p.clientId)) {
        return false;
      }
      return true;
    });
  }, [rawPurchases, excludedSupplierIds]);

  const invoices = useMemo(() => {
    return allPurchases.filter(
      (p: any) => p.parentPath === 'clients' && p.type === 'facture' && p.status !== 'Annulée'
    );
  }, [allPurchases]);

  // Tab and Filters for TVA Module
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'tva'>('overview');
  const [selectedMonth, setSelectedMonth] = useState<number>(() => {
    const val = localStorage.getItem('comp_filter_selectedMonth');
    return val ? Number(val) : new Date().getMonth() + 1;
  });
  const [selectedYear, setSelectedYear] = useState<number>(() => {
    const val = localStorage.getItem('comp_filter_selectedYear');
    return val ? Number(val) : 2026;
  });

  const [tvaRegime, setTvaRegime] = useState<'encaissements' | 'debits'>(() => {
    const val = localStorage.getItem('tva_regime_setting');
    return val === 'debits' || val === 'encaissements' ? val : 'encaissements';
  });

  // Persist filter states to localStorage
  useEffect(() => {
    localStorage.setItem('comp_filter_selectedMonth', String(selectedMonth));
  }, [selectedMonth]);

  useEffect(() => {
    localStorage.setItem('comp_filter_selectedYear', String(selectedYear));
  }, [selectedYear]);

  useEffect(() => {
    localStorage.setItem('tva_regime_setting', tvaRegime);
  }, [tvaRegime]);

  // Modals / forms
  const [isAddMiscModalOpen, setIsAddMiscModalOpen] = useState(false);
  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false);
  const [newMiscLabel, setNewMiscLabel] = useState('');
  const [newMiscDate, setNewMiscDate] = useState(new Date().toISOString().split('T')[0]);
  const [newMiscAmount, setNewMiscAmount] = useState('');
  const [newMiscType, setNewMiscType] = useState<'impot' | 'taxe' | 'cloture' | 'autre'>('autre');

  // Load all validated client invoices, supplier purchases, and TVA declarations
  useEffect(() => {
    if (!user) return;

    // Fetch all purchases (both client invoices and supplier purchases via collectionGroup)
    const unsubscribePurchases = onSnapshot(
      collectionGroup(db, 'purchases'),
      (snapshot) => {
        const items = snapshot.docs
          .map((docSnap) => {
            const dataObj = docSnap.data() as any;
            const pathParts = docSnap.ref.path.split('/').filter(Boolean);
            const clientsIndex = pathParts.indexOf('clients');
            const suppliersIndex = pathParts.indexOf('suppliers');
            const parentId = docSnap.ref.parent?.parent?.id;

            const isClient = clientsIndex !== -1 || docSnap.ref.path.startsWith('clients/');
            const isSupplier = suppliersIndex !== -1 || docSnap.ref.path.startsWith('suppliers/');
            const parentPath = isClient ? 'clients' : isSupplier ? 'suppliers' : '';
            const clientId =
              dataObj.clientId ||
              dataObj.supplierId ||
              parentId ||
              (clientsIndex !== -1 ? pathParts[clientsIndex + 1] : suppliersIndex !== -1 ? pathParts[suppliersIndex + 1] : pathParts[1]);

            return {
              id: docSnap.id,
              ...dataObj,
              clientId,
              parentPath,
            };
          })
          .filter((p: any) => !p.ownerId || p.ownerId === user.uid);

        setRawPurchases(items);
      },
      (error) => {
        console.error('Error reading purchases:', error);
      }
    );

    // Fetch all bank/cash transactions
    const unsubscribeBank = onSnapshot(
      collection(db, 'bank_reconciliations'),
      (snapshot) => {
        const items = snapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter((b: any) => !b.ownerId || b.ownerId === user.uid);
        setBankTransactions(items);
      },
      (error) => {
        console.error('Error reading bank reconciliations:', error);
      }
    );

    // Fetch all payments (from subcollections)
    const unsubscribePayments = onSnapshot(
      collectionGroup(db, 'payments'),
      (snapshot) => {
        const items = snapshot.docs
          .map((doc) => {
            const pathParts = doc.ref.path.split('/').filter(Boolean);
            const isClient = pathParts.includes('clients');
            const isSupplier = pathParts.includes('suppliers');
            return {
              id: doc.id,
              ...doc.data(),
              parentPath: isClient ? 'clients' : isSupplier ? 'suppliers' : pathParts[0],
              partnerId: pathParts[1] || doc.ref.parent?.parent?.id,
              path: doc.ref.path,
            };
          })
          .filter((p: any) => !p.ownerId || p.ownerId === user.uid);
        setAllPayments(items);
      },
      (error) => {
        console.error('Error reading payments:', error);
      }
    );

    // Fetch miscellaneous operations
    const unsubscribeMisc = onSnapshot(
      collection(db, 'miscellaneous_operations'),
      (snapshot) => {
        const items = snapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter((m: any) => !m.ownerId || m.ownerId === user.uid) as MiscOperation[];

        // Sort newest first
        items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setMiscOperations(items);
        setIsLoading(false);
      },
      (error) => {
        console.error('Error reading miscellaneous operations:', error);
      }
    );

    // Fetch clients
    const unsubscribeClients = onSnapshot(
      collection(db, 'clients'),
      (snapshot) => {
        const mapping: Record<string, string> = {};
        snapshot.docs.forEach((doc) => {
          const data = doc.data() as any;
          if (!data.ownerId || data.ownerId === user.uid) {
            mapping[doc.id] = data.name || '';
          }
        });
        setClientsMap(mapping);
      },
      (error) => {
        console.error('Error reading clients:', error);
      }
    );

    // Fetch suppliers
    const unsubscribeSuppliers = onSnapshot(
      collection(db, 'suppliers'),
      (snapshot) => {
        const mapping: Record<string, string> = {};
        const excluded = new Set<string>();
        snapshot.docs.forEach((doc) => {
          const data = doc.data() as any;
          if (!data.ownerId || data.ownerId === user.uid) {
            mapping[doc.id] = data.name || '';
            if (data.excludeFromAccounting) {
              excluded.add(doc.id);
            }
          }
        });
        setSuppliersMap(mapping);
        setExcludedSupplierIds(excluded);
      },
      (error) => {
        console.error('Error reading suppliers:', error);
      }
    );

    // Fetch TVA Declarations history
    const qTva = query(collection(db, 'tva_declarations'), where('ownerId', '==', user.uid));
    const unsubscribeTva = onSnapshot(
      qTva,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        // Sort year desc, month desc
        items.sort((a: any, b: any) => {
          if (b.year !== a.year) return b.year - a.year;
          return b.month - a.month;
        });
        setTvaDeclarations(items);
      },
      (error) => {
        console.error('Error reading TVA declarations:', error);
      }
    );

    return () => {
      unsubscribePurchases();
      unsubscribeBank();
      unsubscribePayments();
      unsubscribeMisc();
      unsubscribeTva();
      unsubscribeClients();
      unsubscribeSuppliers();
    };
  }, [user]);

  // Add a new miscellaneous operation
  const handleAddMiscOperation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!newMiscLabel.trim() || !newMiscAmount) {
      showToast('Veuillez remplir tous les champs obligatoires.', 'error');
      return;
    }

    try {
      await addDoc(collection(db, 'miscellaneous_operations'), {
        label: newMiscLabel.trim(),
        date: newMiscDate,
        amount: Number(newMiscAmount),
        type: newMiscType,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
      });

      showToast('Opération comptable ajoutée avec succès !', 'success');
      setIsAddMiscModalOpen(false);
      // Reset form
      setNewMiscLabel('');
      setNewMiscDate(new Date().toISOString().split('T')[0]);
      setNewMiscAmount('');
      setNewMiscType('autre');
    } catch (err) {
      console.error('Error adding operation:', err);
      showToast("Erreur lors de l'ajout de l'opération.", 'error');
    }
  };

  // Delete miscellaneous operation
  const handleDeleteMiscOperation = (id: string, label: string) => {
    confirm({
      title: "Supprimer l'opération",
      message: `Voulez-vous supprimer l'opération "${label}" ? cette action est irréversible.`,
      confirmText: 'Supprimer',
      cancelText: 'Annuler',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'miscellaneous_operations', id));
          showToast('Opération supprimée.', 'success');
        } catch (e) {
          showToast('Erreur lors de la suppression.', 'error');
        }
      },
    });
  };

  // Delete TVA declaration (Unlock period)
  const handleDeleteTvaDeclaration = (id: string, periodStr: string) => {
    confirm({
      title: 'Annuler la clôture de TVA',
      message: `Voulez-vous annuler la clôture de TVA pour la période ${periodStr} ? Cette action supprimera définitivement la déclaration et déverrouillera toutes les écritures associées.`,
      confirmText: 'Annuler la clôture',
      cancelText: 'Conserver',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'tva_declarations', id));
          showToast(`Clôture pour la période ${periodStr} annulée avec succès.`, 'success');
        } catch (e) {
          console.error('Error deleting TVA declaration:', e);
          showToast('Erreur lors de la suppression de la déclaration.', 'error');
        }
      },
    });
  };

  // Export TVA declaration details to Excel
  const handleExportDeclarationToExcel = (dec: any) => {
    try {
      // Filter computedTransactions for the period dec.month and dec.year
      const paidTx = computedTransactions.filter((tx) => {
        if (tvaRegime === 'debits' && tx.type === 'vente') {
          // Régime des débits: Ventes are declared based on INVOICE DATE, regardless of payment status
          if (!tx.paymentDate) return false;
          const parts = tx.paymentDate.split('-');
          if (parts.length < 2) return false;
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          return m === dec.month && y === dec.year;
        } else {
          // Régime des encaissements (and all Achats): based on PAYMENT DATE and must be PAID
          if (!tx.paymentDate) return false;
          const parts = tx.paymentDate.split('-');
          if (parts.length < 2) return false;
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          return m === dec.month && y === dec.year && tx.status === 'payé';
        }
      });

      if (paidTx.length === 0) {
        showToast('Aucune transaction éligible trouvée pour cette période.', 'error');
        return;
      }

      // 1. Calculate Summary aggregates
      const ventesPaid = paidTx.filter((tx) => tx.type === 'vente');
      const achatsPaid = paidTx.filter((tx) => tx.type === 'achat');

      const totalVentesTTC = ventesPaid.reduce((sum, tx) => sum + (tx.amountTTC || 0), 0);
      const totalVentesHT = ventesPaid.reduce((sum, tx) => sum + (tx.amountHT || 0), 0);
      const totalVentesTVA = ventesPaid.reduce((sum, tx) => sum + (tx.amountTVA || 0), 0);

      const totalAchatsTTC = achatsPaid.reduce((sum, tx) => sum + (tx.amountTTC || 0), 0);
      const totalAchatsHT = achatsPaid.reduce((sum, tx) => sum + (tx.amountHT || 0), 0);
      const totalAchatsTVA = achatsPaid.reduce((sum, tx) => sum + (tx.amountTVA || 0), 0);

      const diffTVA = totalVentesTVA - totalAchatsTVA;
      const tvaDue = diffTVA >= 0 ? diffTVA : 0;
      const creditTva = diffTVA < 0 ? Math.abs(diffTVA) : 0;

      // 2. Format detailed rows for the second sheet
      const detailRows = paidTx.map((tx) => {
        const typeLabel = tx.type === 'vente' ? 'Vente (TVA Collectée)' : 'Achat (TVA Récupérable)';
        const taxRatePercent = tx.taxRate !== undefined ? `${tx.taxRate}%` : '20%';

        // Resolve attachment URL. If it's a Base64 string, provide a direct link to the download endpoint.
        let safeAttachment = 'Aucun justificatif rattaché';
        if (tx.type === 'vente' && tx.clientId && tx.purchaseId) {
          const origin = window.location.origin;
          safeAttachment = `${origin}/purchase/${tx.clientId}/${tx.purchaseId}?download=true`;
        } else if (tx.attachmentUrl) {
          if (tx.attachmentUrl.startsWith('data:')) {
            if (!tx.clientId || !tx.purchaseId || tx.purchaseId === 'direct_charge') {
              safeAttachment = '[Pièce jointe intégrée (Base64) - Non exportable]';
            } else {
              const origin = window.location.origin;
              const route = `/download/${tx.type}/${tx.clientId}/${tx.purchaseId}`;
              safeAttachment = `${origin}${route}`;
            }
          } else {
            safeAttachment =
              tx.attachmentUrl.length > 2000
                ? tx.attachmentUrl.slice(0, 2000) + '...'
                : tx.attachmentUrl;
          }
        }

        return {
          "Type d'Opération": typeLabel,
          'Partenaire / Tiers': tx.partnerName || 'N/A',
          'N° de Facture': tx.invoiceNumber || 'N/A',
          'Date Opération / Règlement': (tvaRegime === 'debits' && tx.type === 'vente') ? (tx.invoiceDate || 'N/A') : (tx.paymentDate || 'N/A'),
          'Montant Encaissé (TTC)': Number((tx.amountTTC || 0).toFixed(2)),
          'Base HT': Number((tx.amountHT || 0).toFixed(2)),
          'Taux TVA': taxRatePercent,
          TVA: Number((tx.amountTVA || 0).toFixed(2)),
          'Lien Justificatif (PDF / Attachment)': safeAttachment,
          'Notes / Affectation': tx.paymentNotes || '',
        };
      });

      // 3. Build Array of Arrays (AOA) for the Summary Tab
      const summaryAOA = [
        ['RAPPORT DE CLÔTURE & SYNTHÈSE COMPTABLE DE TVA', '', '', ''],
        ["Généré depuis le Cockpit d'Exploitation", '', '', ''],
        ['', '', '', ''],
        ['INFORMATION DE LA PÉRIODE', '', '', ''],
        ['Période comptable :', '', `${String(dec.month).padStart(2, '0')}/${dec.year}`, ''],
        [
          'Régime de TVA :',
          '',
          tvaRegime === 'debits'
            ? 'Régime des Débits (Exigibilité à la facturation)'
            : 'Régime des Encaissements (Exigibilité au règlement)',
          '',
        ],
        ["Date d'exportation :", '', new Date().toLocaleDateString('fr-FR'), ''],
        ['Statut :', '', 'CLÔTURÉE', ''],
        ['', '', '', ''],
        ['1. FLUX DES VENTES (TVA COLLECTÉE)', '', '', ''],
        ['Rubrique', 'Base Hors Taxes (HT)', 'Montant TVA Collectée', 'Total TTC (Encaissé)'],
        [
          'Opérations de Ventes (TVA Collectée)',
          Number(totalVentesHT.toFixed(2)),
          Number(totalVentesTVA.toFixed(2)),
          Number(totalVentesTTC.toFixed(2)),
        ],
        ['', '', '', ''],
        ['2. FLUX DES ACHATS & CHARGES (TVA RÉCUPÉRABLE)', '', '', ''],
        ['Rubrique', 'Base Hors Taxes (HT)', 'Montant TVA Récupérable', 'Total TTC (Payé)'],
        [
          "Opérations d'Achats & Dépenses",
          Number(totalAchatsHT.toFixed(2)),
          Number(totalAchatsTVA.toFixed(2)),
          Number(totalAchatsTTC.toFixed(2)),
        ],
        ['', '', '', ''],
        ['3. SOLDE ET BALANCE DE TVA À REVERSER OU CRÉDIT DE TVA', '', '', ''],
        ['Désignation de la ligne', 'Formule / Origine', 'Montant (DH)', 'Observation'],
        [
          'Total TVA Collectée (Ventes)',
          'A (Somme de la TVA Collectée)',
          Number(totalVentesTVA.toFixed(2)),
          "Exigible auprès de l'État",
        ],
        [
          'Total TVA Récupérable (Achats)',
          'B (Somme de la TVA Récupérable)',
          Number(totalAchatsTVA.toFixed(2)),
          'À déduire de la TVA Collectée',
        ],
        [
          'Écart net de TVA (A - B)',
          'TVA Collectée - TVA Récupérable',
          Number(diffTVA.toFixed(2)),
          diffTVA >= 0 ? 'Solde de TVA due' : 'Crédit de TVA reportable',
        ],
        ['', '', '', ''],
        [
          diffTVA >= 0 ? "MONTANT DE TVA DU À L'ÉTAT" : 'MONTANT DU CRÉDIT DE TVA (À REPORTER)',
          '',
          Number((diffTVA >= 0 ? tvaDue : creditTva).toFixed(2)),
          diffTVA >= 0 ? "À PAYER À L'ADMINISTRATION" : 'CRÉDIT COMPTABLE REPORTABLE',
        ],
        ['', '', '', ''],
        ['-- Rapport comptable généré automatiquement --', '', '', ''],
      ];

      // Create Worksheet & Workbook
      const wsSummary = XLSX.utils.aoa_to_sheet(summaryAOA);
      const wsDetail = XLSX.utils.json_to_sheet(detailRows);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, wsSummary, 'Synthèse de TVA');
      XLSX.utils.book_append_sheet(wb, wsDetail, 'Détail des Transactions');

      // 4. Style wsSummary
      Object.keys(wsSummary).forEach((cellKey) => {
        if (cellKey.startsWith('!')) return;
        const cell = wsSummary[cellKey] as any;
        if (!cell) return;

        const decoded = XLSX.utils.decode_cell(cellKey);
        const r = decoded.r;
        const c = decoded.c;

        // Base styling for all cells
        cell.s = {
          font: { name: 'Public Sans', sz: 10, color: { rgb: '566A7F' } },
          alignment: { vertical: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: 'DDE1E5' } },
            bottom: { style: 'thin', color: { rgb: 'DDE1E5' } },
            left: { style: 'thin', color: { rgb: 'DDE1E5' } },
            right: { style: 'thin', color: { rgb: 'DDE1E5' } },
          },
        };

        // Title row (r === 0)
        if (r === 0) {
          cell.s.font = { name: 'Public Sans', sz: 15, bold: true, color: { rgb: '696CFF' } };
          cell.s.alignment = { horizontal: 'center', vertical: 'center' };
          cell.s.border = {};
          return;
        }

        // Subtitle row (r === 1)
        if (r === 1) {
          cell.s.font = { name: 'Public Sans', sz: 10, italic: true, color: { rgb: 'A1ACB8' } };
          cell.s.alignment = { horizontal: 'center', vertical: 'center' };
          cell.s.border = {};
          return;
        }

        // Empty rows or spacer rows
        const val = String(cell.v || '').trim();
        if (val === '' && r < 25) {
          cell.s.border = {};
          return;
        }

        // Section Headers (r = 3, 9, 13, 17)
        if (r === 3 || r === 9 || r === 13 || r === 17) {
          cell.s.fill = { fgColor: { rgb: '233446' } }; // Dark slate Sneat
          cell.s.font = { name: 'Public Sans', sz: 11, bold: true, color: { rgb: 'FFFFFF' } };
          cell.s.alignment = { horizontal: 'center', vertical: 'center' };
          cell.s.border = {
            top: { style: 'medium', color: { rgb: '1D2A38' } },
            bottom: { style: 'medium', color: { rgb: '1D2A38' } },
          };
          return;
        }

        // Table Column Headers (r = 10, 14, 18)
        if (r === 10 || r === 14 || r === 18) {
          cell.s.fill = { fgColor: { rgb: '696CFF' } }; // Sneat primary
          cell.s.font = { name: 'Public Sans', sz: 10, bold: true, color: { rgb: 'FFFFFF' } };
          cell.s.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
          cell.s.border = {
            top: { style: 'thin', color: { rgb: '5A5FE0' } },
            bottom: { style: 'medium', color: { rgb: '5A5FE0' } },
            left: { style: 'thin', color: { rgb: '5A5FE0' } },
            right: { style: 'thin', color: { rgb: '5A5FE0' } },
          };
          return;
        }

        // Info period blocks (r = 4, 5, 6, 7)
        if (r >= 4 && r <= 7) {
          if (c === 0) {
            cell.s.font = { name: 'Public Sans', sz: 10, bold: true, color: { rgb: '566A7F' } };
            cell.s.alignment = { horizontal: 'right' };
          } else {
            cell.s.alignment = { horizontal: 'left' };
            if (val === 'CLÔTURÉE') {
              cell.s.font = { name: 'Public Sans', sz: 10, bold: true, color: { rgb: '71DD37' } };
            }
          }
          return;
        }

        // Final Result Row (r === 23)
        if (r === 23) {
          if (c === 0 || c === 1) {
            cell.s.fill = { fgColor: { rgb: '233446' } };
            cell.s.font = { name: 'Public Sans', sz: 11, bold: true, color: { rgb: 'FFFFFF' } };
            cell.s.alignment = { horizontal: 'center', vertical: 'center' };
          } else {
            const isCredit = !String(summaryAOA[23][0]).includes('TVA DU À');
            const bgHex = isCredit ? '71DD37' : 'FF3E1D';
            cell.s.fill = { fgColor: { rgb: bgHex } };
            cell.s.font = { name: 'Public Sans', sz: 12, bold: true, color: { rgb: 'FFFFFF' } };
            cell.s.alignment = { horizontal: 'center', vertical: 'center' };
            if (c === 2 && typeof cell.v === 'number') {
              cell.z = '#,##0.00" DH"';
            }
          }
          return;
        }

        // Footer Row (r === 25)
        if (r === 25) {
          cell.s.font = { name: 'Public Sans', sz: 9, italic: true, color: { rgb: 'A1ACB8' } };
          cell.s.alignment = { horizontal: 'center', vertical: 'center' };
          cell.s.border = {};
          return;
        }

        // General numbers formatting inside tables
        if (typeof cell.v === 'number') {
          cell.z = '#,##0.00" DH"';
          cell.s.alignment = { horizontal: 'right' };
          cell.s.font = { name: 'Public Sans', sz: 10, bold: true, color: { rgb: '222222' } };
        } else if (c === 0) {
          cell.s.alignment = { horizontal: 'left' };
        } else {
          cell.s.alignment = { horizontal: 'center' };
        }
      });

      // 5. Style wsDetail
      Object.keys(wsDetail).forEach((cellKey) => {
        if (cellKey.startsWith('!')) return;
        const cell = wsDetail[cellKey] as any;
        if (!cell) return;

        const decoded = XLSX.utils.decode_cell(cellKey);
        const r = decoded.r;
        const c = decoded.c;

        cell.s = {
          font: { name: 'Public Sans', sz: 10, color: { rgb: '566A7F' } },
          alignment: { vertical: 'center' },
          border: {
            top: { style: 'thin', color: { rgb: 'E1E5EA' } },
            bottom: { style: 'thin', color: { rgb: 'E1E5EA' } },
            left: { style: 'thin', color: { rgb: 'E1E5EA' } },
            right: { style: 'thin', color: { rgb: 'E1E5EA' } },
          },
        };

        // Header (r === 0)
        if (r === 0) {
          cell.s.fill = { fgColor: { rgb: '696CFF' } }; // Sneat violet
          cell.s.font = { name: 'Public Sans', sz: 10, bold: true, color: { rgb: 'FFFFFF' } };
          cell.s.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
          cell.s.border = {
            top: { style: 'thin', color: { rgb: '5A5FE0' } },
            bottom: { style: 'medium', color: { rgb: '5A5FE0' } },
            left: { style: 'thin', color: { rgb: '5A5FE0' } },
            right: { style: 'thin', color: { rgb: '5A5FE0' } },
          };
          return;
        }

        // Alternating row colors
        if (r % 2 === 0) {
          cell.s.fill = { fgColor: { rgb: 'F9FAFC' } };
        } else {
          cell.s.fill = { fgColor: { rgb: 'FFFFFF' } };
        }

        // Col 0: Type d'Opération
        if (c === 0) {
          const val = String(cell.v || '');
          if (val.startsWith('Vente')) {
            cell.s.font = { name: 'Public Sans', sz: 10, bold: true, color: { rgb: '696CFF' } };
          } else {
            cell.s.font = { name: 'Public Sans', sz: 10, bold: true, color: { rgb: 'FF9F43' } };
          }
          cell.s.alignment = { horizontal: 'left' };
        }
        // Numerical cols: Montant TTC (4), Base HT (5), TVA (7)
        else if (c === 4 || c === 5 || c === 7) {
          if (typeof cell.v === 'number') {
            cell.z = '#,##0.00" DH"';
            cell.s.alignment = { horizontal: 'right' };
            cell.s.font = { name: 'Public Sans', sz: 10, bold: true, color: { rgb: '222222' } };
          }
        }
        // Col 6: Taux TVA
        else if (c === 6) {
          cell.s.alignment = { horizontal: 'center' };
        }
        // Col 8: Lien Justificatif
        else if (c === 8) {
          const val = String(cell.v || '');
          if (val.startsWith('http')) {
            cell.s.font = {
              name: 'Public Sans',
              sz: 10,
              color: { rgb: '696CFF' },
              underline: true,
            };
            cell.s.alignment = { horizontal: 'center' };
            cell.l = { Target: val, Tooltip: 'Ouvrir le justificatif' };
            cell.v = 'Voir PDF';
          } else {
            cell.s.font = { name: 'Public Sans', sz: 10, color: { rgb: 'A1ACB8' } };
            cell.s.alignment = { horizontal: 'center' };
          }
        } else {
          cell.s.alignment = { horizontal: 'left' };
        }
      });

      // 6. Set Merges for wsSummary
      wsSummary['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }, // Main title
        { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } }, // Subtitle
        { s: { r: 3, c: 0 }, e: { r: 3, c: 3 } }, // section "INFORMATION DE LA PÉRIODE"
        { s: { r: 9, c: 0 }, e: { r: 9, c: 3 } }, // section "1. FLUX DES VENTES"
        { s: { r: 13, c: 0 }, e: { r: 13, c: 3 } }, // section "2. FLUX DES ACHATS"
        { s: { r: 17, c: 0 }, e: { r: 17, c: 3 } }, // section "3. SOLDE ET BALANCE"
        { s: { r: 25, c: 0 }, e: { r: 25, c: 3 } }, // Footer

        // Merging A:B and C:D for period metadata rows 4 to 7
        { s: { r: 4, c: 0 }, e: { r: 4, c: 1 } },
        { s: { r: 4, c: 2 }, e: { r: 4, c: 3 } },
        { s: { r: 5, c: 0 }, e: { r: 5, c: 1 } },
        { s: { r: 5, c: 2 }, e: { r: 5, c: 3 } },
        { s: { r: 6, c: 0 }, e: { r: 6, c: 1 } },
        { s: { r: 6, c: 2 }, e: { r: 6, c: 3 } },
        { s: { r: 7, c: 0 }, e: { r: 7, c: 1 } },
        { s: { r: 7, c: 2 }, e: { r: 7, c: 3 } },

        // Merge columns A and B on the final total row (row 23)
        { s: { r: 23, c: 0 }, e: { r: 23, c: 1 } },
      ];

      // 7. Column Widths
      wsSummary['!cols'] = [
        { wch: 42 }, // Rubrique / Désignation
        { wch: 32 }, // Formule / Base HT
        { wch: 22 }, // TVA / Montant
        { wch: 32 }, // TTC / Observation
      ];

      wsDetail['!cols'] = [
        { wch: 22 }, // Type d'Opération
        { wch: 25 }, // Partenaire
        { wch: 18 }, // N° de Facture
        { wch: 25 }, // Date Règlement
        { wch: 22 }, // Montant Encaissé
        { wch: 15 }, // Base HT
        { wch: 10 }, // Taux TVA
        { wch: 15 }, // TVA
        { wch: 45 }, // Lien Justificatif
        { wch: 30 }, // Notes
      ];

      // 8. Row Heights
      const summaryRowsHeight = [];
      for (let i = 0; i <= 25; i++) {
        if (i === 0) summaryRowsHeight.push({ hpt: 30 });
        else if (i === 1) summaryRowsHeight.push({ hpt: 20 });
        else if (i === 3 || i === 9 || i === 13 || i === 17) summaryRowsHeight.push({ hpt: 28 });
        else if (i === 10 || i === 14 || i === 18) summaryRowsHeight.push({ hpt: 26 });
        else if (i === 23) summaryRowsHeight.push({ hpt: 35 });
        else if (i === 4 || i === 5 || i === 6 || i === 7) summaryRowsHeight.push({ hpt: 20 });
        else if (i === 2 || i === 8 || i === 12 || i === 16 || i === 22 || i === 24)
          summaryRowsHeight.push({ hpt: 15 });
        else summaryRowsHeight.push({ hpt: 22 });
      }
      wsSummary['!rows'] = summaryRowsHeight;

      const detailRowsHeight = [{ hpt: 30 }];
      for (let i = 1; i <= detailRows.length; i++) {
        detailRowsHeight.push({ hpt: 24 });
      }
      wsDetail['!rows'] = detailRowsHeight;

      // Save file
      const fileName = `Declaration_TVA_${String(dec.month).padStart(2, '0')}_${dec.year}.xlsx`;
      XLSX.writeFile(wb, fileName);
      showToast(`Fichier Excel exporté avec succès : ${fileName}`, 'success');
    } catch (err) {
      console.error('Excel generation error:', err);
      showToast('Erreur lors de la génération du fichier Excel.', 'error');
    }
  };

  const initialMockTransactions = useMemo(() => [], []);

  // Compute combined real transactions with dynamic lock state based on period declarations and the selected tax regime
  const computedTransactions = useMemo(() => {
    const transactions: any[] = [];

    // Local date formatter to avoid UTC timezone shifts
    const formatLocalDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Parse date parts safely
    const parseDateParts = (dateStr: string) => {
      if (!dateStr) return { month: 0, year: 0 };
      const parts = dateStr.split('-');
      if (parts.length < 2) return { month: 0, year: 0 };
      return {
        year: parseInt(parts[0], 10),
        month: parseInt(parts[1], 10),
      };
    };

    // Helper to calculate proportional HT, TVA and TTC for any paid amount on a purchase
    const getPaymentVATMetrics = (pAmount: number, purchase: any) => {
      const isCreditNote =
        purchase.refId?.startsWith('RINV/') || purchase.invoiceNumber?.startsWith('RINV/');
      const factor = isCreditNote ? -1 : 1;
      const amountTTC = pAmount * factor;

      const type = purchase.parentPath === 'clients' ? ('vente' as const) : ('achat' as const);
      const partnerName =
        type === 'vente'
          ? clientsMap[purchase.clientId] || ''
          : suppliersMap[purchase.clientId] || '';

      let taxRate = 20; // Default to 20%
      if (purchase.taxRate !== undefined) {
        taxRate = Number(purchase.taxRate);
      } else if (Number(purchase.taxAmount) > 0) {
        // Estimate rate from stored values
        const calculatedRate = Math.round(
          (Number(purchase.taxAmount) / (Number(purchase.subtotal) || 1)) * 100
        );
        if ([7, 10, 14, 20].includes(calculatedRate)) {
          taxRate = calculatedRate;
        } else {
          taxRate = 20;
        }
      } else {
        const labelUpper = (
          purchase.description ||
          purchase.label ||
          purchase.invoiceNumber ||
          ''
        ).toUpperCase();
        const partnerUpper = partnerName.toUpperCase();
        const isBankFee =
          labelUpper.includes('FRAIS BANCAIRES') ||
          partnerUpper.includes('BANQUE') ||
          labelUpper.includes('BANQUE');
        taxRate = isBankFee ? 10 : 0;
      }

      const amountHT = amountTTC / (1 + taxRate / 100);
      const amountTVA = amountTTC - amountHT;

      return {
        amountHT,
        amountTVA,
        amountTTC,
      };
    };

    // Keep track of which purchases have had any payments from allPayments
    const purchaseIdsWithPayments = new Set<string>();

    // Compute total sum of payments for each purchase from allPayments
    const purchasePaymentsSum: Record<string, number> = {};

    // 1. Process allPayments (cash transactions)
    allPayments.forEach((payment) => {
      const pId = payment.purchaseId;
      if (!pId) return;

      purchaseIdsWithPayments.add(pId);
      purchasePaymentsSum[pId] = (purchasePaymentsSum[pId] || 0) + (Number(payment.amount) || 0);

      // Find the corresponding purchase
      const purchase = allPurchases.find((item) => item.id === pId);
      if (!purchase) return;

      // Skip draft, cancelled, or non-facture client docs (like devis/quotes)
      if (purchase.status === 'Brouillon' || purchase.status === 'Annulée') return;
      if (purchase.parentPath === 'clients' && purchase.type !== 'facture') return;

      const type = purchase.parentPath === 'clients' ? ('vente' as const) : ('achat' as const);

      // Under Régime des Débits, output VAT (vente) is declared on the invoice date, NOT on payment.
      // So skip processing client payments here under Régime des Débits (handled via invoice date instead).
      if (tvaRegime === 'debits' && type === 'vente') {
        return;
      }

      const partnerName =
        type === 'vente'
          ? clientsMap[purchase.clientId] || 'Client Inconnu'
          : suppliersMap[purchase.clientId] || 'Fournisseur Inconnu';

      // Proportional calculation
      const metrics = getPaymentVATMetrics(Number(payment.amount) || 0, purchase);

      let payDateStr = '';
      if (payment.date) {
        const dObj = payment.date.toDate ? payment.date.toDate() : new Date(payment.date);
        payDateStr = formatLocalDate(dObj);
      } else if (payment.paymentDate) {
        payDateStr = payment.paymentDate;
      } else if (purchase.date) {
        const dObj = purchase.date.toDate ? purchase.date.toDate() : new Date(purchase.date);
        payDateStr = formatLocalDate(dObj);
      }

      const { month, year } = parseDateParts(payDateStr);
      const isPeriodLocked = tvaDeclarations.some(
        (dec) => dec.month === month && dec.year === year
      );

      let taxRateValue = 20; // Default to 20%
      if (purchase.taxRate !== undefined) {
        taxRateValue = Number(purchase.taxRate);
      } else if (Number(purchase.taxAmount) > 0) {
        const calculatedRate = Math.round(
          (Number(purchase.taxAmount) / (Number(purchase.subtotal) || 1)) * 100
        );
        if ([7, 10, 14, 20].includes(calculatedRate)) {
          taxRateValue = calculatedRate;
        } else {
          taxRateValue = 20;
        }
      } else {
        const labelUpper = (
          purchase.description ||
          purchase.label ||
          purchase.invoiceNumber ||
          ''
        ).toUpperCase();
        const partnerUpper = partnerName.toUpperCase();
        const isBankFee =
          labelUpper.includes('FRAIS BANCAIRES') ||
          partnerUpper.includes('BANQUE') ||
          labelUpper.includes('BANQUE');
        taxRateValue = isBankFee ? 10 : 0;
      }

      transactions.push({
        id: `pay_${payment.id}`,
        label: `${type === 'vente' ? 'Encaissement Client' : 'Règlement Fournisseur'} - ${purchase.refId || purchase.invoiceNumber || ''} (${payment.notes || ''})`,
        type,
        status: 'payé' as const,
        paymentDate: payDateStr,
        amountHT: metrics.amountHT,
        amountTVA: metrics.amountTVA,
        amountTTC: metrics.amountTTC,
        isLocked: isPeriodLocked,
        invoiceNumber: purchase.refId || purchase.invoiceNumber || '',
        taxRate: taxRateValue,
        attachmentUrl: purchase.attachmentUrl || null,
        partnerName,
        purchaseId: purchase.id,
        clientId: purchase.clientId,
        paymentNotes: payment.notes || '',
      });
    });

    // 2. Process allPurchases
    allPurchases.forEach((p) => {
      // Skip draft, cancelled, or non-facture client docs (like devis/quotes)
      if (p.status === 'Brouillon' || p.status === 'Annulée') return;
      if (p.parentPath === 'clients' && p.type !== 'facture') return;

      const type = p.parentPath === 'clients' ? ('vente' as const) : ('achat' as const);
      const isCreditNote = p.refId?.startsWith('RINV/') || p.invoiceNumber?.startsWith('RINV/');
      const factor = isCreditNote ? -1 : 1;

      const total = (Number(p.total) || 0) * factor;

      const partnerName =
        type === 'vente'
          ? clientsMap[p.clientId] || 'Client Inconnu'
          : suppliersMap[p.clientId] || 'Fournisseur Inconnu';

      let taxRateValue = 20; // Default to 20%
      if (p.taxRate !== undefined) {
        taxRateValue = Number(p.taxRate);
      } else if (Number(p.taxAmount) > 0) {
        const calculatedRate = Math.round((Number(p.taxAmount) / (Number(p.subtotal) || 1)) * 100);
        if ([7, 10, 14, 20].includes(calculatedRate)) {
          taxRateValue = calculatedRate;
        } else {
          taxRateValue = 20;
        }
      } else {
        const labelUpper = (p.description || p.label || p.invoiceNumber || '').toUpperCase();
        const partnerUpper = partnerName.toUpperCase();
        const isBankFee =
          labelUpper.includes('FRAIS BANCAIRES') ||
          partnerUpper.includes('BANQUE') ||
          labelUpper.includes('BANQUE');
        taxRateValue = isBankFee ? 10 : 0;
      }

      const subtotal = total / (1 + taxRateValue / 100);
      const taxAmount = total - subtotal;

      // Date of the invoice
      let invDateStr = '';
      if (p.date) {
        const dObj = p.date.toDate ? p.date.toDate() : new Date(p.date);
        invDateStr = formatLocalDate(dObj);
      }

      // Case A: Accrual basis (Régime des Débits) for Ventes (Sales)
      if (tvaRegime === 'debits' && type === 'vente') {
        const { month, year } = parseDateParts(invDateStr);
        const isPeriodLocked = tvaDeclarations.some(
          (dec) => dec.month === month && dec.year === year
        );

        transactions.push({
          id: p.id,
          label: p.label || `Facture Client N°${p.refId || p.invoiceNumber || ''}`,
          type,
          status: 'payé' as const, // Exigible directly
          paymentDate: invDateStr,
          amountHT: subtotal,
          amountTVA: taxAmount,
          amountTTC: total,
          isLocked: p.isLocked || isPeriodLocked,
          invoiceNumber: p.refId || p.invoiceNumber || '',
          taxRate: taxRateValue,
          attachmentUrl: p.attachmentUrl || null,
          partnerName,
          purchaseId: p.id,
          clientId: p.clientId,
          paymentNotes: 'Exigibilité directe (Régime des Débits)',
        });
        return;
      }

      // Case B: Cash basis (Régime des Encaissements)
      const hasSubcollectionPayments = purchaseIdsWithPayments.has(p.id);

      if (!hasSubcollectionPayments) {
        // Look at inline values if there are no subcollection payments recorded
        const isPaid =
          p.paymentStatus === 'paid' ||
          p.status === 'Payée' ||
          Number(p.total) - (Number(p.amountPaid) || 0) <= 0.05;

        let pDateStr = '';
        if (p.paymentDate) {
          const pdObj = p.paymentDate.toDate ? p.paymentDate.toDate() : new Date(p.paymentDate);
          pDateStr = formatLocalDate(pdObj);
        } else {
          pDateStr = invDateStr;
        }

        const { month: pMonth, year: pYear } = parseDateParts(pDateStr);
        const isPeriodLocked = tvaDeclarations.some(
          (dec) => dec.month === pMonth && dec.year === pYear
        );

        if (isPaid) {
          transactions.push({
            id: p.id,
            label:
              p.label ||
              (type === 'vente'
                ? `Facture Client N°${p.refId || p.invoiceNumber || ''}`
                : `Achat Fournisseur N°${p.refId || p.invoiceNumber || ''}`),
            type,
            status: 'payé' as const,
            paymentDate: pDateStr,
            amountHT: subtotal,
            amountTVA: taxAmount,
            amountTTC: total,
            isLocked: p.isLocked || isPeriodLocked,
            invoiceNumber: p.refId || p.invoiceNumber || '',
            taxRate: taxRateValue,
            attachmentUrl: p.attachmentUrl || null,
            partnerName,
            purchaseId: p.id,
            clientId: p.clientId,
            paymentNotes: p.notes || '',
          });
        } else {
          const acompte = Number(p.amountPaid) || 0;
          if (acompte > 0.01) {
            // Proportional acompte
            const paidMetrics = getPaymentVATMetrics(acompte, p);
            transactions.push({
              id: `${p.id}_acompte`,
              label: `${type === 'vente' ? 'Acompte Client' : 'Acompte Versé'} - ${p.refId || p.invoiceNumber || ''}`,
              type,
              status: 'payé' as const,
              paymentDate: invDateStr, // Paid on invoice date by default
              amountHT: paidMetrics.amountHT,
              amountTVA: paidMetrics.amountTVA,
              amountTTC: paidMetrics.amountTTC,
              isLocked: p.isLocked || isPeriodLocked,
              invoiceNumber: p.refId || p.invoiceNumber || '',
              taxRate: taxRateValue,
              attachmentUrl: p.attachmentUrl || null,
              partnerName,
              purchaseId: p.id,
              clientId: p.clientId,
              paymentNotes: 'Acompte initial',
            });

            // Rest is unpaid (en attente)
            const remaining = Math.max(0, total - acompte);
            if (remaining > 0.01) {
              const unpaidMetrics = getPaymentVATMetrics(remaining, p);
              transactions.push({
                id: `${p.id}_reste`,
                label: `Solde à crédit - ${p.refId || p.invoiceNumber || ''}`,
                type,
                status: 'en_attente' as const,
                paymentDate: invDateStr,
                amountHT: unpaidMetrics.amountHT,
                amountTVA: unpaidMetrics.amountTVA,
                amountTTC: unpaidMetrics.amountTTC,
                isLocked: p.isLocked || isPeriodLocked,
                invoiceNumber: p.refId || p.invoiceNumber || '',
                taxRate: taxRateValue,
                attachmentUrl: p.attachmentUrl || null,
                partnerName,
                purchaseId: p.id,
                clientId: p.clientId,
                paymentNotes: 'Solde impayé',
              });
            }
          } else {
            // Fully unpaid (en attente)
            transactions.push({
              id: p.id,
              label:
                p.label ||
                (type === 'vente'
                  ? `Facture Client N°${p.refId || p.invoiceNumber || ''}`
                  : `Achat Fournisseur N°${p.refId || p.invoiceNumber || ''}`),
              type,
              status: 'en_attente' as const,
              paymentDate: invDateStr,
              amountHT: subtotal,
              amountTVA: taxAmount,
              amountTTC: total,
              isLocked: p.isLocked || isPeriodLocked,
              invoiceNumber: p.refId || p.invoiceNumber || '',
              taxRate: taxRateValue,
              attachmentUrl: p.attachmentUrl || null,
              partnerName,
              purchaseId: p.id,
              clientId: p.clientId,
              paymentNotes: '',
            });
          }
        }
      } else {
        // If there are subcollection payments, the paid parts are handled by step 1.
        // We only show the unpaid part as 'en_attente' so it shows up in the grid
        const paidSoFar = purchasePaymentsSum[p.id] || 0;
        const remaining = Math.max(0, total - paidSoFar);

        if (remaining > 0.05) {
          const unpaidMetrics = getPaymentVATMetrics(remaining, p);
          const { month: invMonth, year: invYear } = parseDateParts(invDateStr);
          const isPeriodLocked = tvaDeclarations.some(
            (dec) => dec.month === invMonth && dec.year === invYear
          );

          transactions.push({
            id: `${p.id}_reste`,
            label: `Solde à crédit - ${p.refId || p.invoiceNumber || ''}`,
            type,
            status: 'en_attente' as const,
            paymentDate: invDateStr,
            amountHT: unpaidMetrics.amountHT,
            amountTVA: unpaidMetrics.amountTVA,
            amountTTC: unpaidMetrics.amountTTC,
            isLocked: p.isLocked || isPeriodLocked,
            invoiceNumber: p.refId || p.invoiceNumber || '',
            taxRate: taxRateValue,
            attachmentUrl: p.attachmentUrl || null,
            partnerName,
            purchaseId: p.id,
            clientId: p.clientId,
            paymentNotes: 'Solde impayé',
          });
        }
      }
    });

    // 3. Add Direct Charges from Bank Reconciliations
    bankTransactions
      .filter((tx) => tx.matchedDocParentType === 'direct_charge')
      .forEach((tx) => {
        const txDate = tx.date?.toDate ? tx.date.toDate() : new Date(tx.date || 0);
        const dateStr = formatLocalDate(txDate);
        const { month, year } = parseDateParts(dateStr);
        const isPeriodLocked = tvaDeclarations.some(
          (dec) => dec.month === month && dec.year === year
        );

        transactions.push({
          id: tx.id,
          label: tx.matchedDocument || tx.label || 'Charge bancaire',
          type: 'achat' as const,
          status: 'payé' as const,
          paymentDate: dateStr,
          amountHT: tx.subtotal || 0,
          amountTVA: tx.tvaAmount || 0,
          amountTTC: Math.abs(tx.amount) || 0,
          isLocked: isPeriodLocked,
          invoiceNumber: tx.matchedDocument || 'DIRECT_DEBIT',
          taxRate: tx.tvaRate !== undefined ? Number(tx.tvaRate) : 20,
          attachmentUrl: tx.attachmentUrl || null,
          partnerName: tx.chargeCategory || 'Banque',
          purchaseId: tx.id,
          paymentNotes: tx.label || 'Frais bancaires',
        });
      });

    return transactions;
  }, [
    allPurchases,
    tvaDeclarations,
    allPayments,
    bankTransactions,
    tvaRegime,
    clientsMap,
    suppliersMap,
  ]);

  // Compute TVA declarations metrics based on active month and year
  const tvaStats = useMemo(() => {
    const filtered = computedTransactions.filter((tx) => {
      if (!tx.paymentDate) return false;
      const parts = tx.paymentDate.split('-');
      if (parts.length < 2) return false;
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      return m === selectedMonth && y === selectedYear;
    });

    // Régime des encaissements rule: Only paid (or settled/reconciled) transactions are included
    const paidFiltered = filtered.filter((tx) => tx.status === 'payé');

    const tvaCollectee = paidFiltered
      .filter((tx) => tx.type === 'vente')
      .reduce((sum, tx) => sum + tx.amountTVA, 0);

    const sumVentesHT = paidFiltered
      .filter((tx) => tx.type === 'vente')
      .reduce((sum, tx) => sum + tx.amountHT, 0);

    const sumVentesTTC = paidFiltered
      .filter((tx) => tx.type === 'vente')
      .reduce((sum, tx) => sum + tx.amountTTC, 0);

    const tvaRecuperable = paidFiltered
      .filter((tx) => tx.type === 'achat')
      .reduce((sum, tx) => sum + tx.amountTVA, 0);

    const sumAchatsHT = paidFiltered
      .filter((tx) => tx.type === 'achat')
      .reduce((sum, tx) => sum + tx.amountHT, 0);

    const sumAchatsTTC = paidFiltered
      .filter((tx) => tx.type === 'achat')
      .reduce((sum, tx) => sum + tx.amountTTC, 0);

    const resultatTVA = tvaCollectee - tvaRecuperable;
    const typeResultat = resultatTVA >= 0 ? 'TVA à décaisser' : 'Crédit de TVA';

    return {
      allFiltered: filtered,
      paidFiltered,
      tvaCollectee,
      tvaRecuperable,
      resultatTVA,
      typeResultat,
      sumVentesHT,
      sumVentesTTC,
      sumAchatsHT,
      sumAchatsTTC,
      hasTransactions: filtered.length > 0,
    };
  }, [computedTransactions, selectedMonth, selectedYear]);

  // Is current period already locked?
  const isCurrentPeriodLocked = useMemo(() => {
    return tvaDeclarations.some((dec) => dec.month === selectedMonth && dec.year === selectedYear);
  }, [tvaDeclarations, selectedMonth, selectedYear]);

  // Clôturer la période action
  const handleLockPeriod = async () => {
    if (!user) return;

    if (isCurrentPeriodLocked) {
      showToast('Cette période est déjà clôturée.', 'error');
      return;
    }

    if (tvaStats.paidFiltered.length === 0) {
      showToast('Aucune transaction payée pour cette période.', 'error');
      return;
    }

    confirm({
      title: 'Clôturer la période fiscale',
      message: `Voulez-vous clôturer la déclaration de TVA pour la période ${String(selectedMonth).padStart(2, '0')}/${selectedYear} ? Les transactions de ce mois seront verrouillées de manière définitive (isLocked = true).`,
      confirmText: 'Confirmer & Clôturer',
      cancelText: 'Annuler',
      variant: 'danger',
      onConfirm: async () => {
        try {
          const decCode = 'DEC-' + Math.floor(Math.random() * 900000 + 100000);
          const declObj = {
            month: selectedMonth,
            year: selectedYear,
            tvaCollectee: tvaStats.tvaCollectee,
            tvaRecuperable: tvaStats.tvaRecuperable,
            netResult: tvaStats.resultatTVA,
            typeResultat: tvaStats.typeResultat,
            declaredAt: new Date().toISOString(),
            declarationCode: decCode,
            ownerId: user.uid,
            transactionCount: tvaStats.paidFiltered.length,
          };

          await addDoc(collection(db, 'tva_declarations'), declObj);

          console.log('Clôture comptable réussie. Objet Déclaration comptabilisé :', declObj);
          showToast(
            `Période ${String(selectedMonth).padStart(2, '0')}/${selectedYear} clôturée ! Déclaration n° ${decCode} transmise.`,
            'success'
          );
        } catch (e) {
          console.error('Error locking period:', e);
          showToast('Erreur lors de la clôture de la période.', 'error');
        }
      },
    });
  };

  // Compute Client Invoices Stats (Unpaid vs Overdue)
  const clientInvoiceStats = useMemo(() => {
    let nonPayeTotal = 0;
    let nonPayeCount = 0;
    let enRetardTotal = 0;
    let enRetardCount = 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    invoices.forEach((inv) => {
      // Exclude draft and cancelled
      if (inv.status === 'Brouillon' || inv.status === 'Annulée') return;

      const total = Number(inv.total) || 0;
      const isPaid = inv.paymentStatus === 'paid';
      const paid = inv.amountPaid !== undefined ? Number(inv.amountPaid) || 0 : isPaid ? total : 0;
      const remaining = total - paid;

      if (remaining > 0.05) {
        nonPayeTotal += remaining;
        nonPayeCount++;

        // Determine if Overdue
        let isOverdue = false;
        if (inv.dueDate) {
          let dueD: Date | null = null;
          if (inv.dueDate.toDate) {
            dueD = inv.dueDate.toDate();
          } else {
            dueD = new Date(inv.dueDate);
          }
          if (dueD && dueD < today) {
            isOverdue = true;
          }
        } else {
          // If no due date is set, assume overdue if older than 30 days
          let invDate: Date | null = null;
          if (inv.date && inv.date.toDate) {
            invDate = inv.date.toDate();
          } else if (inv.date) {
            invDate = new Date(inv.date);
          }
          if (invDate) {
            const diffDays = Math.ceil(
              (today.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24)
            );
            if (diffDays > 30) {
              isOverdue = true;
            }
          }
        }

        if (isOverdue) {
          enRetardTotal += remaining;
          enRetardCount++;
        }
      }
    });

    return {
      nonPayeTotal,
      nonPayeCount,
      enRetardTotal,
      enRetardCount,
    };
  }, [invoices]);

  // Compute Aging Buckets for Bar Chart (matches the categories in screenshot exactly)
  // Buckets:
  // 1. Dû (Overdue)
  // 2. 15 - 21 juin (Last Week / Recent)
  // 3. Cette semaine (Current Week)
  // 4. 29 juin - 5 juil. (Next Week)
  // 5. 6 - 12 juil. (In 2 Weeks)
  // 6. Pas dû (Au-delà / Future)
  const agingChartData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Dynamic dates relative to today
    // Last Week (7-14 days ago)
    const startLw = new Date(today);
    startLw.setDate(today.getDate() - 14);
    const endLw = new Date(today);
    endLw.setDate(today.getDate() - 7);
    endLw.setHours(23, 59, 59, 999);

    // This Week (0-6 days ago)
    const startCw = new Date(today);
    startCw.setDate(today.getDate() - 6);
    const endCw = new Date(today);
    endCw.setHours(23, 59, 59, 999);

    // Next Week (1-7 days in future)
    const startNw1 = new Date(today);
    startNw1.setDate(today.getDate() + 1);
    const endNw1 = new Date(today);
    endNw1.setDate(today.getDate() + 7);
    endNw1.setHours(23, 59, 59, 999);

    // In 2 Weeks (8-14 days in future)
    const startNw2 = new Date(today);
    startNw2.setDate(today.getDate() + 8);
    const endNw2 = new Date(today);
    endNw2.setDate(today.getDate() + 14);
    endNw2.setHours(23, 59, 59, 999);

    let duTotal = 0;
    let lwTotal = 0;
    let cwTotal = 0;
    let nw1Total = 0;
    let nw2Total = 0;
    let pasDuTotal = 0;

    invoices.forEach((inv) => {
      if (inv.status === 'Brouillon' || inv.status === 'Annulée') return;

      const total = Number(inv.total) || 0;
      const isPaid = inv.paymentStatus === 'paid';
      const paid = inv.amountPaid !== undefined ? Number(inv.amountPaid) || 0 : isPaid ? total : 0;
      const remaining = total - paid;

      if (remaining <= 0.05) return; // ignore fully paid

      let dueD: Date | null = null;
      if (inv.dueDate) {
        dueD = inv.dueDate.toDate ? inv.dueDate.toDate() : new Date(inv.dueDate);
      } else if (inv.date) {
        dueD = inv.date.toDate ? inv.date.toDate() : new Date(inv.date);
      }

      if (!dueD) {
        pasDuTotal += remaining;
        return;
      }

      const dueTime = dueD.getTime();

      if (dueTime < startLw.getTime()) {
        duTotal += remaining; // Overdue / before last week
      } else if (dueTime >= startLw.getTime() && dueTime <= endLw.getTime()) {
        lwTotal += remaining; // Last week
      } else if (dueTime >= startCw.getTime() && dueTime <= endCw.getTime()) {
        cwTotal += remaining; // This week
      } else if (dueTime >= startNw1.getTime() && dueTime <= endNw1.getTime()) {
        nw1Total += remaining; // Next week
      } else if (dueTime >= startNw2.getTime() && dueTime <= endNw2.getTime()) {
        nw2Total += remaining; // In 2 weeks
      } else {
        pasDuTotal += remaining; // Beyond 2 weeks
      }
    });

    const maxVal = Math.max(duTotal, lwTotal, cwTotal, nw1Total, nw2Total, pasDuTotal, 1);

    const formatDateRange = (start: Date, end: Date) => {
      return `${start.getDate()} - ${end.getDate()} ${end.toLocaleDateString('fr-FR', { month: 'short' })}`;
    };

    return [
      {
        label: 'Dû',
        value: duTotal,
        percent: (duTotal / maxVal) * 100,
        colorClass: 'bg-[#e2d9e2]',
      },
      {
        label: formatDateRange(startLw, endLw),
        value: lwTotal,
        percent: (lwTotal / maxVal) * 100,
        colorClass: 'bg-[#e2d9e2]',
      },
      {
        label: 'Cette semaine',
        value: cwTotal,
        percent: (cwTotal / maxVal) * 100,
        colorClass: 'bg-[#a9dfdf]',
      },
      {
        label: formatDateRange(startNw1, endNw1),
        value: nw1Total,
        percent: (nw1Total / maxVal) * 100,
        colorClass: 'bg-[#a9dfdf]',
      },
      {
        label: formatDateRange(startNw2, endNw2),
        value: nw2Total,
        percent: (nw2Total / maxVal) * 100,
        colorClass: 'bg-[#a9dfdf]',
      },
      {
        label: 'Pas dû',
        value: pasDuTotal,
        percent: (pasDuTotal / maxVal) * 100,
        colorClass: 'bg-[#e2d9e2]',
      },
    ];
  }, [invoices]);

  // Compute Balances and Trend Charts for journals (UMNIA BANK & Espèces)
  const bankStats = useMemo(() => {
    const umniaTxs = bankTransactions.filter((t) => t.journal === 'UMNIA BANK');
    const especesTxs = bankTransactions.filter((t) => t.journal === 'Espèces');

    // Chronological sort for trend projection
    const sortTxs = (txList: any[]) => {
      return [...txList].sort((a, b) => {
        const dateA = a.date
          ? a.date.seconds
            ? a.date.seconds * 1000
            : new Date(a.date).getTime()
          : 0;
        const dateB = b.date
          ? b.date.seconds
            ? b.date.seconds * 1000
            : new Date(b.date).getTime()
          : 0;
        return dateA - dateB;
      });
    };

    const sortedUmnia = sortTxs(umniaTxs);
    const sortedEspeces = sortTxs(especesTxs);

    // Compute balance (simple sum)
    const umniaBalance = umniaTxs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
    const especesBalance = especesTxs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

    // Build trend series (cumulative sum over time)
    const buildTrend = (txs: any[], baseBalance: number) => {
      let current = 0;
      const points = txs.map((t) => {
        current += Number(t.amount) || 0;
        return current;
      });

      // Ensure we have at least 2 points for a nice visual line
      if (points.length === 0) {
        return [0, 0, 0];
      }
      if (points.length === 1) {
        return [points[0], points[0]];
      }
      return points;
    };

    const umniaTrendPoints = buildTrend(sortedUmnia, umniaBalance);
    const especesTrendPoints = buildTrend(sortedEspeces, especesBalance);

    // Format helper for rendering neat SVG path
    const getSvgPathAndGradient = (points: number[], width: number, height: number) => {
      if (points.length < 2) return { path: '', areaPath: '' };

      const minVal = Math.min(...points, 0);
      const maxVal = Math.max(...points, 1);
      const range = maxVal - minVal;

      const paddingX = 10;
      const paddingY = 15;
      const graphWidth = width - paddingX * 2;
      const graphHeight = height - paddingY * 2;

      const coordinates = points.map((val, idx) => {
        const x = paddingX + (idx / (points.length - 1)) * graphWidth;
        // SVG coordinates start at top-left, so flip y
        const y = paddingY + graphHeight - ((val - minVal) / range) * graphHeight;
        return { x, y };
      });

      let path = `M ${coordinates[0].x} ${coordinates[0].y}`;
      for (let i = 1; i < coordinates.length; i++) {
        path += ` L ${coordinates[i].x} ${coordinates[i].y}`;
      }

      // Closing the path for gradient fill
      const areaPath = `${path} L ${coordinates[coordinates.length - 1].x} ${height} L ${coordinates[0].x} ${height} Z`;

      return { path, areaPath };
    };

    return {
      umniaBalance,
      especesBalance,
      umniaTrendPoints,
      especesTrendPoints,
      getSvgPathAndGradient,
    };
  }, [bankTransactions]);

  // Navigate to Rapprochement page with preselected filters
  const handleGoToTransactions = (journal: 'UMNIA BANK' | 'Espèces') => {
    // We can store standard local preferences or state, then navigate
    localStorage.setItem('rapprochement_selected_journal', journal);
    navigate('/rapprochement');
  };

  return (
    <div className="w-full select-none relative bg-transparent py-4 space-y-6">
      {/* Navigation Tabs & Actions (Style Sneat) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 dark:border-[#434460]/20 mb-6 select-none gap-4">
        <div className="flex">
          <button
            onClick={() => setActiveSubTab('overview')}
            className={`px-5 py-2.5 border-b-2 font-semibold text-sm transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'overview'
                ? 'border-[#696cff] text-[#696cff]'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-[#dbdade]'
            }`}
          >
            <Scale className="w-4.5 h-4.5" />
            Cockpit Financier
          </button>
          <button
            onClick={() => setActiveSubTab('tva')}
            className={`px-5 py-2.5 border-b-2 font-semibold text-sm transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === 'tva'
                ? 'border-[#696cff] text-[#696cff]'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-[#dbdade]'
            }`}
          >
            <Percent className="w-4.5 h-4.5" />
            Calculateur de TVA & Clôture
          </button>
        </div>

        {/* Action Button on the right, matches finexy quote/facture design */}
        <div className="flex items-center gap-2 sm:mb-1.5 px-4 sm:px-0">
          <button
            onClick={() => setIsAddMiscModalOpen(true)}
            className="bg-[#696cff] hover:bg-[#5f61e6] text-white font-semibold text-xs h-[34px] px-4 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
          >
            <PlusCircle className="w-4 h-4" />
            Saisir Écriture
          </button>
        </div>
      </div>

      {activeSubTab === 'overview' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          {/* Card 1: Factures clients */}
          <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between min-h-[380px]">
            <div>
              <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-[#434460]/20">
                <h2 className="text-[16px] font-semibold text-[#435971] dark:text-[#dbdade] tracking-tight">
                  Factures clients
                </h2>
                <button
                  onClick={() => navigate('/add-purchase?type=facture')}
                  className="bg-[#6f42c1] hover:bg-[#623aa9] text-white font-semibold text-xs py-1.5 px-3.5 rounded-lg border-0 cursor-pointer transition-colors"
                >
                  Nouveau
                </button>
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-2 gap-4 my-5 select-none">
                <div className="flex flex-col text-left">
                  <span className="text-[14px] text-slate-400 font-medium">
                    {clientInvoiceStats.nonPayeCount} Non payé
                  </span>
                  <span className="text-[19px] font-bold font-mono text-[#222222] dark:text-[#e1e2ec] mt-1">
                    {clientInvoiceStats.nonPayeTotal.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-xs">DH</span>
                  </span>
                </div>
                <div className="flex flex-col text-left">
                  <span className="text-[14px] text-slate-400 font-medium">
                    {clientInvoiceStats.enRetardCount} En retard
                  </span>
                  <span className="text-[19px] font-bold font-mono text-[#222222] dark:text-[#e1e2ec] mt-1">
                    {clientInvoiceStats.enRetardTotal.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-xs">DH</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Aging Column Chart (matches mockup closely with vertical dividers and grid lines) */}
            <div className="relative mt-2">
              <div className="h-[140px] flex items-end justify-between w-full relative pt-2 border-b border-slate-200 dark:border-[#434460]/30">
                {/* Background Grid Lines */}
                <div className="absolute inset-x-0 top-0 bottom-0 flex justify-between pointer-events-none">
                  {[0, 1, 2, 3, 4, 5].map((_, i) => (
                    <div
                      key={i}
                      className="h-full w-px border-l border-dashed border-slate-100 dark:border-[#434460]/10"
                    />
                  ))}
                </div>

                {agingChartData.map((bucket, index) => (
                  <div
                    key={index}
                    className="flex flex-col items-center flex-1 h-full justify-end group px-1 relative z-10"
                  >
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-[105%] bg-slate-900 text-white text-[10px] font-mono px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-md">
                      {bucket.value.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH
                    </div>

                    {/* Column Bar */}
                    <div
                      className={`w-full max-w-[28px] ${bucket.colorClass} rounded-t transition-all duration-500 hover:opacity-90 cursor-pointer`}
                      style={{ height: `${Math.max(bucket.percent, 6)}%` }}
                    />
                  </div>
                ))}
              </div>

              {/* Labels under the columns */}
              <div className="flex justify-between w-full mt-2 select-none">
                {agingChartData.map((bucket, index) => (
                  <div
                    key={index}
                    className="flex-1 text-center text-[10px] md:text-[11px] font-medium text-slate-400 truncate px-0.5"
                  >
                    {bucket.label}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Card 2: Opérations diverses */}
          <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between min-h-[380px]">
            <div>
              <div className="flex justify-between items-center pb-4 border-b border-slate-100 dark:border-[#434460]/20">
                <h2 className="text-[16px] font-semibold text-[#435971] dark:text-[#dbdade] tracking-tight">
                  Opérations diverses
                </h2>
                <button
                  onClick={() => setIsTaxModalOpen(true)}
                  className="bg-[#71dd37]/15 dark:bg-[#71dd37]/10 text-[#54ae25] dark:text-[#71dd37] font-semibold text-xs py-1.5 px-3.5 rounded-lg border-0 cursor-pointer hover:bg-[#71dd37]/20 transition-colors"
                >
                  Déclarations fiscales
                </button>
              </div>

              {/* List of journal items */}
              <div className="mt-4 space-y-1 overflow-y-auto max-h-[220px] pr-1">
                {miscOperations.map((op, idx) => (
                  <div
                    key={op.id + "_" + String(idx)}
                    className="flex items-center justify-between py-3 border-b border-slate-100/70 dark:border-[#434460]/10 hover:bg-slate-50/40 dark:hover:bg-slate-800/10 transition-colors px-1"
                  >
                    <div className="flex items-start gap-3 text-left">
                      <div
                        className={`p-1.5 rounded-lg mt-0.5 ${
                          op.type === 'impot'
                            ? 'text-rose-500 bg-rose-50 dark:bg-rose-950/20'
                            : op.type === 'taxe'
                              ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/20'
                              : 'text-slate-500 bg-slate-50 dark:bg-slate-800'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                      </div>
                      <div>
                        <p className="text-[13px] font-medium text-slate-700 dark:text-slate-200 leading-tight">
                          {op.label}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1 font-mono">
                          N° journal OP-{op.id.slice(0, 5).toUpperCase()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="flex flex-col text-right">
                        {/* Monetary amount in Mono */}
                        <span className="text-[14px] font-bold font-mono text-[#222222] dark:text-[#e1e2ec]">
                          {op.amount.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                        {/* Date in beautiful Light Red as requested */}
                        <span className="text-[11px] font-medium text-[#ff3e1d] font-mono mt-0.5">
                          {new Date(op.date).toLocaleDateString('fr-FR')}
                        </span>
                      </div>

                      {/* Delete entry */}
                      <button
                        onClick={() => handleDeleteMiscOperation(op.id, op.label)}
                        className="p-1 text-slate-300 hover:text-rose-500 rounded transition-colors"
                        title="Supprimer cette écriture"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}

                {miscOperations.length === 0 && !isLoading && (
                  <div className="text-center py-8 text-slate-400 text-xs">
                    Aucune opération diverse enregistrée.
                  </div>
                )}
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-[#434460]/20 flex justify-end">
              <button
                onClick={() => setIsAddMiscModalOpen(true)}
                className="text-slate-400 hover:text-[#696cff] transition-colors text-xs font-semibold flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Saisir une opération
              </button>
            </div>
          </div>

          {/* Card 3: UMNIA BANK */}
          <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between min-h-[240px]">
            <div>
              <div className="flex justify-between items-center pb-3">
                <h2 className="text-[16px] font-semibold text-[#005c53] dark:text-[#26d1bf] tracking-tight flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#005c53] dark:bg-[#26d1bf]" />
                  UMNIA BANK
                </h2>
                <button
                  onClick={() => handleGoToTransactions('UMNIA BANK')}
                  className="bg-[#6f42c1] hover:bg-[#623aa9] text-white font-semibold text-xs py-1.5 px-3.5 rounded-lg border-0 cursor-pointer transition-colors"
                >
                  Transactions
                </button>
              </div>

              <div className="flex justify-between items-baseline mt-2 mb-3">
                <span className="text-[13px] text-slate-400 font-medium">Solde</span>
                <span
                  className={`text-[21px] font-bold font-mono ${bankStats.umniaBalance >= 0 ? 'text-[#4fb922] dark:text-[#71dd37]' : 'text-rose-500'}`}
                >
                  {bankStats.umniaBalance.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  DH
                </span>
              </div>
            </div>

            {/* Svg trend line chart */}
            <div className="w-full h-[80px] mt-2 relative">
              <svg viewBox="0 0 380 80" className="w-full h-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="umniaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#005c53" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#005c53" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Paths from computed stats */}
                {(() => {
                  const { path, areaPath } = bankStats.getSvgPathAndGradient(
                    bankStats.umniaTrendPoints,
                    380,
                    80
                  );
                  if (!path) return null;
                  return (
                    <>
                      <path d={areaPath} fill="url(#umniaGrad)" />
                      <path
                        d={path}
                        fill="none"
                        stroke="#005c53"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      {/* Pulsing endpoint dot */}
                      {bankStats.umniaTrendPoints.length > 0 && (
                        <circle
                          cx={370}
                          cy={
                            bankStats
                              .getSvgPathAndGradient(bankStats.umniaTrendPoints, 380, 80)
                              .path.split(' ')
                              .slice(-1)[0]
                              .split(',')[1] || 40
                          }
                          r="3.5"
                          fill="#005c53"
                          className="animate-pulse"
                        />
                      )}
                    </>
                  );
                })()}
              </svg>
            </div>
          </div>

          {/* Card 4: Espèces */}
          <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between min-h-[240px]">
            <div>
              <div className="flex justify-between items-center pb-3">
                <h2 className="text-[16px] font-semibold text-[#854d0e] dark:text-[#f59e0b] tracking-tight flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#854d0e] dark:bg-[#f59e0b]" />
                  Espèces
                </h2>
                <button
                  onClick={() => handleGoToTransactions('Espèces')}
                  className="bg-[#6f42c1] hover:bg-[#623aa9] text-white font-semibold text-xs py-1.5 px-3.5 rounded-lg border-0 cursor-pointer transition-colors"
                >
                  Transactions
                </button>
              </div>

              <div className="flex justify-between items-baseline mt-2 mb-3">
                <span className="text-[13px] text-slate-400 font-medium">Solde</span>
                <span
                  className={`text-[21px] font-bold font-mono ${bankStats.especesBalance >= 0 ? 'text-[#4fb922] dark:text-[#71dd37]' : 'text-rose-500'}`}
                >
                  {bankStats.especesBalance.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  DH
                </span>
              </div>
            </div>

            {/* Svg trend line chart */}
            <div className="w-full h-[80px] mt-2 relative">
              <svg viewBox="0 0 380 80" className="w-full h-full" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="especesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
                  </linearGradient>
                </defs>

                {/* Paths from computed stats */}
                {(() => {
                  const { path, areaPath } = bankStats.getSvgPathAndGradient(
                    bankStats.especesTrendPoints,
                    380,
                    80
                  );
                  if (!path) return null;
                  return (
                    <>
                      <path d={areaPath} fill="url(#especesGrad)" />
                      <path
                        d={path}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      {/* Endpoint dot */}
                      {bankStats.especesTrendPoints.length > 0 && (
                        <circle
                          cx={370}
                          cy={
                            bankStats
                              .getSvgPathAndGradient(bankStats.especesTrendPoints, 380, 80)
                              .path.split(' ')
                              .slice(-1)[0]
                              .split(',')[1] || 40
                          }
                          r="3.5"
                          fill="#f59e0b"
                        />
                      )}
                    </>
                  );
                })()}
              </svg>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-fadeIn text-left">
          {/* Header Controls */}
          <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div>
              <h2 className="text-[16px] font-semibold text-[#435971] dark:text-[#dbdade] tracking-tight flex items-center gap-2">
                <Percent className="w-4.5 h-4.5 text-[#696cff]" />
                Calculateur de TVA & Période Fiscale
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {tvaRegime === 'encaissements'
                  ? 'Régime marocain des encaissements : La TVA collectée et récupérable est calculée sur les encaissements et règlements réels.'
                  : 'Régime marocain des débits : La TVA collectée est due dès la facturation client, tandis que la TVA récupérable reste basée sur les règlements.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Regime Selector */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase font-bold text-slate-400">Régime :</span>
                <select
                  value={tvaRegime}
                  onChange={(e) => setTvaRegime(e.target.value as 'encaissements' | 'debits')}
                  className="bg-transparent dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/40 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#696cff] outline-none cursor-pointer focus:border-[#696cff]"
                >
                  <option value="encaissements" className="dark:bg-[#2b2c40]">
                    Encaissements
                  </option>
                  <option value="debits" className="dark:bg-[#2b2c40]">
                    Débits (Facturation)
                  </option>
                </select>
              </div>

              {/* Month Selector */}
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="bg-transparent dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/40 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-[#dbdade] outline-none cursor-pointer focus:border-[#696cff]"
              >
                {[
                  { val: 1, label: 'Janvier' },
                  { val: 2, label: 'Février' },
                  { val: 3, label: 'Mars' },
                  { val: 4, label: 'Avril' },
                  { val: 5, label: 'Mai' },
                  { val: 6, label: 'Juin' },
                  { val: 7, label: 'Juillet' },
                  { val: 8, label: 'Août' },
                  { val: 9, label: 'Septembre' },
                  { val: 10, label: 'Octobre' },
                  { val: 11, label: 'Novembre' },
                  { val: 12, label: 'Décembre' },
                ].map((m) => (
                  <option key={m.val} value={m.val} className="dark:bg-[#2b2c40]">
                    {m.label}
                  </option>
                ))}
              </select>

              {/* Year Selector */}
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="bg-transparent dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/40 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-[#dbdade] outline-none cursor-pointer focus:border-[#696cff]"
              >
                {[2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028].map((y) => (
                  <option key={y} value={y} className="dark:bg-[#2b2c40]">
                    {y}
                  </option>
                ))}
              </select>

              {/* Status Badge */}
              {isCurrentPeriodLocked ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/20 px-2.5 py-1 rounded-full border border-emerald-100">
                  <CheckCircle className="w-3 h-3" />
                  Clôturé
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-500 bg-amber-50/70 dark:bg-amber-950/20 px-2.5 py-1 rounded-full border border-amber-100">
                  <AlertCircle className="w-3 h-3" />
                  Période Ouverte
                </span>
              )}
            </div>
          </div>

          {/* 3-Column KPI Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* KPI 1: TVA Collectée */}
            <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[12px] text-slate-400 font-bold uppercase tracking-wider block">
                    TVA Collectée (Ventes)
                  </span>
                  <span className="text-[24px] font-black font-mono text-[#222222] dark:text-[#e1e2ec] mt-2 block">
                    {tvaStats.tvaCollectee.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-sm">DH</span>
                  </span>
                  <span className="text-[11px] text-[#566a7f] dark:text-slate-400 mt-1 block">
                    Cumul ventes :{' '}
                    <strong className="font-mono text-emerald-600 dark:text-emerald-400">
                      {tvaStats.sumVentesTTC.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </strong>{' '}
                    <span className="text-[9px] uppercase font-bold text-slate-400">TTC</span>
                  </span>
                </div>
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/10 text-emerald-500 rounded-lg">
                  <TrendingUp className="w-5 h-5" />
                </div>
              </div>
              <div className="border-t border-slate-100 dark:border-[#434460]/10 mt-4 pt-3 flex justify-between text-xs text-slate-400 font-medium">
                <span>Ventes encaissées payées</span>
                <span className="text-slate-600 dark:text-[#dbdade]">
                  {tvaStats.paidFiltered.filter((tx) => tx.type === 'vente').length} facture(s)
                </span>
              </div>
            </div>

            {/* KPI 2: TVA Récupérable */}
            <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div>
                  <span className="text-[12px] text-slate-400 font-bold uppercase tracking-wider block">
                    TVA Récupérable (Achats)
                  </span>
                  <span className="text-[24px] font-black font-mono text-[#222222] dark:text-[#e1e2ec] mt-2 block">
                    {tvaStats.tvaRecuperable.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-sm">DH</span>
                  </span>
                  <span className="text-[11px] text-[#566a7f] dark:text-slate-400 mt-1 block">
                    Cumul achats :{' '}
                    <strong className="font-mono text-rose-600 dark:text-rose-400">
                      {tvaStats.sumAchatsTTC.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </strong>{' '}
                    <span className="text-[9px] uppercase font-bold text-slate-400">TTC</span>
                  </span>
                </div>
                <div className="p-2 bg-rose-50 dark:bg-rose-950/10 text-rose-500 rounded-lg">
                  <TrendingDown className="w-5 h-5" />
                </div>
              </div>
              <div className="border-t border-slate-100 dark:border-[#434460]/10 mt-4 pt-3 flex justify-between text-xs text-slate-400 font-medium">
                <span>Achats réglés payés</span>
                <span className="text-slate-600 dark:text-[#dbdade]">
                  {tvaStats.paidFiltered.filter((tx) => tx.type === 'achat').length} achat(s)
                </span>
              </div>
            </div>

            {/* KPI 3: Solde fiscal final */}
            <div
              className={`border rounded-lg p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col justify-between ${
                tvaStats.resultatTVA >= 0
                  ? 'bg-rose-50/40 dark:bg-rose-950/10 border-rose-100 dark:border-rose-950/30'
                  : 'bg-emerald-50/40 dark:bg-emerald-950/10 border-emerald-100 dark:border-emerald-950/30'
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <span
                    className={`text-[12px] font-bold uppercase tracking-wider block ${
                      tvaStats.resultatTVA >= 0 ? 'text-rose-500' : 'text-emerald-500'
                    }`}
                  >
                    {tvaStats.resultatTVA >= 0
                      ? 'TVA à décaisser (Net à payer)'
                      : 'Crédit de TVA (Reportable)'}
                  </span>
                  <span
                    className={`text-[24px] font-black font-mono mt-2 block ${
                      tvaStats.resultatTVA >= 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {Math.abs(tvaStats.resultatTVA).toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-sm font-semibold">DH</span>
                  </span>
                  {tvaStats.resultatTVA >= 0 && (
                    <span className="text-[11px] text-[#566a7f] dark:text-slate-400 mt-1 block">
                      Ventes génératrices :{' '}
                      <strong className="font-mono text-rose-600 dark:text-rose-400">
                        {tvaStats.sumVentesTTC.toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        DH
                      </strong>{' '}
                      <span className="text-[9px] uppercase font-bold text-slate-400">TTC</span>
                    </span>
                  )}
                </div>
                <div
                  className={`p-2 rounded-lg ${
                    tvaStats.resultatTVA >= 0
                      ? 'bg-rose-100/50 dark:bg-rose-950/35 text-rose-600'
                      : 'bg-emerald-100/50 dark:bg-emerald-950/35 text-emerald-600'
                  }`}
                >
                  <Calculator className="w-5 h-5" />
                </div>
              </div>
              <div className="border-t border-slate-100/60 dark:border-[#434460]/10 mt-4 pt-3 flex justify-between text-xs text-slate-400 font-medium">
                <span>Solde net de la période</span>
                <span
                  className={`font-semibold ${
                    tvaStats.resultatTVA >= 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {tvaStats.resultatTVA >= 0 ? 'À liquider' : 'Créance fiscale'}
                </span>
              </div>
            </div>
          </div>

          {/* Moroccan Tax Rule Callout */}
          <div className="bg-slate-50 dark:bg-[#232333]/50 border border-slate-200/60 dark:border-[#434460]/20 rounded-lg p-4 flex gap-3 items-start">
            <Info className="w-4.5 h-4.5 text-[#696cff] mt-0.5 shrink-0" />
            <div className="text-xs text-slate-500 dark:text-slate-300">
              {tvaRegime === 'encaissements' ? (
                <>
                  <span className="font-bold text-slate-700 dark:text-[#dbdade]">
                    Régime des Encaissements en vigueur :{' '}
                  </span>
                  Seules les factures effectivement encaissées (ventes) ou payées (achats) sont
                  incluses. Les montants à crédit (en attente) sont exclus temporairement de
                  l'exigibilité.
                  <span className="font-bold text-[#696cff] ms-1.5">
                    ({tvaStats.allFiltered.filter((tx) => tx.status === 'en_attente').length}{' '}
                    opérations crédit/attente exclues ce mois)
                  </span>
                </>
              ) : (
                <>
                  <span className="font-bold text-slate-700 dark:text-[#dbdade]">
                    Régime des Débits (Facturation) en vigueur :{' '}
                  </span>
                  La TVA collectée sur les ventes est exigible dès la date de facturation, peu
                  importe l'encaissement. La TVA récupérable sur les achats reste quant à elle basée
                  sur les règlements effectifs.
                  <span className="font-bold text-[#696cff] ms-1.5">
                    (
                    {
                      tvaStats.allFiltered.filter(
                        (tx) => tx.status === 'en_attente' && tx.type === 'achat'
                      ).length
                    }{' '}
                    achats à crédit exclus ce mois)
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Collapsible details of transactions included */}
          <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg overflow-hidden shadow-[0_2px_12px_rgba(15,23,42,0.02)]">
            <div className="border-b border-slate-200/60 dark:border-slate-800/60 px-5 py-4 flex justify-between items-center bg-slate-50/40 dark:bg-[#2b2c40]">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-[#dbdade]">
                  Détail des opérations éligibles de la période
                </h3>
                <p className="text-[11px] text-slate-400">
                  {tvaRegime === 'encaissements'
                    ? `Ventes encaissées et achats effectivement réglés pour ${selectedMonth}/${selectedYear}.`
                    : `Factures clients émises et achats réglés pour ${selectedMonth}/${selectedYear}.`}
                </p>
              </div>
            </div>

            {tvaStats.allFiltered.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                Aucune transaction enregistrée pour cette période fiscale.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-sans text-xs">
                  <thead>
                    <tr className="bg-slate-100/70 dark:bg-[#34354e]/60 border-b border-slate-200/60 dark:border-slate-800/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="px-5 py-3">Type</th>
                      <th className="px-5 py-3">Réf/Libellé</th>
                      <th className="px-5 py-3">Date Encaissement</th>
                      <th className="px-5 py-3 text-right">Base HT</th>
                      <th className="px-5 py-3 text-right">TVA (20%)</th>
                      <th className="px-5 py-3 text-right">Total TTC</th>
                      <th className="px-5 py-3 text-center">État</th>
                      <th className="px-5 py-3 text-center">Verrou</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#434460]/20">
                    {tvaStats.allFiltered.map((tx, idx) => (
                      <tr
                        key={tx.id + "_" + String(idx)}
                        className={`hover:bg-slate-50/30 dark:hover:bg-slate-800/10 transition-colors ${
                          tx.status === 'en_attente' ? 'opacity-65 bg-slate-50/10' : ''
                        }`}
                      >
                        <td className="px-5 py-3.5 font-bold">
                          {tx.type === 'vente' ? (
                            <span className="text-[#4fb922] dark:text-[#71dd37]">VENTE</span>
                          ) : (
                            <span className="text-rose-500">ACHAT</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div>
                            <p className="font-semibold text-slate-700 dark:text-[#dbdade]">
                              {tx.label}
                            </p>
                            <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                              ID: {tx.id.toUpperCase()}
                            </p>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 font-mono text-slate-500 dark:text-slate-400">
                          {tx.paymentDate}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono font-medium text-slate-600 dark:text-slate-300">
                          {tx.amountHT.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono font-semibold text-slate-700 dark:text-slate-300">
                          {tx.amountTVA.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                          {tx.amountTTC.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          {/* Ghost Badges as requested in RULE[AGENTS_md] - no background, text color only */}
                          {tx.status === 'payé' ? (
                            <span className="text-emerald-500 font-bold text-[11px] uppercase tracking-wider">
                              Encaissé
                            </span>
                          ) : (
                            <span className="text-amber-500 font-bold text-[11px] uppercase tracking-wider">
                              À crédit
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          {tx.isLocked ? (
                            <span
                              className="text-emerald-500 font-bold text-xs"
                              title="Verrouillé pour clôture"
                            >
                              🔒 Oui
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs" title="Modifiable">
                              🔓 Non
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Clôture action trigger */}
          <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-5 shadow-[0_2px_12px_rgba(15,23,42,0.02)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="max-w-xl text-xs text-slate-500 dark:text-slate-300">
              {isCurrentPeriodLocked ? (
                <div className="flex gap-2 items-center text-emerald-600 font-semibold">
                  <CheckCircle className="w-4 h-4 shrink-0" />
                  <span>
                    Cette période a déjà fait l'objet d'une clôture fiscale officielle. Les
                    transactions de {selectedMonth}/{selectedYear} sont verrouillées pour
                    d'éventuels contrôles comptables.
                  </span>
                </div>
              ) : (
                <div className="flex gap-2 items-start text-amber-600">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    La clôture fige les écritures et génère un justificatif fiscal de TVA.
                    Assurez-vous d'avoir rapproché toutes les opérations de banque avant de valider.
                  </span>
                </div>
              )}
            </div>

            <button
              onClick={handleLockPeriod}
              disabled={isCurrentPeriodLocked || tvaStats.paidFiltered.length === 0}
              className={`font-semibold text-xs h-[38px] px-6 rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-sm ${
                isCurrentPeriodLocked || tvaStats.paidFiltered.length === 0
                  ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:border-[#434460]/20'
                  : 'bg-rose-500 hover:bg-rose-600 text-white cursor-pointer'
              }`}
            >
              🔒 Clôturer la période
            </button>
          </div>

          {/* Historique des Clôtures de TVA */}
          <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg overflow-hidden shadow-[0_2px_12px_rgba(15,23,42,0.02)]">
            <div className="border-b border-slate-200/60 dark:border-slate-800/60 px-5 py-4 bg-slate-50/40 dark:bg-[#2b2c40]">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-[#dbdade]">
                Historique des Déclarations Clôturées
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Archivage officiel des écritures clôturées et soumises.
              </p>
            </div>

            {tvaDeclarations.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                Aucune déclaration comptable validée historiquement.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse font-sans text-xs">
                  <thead>
                    <tr className="bg-slate-100/70 dark:bg-[#34354e]/60 border-b border-slate-200/60 dark:border-slate-800/60 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                      <th className="px-5 py-3">Période</th>
                      <th className="px-5 py-3">N° Déclaration</th>
                      <th className="px-5 py-3">Date de Clôture</th>
                      <th className="px-5 py-3 text-right">TVA Collectée</th>
                      <th className="px-5 py-3 text-right">TVA Récupérable</th>
                      <th className="px-5 py-3 text-right">Solde de TVA</th>
                      <th className="px-5 py-3 text-center">Statut</th>
                      <th className="px-5 py-3 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-[#434460]/20">
                    {tvaDeclarations.map((dec, idx) => (
                      <tr
                        key={dec.id + "_" + String(idx)}
                        className="hover:bg-slate-50/30 dark:hover:bg-slate-800/10 transition-colors"
                      >
                        <td className="px-5 py-3.5 font-bold text-slate-800 dark:text-[#dbdade]">
                          {String(dec.month).padStart(2, '0')} / {dec.year}
                        </td>
                        <td className="px-5 py-3.5 font-mono text-[#696cff] font-semibold">
                          {dec.declarationCode}
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 font-mono">
                          {new Date(dec.declaredAt).toLocaleDateString('fr-FR', {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-slate-600 dark:text-slate-300">
                          {dec.tvaCollectee.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}{' '}
                          DH
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono text-slate-600 dark:text-slate-300">
                          {dec.tvaRecuperable.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}{' '}
                          DH
                        </td>
                        <td className="px-5 py-3.5 text-right font-mono font-bold">
                          <span
                            className={dec.netResult >= 0 ? 'text-rose-600' : 'text-emerald-600'}
                          >
                            {Math.abs(dec.netResult).toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                            })}{' '}
                            DH
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-center">
                          {/* Ghost Badges as requested in RULE[AGENTS_md] - no background, text color only */}
                          <span className="text-emerald-500 font-bold text-[11px] uppercase tracking-wider">
                            Transmis (DGI)
                          </span>
                        </td>
                        <td className="px-5 py-3.5 text-center flex items-center justify-center gap-2">
                          <button
                            onClick={() => handleExportDeclarationToExcel(dec)}
                            className="p-1 text-[#696cff] hover:text-[#5f61e8] rounded transition-colors"
                            title="Télécharger les écritures (Excel)"
                          >
                            <FileSpreadsheet className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() =>
                              handleDeleteTvaDeclaration(
                                dec.id,
                                `${String(dec.month).padStart(2, '0')}/${dec.year}`
                              )
                            }
                            className="p-1 text-slate-300 hover:text-rose-500 rounded transition-colors"
                            title="Annuler la clôture"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 1: Saisir Écriture comptable (Opérations diverses) */}
      <AnimatePresence>
        {isAddMiscModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddMiscModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />

            {/* Box */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-[#434460]/40 w-full max-w-md rounded-xl p-5 shadow-lg relative z-10"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-[#434460]/25 mb-4">
                <h3 className="text-[16px] font-semibold text-slate-800 dark:text-[#dbdade]">
                  Saisir une opération diverse
                </h3>
                <button
                  onClick={() => setIsAddMiscModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleAddMiscOperation} className="space-y-4 text-left">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Libellé de l'écriture
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="ex: Taxe professionnelle, Clôture..."
                    value={newMiscLabel}
                    onChange={(e) => setNewMiscLabel(e.target.value)}
                    className="w-full px-3 py-2 bg-transparent dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/40 rounded-lg text-sm text-slate-800 dark:text-[#dbdade] outline-none focus:border-[#696cff] transition-colors"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Montant (DH)
                    </label>
                    <input
                      type="number"
                      required
                      placeholder="0.00"
                      value={newMiscAmount}
                      onChange={(e) => setNewMiscAmount(e.target.value)}
                      className="w-full px-3 py-2 bg-transparent dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/40 rounded-lg text-sm text-slate-800 dark:text-[#dbdade] outline-none focus:border-[#696cff] transition-colors font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Date d'écriture
                    </label>
                    <input
                      type="date"
                      required
                      value={newMiscDate}
                      onChange={(e) => setNewMiscDate(e.target.value)}
                      className="w-full px-3 py-2 bg-transparent dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/40 rounded-lg text-sm text-slate-800 dark:text-[#dbdade] outline-none focus:border-[#696cff] transition-colors font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Type d'écriture
                  </label>
                  <select
                    value={newMiscType}
                    onChange={(e) => setNewMiscType(e.target.value as any)}
                    className="w-full px-3 py-2 bg-transparent dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/40 rounded-lg text-sm text-slate-800 dark:text-[#dbdade] outline-none focus:border-[#696cff] transition-colors"
                  >
                    <option value="impot">Impôt (IS, IR...)</option>
                    <option value="taxe">Taxe (TVA, Taxe Pro...)</option>
                    <option value="cloture">Clôture annuelle</option>
                    <option value="autre">Autre écriture</option>
                  </select>
                </div>

                <div className="pt-2 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsAddMiscModalOpen(false)}
                    className="px-4 py-2 bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-[#696cff] text-white rounded-lg text-xs font-semibold hover:bg-[#5f61e6] transition-colors cursor-pointer shadow-xs"
                  >
                    Valider l'écriture
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: Déclarations fiscales */}
      <AnimatePresence>
        {isTaxModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsTaxModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />

            {/* Box */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#2b2c40] border border-slate-200 dark:border-[#434460]/40 w-full max-w-lg rounded-xl p-6 shadow-lg relative z-10 text-left"
            >
              <div className="flex justify-between items-center pb-3 border-b border-slate-100 dark:border-[#434460]/25 mb-4">
                <div className="flex items-center gap-2">
                  <Percent className="w-5 h-5 text-[#ff3e1d]" />
                  <h3 className="text-[16px] font-semibold text-slate-800 dark:text-[#dbdade]">
                    Déclarations Fiscales & Taxes
                  </h3>
                </div>
                <button
                  onClick={() => setIsTaxModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-4 bg-amber-50/70 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/20 rounded-xl flex items-start gap-3">
                  <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                      Rappel Réglementaire Marocain
                    </h4>
                    <p className="text-xs text-amber-750 dark:text-amber-400/90 mt-1 leading-relaxed">
                      Les entreprises marocaines doivent effectuer leurs déclarations de TVA
                      périodiquement (mensuelle ou trimestrielle) et liquider l'Impôt sur les
                      Sociétés (IS) sous forme d'acomptes prévisionnels.
                    </p>
                  </div>
                </div>

                <div className="space-y-2.5">
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Suivi de vos échéances fiscales 2026
                  </h4>

                  <div className="border border-slate-100 dark:border-[#434460]/20 rounded-xl p-3.5 flex justify-between items-center hover:bg-slate-55/30 transition-all">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        TVA Trimestrielle - T2 2026
                      </p>
                      <p className="text-xs text-slate-400 mt-1">Date limite : 31 Juillet 2026</p>
                    </div>
                    {/* Ghost Badge for status */}
                    <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                      À déclarer
                    </span>
                  </div>

                  <div className="border border-slate-100 dark:border-[#434460]/20 rounded-xl p-3.5 flex justify-between items-center hover:bg-slate-55/30 transition-all">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        Acompte Provisionnel IS - N°2
                      </p>
                      <p className="text-xs text-slate-400 mt-1">Date limite : 30 Septembre 2026</p>
                    </div>
                    {/* Ghost Badge for status */}
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Planifié
                    </span>
                  </div>

                  <div className="border border-slate-100 dark:border-[#434460]/20 rounded-xl p-3.5 flex justify-between items-center hover:bg-slate-55/30 transition-all">
                    <div>
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        Taxe Professionnelle 2026
                      </p>
                      <p className="text-xs text-slate-400 mt-1">Payée le 21 Janvier 2026</p>
                    </div>
                    {/* Ghost Badge for status */}
                    <span className="text-[11px] font-bold text-[#4fb922] uppercase tracking-wider">
                      Validé
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-[#434460]/25 flex justify-end">
                  <button
                    onClick={() => setIsTaxModalOpen(false)}
                    className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    Fermer
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

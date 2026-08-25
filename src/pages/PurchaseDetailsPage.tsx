import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { backendService } from '../services/backendService';
import {
  doc,
  updateDoc,
  collection,
  collectionGroup,
  addDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  getDocs,
  getDoc,
  writeBatch,
  deleteField,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useNavigate, useParams } from 'react-router-dom';
import { convertNumberToFrenchWords } from '../utils/numberToWords';
import { COMPANY_INFO } from '../constants';
import { invoiceService } from '../services/invoiceService';
import html2pdf from 'html2pdf.js';
import { generatePDF, getPDFBase64 } from '../utils/pdfGenerator';
import { InvoicePrint } from '../components/InvoicePrint';
import { DeliveryNotePrint } from '../components/DeliveryNotePrint';
import { TicketPrint, printTicket } from '../components/TicketPrint';
import { InvoiceData } from '../types';
import { mapDocToInvoiceData } from '../utils/invoiceMapper';
import { mapDocToDeliveryNoteData } from '../utils/deliveryNoteMapper';
import {
  ArrowLeft,
  ShoppingCart,
  Edit3,
  Package,
  Trash2,
  FileText,
  ExternalLink,
  Paperclip,
  ImageIcon,
  Phone,
  MessageSquare,
  Copy,
  Share2,
  BadgePercent,
  CheckCircle2,
  AlertCircle,
  FileX,
  Ban,
  Calendar,
  User,
  Mail,
  RefreshCw,
  Info,
  Calculator,
  Printer,
  Download,
  Upload,
  FileSpreadsheet,
  Truck,
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';

const getInvoiceStatus = (item: any): 'Brouillon' | 'Valide' | 'Annulée' => {
  if (!item) return 'Brouillon';
  const rawStatus =
    item.status || (item.refId && item.refId !== 'Brouillon' ? 'Valide' : 'Brouillon');
  if (rawStatus === 'Validée' || rawStatus === 'Valide') {
    return 'Valide';
  }
  if (rawStatus === 'Annulée') {
    return 'Annulée';
  }
  return 'Brouillon';
};

export default function PurchaseDetailsPage() {
  const { clientId, purchaseId } = useParams();
  const [purchase, setPurchase] = useState<any>(null);
  const [client, setClient] = useState<any>(null);
  const [fetching, setFetching] = useState(true);
  const { showToast, confirm } = useNotification();
  const [paymentAmount, setPaymentAmount] = useState('');
  const [addingPayment, setAddingPayment] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [allPurchases, setAllPurchases] = useState<any[]>([]);
  

  const [sendingEmail, setSendingEmail] = useState(false);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  // States for gap recycling / override validation modal (Odoo style) In Detail View
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [customRefNum, setCustomRefNum] = useState('');
  const [loadingValidation, setLoadingValidation] = useState(false);
  const [missingSequences, setMissingSequences] = useState<string[]>([]);

  // Excel import/export states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [parsedImportLines, setParsedImportLines] = useState<any[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const exportToExcel = () => {
    if (!purchase || !client) return;
    try {
      const pType = purchase.type || 'commande';
      
      const dataRows = [
        ['RÉCAPITULATIF DE LA PIÈCE'],
        ['Type de Document', pType.toUpperCase()],
        ['Référence', computedRefId],
        ['Statut', getInvoiceStatus(purchase)],
        ['Date d\'émission', purchase.date?.toDate ? purchase.date.toDate().toLocaleDateString('fr-FR') : purchase.date || ''],
        ['Client / Partenaire', client.name],
        ['Téléphone Client', client.phone || ''],
        ['Email Client', client.email || ''],
        ['Adresse Client', client.address || ''],
        [''],
        ['LIGNES DE FACTURE / ARTICLES'],
        ['Description/Libellé', 'Quantité', 'Prix Unitaire (DH)', 'Taxe (%)', 'Total TTC (DH)'],
      ];

      items.forEach((item: any) => {
        const qty = Number(item.quantity || 0);
        const price = Number(item.price || 0);
        const tax = Number(item.tax || item.tva || 0);
        const sub = qty * price;
        const totalItem = sub + (sub * tax) / 100;
        dataRows.push([
          item.description || 'Article',
          qty,
          price,
          tax,
          totalItem
        ]);
      });

      dataRows.push(['']);
      dataRows.push(['RÉSUMÉ FINANCIER']);
      dataRows.push(['Sous-total HT', Number(purchase.subtotal || purchase.total).toFixed(2) + ' DH']);
      if (purchase.taxAmount) {
        dataRows.push(['TVA / Taxe', Number(purchase.taxAmount).toFixed(2) + ' DH']);
      }
      dataRows.push(['Total TTC', Number(purchase.total).toFixed(2) + ' DH']);

      const ws = XLSX.utils.aoa_to_sheet(dataRows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Détails');
      XLSX.writeFile(wb, `${pType.toUpperCase()}_${computedRefId}.xlsx`);
      showToast('Document exporté avec succès en Excel !', 'success');
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de l'exportation Excel.", 'error');
    }
  };

  const handleExcelImport = (file: File) => {
    setImportingFile(true);
    setImportError(null);
    setImportSuccess(null);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) throw new Error("Impossible de lire les données du fichier.");
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
        
        if (!jsonData || jsonData.length === 0) {
          throw new Error("Le fichier Excel est vide ou invalide.");
        }
        
        let headerRowIndex = 0;
        for (let r = 0; r < Math.min(15, jsonData.length); r++) {
          const rowStr = jsonData[r].map(c => String(c || '').trim().toLowerCase());
          if (rowStr.some(c => c.includes('libell') || c.includes('description') || c.includes('produit') || c.includes('article') || c.includes('lignes de facture'))) {
            headerRowIndex = r;
            break;
          }
        }

        const headerRow = jsonData[headerRowIndex].map(h => String(h || '').trim().toLowerCase());
        
        const findColumnIndex = (synonyms: string[]) => {
          return headerRow.findIndex(cell => 
            synonyms.some(syn => cell.includes(syn) || cell === syn)
          );
        };
        
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
          'produit',
          'article',
          'lignes de facture',
          'designation',
          'désignation',
          'name',
          'nom'
        ]);
        
        const idxQuantity = findColumnIndex([
          'quantité',
          'quantite',
          'qty',
          'quantity',
          'nombre',
          'qte'
        ]);
        
        const idxUnitPrice = findColumnIndex([
          'prix unitaire',
          'prix',
          'unit price',
          'price',
          'prix_unitaire',
          'p.u.',
          'pu'
        ]);
        
        const idxTax = findColumnIndex([
          'tva',
          'taxe',
          'tax',
          't.v.a.'
        ]);
        
        const parsedLines: any[] = [];
        
        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          if (!row || row.length === 0) continue;
          
          const getValue = (idx: number) => {
            if (idx < 0 || idx >= row.length) return undefined;
            return row[idx];
          };
          
          let desc = '';
          if (idxDescription >= 0) {
            desc = String(getValue(idxDescription) || '').trim();
          }
          
          let qty = 1;
          if (idxQuantity >= 0) {
            const val = Number(getValue(idxQuantity));
            if (!isNaN(val) && val > 0) qty = val;
          }
          
          let price = 0;
          if (idxUnitPrice >= 0) {
            const val = Number(getValue(idxUnitPrice));
            if (!isNaN(val)) price = val;
          }
          
          let tax = 20;
          if (idxTax >= 0) {
            const val = Number(getValue(idxTax));
            if (!isNaN(val)) tax = val;
          }
          
          if (desc && (qty > 0 || price > 0)) {
            parsedLines.push({
              id: `imported_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 5)}`,
              description: desc,
              quantity: qty,
              price: price,
              tax: tax
            });
          }
        }
        
        if (parsedLines.length === 0) {
          throw new Error("Aucun article valide trouvé. Vérifiez les en-têtes (Produit, Quantité, Prix).");
        }
        
        setParsedImportLines(parsedLines);
        setImportSuccess(`${parsedLines.length} articles détectés avec succès !`);
      } catch (err: any) {
        console.error(err);
        setImportError(err.message || "Erreur de lecture du fichier Excel.");
      } finally {
        setImportingFile(false);
      }
    };
    reader.onerror = () => {
      setImportError("Erreur lors de la lecture physique du fichier.");
      setImportingFile(false);
    };
    reader.readAsBinaryString(file);
  };

  const handleConfirmImport = async () => {
    if (!purchase || !clientId || !purchaseId) return;
    try {
      let newSubtotal = 0;
      let newTaxAmount = 0;
      
      const formattedLines = parsedImportLines.map((line) => {
        const lineSub = Number(line.quantity) * Number(line.price);
        const lineTax = (lineSub * Number(line.tax)) / 100;
        newSubtotal += lineSub;
        newTaxAmount += lineTax;
        
        return {
          id: line.id,
          description: line.description,
          quantity: line.quantity,
          price: line.price,
          tax: line.tax,
          total: lineSub + lineTax
        };
      });
      
      const newTotal = newSubtotal + newTaxAmount;
      
      const purchaseRef = doc(db, 'clients', clientId, 'purchases', purchaseId);
      await updateDoc(purchaseRef, {
        items: formattedLines,
        subtotal: newSubtotal,
        taxAmount: newTaxAmount,
        total: newTotal
      });
      
      showToast(`${formattedLines.length} articles importés et enregistrés !`, 'success');
      setIsImportModalOpen(false);
      setParsedImportLines([]);
      setImportSuccess(null);
    } catch (err: any) {
      console.error(err);
      showToast("Erreur lors de l'enregistrement de l'import : " + err.message, 'error');
    }
  };

  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!clientId || !purchaseId || !user) return;

    setFetching(true);
    let purchaseLoaded = false;
    let clientLoaded = false;
    let paymentsLoaded = false;
    let allPurchasesLoaded = false;

    const checkReady = () => {
      if (purchaseLoaded && clientLoaded && paymentsLoaded && allPurchasesLoaded) {
        setFetching(false);
      }
    };

    const unsubPurchase = onSnapshot(
      doc(db, 'clients', clientId, 'purchases', purchaseId),
      (snap) => {
        if (snap.exists()) {
          const pData = snap.data();
          if (pData.ownerId === user.uid) {
            setPurchase({ id: snap.id, ...pData });
          } else {
            showToast('Accès non autorisé', 'error');
            navigate(-1);
          }
        } else {
          showToast('Vente non trouvée', 'error');
          navigate(-1);
        }
        purchaseLoaded = true;
        checkReady();
      },
      (err) => {
        handleFirestoreError(err, OperationType.GET, `clients/${clientId}/purchases/${purchaseId}`);
        purchaseLoaded = true;
        checkReady();
      }
    );

    const unsubClient = onSnapshot(doc(db, 'clients', clientId), (snap) => {
      if (snap.exists()) {
        const cData = snap.data();
        if (cData.ownerId === user.uid) {
          setClient({ id: snap.id, ...cData });
        }
      }
      clientLoaded = true;
      checkReady();
    });

    const paymentsRef = collection(db, 'clients', clientId, 'payments');
    const paymentsQ = query(
      paymentsRef,
      where('purchaseId', '==', purchaseId),
      where('ownerId', '==', user.uid)
    );

    const unsubPayments = onSnapshot(paymentsQ, (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => {
          const tA = a.date?.toMillis?.() || 0;
          const tB = b.date?.toMillis?.() || 0;
          return tB - tA;
        });
      setPayments(data);
      paymentsLoaded = true;
      checkReady();
    });

    const unsubAllPurchases = onSnapshot(
      query(collectionGroup(db, 'purchases'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        const data = snapshot.docs
          .map((doc) => {
            const parts = doc.ref.path.split('/');
            return {
              id: doc.id,
              ...doc.data(),
              clientId: parts[1] || doc.ref.parent.parent?.id,
              parentPath: parts[0] || doc.ref.parent.parent?.parent.id,
            } as any;
          })
          .filter((p) => p.parentPath === 'clients');
        setAllPurchases(data);
        allPurchasesLoaded = true;
        checkReady();
      },
      (err) => {
        console.error(err);
        allPurchasesLoaded = true;
        checkReady();
      }
    );

    return () => {
      unsubPurchase();
      unsubClient();
      unsubPayments();
      unsubAllPurchases();
    };
  }, [clientId, purchaseId, user, navigate]);

  useEffect(() => {
    if (!fetching && purchase && client) {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get('send') === 'true') {
        // Clear param so it doesn't reopen
        navigate(`/purchase/${clientId}/${purchaseId}`, { replace: true });
        handleOpenEmailModal();
      } else if (searchParams.get('download') === 'true') {
        // Clear param so it doesn't reopen and trigger PDF download immediately
        navigate(`/purchase/${clientId}/${purchaseId}`, { replace: true });
        setTimeout(() => {
          handleExportPDF();
        }, 300);
      }
    }
  }, [fetching, purchase, client, clientId, purchaseId]);

  useEffect(() => {
    const handleCopy = () => {
      copyReportToClipboard();
    };
    window.addEventListener('copy-purchase-report', handleCopy);
    return () => {
      window.removeEventListener('copy-purchase-report', handleCopy);
    };
  }, [purchase, client, allPurchases]);

  const computedRefId = useMemo(() => {
    if (!purchase) return '';
    const pType = purchase.type || 'commande';

    if (pType === 'devis') {
      const rawDevis = allPurchases.filter((p) => p.type === 'devis');
      rawDevis.sort((a, b) => {
        const dateA = a.date?.toMillis
          ? a.date.toMillis()
          : a.date instanceof Date
            ? a.date.getTime()
            : 0;
        const dateB = b.date?.toMillis
          ? b.date.toMillis()
          : b.date instanceof Date
            ? b.date.getTime()
            : 0;
        return dateA - dateB;
      });
      const index = rawDevis.findIndex((p) => p.id === purchase.id);
      if (index !== -1) {
        return `S${String(index + 1).padStart(5, '0')}`;
      }
    } else if (pType === 'facture') {
      const status = getInvoiceStatus(purchase);
      if (status === 'Brouillon') {
        return purchase.refId && purchase.refId !== 'Brouillon'
          ? `${purchase.refId} (Brouillon)`
          : 'Brouillon';
      }
      if (status === 'Annulée') {
        return purchase.refId ? `${purchase.refId} (Annulée)` : 'N/A (Annulée)';
      }
      return purchase.refId || 'N/A';
    } else {
      const rawCommandes = allPurchases.filter((p) => !p.type || p.type === 'commande');
      rawCommandes.sort((a, b) => {
        const dateA = a.date?.toMillis
          ? a.date.toMillis()
          : a.date instanceof Date
            ? a.date.getTime()
            : 0;
        const dateB = b.date?.toMillis
          ? b.date.toMillis()
          : b.date instanceof Date
            ? b.date.getTime()
            : 0;
        return dateA - dateB;
      });
      const index = rawCommandes.findIndex((p) => p.id === purchase.id);
      if (index !== -1) {
        return `C${String(index + 1).padStart(5, '0')}`;
      }
    }

    return '';
  }, [allPurchases, purchase]);

  const handleAddPayment = async () => {
    if (!clientId || !purchaseId) return;
    if (!paymentAmount || isNaN(Number(paymentAmount)) || Number(paymentAmount) <= 0) return;

    const amount = Number(paymentAmount);
    const balanceRemainingRaw = Number(purchase.total) - Number(purchase.amountPaid || 0);
    const balanceRemaining = Math.max(0, Math.round(balanceRemainingRaw * 100) / 100);

    if (amount > balanceRemaining) {
      showToast(
        `Le montant ne peut pas dépasser le solde restant de ${balanceRemaining.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`,
        'error'
      );
      return;
    }

    setAddingPayment(true);
    try {
      const newTotalPaidRaw = (Number(purchase.amountPaid) || 0) + amount;
      const newTotalPaid = Math.round(newTotalPaidRaw * 100) / 100;
      let newStatus = 'credit';
      if (newTotalPaid >= Math.round(Number(purchase.total) * 100) / 100) {
        newStatus = 'paid';
      }

      const updateData: any = {
        amountPaid: newTotalPaid,
        paymentStatus: newStatus,
      };
      if (newStatus === 'paid') {
        updateData.paymentDate = new Date();
      }
      await updateDoc(doc(db, 'clients', clientId, 'purchases', purchaseId), updateData);

      // Track the payment history in the generic payments subcollection
      const newPaymentObj = {
        ownerId: user.uid,
        amount,
        date: serverTimestamp(),
        purchaseId: purchaseId,
        notes: `Paiement pour la commande BC/''`,
      };
      const newDocRef = await addDoc(
        collection(db, 'clients', clientId, 'payments'),
        newPaymentObj
      );

      setPayments((prev) => [
        {
          id: newDocRef.id,
          ...newPaymentObj,
          date: { toDate: () => new Date() },
        },
        ...prev,
      ]);

      setPurchase({
        ...purchase,
        amountPaid: newTotalPaid,
        paymentStatus: newStatus,
      });
      setPaymentAmount('');
      showToast('Paiement ajouté avec succès');
    } catch (error: any) {
      showToast('Erreur: ' + error.message, 'error');
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `clients/${clientId}/purchases/${purchaseId}`
      );
    } finally {
      setAddingPayment(false);
    }
  };

  const handleDeletePayment = async (payment: any) => {
    confirm({
      title: 'Supprimer le paiement ?',
      message: `Êtes-vous sûr de vouloir supprimer ce paiement de ${Number(payment.amount).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH ? Cette action mettra à jour le solde restant.`,
      onConfirm: async () => {
        if (!clientId || !purchaseId) return;

        const isInitial = payment.isInitial;
        if (!isInitial && !payment.id) return;

        setDeletingPaymentId(isInitial ? 'initial' : payment.id);
        try {
          const newTotalPaid = Math.max(
            0,
            (Number(purchase.amountPaid) || 0) - Number(payment.amount)
          );
          let newStatus = 'credit';
          if (newTotalPaid >= purchase.total) {
            newStatus = 'paid';
          }

          if (!isInitial) {
            await deleteDoc(doc(db, 'clients', clientId, 'payments', payment.id));

            if (payment.reconciliationId) {
              await updateDoc(doc(db, 'bank_reconciliations', payment.reconciliationId), {
                isReconciled: false,
                matchedDocument: null,
                matchedDocId: null,
                matchedDocParentType: null,
                matchedDocParentId: null,
                matchedDocTotalAmount: null,
                isMultiReconciled: null,
                matchedDocs: null,
              });
            }
          }

          const deleteUpdateData: any = {
            amountPaid: newTotalPaid,
            paymentStatus: newStatus,
          };
          if (newStatus !== 'paid') {
            deleteUpdateData.paymentDate = null;
          }

          await updateDoc(doc(db, 'clients', clientId, 'purchases', purchaseId), deleteUpdateData);

          if (!isInitial) {
            setPayments((prev) => prev.filter((p) => p.id !== payment.id));
          }

          setPurchase({
            ...purchase,
            amountPaid: newTotalPaid,
            paymentStatus: newStatus,
          });
          showToast('Paiement supprimé.');
        } catch (error: any) {
          showToast('Erreur: ' + error.message, 'error');
          handleFirestoreError(
            error,
            OperationType.DELETE,
            `clients/${clientId}/payments/${isInitial ? 'initial' : payment.id}`
          );
        } finally {
          setDeletingPaymentId(null);
        }
      },
    });
  };

  const handleValidateInvoice = async () => {
    if (!purchase || !clientId || !purchaseId || !user) return;
    try {
      const status =
        purchase.status ||
        (purchase.refId && purchase.refId !== 'Brouillon' ? 'Validée' : 'Brouillon');
      if (status !== 'Brouillon') {
        showToast("Seules les factures en état 'Brouillon' peuvent être validées.", 'error');
        return;
      }

      let proposed = purchase.refId;
      if (!proposed || proposed === 'Brouillon') {
        proposed = await invoiceService.getProposedInvoiceNumber(user.uid);
      } else {
        // Check if existing proposed number is already taken
        try {
          const qRef = collection(db, 'sequences');
          const uniqueRegistryRef = doc(qRef, `ref_${user.uid}_${proposed}`);
          const snap = await getDoc(uniqueRegistryRef);
          if (snap.exists() && snap.data()?.purchaseId !== purchase.id) {
            proposed = await invoiceService.getProposedInvoiceNumber(user.uid);
          }
        } catch (e) {
          console.warn('Could not check unique registry:', e);
        }
      }
      // Auto-correct the proposed number if it's lagging behind the ACTUAL history and compute holes
      let missing: string[] = [];
      if (proposed) {
        const match = proposed.match(/^(.*?)(\d+)([^0-9]*)$/);
        if (match) {
          const prefix = match[1];
          const numStr = match[2];
          const len = numStr.length;
          const suffix = match[3];

          let actualMaxExisting = 0;
          let actualMinExisting = Number.MAX_SAFE_INTEGER;
          const existingNums = new Set<number>();
          allPurchases.forEach((f) => {
            const fStatus =
              f.status || (f.refId && f.refId !== 'Brouillon' ? 'Validée' : 'Brouillon');
            if (
              (fStatus === 'Valide' || fStatus === 'Validée' || fStatus === 'Annulée') &&
              f.refId
            ) {
              if (f.refId.startsWith(prefix) && f.refId.endsWith(suffix)) {
                const subStr = f.refId.substring(prefix.length, f.refId.length - suffix.length);
                if (/^\d+$/.test(subStr)) {
                  const n = parseInt(subStr, 10);
                  existingNums.add(n);
                  if (n > actualMaxExisting) actualMaxExisting = n;
                  if (n < actualMinExisting) actualMinExisting = n;
                }
              }
            }
          });

          // Force proposed to be exactly actualMaxExisting + 1 (strict sequential)
          const correctNext = actualMaxExisting + 1;
          proposed = `${prefix}${String(correctNext).padStart(len, '0')}${suffix}`;

          // Compute missing holes strictly between 1 and correctNext - 1
          if (existingNums.size > 0) {
            for (let i = 1; i < correctNext; i++) {
              if (!existingNums.has(i)) {
                missing.push(`${prefix}${String(i).padStart(len, '0')}${suffix}`);
                if (missing.length >= 30) break; // limit to 30 to avoid UI clutter
              }
            }
          }
        }
      }

      // Automatically determine the legal date from the draft's "Date d'Émission"
      let invoiceDateToUse: Date;
      if (purchase.date) {
        invoiceDateToUse =
          typeof purchase.date.toDate === 'function'
            ? purchase.date.toDate()
            : new Date(purchase.date);
      } else {
        invoiceDateToUse = new Date();
      }

      // If no sequence holes are detected, bypass modal step completely & validate directly!
      if (missing.length === 0) {
        setLoadingValidation(true);
        try {
          const confirmedNo = await invoiceService.validateInvoice(
            clientId,
            purchaseId,
            proposed,
            invoiceDateToUse
          );
          setPurchase({
            ...purchase,
            status: 'Valide',
            refId: confirmedNo,
            date: invoiceDateToUse,
          });
          showToast(`Excellent ! Facture validée sous le numéro : ${confirmedNo}`, 'success');
        } catch (error: any) {
          console.error(error);
          showToast(error?.message || 'Erreur lors de la validation.', 'error');
        } finally {
          setLoadingValidation(false);
        }
        return;
      }

      // Holes/Gaps exist: Show modal warning for choice/override
      setCustomRefNum(proposed);
      setMissingSequences(missing);
      setIsValidationModalOpen(true);
    } catch (err: any) {
      console.error('FATAL ERROR IN INVOICE NUMBER FETCHING:', err);
      showToast('Impossible de charger le numéro proposé. ' + err?.message, 'error');
    }
  };

  const handleConfirmValidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!purchase || !clientId || !purchaseId || !user) return;

    setLoadingValidation(true);
    try {
      let invoiceDateToUse: Date;
      if (purchase.date) {
        invoiceDateToUse =
          typeof purchase.date.toDate === 'function'
            ? purchase.date.toDate()
            : new Date(purchase.date);
      } else {
        invoiceDateToUse = new Date();
      }

      const confirmedNo = await invoiceService.validateInvoice(
        clientId,
        purchaseId,
        customRefNum,
        invoiceDateToUse
      );
      setPurchase({
        ...purchase,
        status: 'Valide',
        refId: confirmedNo,
        date: invoiceDateToUse,
      });
      showToast(`Excellent ! Facture validée sous le numéro : ${confirmedNo}`, 'success');
      setIsValidationModalOpen(false);
      setCustomRefNum('');
    } catch (error: any) {
      console.error(error);
      showToast(error?.message || 'Erreur lors de la validation.', 'error');
    } finally {
      setLoadingValidation(false);
    }
  };

  const handleCancelInvoice = async () => {
    if (!purchase || !clientId || !purchaseId) return;
    try {
      const status =
        purchase.status ||
        (purchase.refId && purchase.refId !== 'Brouillon' ? 'Validée' : 'Brouillon');
      if (status !== 'Brouillon' && status !== 'Valide' && status !== 'Validée') {
        showToast(
          "Seule une facture à l'état de 'Brouillon' ou 'Validée' peut être annulée.",
          'error'
        );
        return;
      }

      confirm({
        title: 'Annuler cette facture ?',
        message:
          "La facture sera définitivement annulée. Elle conservera l'état de Brouillon annulé.",
        onConfirm: async () => {
          try {
            await invoiceService.cancelInvoice(clientId, purchaseId);
            setPurchase({ ...purchase, status: 'Annulée' });
            showToast('La facture a été annulée.', 'success');
          } catch (error: any) {
            console.error(error);
            showToast(error?.message || "Erreur lors de l'annulation.", 'error');
          }
        },
      });
    } catch (err) {
      console.error(err);
      showToast("Une erreur s'est produite.", 'error');
    }
  };

  const handleResetToDraft = async () => {
    if (!purchase || !clientId || !purchaseId) return;
    try {
      const status =
        purchase.status ||
        (purchase.refId && purchase.refId !== 'Brouillon' ? 'Validée' : 'Brouillon');
      if (status !== 'Validée' && status !== 'Valide' && status !== 'Annulée') {
        showToast(
          'Seules les factures officiellement validées ou annulées peuvent être remises en brouillon.',
          'error'
        );
        return;
      }

      confirm({
        title: 'Remettre en Brouillon ?',
        message: 'En remettant cette facture en état Brouillon, son numéro officiel sera conservé.',
        onConfirm: async () => {
          try {
            await invoiceService.resetToDraft(clientId, purchaseId);
            setPurchase({ ...purchase, status: 'Brouillon' });
            showToast('La facture a été remise en état Brouillon.', 'success');
          } catch (error: any) {
            console.error(error);
            showToast(error?.message || 'Erreur lors de la remise en brouillon.', 'error');
          }
        },
      });
    } catch (err) {
      console.error(err);
      showToast("Une erreur s'est produite.", 'error');
    }
  };

  const handleDeleteInvoice = () => {
    if (!clientId || !purchaseId) return;
    confirm({
      title: 'Supprimer la facture définitivement ?',
      message:
        'Cette opération supprimera définitivement la facture et tous ses règlements associés de la base de données. Êtes-vous sûr ?',
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          const paymentsSnap = await getDocs(
            query(
              collection(db, 'clients', clientId, 'payments'),
              where('purchaseId', '==', purchaseId),
              where('ownerId', '==', user.uid)
            )
          );
          paymentsSnap.forEach((d) => batch.delete(d.ref));
          batch.delete(doc(db, 'clients', clientId, 'purchases', purchaseId));
          if (purchase.parent_id) {
            batch.update(doc(db, 'clients', clientId, 'purchases', purchase.parent_id), { child_id: deleteField() });
          }
          await batch.commit();
          showToast('Facture supprimée définitivement.', 'success');
          navigate('/facturation');
        } catch (err) {
          showToast('Erreur lors de la suppression.', 'error');
        }
      },
    });
  };

  const getMessageTemplate = (type: string, docId: string, total: string, clientName: string) => {
    switch (type) {
      case 'devis':
        return `Bonjour ${clientName},

Votre devis ${docId} d'un montant de ${total} DH attend votre validation.

N'hésitez pas à nous contacter si vous avez des questions.

Cordialement.`;
      case 'facture':
        return `Bonjour ${clientName},

Veuillez trouver ci-joint votre facture ${docId} d'un montant de ${total} DH de Advanced IT. 

Cordialement`;
      case 'commande':
      default:
        return `Bonjour ${clientName},

Votre commande ${docId} d'un montant de ${total} DH est confirmée.


Merci de votre confiance !

N'hésitez pas à nous contacter si vous avez des questions.`;
    }
  };

  const shareInvoiceWhatsApp = () => {
    if (!purchase || !client) return;
    const pType = purchase.type || 'commande';
    const docId = computedRefId;
    const totalFormatted = Number(purchase.total).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const reportText = getMessageTemplate(pType, docId, totalFormatted, client.name);

    const encodedText = encodeURIComponent(reportText);
    if (!client.phone) {
      showToast('Aucun numéro de téléphone pour ce client.', 'error');
      return;
    }
    const cleanNum = client.phone.replace(/[^0-9]/g, '');
    if (/^0[58]/.test(cleanNum) || /^(212|00212)[58]/.test(cleanNum) || /^[58][0-9]{8}$/.test(cleanNum)) {
      showToast('Le numéro de ce client est une ligne fixe (05...), impossible d\'envoyer par WhatsApp.', 'error');
      return;
    }
    showToast('Envoi du message WhatsApp en cours...', 'info');
    import('../services/whatsappService').then(({ sendWhatsAppMessage }) => {
      sendWhatsAppMessage(client.phone, reportText).then(result => {
        if (result.success) {
          showToast('Message WhatsApp envoyé avec succès.', 'success');
        } else {
          showToast('Erreur lors de l\'envoi: ' + result.error, 'error');
        }
      });
    });
  };

  const copyReportToClipboard = () => {
    if (!purchase || !client) return;
    const pType = purchase.type || 'commande';
    const docId = computedRefId;
    const totalFormatted = Number(purchase.total).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const reportText = getMessageTemplate(pType, docId, totalFormatted, client.name);

    navigator.clipboard.writeText(reportText);
    showToast(`Le rapport de ${pType} a été copié dans le presse-papiers !`, 'success');
  };

  const handleExportPDF = () => {
    const isCommandeOrRecu = purchase?.type !== 'devis' && purchase?.type !== 'facture';
    const targetId = 'pdf-export-hidden';
    const element = document.getElementById(targetId);
    if (!element) return;

    generatePDF(element, {
      filename: `${purchase.type || 'commande'}_${computedRefId}.pdf`,
    });
  };

  const handleExportBLPDF = () => {
    const element = document.getElementById('bl-pdf-export-hidden');
    if (!element) {
      showToast("L'élément Bon de Livraison est introuvable.", 'error');
      return;
    }

    const blData = mapDocToDeliveryNoteData(purchase, client, computedRefId);
    const cleanRef = (blData.blNumber || computedRefId || 'BL').replace(/[/\\?%*:|"<>]/g, '_');

    generatePDF(element, {
      filename: `BL_${cleanRef}.pdf`,
    });
    showToast('Génération du Bon de Livraison PDF en cours...', 'success');
  };

  useEffect(() => {
    const handleExportBLEvent = () => {
      handleExportBLPDF();
    };
    window.addEventListener('export-bl-pdf', handleExportBLEvent);
    return () => {
      window.removeEventListener('export-bl-pdf', handleExportBLEvent);
    };
  }, [purchase, client, computedRefId]);

  const handleExportTicket = () => {
    if (!purchase) return;
    printTicket(mapDocToInvoiceData(purchase, client, computedRefId));
  };

  const handleOpenEmailModal = () => {
    setEmailTo(client?.email || '');
    const pType = purchase?.type || 'commande';
    const docName = pType.toUpperCase();
    setEmailSubject(`Votre document ${docName} - ${computedRefId}`);

    const docId = computedRefId;
    const totalFormatted = Number(purchase?.total || 0).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const reportText = getMessageTemplate(pType, docId, totalFormatted, client?.name || 'Client');

    setEmailBody(reportText);
    setShowEmailModal(true);
  };

  const handleSendEmail = async () => {
    if (!emailTo) {
      showToast('Veuillez saisir une adresse email.', 'error');
      return;
    }
    setSendingEmail(true);
    try {
      const isCommandeOrRecu = purchase?.type !== 'devis' && purchase?.type !== 'facture';
      const targetId = 'pdf-export-hidden';
      const element = document.getElementById(targetId);
      if (!element) {
        throw new Error("L'élément de facture est introuvable.");
      }

      const pdfBase64 = await getPDFBase64(element, {
        filename: `${purchase.type || 'commande'}_${computedRefId}.pdf`,
      });

      await backendService.sendEmail({
        to: emailTo,
        subject: emailSubject,
        body: emailBody.replace(/\n/g, '<br>'),
        attachmentName: `${purchase.type || 'commande'}_${computedRefId}.pdf`,
        pdfBase64,
      });

      showToast('Email envoyé avec succès !', 'success');
      setShowEmailModal(false);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Impossible d'envoyer l'email.", 'error');
    } finally {
      setSendingEmail(false);
    }
  };

  if (fetching) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-slate-700 font-bold uppercase tracking-widest text-xs">
            Chargement...
          </p>
        </div>
      </div>
    );
  }

  if (!purchase || !client) return null;

  // Handle legacy vs new structure
  const items = purchase.items || [
    {
      id: 'legacy',
      description: purchase.description,
      price: purchase.price,
      quantity: purchase.quantity,
    },
  ];

  const totalPaid = Number(purchase.amountPaid || 0);
  const historySum = payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
  // Robust initial payment calculation (precision issues with floats)
  const initialPaymentRaw = totalPaid - historySum;
  const initialPayment = initialPaymentRaw > 0.01 ? initialPaymentRaw : 0;

  return (
    <div className="w-full">
      <main className="w-full flex flex-col lg:flex-row gap-6 items-start py-4 animate-in fade-in duration-500">
        {/* Left Side: Document Preview */}
        <div
          className="flex-1 w-full bg-white dark:bg-[#2b2c40] p-8 md:p-12 shadow-xs rounded-xl border border-[#dbdade]/70 dark:border-[#434460]/40 overflow-hidden min-h-[500px] print:min-h-[1123px] flex flex-col relative"
          id="pdf-content-visual"
        >
          <div className="flex justify-between items-start border-b border-[#dbdade]/40 dark:border-[#434460]/40 pb-6 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#566a7f] dark:text-[#a1acb8] tracking-tight uppercase">
                {purchase.type === 'devis'
                  ? 'DEVIS'
                  : purchase.type === 'facture'
                    ? 'FACTURE'
                    : purchase.type === 'reçu'
                      ? 'REÇU'
                      : 'COMMANDE'}
              </h1>
              <div className="text-[15px] font-medium text-[#696cff] dark:text-[#b1b4ff] mt-1 mb-4 flex items-center gap-2">
                <span className="text-[#a1acb8] dark:text-[#707194]">#</span>
                {computedRefId}
              </div>
              {(!purchase.type || purchase.type === 'commande') && (
                <p className="text-[11px] text-[#a1acb8] dark:text-[#707194] lowercase mt-[-0.5rem] mb-4">
                  (commande n°: #{computedRefId})
                </p>
              )}
            </div>

            <div className="text-right">
              <div className="text-[13px] text-[#566a7f] dark:text-[#a1acb8] mt-1 space-y-1">
                <div className="flex justify-end gap-2">
                  <span className="font-semibold">Date d'émission :</span>
                  <span>
                    {purchase.date?.toDate
                      ? purchase.date.toDate().toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })
                      : purchase.date
                        ? new Date(purchase.date).toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : '-'}
                  </span>
                </div>
                {purchase.type === 'devis' ? (
                  <div className="flex justify-end gap-2">
                    <span className="font-semibold">Validité :</span>
                    <span>
                      {purchase.dueDate?.toDate
                        ? purchase.dueDate.toDate().toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : purchase.dueDate
                          ? new Date(purchase.dueDate).toLocaleDateString('fr-FR', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })
                          : (() => {
                              const baseDate = purchase.date?.toDate
                                ? purchase.date.toDate()
                                : purchase.date
                                  ? new Date(purchase.date)
                                  : new Date();
                              const expDate = new Date(
                                baseDate.getTime() + 7 * 24 * 60 * 60 * 1000
                              );
                              return expDate.toLocaleDateString('fr-FR', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              });
                            })()}
                    </span>
                  </div>
                ) : purchase.paymentDate ? (
                  <div className="flex justify-end gap-2">
                    <span className="font-semibold">Date de règlement :</span>
                    <span>
                      {purchase.paymentDate?.toDate
                        ? purchase.paymentDate.toDate().toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : new Date(purchase.paymentDate).toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                    </span>
                  </div>
                ) : null}

                <div
                  className={`mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold tracking-wider border shadow-2xs ${
                    purchase.type === 'devis'
                      ? 'bg-amber-50/70 text-amber-500 border-amber-100 dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-300'
                      : purchase.paymentStatus === 'paid' ||
                          Number(purchase.amountPaid || 0) >= Number(purchase.total || 0)
                        ? 'bg-emerald-50/70 text-[#4fb922] border-emerald-100 dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-[#71dd37]'
                        : Number(purchase.amountPaid || 0) > 0
                          ? 'bg-orange-50/70 text-orange-400 border-orange-100 dark:bg-orange-950/20 dark:border-orange-900/40 dark:text-orange-300'
                          : 'bg-rose-50/70 text-rose-400 border-rose-100 dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-300'
                  }`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      purchase.type === 'devis'
                        ? 'bg-amber-500'
                        : purchase.paymentStatus === 'paid' ||
                            Number(purchase.amountPaid || 0) >= Number(purchase.total || 0)
                          ? 'bg-[#4fb922] dark:bg-[#71dd37]'
                          : 'bg-orange-400'
                    }`}
                  />
                  <span className="uppercase tracking-widest text-[10px]">
                    {purchase.type === 'devis'
                      ? 'DEVIS EN ATTENTE'
                      : purchase.paymentStatus === 'paid' ||
                          Number(purchase.amountPaid || 0) >= Number(purchase.total || 0)
                        ? 'VALIDÉ & SOLDÉ'
                        : Number(purchase.amountPaid || 0) > 0
                          ? 'RÈGLEMENT PARTIEL'
                          : 'CRÉANCE EN COURS'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 my-8 text-[13px] text-[#566a7f] dark:text-[#a1acb8] leading-relaxed">
            <div>
              <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block mb-2 uppercase tracking-widest">
                {purchase.type === 'devis' ? 'Devis pour :' : "À l'attention de :"}
              </span>
              <h2 className="font-bold text-[14px] text-[#566a7f] dark:text-[#dbdade] mb-1 uppercase">
                {client.name}
              </h2>
              {client.addressLine1 && <p>{client.addressLine1}</p>}
              {(client.city || client.phone) && (
                <p>
                  {[client.city, client.phone ? `Tél: ${client.phone}` : '']
                    .filter(Boolean)
                    .join(' | ')}
                </p>
              )}
              {client.ice && <p className="mt-1">ICE: {client.ice}</p>}
            </div>
            <div className="text-right">
              <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block mb-2 uppercase tracking-widest">
                Règlement
              </span>
              <p>
                <span className="font-semibold">Statut :</span>{' '}
                {purchase.type === 'devis'
                  ? 'En attente'
                  : purchase.paymentStatus === 'paid' ||
                      Number(purchase.amountPaid || 0) >= Number(purchase.total || 0)
                    ? `Réglé (${purchase.mode_reglement?.replace(/💵 |🏦 |⏳ |📄 /g, '') || 'Espèces'})`
                    : Number(purchase.amountPaid || 0) > 0
                      ? `Avance (Reste: ${(Number(purchase.total || 0) - Number(purchase.amountPaid || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH)`
                      : 'Crédit'}
              </p>
              <p>
                <span className="font-semibold">Conditions :</span>{' '}
                {purchase.conditions_paiement || 'Paiement immédiat'}
              </p>
              {purchase.mode_reglement &&
                purchase.paymentStatus !== 'paid' &&
                Number(purchase.amountPaid || 0) < Number(purchase.total || 0) && (
                  <p>
                    <span className="font-semibold">Mode Prévu :</span>{' '}
                    {purchase.mode_reglement.replace(/💵 |🏦 |⏳ |📄 /g, '')}
                  </p>
                )}
            </div>
          </div>

          <div className="overflow-x-auto mb-8 border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[#dbdade]/70 dark:border-[#434460]/40 text-[#a1acb8] dark:text-[#707194] bg-[#f8f7fa] dark:bg-[#232333]">
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-12 text-center">
                    #
                  </th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px]">
                    Description
                  </th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-20 text-center">
                    Qté
                  </th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-32 text-right">
                    P.U (DH)
                  </th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-32 text-right">
                    Total (DH)
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dbdade]/40 dark:divide-[#434460]/20">
                {items.map((item: any, idx: number) => {
                  if (item.type === 'section') {
                    return (
                      <tr
                        key={(item.id || 'sec') + "_" + idx}
                        className="bg-slate-50/50 dark:bg-slate-800/10 transition-colors"
                      >
                        <td className="py-3 px-4"></td>
                        <td
                          colSpan={4}
                          className="py-3 px-4 font-bold text-[#566a7f] dark:text-[#dbdade]"
                        >
                          {item.description}
                        </td>
                      </tr>
                    );
                  }

                  if (item.type === 'note') {
                    return (
                      <tr
                        key={(item.id || 'note') + "_" + idx}
                        className="hover:bg-[#f8f7fa]/60 dark:hover:bg-[#232333]/40 transition-colors"
                      >
                        <td className="py-3 px-4"></td>
                        <td
                          colSpan={4}
                          className="py-3 px-4 italic text-slate-500 dark:text-slate-400 whitespace-pre-wrap"
                        >
                          {item.description}
                        </td>
                      </tr>
                    );
                  }

                  const itemTotal = (Number(item.price) || 0) * (Number(item.quantity) || 1);
                  return (
                    <tr
                      key={(item.id || 'prod') + "_" + idx}
                      className="text-[#566a7f] dark:text-[#a1acb8] hover:bg-[#f8f7fa]/60 dark:hover:bg-[#232333]/40 transition-colors"
                    >
                      <td className="py-3 px-4 text-center font-medium">{idx + 1}</td>
                      <td className="py-3 px-4 font-semibold text-[#566a7f] dark:text-[#dbdade] whitespace-pre-wrap">
                        {item.description}
                      </td>
                      <td className="py-3 px-4 text-center">{item.quantity}</td>
                      <td className="py-3 px-4 text-right font-mono text-[12px]">
                        {Number(item.price || 0).toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-[#566a7f] dark:text-[#dbdade] text-[12px]">
                        {Number(itemTotal).toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
            <div className="text-[13px] text-[#566a7f] dark:text-[#a1acb8] space-y-4">
              <div className="mb-8 bg-[#fffbeb] dark:bg-[#4b3e2e]/30 border-l-[3px] border-[#ffab00] p-3 rounded-r-md">
                <p className="text-[12px] font-medium leading-relaxed text-[#566a7f] dark:text-[#a1acb8]">
                  Arrêté{' '}
                  {purchase.type === 'devis'
                    ? 'la présente proposition'
                    : purchase.type === 'facture'
                      ? 'la présente facture'
                      : purchase.type === 'reçu'
                        ? 'le présent reçu'
                        : 'la présente commande'}{' '}
                  au montant de : <br />
                  <strong className="text-[#566a7f] dark:text-[#dbdade] mt-1 block uppercase">
                    {convertNumberToFrenchWords(Number(purchase.total || 0))}
                  </strong>
                </p>
              </div>
              <div>
                <span className="font-bold block uppercase tracking-wider text-[11px] text-[#a1acb8] dark:text-[#707194] mb-2">
                  Notes & Observations
                </span>
                {purchase.notesList &&
                Array.isArray(purchase.notesList) &&
                purchase.notesList.some((n: string) => n?.toString().trim() !== '') ? (
                  purchase.notesList
                    .filter((n: string) => n?.toString().trim() !== '')
                    .map((n: string, idx: number) => (
                      <p key={idx} className="font-medium mb-1">
                        • {n}
                      </p>
                    ))
                ) : purchase.notes ? (
                  <p className="font-medium">• {purchase.notes}</p>
                ) : (
                  <p className="text-[#a1acb8] dark:text-[#707194] italic text-[12px]">
                    Aucune observation.
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col justify-start items-end">
              <div className="w-full max-w-[280px] text-[13px] text-[#566a7f] dark:text-[#a1acb8]">
                <div className="flex justify-between py-1.5 px-2">
                  <span className="font-medium">Sous-Total :</span>
                  <span className="font-semibold font-mono text-[12px]">
                    {Number(purchase.subtotal || purchase.total).toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    DH
                  </span>
                </div>
                {purchase.taxAmount > 0 && (
                  <div className="flex justify-between py-1.5 px-2">
                    <span className="font-medium">Taxe ({purchase.taxRate}%) :</span>
                    <span className="font-semibold font-mono text-[12px]">
                      {Number(purchase.taxAmount).toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center text-[15px] p-3 rounded-lg font-bold text-[#696cff] dark:text-[#b1b4ff] bg-[#e7e7ff]/50 dark:bg-[#393a59]/30 mt-3 border border-[#696cff]/20 dark:border-[#696cff]/10">
                  <span>Total TTC :</span>
                  <span className="font-mono">
                    {Number(purchase.total).toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    DH
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Actions du Cockpit (User styling) */}
        <div className="w-full lg:w-[320px] flex flex-col gap-6 shrink-0 print:hidden lg:sticky lg:top-[90px] self-start">
          <div className="bg-white dark:bg-[#2b2c40] p-5 shadow-xs rounded-xl border border-[#dbdade]/70 dark:border-[#434460]/40">
            <span className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-wider block mb-3">
              Actions du Cockpit
            </span>

            {purchase.type === 'facture' && (
              <div className="mb-3 pb-3 border-b border-[#dbdade]/40 dark:border-[#434460]/40">
                <div className="grid grid-cols-3 gap-2.5">
                  {getInvoiceStatus(purchase) === 'Brouillon' && (
                    <button
                      onClick={handleValidateInvoice}
                      title="Valider la facture"
                      className="h-11 md:h-12 w-full bg-[#71dd37] hover:bg-[#66c732] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(113,221,55,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
                    >
                      <CheckCircle2 size={20} />
                    </button>
                  )}

                  {getInvoiceStatus(purchase) === 'Valide' && (
                    <button
                      onClick={() => navigate(`/credit-notes/create/${clientId}/${purchaseId}`)}
                      title="Créer un avoir"
                      className="h-11 md:h-12 w-full bg-[#696cff] hover:bg-[#5f61e6] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(105,108,255,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
                    >
                      <FileText size={20} />
                    </button>
                  )}

                  {(getInvoiceStatus(purchase) === 'Brouillon' ||
                    getInvoiceStatus(purchase) === 'Valide') && (
                    <button
                      onClick={handleCancelInvoice}
                      title="Annuler la facture"
                      className="h-11 md:h-12 w-full bg-[#ff3e1d] hover:bg-[#e6381a] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(255,62,29,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
                    >
                      <FileX size={20} />
                    </button>
                  )}

                  {(getInvoiceStatus(purchase) === 'Valide' ||
                    getInvoiceStatus(purchase) === 'Annulée') && (
                    <button
                      onClick={handleResetToDraft}
                      title="Remettre en brouillon"
                      className="h-11 md:h-12 w-full bg-[#ffab00] hover:bg-[#e69a00] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(255,171,0,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
                    >
                      <RefreshCw size={20} />
                    </button>
                  )}

                  {getInvoiceStatus(purchase) === 'Annulée' && (
                    <button
                      onClick={handleDeleteInvoice}
                      title="Supprimer définitivement"
                      className="h-11 md:h-12 w-full bg-[#ff3e1d] hover:bg-[#e6381a] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(255,62,29,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
                    >
                      <Trash2 size={20} />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2.5">
              <button
                onClick={handleExportPDF}
                title="Télécharger PDF"
                className="h-11 md:h-12 w-full bg-[#03c3ec] hover:bg-[#02afd4] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(3,195,236,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
              >
                <Printer size={20} />
              </button>

              <button
                onClick={handleExportBLPDF}
                title="Créer BL PDF (Bon de Livraison)"
                className="h-11 md:h-12 w-full bg-[#ffab00] hover:bg-[#e69a00] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(255,171,0,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
              >
                <Truck size={20} />
              </button>

              <button
                onClick={handleOpenEmailModal}
                title="Envoyer par Email"
                className="h-11 md:h-12 w-full bg-[#696cff] hover:bg-[#5f61e6] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(105,108,255,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
              >
                <Mail size={20} />
              </button>
            </div>
          </div>

          {/* Import / Export Excel */}
          <div className="bg-white dark:bg-[#2b2c40] p-5 shadow-xs rounded-xl border border-[#dbdade]/70 dark:border-[#434460]/40 text-left">
            <span className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-wider block mb-3">
              Import / Export Excel
            </span>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={exportToExcel}
                title="Exporter en Excel"
                className="h-11 md:h-12 w-full bg-[#71dd37] hover:bg-[#66c732] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(113,221,55,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
              >
                <Download size={20} />
              </button>
              <button
                onClick={() => {
                  setImportError(null);
                  setImportSuccess(null);
                  setParsedImportLines([]);
                  setIsImportModalOpen(true);
                }}
                title="Importer depuis Excel"
                className="h-11 md:h-12 w-full bg-[#03c3ec] hover:bg-[#02afd4] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(3,195,236,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
              >
                <Upload size={20} />
              </button>
            </div>
          </div>

          {/* Pièce Justificative Section */}
          {purchase?.attachmentUrl && (
            <div className="bg-white dark:bg-[#2b2c40] p-5 shadow-xs rounded-xl border border-[#dbdade]/70 dark:border-[#434460]/40">
              <div className="flex justify-between items-center mb-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  Pièce Justificative
                </span>
                <Paperclip size={14} className="text-[#696cff]" />
              </div>

              <div className="bg-slate-50 dark:bg-[#232333]/40 p-3 rounded-lg border border-slate-100 dark:border-[#434460]/30 flex flex-col gap-2.5">
                <div className="flex items-center gap-2">
                  <FileText size={16} className="text-[#696cff] shrink-0" />
                  <span
                    className="text-xs font-semibold text-[#566a7f] dark:text-[#dbdade] truncate max-w-[200px]"
                    title={purchase.attachmentName || 'justificatif'}
                  >
                    {purchase.attachmentName || 'Justificatif rattaché'}
                  </span>
                </div>

                <a
                  href={purchase.attachmentUrl}
                  download={purchase.attachmentName || 'justificatif'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full bg-[#696cff] hover:bg-[#5f61e6] hover:shadow-[0_0.25rem_0.5rem_0_rgba(105,108,255,0.2)] text-white py-2 px-3 rounded-md font-bold text-[11px] tracking-wider uppercase text-center flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                >
                  <Download size={12} />
                  Télécharger / Ouvrir
                </a>
              </div>
            </div>
          )}

          {/* Payment Section */}
          {purchase.type !== 'devis' && (
            <div className="bg-white dark:bg-[#2b2c40] p-4 shadow-xs rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  Règlements & Solde
                </span>
                <span className="text-blue-500 text-xs">
                  <Info size={14} />
                </span>
              </div>

              <div className="space-y-4 text-xs font-bold">
                <div className="bg-gray-50 dark:bg-[#232333] p-3 rounded-md flex justify-between items-center border border-gray-100 dark:border-[#434460]/30">
                  <span className="text-gray-400 dark:text-gray-500 uppercase text-[10px]">
                    Collecté
                  </span>
                  <span className="text-emerald-500 text-sm font-mono">
                    {Number(
                      purchase.amountPaid ||
                        (purchase.paymentStatus === 'paid' ? purchase.total : 0)
                    ).toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    DH
                  </span>
                </div>

                <div className="flex justify-between items-center px-1">
                  <span className="text-slate-700 dark:text-gray-300 uppercase tracking-wider text-[10px]">
                    Reste Due
                  </span>
                  <span className="text-red-500 text-sm font-mono">
                    {Math.max(
                      0,
                      Number(purchase.total) -
                        Number(
                          purchase.amountPaid ||
                            (purchase.paymentStatus === 'paid' ? purchase.total : 0)
                        )
                    ).toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    DH
                  </span>
                </div>

                {purchase.paymentStatus !== 'paid' &&
                  Number(purchase.amountPaid || 0) < Number(purchase.total || 0) && (
                    <>
                      <div className="relative mt-2">
                        <input
                          type="number"
                          placeholder="Encaissement..."
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          className="w-full bg-gray-50 dark:bg-[#232333] border border-gray-200 dark:border-[#434460]/50 rounded-md py-2.5 pl-3 pr-10 text-gray-700 dark:text-gray-300 font-mono font-bold placeholder-gray-400 focus:outline-none focus:border-cyan-400 transition-colors"
                        />
                        <span className="absolute right-3 top-2.5 text-gray-400">
                          <Calculator size={14} />
                        </span>
                      </div>

                      <button
                        disabled={addingPayment || !paymentAmount}
                        onClick={handleAddPayment}
                        className="w-full bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 dark:disabled:bg-indigo-800 disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-md uppercase tracking-wider text-[11px] font-black transition-colors"
                      >
                        {addingPayment ? 'Saisie...' : 'Valider Encaissement'}
                      </button>
                    </>
                  )}

                {/* Transaction History (Mini) */}
                {payments.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-[#434460]/30 space-y-2">
                    {payments.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between py-1 px-1 group text-left border-b border-gray-50 dark:border-gray-800/30 last:border-0"
                      >
                        <div className="flex flex-col">
                          <span className="font-mono text-slate-800 dark:text-gray-300">
                            {Number(p.amount).toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            DH
                          </span>
                          <span className="text-[9px] text-gray-400 font-medium mt-0.5">
                            {p.date?.toDate ? p.date.toDate().toLocaleDateString('fr-FR') : '-'}
                            {p.notes && <span className="ml-1 opacity-80">- {p.notes}</span>}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeletePayment(p)}
                          className="text-gray-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Email Dispatch Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-[9999] p-4 animate-fadeIn">
          <div className="bg-white dark:bg-[#2b2c40] w-full max-w-lg border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl shadow-lg overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#f4f3f6] dark:border-[#434460]/20 flex items-center justify-between bg-[#f5f5f9] dark:bg-[#232333]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#03c3ec]/15 flex items-center justify-center text-[#03c3ec]">
                  <Mail size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#435971] dark:text-[#dbdade]">
                    Envoyer le document
                  </h3>
                  <p className="text-[10px] text-[#a1acb8] font-semibold uppercase tracking-wider">
                    Via Gmail SMTP Sécurisé
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEmailModal(false)}
                className="p-1 px-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-[#232333] transition-all font-bold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-[#a1acb8] uppercase tracking-wider">
                  Email Destinataire :
                </label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="exemple@client.com"
                  className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/50 rounded-lg px-3.5 py-2.5 text-sm text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] transition-all outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-[#a1acb8] uppercase tracking-wider">
                  Objet du message :
                </label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Objet de l'email"
                  className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/50 rounded-lg px-3.5 py-2.5 text-sm text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] transition-all outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-[#a1acb8] uppercase tracking-wider">
                  Message Commercial :
                </label>
                <textarea
                  rows={4}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  placeholder="Message..."
                  className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/50 rounded-lg px-3.5 py-2.5 text-sm text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] transition-all outline-none resize-none"
                />
              </div>

              <div className="bg-[#e0f7fa] dark:bg-[#006064]/20 border border-[#b2ebf2]/40 rounded-lg p-3 text-[11px] text-[#006064] dark:text-[#80deea] flex gap-2">
                <span className="font-bold">💡 Information :</span>
                <span>
                  Un fichier PDF de haute qualité correspondant au document affiché sera
                  automatiquement généré et joint à cet email.
                </span>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4.5 border-t border-[#f4f3f6] dark:border-[#434460]/20 bg-[#f5f5f9] dark:bg-[#232333] flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowEmailModal(false)}
                disabled={sendingEmail}
                className="px-4 py-2.5 text-xs font-bold text-slate-500 hover:text-slate-700 bg-transparent rounded-lg hover:bg-slate-100 transition-all uppercase tracking-widest cursor-pointer disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={sendingEmail}
                onClick={handleSendEmail}
                className="px-5 py-2.5 bg-[#03c3ec] hover:bg-[#02afd4] text-white font-bold text-xs rounded-lg uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50 active:scale-[0.98]"
              >
                {sendingEmail ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Envoi en cours...
                  </>
                ) : (
                  <>
                    <Mail size={14} />
                    Envoyer l'Email
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Override & Gap Recycling Invoice Validation Modal in details view */}
      {isValidationModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-[9999] p-4 animate-fadeIn">
          <div className="bg-white dark:bg-[#2b2c40] w-full max-w-md border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl shadow-lg overflow-hidden flex flex-col text-left">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#f4f3f6] dark:border-[#434460]/20 flex items-center justify-between bg-[#f5f5f9] dark:bg-[#232333]">
              <div>
                <h3 className="text-sm font-bold text-[#435971] dark:text-[#dbdade]">
                  Valider la Facture
                </h3>
                <p className="text-[10px] text-[#a1acb8] font-semibold uppercase tracking-wider mt-1">
                  État actuel : <strong className="text-orange-500">Brouillon</strong>
                </p>
              </div>
              <button
                onClick={() => setIsValidationModalOpen(false)}
                className="p-1 px-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-[#232333] transition-all font-bold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleConfirmValidation} className="p-6 space-y-4">
              <div className="bg-orange-50/70 text-orange-600 border border-orange-100 p-4 rounded-md text-xs space-y-1 bg-clip-padding">
                <p className="font-bold uppercase tracking-wider text-[9px] mb-1">
                  Règles de Numérotation Légale :
                </p>
                <p>Un numéro séquentiel unique officiel est automatiquement calculé.</p>
                <p>
                  Vous pouvez <strong className="underline">surcharger ce numéro</strong> ci-dessous
                  si vous souhaitez recycler des trous de numérotation d'anciennes factures
                  supprimées.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-[#a1acb8] uppercase tracking-wider">
                  Numéro Officiel Assigné
                </label>
                <input
                  type="text"
                  required
                  value={customRefNum}
                  onChange={(e) => setCustomRefNum(e.target.value.toUpperCase())}
                  placeholder="Ex: FAC-2026-0001..."
                  className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/50 rounded-lg px-3.5 py-2.5 text-sm font-mono font-bold text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] transition-all outline-none uppercase tracking-wider"
                />
                <p className="text-[10px] text-[#a1acb8] font-medium">
                  Contrôle d'unicité automatique à la validation.
                </p>
              </div>

              {missingSequences.length > 0 && (
                <div className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 p-3 rounded-md mt-2">
                  <p className="font-bold text-[10px] text-red-600 dark:text-red-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                    ⚠️ Trous de numérotation détectés
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {missingSequences.map((seq, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setCustomRefNum(seq)}
                        className="px-2 py-1 bg-white dark:bg-[#32334b] border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-[10px] font-mono font-bold rounded hover:bg-red-600 hover:text-white dark:hover:bg-red-500 dark:hover:text-white transition-colors cursor-pointer"
                      >
                        {seq}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Modal Footer */}
              <div className="pt-4 border-t border-[#f4f3f6] dark:border-[#434460]/20 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsValidationModalOpen(false)}
                  disabled={loadingValidation}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-[#435971] bg-transparent rounded-lg hover:bg-slate-100 transition-all uppercase tracking-widest cursor-pointer disabled:opacity-50"
                >
                  Brouillon
                </button>
                <button
                  type="submit"
                  disabled={loadingValidation}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {loadingValidation ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Validation...
                    </>
                  ) : (
                    'Confirmer la validation'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Excel Import Modal */}
      {isImportModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-[9999] p-4 animate-fadeIn">
          <div className="bg-white dark:bg-[#2b2c40] w-full max-w-xl border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl shadow-lg overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[#f4f3f6] dark:border-[#434460]/20 flex items-center justify-between bg-[#f5f5f9] dark:bg-[#232333]">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#03c3ec]/15 flex items-center justify-center text-[#03c3ec]">
                  <FileSpreadsheet size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-[#435971] dark:text-[#dbdade]">
                    Importer les articles depuis Excel
                  </h3>
                  <p className="text-[10px] text-[#a1acb8] font-semibold uppercase tracking-wider">
                    Format compatible : Excel (.xlsx, .xls) ou CSV
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsImportModalOpen(false)}
                className="p-1 px-2 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-slate-100 dark:hover:bg-[#232333] transition-all font-bold text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4">
              {/* File Selector Zone */}
              <div className="border-2 border-dashed border-[#dbdade] dark:border-[#434460] rounded-xl p-6 text-center hover:bg-slate-50 dark:hover:bg-[#232333]/20 transition-all relative">
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleExcelImport(file);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center gap-2 text-center">
                  <Upload size={32} className="text-[#a1acb8]" />
                  <span className="text-sm font-semibold text-[#566a7f] dark:text-[#dbdade]">
                    Déposer votre fichier Excel ici ou cliquez pour parcourir
                  </span>
                  <span className="text-xs text-slate-400">
                    Les colonnes de votre fichier seront mappées automatiquement (Produit/Description, Quantité, Prix unitaire, Taxe/TVA).
                  </span>
                </div>
              </div>

              {/* Status Indicator */}
              {importingFile && (
                <div className="flex items-center gap-3 bg-blue-50/50 dark:bg-blue-900/15 p-3 rounded-lg border border-blue-100/50 text-blue-600 text-xs font-semibold text-left">
                  <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0"></div>
                  Analyse et traitement du fichier Excel en cours...
                </div>
              )}

              {importError && (
                <div className="p-3 bg-rose-50/70 dark:bg-rose-900/10 text-rose-500 rounded-lg border border-rose-100 dark:border-rose-900/30 text-xs font-semibold text-left">
                  ⚠ {importError}
                </div>
              )}

              {importSuccess && (
                <div className="p-3 bg-emerald-50/70 dark:bg-emerald-900/10 text-emerald-600 rounded-lg border border-emerald-100 dark:border-emerald-900/30 text-xs font-semibold text-left">
                  ✓ {importSuccess}
                </div>
              )}

              {/* Parsed Items Preview Table */}
              {parsedImportLines.length > 0 && (
                <div className="space-y-2 text-left">
                  <span className="text-[10px] font-black text-[#a1acb8] uppercase tracking-wider block">
                    Aperçu des articles à importer ({parsedImportLines.length}) :
                  </span>
                  <div className="max-h-[180px] overflow-y-auto border border-slate-100 dark:border-[#434460]/30 rounded-lg">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-[#f5f5f9] dark:bg-[#232333] text-[#566a7f] dark:text-[#dbdade] font-semibold sticky top-0">
                        <tr>
                          <th className="p-2">Description</th>
                          <th className="p-2 text-center">Quantité</th>
                          <th className="p-2 text-right">Prix (DH)</th>
                          <th className="p-2 text-center">TVA</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-[#434460]/20 text-[#566a7f] dark:text-[#a1acb8]">
                        {parsedImportLines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-[#232333]/10">
                            <td className="p-2 truncate max-w-[200px]" title={line.description}>
                              {line.description}
                            </td>
                            <td className="p-2 text-center font-mono">{line.quantity}</td>
                            <td className="p-2 text-right font-mono">
                              {Number(line.price).toFixed(2)}
                            </td>
                            <td className="p-2 text-center font-mono">{line.tax}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-[#f4f3f6] dark:border-[#434460]/20 flex justify-end gap-3 bg-[#f5f5f9] dark:bg-[#232333]">
              <button
                type="button"
                onClick={() => setIsImportModalOpen(false)}
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-[#435971] bg-transparent rounded-lg hover:bg-slate-100 transition-all uppercase tracking-widest cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={parsedImportLines.length === 0}
                onClick={handleConfirmImport}
                className="px-5 py-2.5 bg-[#03c3ec] hover:bg-[#02afd4] text-white font-bold text-xs rounded-lg uppercase tracking-widest transition-all flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
              >
                Confirmer l'importation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden layout for PDF Export using standard template */}
      <div
        style={{
          position: 'absolute',
          top: '-9999px',
          left: '-9999px',
          zIndex: -9999,
        }}
      >
        <div
          id="pdf-export-hidden"
          style={{
            background: 'white',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ width: '210mm', height: '297mm' }}>
            <InvoicePrint data={mapDocToInvoiceData(purchase, client)} />
          </div>
        </div>

        <div
          id="bl-pdf-export-hidden"
          style={{
            background: 'white',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ width: '210mm', height: '297mm' }}>
            <DeliveryNotePrint data={mapDocToDeliveryNoteData(purchase, client, computedRefId)} />
          </div>
        </div>
      </div>
    </div>
  );
}

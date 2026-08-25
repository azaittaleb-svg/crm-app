import { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  doc,
  updateDoc,
  collection,
  addDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { useNavigate, useParams } from 'react-router-dom';
import { COMPANY_INFO } from '../constants';
import {
  ArrowLeft,
  Truck,
  Edit3,
  Package,
  Trash2,
  Copy,
  Printer,
  Coins,
  Plus,
  Send,
  Layers,
  Receipt,
  CheckCircle2,
  AlertCircle,
  Paperclip,
  FileText,
  Download,
  Upload,
  FileSpreadsheet,
} from 'lucide-react';
import { motion } from 'motion/react';
import * as XLSX from 'xlsx';

export default function SupplierPurchaseDetailsPage() {
  const { supplierId, purchaseId } = useParams();
  const [purchase, setPurchase] = useState<any>(null);
  const [supplier, setSupplier] = useState<any>(null);
  const [fetching, setFetching] = useState(true);
  const { showToast, confirm } = useNotification();
  const [paymentAmount, setPaymentAmount] = useState('');
  const [addingPayment, setAddingPayment] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  const { user } = useAuth();
  const navigate = useNavigate();

  // Excel import/export states
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importingFile, setImportingFile] = useState(false);
  const [parsedImportLines, setParsedImportLines] = useState<any[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const exportToExcel = () => {
    if (!purchase || !supplier) return;
    try {
      const pType = purchase.type || 'achat_fournisseur';
      const computedRefId = purchase.refId || purchase.id || '';
      
      const dataRows = [
        ['RÉCAPITULATIF DE L\'ACHAT FOURNISSEUR'],
        ['Type de Document', pType.toUpperCase()],
        ['Référence', computedRefId],
        ['Statut Paiement', purchase.paymentStatus || ''],
        ['Date d\'émission', purchase.date?.toDate ? purchase.date.toDate().toLocaleDateString('fr-FR') : purchase.date || ''],
        ['Fournisseur / Partenaire', supplier.name],
        ['Téléphone Fournisseur', supplier.phone || ''],
        ['Email Fournisseur', supplier.email || ''],
        ['Adresse Fournisseur', supplier.address || ''],
        [''],
        ['LIGNES DE FACTURE / ARTICLES'],
        ['Description/Libellé', 'Quantité', 'Prix Unitaire (DH)', 'Taxe (%)', 'Total TTC (DH)'],
      ];

      const itemsList = purchase.items || [
        {
          id: 'legacy',
          description: purchase.description,
          price: purchase.price,
          quantity: purchase.quantity,
        },
      ];

      itemsList.forEach((item: any) => {
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
      XLSX.writeFile(wb, `ACHAT_${computedRefId}.xlsx`);
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
    if (!purchase || !supplierId || !purchaseId) return;
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
      
      const purchaseRef = doc(db, 'suppliers', supplierId, 'purchases', purchaseId);
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

  useEffect(() => {
    if (!supplierId || !purchaseId || !user) return;

    setFetching(true);
    let purchaseLoaded = false;
    let supplierLoaded = false;
    let paymentsLoaded = false;

    const checkReady = () => {
      if (purchaseLoaded && supplierLoaded && paymentsLoaded) {
        setFetching(false);
      }
    };

    const unsubPurchase = onSnapshot(
      doc(db, 'suppliers', supplierId, 'purchases', purchaseId),
      (snap) => {
        if (snap.exists()) {
          const pData = snap.data() as any;
          if (!pData.ownerId || pData.ownerId === user.uid) {
            setPurchase({ id: snap.id, ...pData });
          } else {
            showToast('Accès non autorisé', 'error');
            navigate(-1);
          }
        } else {
          showToast('Achat non trouvé', 'error');
          navigate(-1);
        }
        purchaseLoaded = true;
        checkReady();
      },
      (err) => {
        handleFirestoreError(
          err,
          OperationType.GET,
          `suppliers/${supplierId}/purchases/${purchaseId}`
        );
        purchaseLoaded = true;
        checkReady();
      }
    );

    const unsubSupplier = onSnapshot(doc(db, 'suppliers', supplierId), (snap) => {
      if (snap.exists()) {
        const sData = snap.data() as any;
        if (!sData.ownerId || sData.ownerId === user.uid) {
          setSupplier({ id: snap.id, ...sData });
        }
      }
      supplierLoaded = true;
      checkReady();
    });

    const paymentsRef = collection(db, 'suppliers', supplierId, 'payments');
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

    return () => {
      unsubPurchase();
      unsubSupplier();
      unsubPayments();
    };
  }, [supplierId, purchaseId, user, navigate]);

  useEffect(() => {
    const handleCopy = () => {
      copyReportToClipboard();
    };
    window.addEventListener('copy-supplier-purchase', handleCopy);
    return () => {
      window.removeEventListener('copy-supplier-purchase', handleCopy);
    };
  }, [purchase, supplier]);

  const handleAddPayment = async () => {
    if (!supplierId || !purchaseId) return;
    if (!paymentAmount || isNaN(Number(paymentAmount)) || Number(paymentAmount) <= 0) {
      showToast('Veuillez saisir un montant de versement valide.', 'error');
      return;
    }

    const amount = Number(paymentAmount);
    const balanceRemainingRaw = Number(purchase.total) - Number(purchase.amountPaid || 0);
    const balanceRemaining = Math.max(0, Math.round(balanceRemainingRaw * 100) / 100);

    if (amount > balanceRemaining) {
      showToast(
        `Le montant ne peut pas dépasser la dette actuelle de ${balanceRemaining.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`,
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
      await updateDoc(doc(db, 'suppliers', supplierId, 'purchases', purchaseId), updateData);

      // Track the payment in Firebase subcollection
      const newPaymentObj = {
        ownerId: user.uid,
        amount,
        date: serverTimestamp(),
        purchaseId: purchaseId,
        notes: `Versement pour l'achat ${purchase?.refId ? purchase.refId : ''}`,
      };
      const newDocRef = await addDoc(
        collection(db, 'suppliers', supplierId, 'payments'),
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
      showToast('Versement enregistré avec succès !', 'success');
    } catch (error: any) {
      showToast('Erreur lors de la validation du paiement', 'error');
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `suppliers/${supplierId}/purchases/${purchaseId}`
      );
    } finally {
      setAddingPayment(false);
    }
  };

  const handleDeletePayment = async (payment: any) => {
    confirm({
      title: 'Supprimer ce règlement ?',
      message: `Êtes-vous sûr de vouloir supprimer ce règlement de ${Number(payment.amount).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH ? Cela réajustera le solde restant de la facturation auprès de ${supplier?.name}.`,
      onConfirm: async () => {
        if (!supplierId || !purchaseId) return;

        const isInitial = payment.isInitial;
        if (!isInitial && !payment.id) return;

        setDeletingPaymentId(isInitial ? 'initial' : payment.id);
        try {
          const newTotalPaidValue = (Number(purchase.amountPaid) || 0) - Number(payment.amount);
          const newTotalPaid = Math.max(0, Math.round(newTotalPaidValue * 100) / 100);
          let newStatus = 'credit';
          if (newTotalPaid >= Math.round(Number(purchase.total) * 100) / 100) {
            newStatus = 'paid';
          }

          if (!isInitial) {
            await deleteDoc(doc(db, 'suppliers', supplierId, 'payments', payment.id));

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

          await updateDoc(
            doc(db, 'suppliers', supplierId, 'purchases', purchaseId),
            deleteUpdateData
          );

          if (!isInitial) {
            setPayments((prev) => prev.filter((p) => p.id !== payment.id));
          }

          setPurchase({
            ...purchase,
            amountPaid: newTotalPaid,
            paymentStatus: newStatus,
          });
          showToast('Règlement supprimé.');
        } catch (error: any) {
          showToast('Échec de la suppression.', 'error');
          handleFirestoreError(
            error,
            OperationType.DELETE,
            `suppliers/${supplierId}/payments/${isInitial ? 'initial' : payment.id}`
          );
        } finally {
          setDeletingPaymentId(null);
        }
      },
    });
  };

  const shareInvoiceWhatsApp = () => {
    if (!purchase || !supplier) return;
    const dateStr = purchase.date?.toDate
      ? purchase.date.toDate().toLocaleDateString('fr-FR')
      : purchase.date
        ? new Date(purchase.date).toLocaleDateString('fr-FR')
        : '-';
    const docId = purchase.refId || '';
    const remaining = Math.max(0, Number(purchase.total) - Number(purchase.amountPaid || 0));

    let itemsText = '';
    const itemsList = purchase.items || [
      {
        id: 'legacy',
        description: purchase.description,
        price: purchase.price,
        quantity: purchase.quantity,
      },
    ];
    itemsList.forEach((item: any, index: number) => {
      itemsText += `\n${index + 1}. ${item.description.toUpperCase()} (x${item.quantity}) - ${Number(item.price).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    });

    const reportText = `🧾 *BON D'ACHAT INTERNE N° ${docId}* 🧾
Date : ${dateStr}
Fournisseur : ${supplier.name.toUpperCase()}

━━━━━━━━━━━━━━━━━━━
📦 *DÉSIGNATION DES ARTICLES :*${itemsText}
━━━━━━━━━━━━━━━━━━━
💰 *Total de Revient :* ${Number(purchase.total).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
✅ *Montant Réglé :* ${Number(purchase.amountPaid || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
⚠️ *Reste à payer (Dette) :* ${remaining.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
━━━━━━━━━━━━━━━━━━━
Statut : ${purchase.paymentStatus === 'paid' ? '✅ RÉGLÉ (SOLDÉ)' : '⏳ EN CRÉDIT'}`;

    const encodedText = encodeURIComponent(reportText);
    if (!supplier.phone) {
      showToast('Aucun numéro de téléphone configuré pour ce fournisseur.', 'error');
      return;
    }
    const cleanNum = supplier.phone.replace(/[^0-9]/g, '');
    if (/^0[58]/.test(cleanNum) || /^(212|00212)[58]/.test(cleanNum) || /^[58][0-9]{8}$/.test(cleanNum)) {
      showToast('Le numéro de ce fournisseur est une ligne fixe (05...), impossible d\'envoyer par WhatsApp.', 'error');
      return;
    }
    showToast('Envoi du message WhatsApp en cours...', 'info');
    import('../services/whatsappService').then(({ sendWhatsAppMessage }) => {
      sendWhatsAppMessage(supplier.phone, reportText).then(result => {
        if (result.success) {
          showToast('Message WhatsApp envoyé avec succès.', 'success');
        } else {
          showToast('Erreur lors de l\'envoi: ' + result.error, 'error');
        }
      });
    });
  };

  const copyReportToClipboard = () => {
    if (!purchase || !supplier) return;
    const dateStr = purchase.date?.toDate
      ? purchase.date.toDate().toLocaleDateString('fr-FR')
      : purchase.date
        ? new Date(purchase.date).toLocaleDateString('fr-FR')
        : '-';
    const docId = purchase.refId || '';
    const remaining = Math.max(0, Number(purchase.total) - Number(purchase.amountPaid || 0));

    let itemsText = '';
    const itemsList = purchase.items || [
      {
        id: 'legacy',
        description: purchase.description,
        price: purchase.price,
        quantity: purchase.quantity,
      },
    ];
    itemsList.forEach((item: any, index: number) => {
      itemsText += `\n${index + 1}. ${item.description.toUpperCase()} (x${item.quantity}) - ${Number(item.price).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`;
    });

    const reportText = `🧾 BON D'ACHAT N° ${docId} 🧾
Date : ${dateStr}
Fournisseur : ${supplier.name.toUpperCase()}

━━━━━━━━━━━━━━━━━━━
Détail des articles :${itemsText}
━━━━━━━━━━━━━━━━━━━
Total de Revient : ${Number(purchase.total).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
Montant Réglé : ${Number(purchase.amountPaid || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
Reste dû (Dette) : ${remaining.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
━━━━━━━━━━━━━━━━━━━
Statut : ${purchase.paymentStatus === 'paid' ? '✅ RÉGLÉ (SOLDÉ)' : '⏳ SOLDE CRÉDITEUR'}`;

    navigator.clipboard.writeText(reportText);
    showToast('Résumé copié dans le presse-papiers !', 'success');
  };

  if (fetching) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#f5f5f9] dark:bg-[#232333]">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-10 w-10 border-4 border-[#696cff] border-t-transparent"></div>
          <p className="text-[#a1acb8] dark:text-[#707194] font-mono text-[10px] uppercase tracking-widest font-bold">
            Récupération des données logistiques...
          </p>
        </div>
      </div>
    );
  }

  if (!purchase || !supplier) return null;

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
  const initialPaymentRaw = totalPaid - historySum;
  const initialPayment = initialPaymentRaw > 0.01 ? initialPaymentRaw : 0;
  const remainingDebt = Math.max(0, Number(purchase.total) - totalPaid);

  return (
    <div className="w-full">
      <main className="w-full flex flex-col lg:flex-row gap-6 items-start py-4 animate-in fade-in duration-500">
        {/* Left Side: Live A4 Document Preview */}
        <div
          className="flex-1 w-full bg-white dark:bg-[#2b2c40] p-8 md:p-12 shadow-xs rounded-xl border border-[#dbdade]/70 dark:border-[#434460]/40 overflow-hidden min-h-[500px] print:min-h-[1123px] flex flex-col relative"
          id="pdf-content"
        >
          {/* Header Section */}
          <div className="flex flex-col md:flex-row justify-between items-start border-b border-[#dbdade]/40 dark:border-[#434460]/40 pb-6 mb-6 gap-4">
            <div>
              <h1 className="text-2xl font-bold text-[#566a7f] dark:text-[#a1acb8] tracking-tight uppercase">
                ACHAT FOURNISSEUR {purchase.isInternational ? 'INTERNATIONAL' : 'LOCAL'}
              </h1>
              <div className="text-[15px] font-medium text-[#696cff] dark:text-[#b1b4ff] mt-1 mb-4 flex items-center gap-2">
                <span className="text-[#a1acb8] dark:text-[#707194]">#</span>
                {purchase?.refId
                  ? purchase.refId
                  : `ACH/${purchase?.id?.slice(0, 8).toUpperCase()}`}
              </div>
            </div>

            <div className="text-left sm:text-right">
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
                {purchase.dueDate ? (
                  <div className="flex justify-end gap-2">
                    <span className="font-semibold">Date de règlement :</span>
                    <span>
                      {purchase.dueDate?.toDate
                        ? purchase.dueDate.toDate().toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })
                        : new Date(purchase.dueDate).toLocaleDateString('fr-FR', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                    </span>
                  </div>
                ) : null}
                <div
                  className={`mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold tracking-wider border shadow-2xs ${
                    purchase.paymentStatus === 'paid'
                      ? 'bg-emerald-50/70 text-[#4fb922] border-emerald-100 dark:bg-[#71dd37]/10 dark:text-[#71dd37] dark:border-[#71dd37]/20'
                      : 'bg-orange-50/70 text-orange-400 border-orange-100 dark:bg-[#ffab00]/10 dark:text-[#ffab00] dark:border-[#ffab00]/20'
                  }`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${purchase.paymentStatus === 'paid' ? 'bg-[#4fb922] dark:bg-[#71dd37]' : 'bg-[#ffab00]'}`}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    {purchase.paymentStatus === 'paid' ? 'VALIDÉ & SOLDÉ' : 'CRÉANCE EN COURS'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Supplier Info */}
          <div className="grid grid-cols-2 gap-8 my-8 text-[13px] text-[#566a7f] dark:text-[#a1acb8] leading-relaxed">
            <div>
              <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block mb-2 uppercase tracking-widest">
                Fournisseur :
              </span>
              <h2 className="font-bold text-[14px] text-[#566a7f] dark:text-[#dbdade] mb-1 uppercase">
                {supplier?.name || 'Inconnu'}
              </h2>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block mb-2 uppercase tracking-widest">
                Règlement
              </span>
              <p>
                <span className="font-semibold">Statut :</span>{' '}
                {purchase.paymentStatus === 'paid' ||
                Number(totalPaid) >= Number(purchase.total || 0)
                  ? `Réglé (${purchase.mode_reglement?.replace(/💵 |🏦 |⏳ |📄 /g, '') || 'Espèces'})`
                  : Number(totalPaid) > 0
                    ? `Avance (Reste: ${(Number(purchase.total || 0) - Number(totalPaid)).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH)`
                    : 'À Crédit'}
              </p>
              <p>
                <span className="font-semibold">Conditions :</span>{' '}
                {purchase.conditions_paiement || 'Paiement immédiat'}
              </p>
              {purchase.mode_reglement &&
                purchase.paymentStatus !== 'paid' &&
                Number(totalPaid) < Number(purchase.total || 0) && (
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
                    N°
                  </th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px]">
                    Désignation
                  </th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-20 text-center">
                    Qté
                  </th>
                  {purchase.isInternational ? (
                    <>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-24 text-right">
                        P.A ($)
                      </th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-24 text-right text-[#696cff] dark:text-[#b1b4ff]">
                        +36.5%
                      </th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-24 text-right text-[#696cff] dark:text-[#b1b4ff]">
                        DIW MAD
                      </th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-24 text-right text-[#696cff] dark:text-[#b1b4ff]">
                        F.T
                      </th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-28 text-right text-[#71dd37] dark:text-[#71dd37]">
                        P.R
                      </th>
                    </>
                  ) : (
                    <>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-20 text-center">
                        Unité
                      </th>
                      <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-32 text-right">
                        P.U HT (DH)
                      </th>
                    </>
                  )}
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-32 text-right">
                    Total HT (DH)
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
                          colSpan={purchase.isInternational ? 7 : 4}
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
                          colSpan={purchase.isInternational ? 7 : 4}
                          className="py-3 px-4 italic text-slate-500 dark:text-slate-400 whitespace-pre-wrap"
                        >
                          {item.description}
                        </td>
                      </tr>
                    );
                  }

                  const itemTotalHT = (item.price || 0) * (item.quantity || 1);
                  return (
                    <tr
                      key={(item.id || 'prod') + "_" + idx}
                      className="text-[#566a7f] dark:text-[#a1acb8] hover:bg-[#f8f7fa]/60 dark:hover:bg-[#232333]/40 transition-colors"
                    >
                      <td className="py-3 px-4 text-center font-medium">{idx + 1}</td>
                      <td className="py-3 px-4 font-semibold text-[#566a7f] dark:text-[#dbdade]">
                        <span
                          className="block truncate max-w-[200px] md:max-w-[300px]"
                          title={item.description?.toUpperCase()}
                        >
                          {item.description?.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-[12px]">
                        {item.quantity}
                      </td>

                      {purchase.isInternational ? (
                        <>
                          <td className="py-3 px-4 text-right font-mono text-[12px]">
                            {Number(item.prix_achat_usd || 0).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                            {'\u00a0'}$
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[12px]">
                            {((item.prix_achat_usd || 0) * 1.365).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                            {'\u00a0'}$
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[12px] font-semibold text-[#696cff] dark:text-[#b1b4ff]">
                            {Number(item.diw_mad || 0).toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                            {'\u00a0'}DH
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[12px]">
                            {Number(item.shipping_usd || 0).toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                            {'\u00a0'}$
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[12px] text-[#71dd37] dark:text-[#71dd37] font-semibold">
                            {Number(item.prix_achat_net_unit_mad || item.price || 0).toLocaleString(
                              'fr-FR',
                              {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              }
                            )}
                            {'\u00a0'}DH
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-3 px-4 text-center font-mono text-[12px]">
                            {item.unit || 'U'}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-[12px]">
                            {Number(item.price || 0).toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </>
                      )}

                      <td className="py-3 px-4 text-right font-mono font-bold text-[#566a7f] dark:text-[#dbdade] text-[12px]">
                        {Number(itemTotalHT).toLocaleString('fr-FR', {
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
              {purchase.isInternational && (
                <div className="mb-8 bg-[#f5f5f9] dark:bg-[#232333]/30 border-l-[3px] border-[#696cff] p-3 rounded-r-md">
                  <p className="text-[11px] font-medium leading-relaxed text-[#566a7f] dark:text-[#a1acb8]">
                    Total DIW (DH) :{' '}
                    <strong className="text-indigo-650 dark:text-[#b1b4ff] ml-1">
                      {(purchase.totalDiwMad || 0).toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </strong>
                    <br />
                    Total Transport ($) :{' '}
                    <strong className="text-[#696cff] dark:text-[#b1b4ff] ml-1">
                      {(purchase.totalShippingUsd || 0).toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      $
                    </strong>
                  </p>
                </div>
              )}
              <div>
                <span className="font-bold block uppercase tracking-wider text-[11px] text-[#a1acb8] dark:text-[#707194] mb-2">
                  Observations
                </span>
                {purchase.description ? (
                  <p className="font-medium">{purchase.description}</p>
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
                    <span className="font-medium">TVA ({purchase.taxRate}%) :</span>
                    <span className="font-semibold font-mono text-[12px]">
                      {Number(purchase.taxAmount).toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </span>
                  </div>
                )}

                <div className="flex justify-between items-center text-[15px] p-3 rounded-lg font-bold text-white bg-slate-900 dark:bg-slate-800 mt-3 border border-slate-800">
                  <span className="text-[10px] uppercase tracking-wider mt-1">
                    TOTAL DE REVIENT
                  </span>
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

        {/* Right Sidebar: Actions du Cockpit & Règlements */}
        <div className="w-full lg:w-[320px] flex flex-col gap-6 shrink-0 print:hidden text-left lg:sticky lg:top-[90px] self-start">
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

          {/* Paiements Sidebar Section */}
          <div className="bg-white dark:bg-[#2b2c40] p-4 shadow-xs rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40">
            <div className="flex justify-between items-center mb-4">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Règlements & Solde
              </span>
            </div>

            <div className="space-y-4 text-xs font-bold text-left">
              <div className="bg-gray-50 dark:bg-[#232333] p-3 rounded-md flex justify-between items-center border border-gray-100 dark:border-[#434460]/30">
                <span className="text-gray-400 dark:text-gray-500 uppercase text-[10px]">
                  Total Achat
                </span>
                <span className="text-slate-800 dark:text-slate-200 text-sm font-mono">
                  {Number(purchase.total || 0).toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  DH
                </span>
              </div>

              <div className="bg-gray-50 dark:bg-[#232333] p-3 rounded-md flex justify-between items-center border border-gray-100 dark:border-[#434460]/30">
                <span className="text-gray-400 dark:text-gray-500 uppercase text-[10px]">
                  RÉGLÉ
                </span>
                <span className="text-emerald-500 text-sm font-mono">
                  {totalPaid.toLocaleString('fr-FR', {
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
                <span
                  className={`text-sm font-mono ${remainingDebt > 0 ? 'text-red-500' : 'text-emerald-500'}`}
                >
                  {remainingDebt.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  DH
                </span>
              </div>

              {remainingDebt > 0.01 && (
                <>
                  <div className="relative mt-2">
                    <input
                      type="number"
                      placeholder="Décaissement..."
                      value={paymentAmount}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val !== '' && Number(val) > remainingDebt) {
                          setPaymentAmount(remainingDebt.toFixed(2));
                          showToast(
                            `Le montant maximum autorisé est de ${remainingDebt.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`,
                            'error'
                          );
                        } else {
                          setPaymentAmount(val);
                        }
                      }}
                      className="w-full bg-gray-50 dark:bg-[#232333] border border-gray-200 dark:border-[#434460]/50 rounded-md py-2.5 pl-3 pr-10 text-gray-700 dark:text-gray-300 font-mono font-bold placeholder-gray-400 focus:outline-none focus:border-cyan-400 transition-colors"
                    />
                    <span className="absolute right-3 top-2.5 text-gray-400 font-bold font-mono">
                      DH
                    </span>
                  </div>

                  <button
                    disabled={addingPayment || !paymentAmount}
                    onClick={handleAddPayment}
                    className="w-full bg-[#696cff] hover:bg-[#5f61e6] disabled:bg-[#a1acb8] disabled:cursor-not-allowed text-white py-2.5 px-4 rounded-md uppercase tracking-wider text-[11px] font-black transition-colors"
                  >
                    {addingPayment ? 'Saisie...' : 'Valider Paiement'}
                  </button>
                  {remainingDebt > 0 && (
                    <button
                      onClick={() => setPaymentAmount(remainingDebt.toFixed(2))}
                      className="w-full bg-transparent border-none text-[9px] font-bold text-[#696cff] hover:text-[#5f61e6] uppercase transition-colors outline-none cursor-pointer mt-1"
                    >
                      Tout payer d'un coup
                    </button>
                  )}
                </>
              )}

              {/* Transaction History (Mini) */}
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-[#434460]/30 space-y-2">
                {initialPayment > 0.01 && (
                  <div className="flex items-center justify-between py-1 px-1 group text-left">
                    <div className="flex flex-col">
                      <span className="font-mono text-slate-800 dark:text-gray-300">
                        {initialPayment.toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        DH
                      </span>
                      <span className="text-[9px] text-gray-400 font-medium">Acompte Initial</span>
                    </div>
                  </div>
                )}
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
                      className="text-gray-300 hover:text-red-500 transition-colors bg-transparent border-none outline-none cursor-pointer"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                {payments.length === 0 && initialPayment <= 0 && (
                  <div className="text-center py-2 opacity-60 text-left">
                    <span className="text-[9px] font-bold text-slate-400 uppercase">
                      Aucun historique
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

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
    </div>
  );
}

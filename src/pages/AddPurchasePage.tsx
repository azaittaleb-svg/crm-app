import { useState, useEffect, useMemo, FormEvent } from 'react';
import { db, storage, handleFirestoreError, OperationType } from '../lib/firebase';
import { useNotification } from '../context/NotificationContext';
import {
  collection,
  addDoc,
  serverTimestamp,
  getDocs,
  orderBy,
  query,
  where,
  getDoc,
  doc,
  onSnapshot,
  collectionGroup,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { convertNumberToFrenchWords } from '../utils/numberToWords';
import { calculateDocumentTotals } from '../utils/calculations';
import { useInvoiceFormItems, OrderItem } from '../hooks/useInvoiceFormItems';
import { COMPANY_INFO } from '../constants';
import { creditNoteService } from '../services/creditNoteService';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import {
  ShoppingCart,
  ArrowLeft,
  UserPlus,
  Plus,
  Trash2,
  Package,
  X,
  Check,
  ClipboardPaste,
  AlertCircle,
  Paperclip,
  FileText,
  ImageIcon,
  Link2,
  Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';

// Extracted to hook

export default function AddPurchasePage() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const docType = useMemo(() => searchParams.get('type') || 'commande', [searchParams]);

  const [clients, setClients] = useState<any[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [linkedPartnerInfo, setLinkedPartnerInfo] = useState<any>(null);
  const [partnerBalance, setPartnerBalance] = useState(0);

  const clientOptions = useMemo(() => {
    return clients.map((c) => ({
      value: c.id,
      label: c.name || 'Client sans nom',
      subtitle: c.ice ? `ICE: ${c.ice}` : c.phone ? `Tél: ${c.phone}` : c.email ? c.email : undefined,
      badge: c.city || undefined,
    }));
  }, [clients]);

  // New Client Modal state
  const [showClientModal, setShowClientModal] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientAddressLine1, setNewClientAddressLine1] = useState('');
  const [newClientAddressLine2, setNewClientAddressLine2] = useState('');
  const [newClientCity, setNewClientCity] = useState('');
  const [newClientIce, setNewClientIce] = useState('');

  const { showToast, confirm } = useNotification();
  const {
    items,
    setItems,
    addItem,
    updateItem,
    removeItem,
    showPasteModal,
    setShowPasteModal,
    pasteContent,
    setPasteContent,
    handlePasteExcel,
  } = useInvoiceFormItems();

  // Tax and Payment
  const [applyTax, setApplyTax] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'credit'>('credit');
  const [conditionsPaiement, setConditionsPaiement] = useState('Paiement immédiat');
  const [modeReglement, setModeReglement] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [amountPaid, setAmountPaid] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notesList, setNotesList] = useState<string[]>(['']);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'clients'),
      where('ownerId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setClients(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'clients');
      }
    );

    return () => unsubscribe();
  }, [user]);

  // Pre-fill selected client if provided in search params
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const clientIdParam = searchParams.get('clientId');
    if (clientIdParam && clients.some((c) => c.id === clientIdParam)) {
      setSelectedClientId(clientIdParam);
    }
  }, [clients]);

  // Set default expiration of Devis to be +7 days from emission date
  useEffect(() => {
    if (docType === 'devis' && purchaseDate) {
      const date = new Date(purchaseDate + 'T12:00:00');
      date.setDate(date.getDate() + 7);
      setDueDate(date.toISOString().split('T')[0]);
    } else {
      setDueDate('');
    }
  }, [docType, purchaseDate]);

  const [availableCreditNotes, setAvailableCreditNotes] = useState<any[]>([]);
  const [selectedCreditNotes, setSelectedCreditNotes] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!selectedClientId || !user) {
      setAvailableCreditNotes([]);
      setSelectedCreditNotes({});
      return;
    }

    const fetchCreditNotes = async () => {
      try {
        const q = query(
          collection(db, 'clients', selectedClientId, 'credit_notes'),
          where('status', 'in', ['Validé', 'Utilisé']),
          where('ownerId', '==', user?.uid)
        );
        const snap = await getDocs(q);
        const notes = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter((n: any) => n.total - (n.amountUsed || 0) > 0);
        
        setAvailableCreditNotes(notes);
        setSelectedCreditNotes({}); // Reset selection
      } catch (e) {
        console.error('Error fetching credit notes:', e);
      }
    };
    
    fetchCreditNotes();
  }, [selectedClientId, user]);

  useEffect(() => {
    if (!selectedClientId || !user) {
      setLinkedPartnerInfo(null);
      setPartnerBalance(0);
      return;
    }

    const client = clients.find((c) => c.id === selectedClientId);
    if (!client?.linkedPartnerId) {
      setLinkedPartnerInfo(null);
      setPartnerBalance(0);
      return;
    }

    const fetchPartnerData = async () => {
      try {
        const partnerSnap = await getDoc(doc(db, 'suppliers', client.linkedPartnerId));
        if (partnerSnap.exists()) {
          const partnerData = partnerSnap.id ? { id: partnerSnap.id, ...partnerSnap.data() } : null;
          setLinkedPartnerInfo(partnerData);

          // Fetch partner purchases to calculate their debt to us
          const qPartnerPurchases = query(
            collection(db, 'suppliers', client.linkedPartnerId, 'purchases'),
            where('ownerId', '==', user.uid)
          );
          const partnerPurchasesSnap = await getDocs(qPartnerPurchases);
          const partnerPurchasesData = partnerPurchasesSnap.docs.map((d) => d.data());

          const totalPartnerPurchases = partnerPurchasesData.reduce(
            (acc, p) => acc + (Number(p.total) || 0),
            0
          );
          const totalPartnerPaid = partnerPurchasesData.reduce(
            (acc, p) => acc + (Number(p.amountPaid) || 0),
            0
          );
          const supplierDette = totalPartnerPurchases - totalPartnerPaid;

          // Fetch current client's purchases to calculate their credit to us
          const qClientPurchases = query(
            collection(db, 'clients', selectedClientId, 'purchases'),
            where('ownerId', '==', user.uid)
          );
          const clientPurchasesSnap = await getDocs(qClientPurchases);
          const clientPurchasesData = clientPurchasesSnap.docs.map((d) => d.data());

          const totalClientPurchases = clientPurchasesData.reduce(
            (acc, p) => acc + (Number(p.total) || 0),
            0
          );
          const totalClientPaid = clientPurchasesData.reduce(
            (acc, p) => acc + (Number(p.amountPaid) || 0),
            0
          );
          const clientCredit = totalClientPurchases - totalClientPaid;

          setPartnerBalance(clientCredit - supplierDette);
        }
      } catch (err) {
        console.error(err);
      }
    };

    fetchPartnerData();
  }, [selectedClientId, user, clients]);

  const handleAddClient = async (e: FormEvent) => {
    e.preventDefault();
    if (!newClientName || !user) return;
    setLoading(true);
    try {
      const q = query(
        collection(db, 'clients'),
        where('ownerId', '==', user.uid),
        where('name', '==', newClientName.trim())
      );

      const checkPromise = getDocs(q);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 2000)
      );

      try {
        const querySnapshot = (await Promise.race([checkPromise, timeoutPromise])) as any;
        if (querySnapshot && !querySnapshot.empty) {
          showToast('Un client avec ce nom existe déjà', 'error');
          setLoading(false);
          return;
        }
      } catch (err) {
        console.warn('Duplicate check timed out or failed, proceeding', err);
      }

      confirm({
        title: "Confirmer l'ajout",
        message: `Voulez-vous ajouter le client "${newClientName.trim()}" ?`,
        onConfirm: async () => {
          try {
            setLoading(true);
            const docRef = await addDoc(collection(db, 'clients'), {
              ownerId: user.uid,
              name: newClientName.trim(),
              phone: newClientPhone || null,
              email: newClientEmail || null,
              addressLine1: newClientAddressLine1 || null,
              addressLine2: newClientAddressLine2 || null,
              city: newClientCity || null,
              ice: newClientIce || null,
              createdAt: serverTimestamp(),
            });
            setSelectedClientId(docRef.id);
            showToast('Client ajouté et sélectionné', 'success');
            setShowClientModal(false);
            setNewClientName('');
            setNewClientPhone('');
            setNewClientEmail('');
            setNewClientAddressLine1('');
            setNewClientAddressLine2('');
            setNewClientCity('');
            setNewClientIce('');
            setLoading(false);
          } catch (error) {
            console.error('Add quick client error:', error);
            showToast("Erreur lors de l'enregistrement", 'error');
            setLoading(false);
          }
        },
        onCancel: () => {
          setLoading(false);
        },
      });
    } catch (error) {
      console.error('Outer add quick client error:', error);
      setLoading(false);
    }
  };

  const downloadClientOrderTemplate = () => {
    const templateData = [
      ['Type de Document', '', '', '', 'COMMANDE'],
      ['Référence', '', '', '', 'C00001'],
      ['Statut', '', '', '', 'Valide'],
      ['Date d\'émission', '', '', '', '17/01/2022'],
      ['Client / Partenaire', '', '', '', 'Mounir hssnaoui'],
      ['Téléphone Client', '', '', '', '0600000000'],
      ['Email Client', '', '', '', 'mounir@example.com'],
      ['Adresse Client', '', '', '', 'Casablanca, Maroc'],
      [''],
      ['LIGNES DE FACTURE / ARTICLES'],
      ['Description/Libellé', '', '', '', 'Quantité', 'Prix Unitaire', 'Taxe (%)', 'Total TTC (DH)'],
      ['Chaise Ergonomique de Bureau', '', '', '', 2, 1200.00, 20, 2880.00],
      ['Bureau Ministériel en Bois', '', '', '', 1, 3500.00, 20, 4200.00],
      ['Ecran Professionnel 27-pouces', '', '', '', 3, 2100.00, 20, 7560.00],
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);
    ws['!cols'] = [
      { wch: 35 },
      { wch: 5 },
      { wch: 5 },
      { wch: 5 },
      { wch: 20 },
      { wch: 15 },
      { wch: 12 },
      { wch: 18 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Commande Client');
    XLSX.writeFile(wb, 'modele_commande_client.xlsx');
    showToast('Le modèle Excel Vente / Commande a été téléchargé !', 'success');
  };

  const downloadStandardTemplate = () => {
    const templateData = [
      ['Description/Libellé', 'Quantité', 'Prix Unitaire', 'Taxe (%)'],
      ['Article Exemple 1', 10, 150.00, 20],
      ['Article Exemple 2', 5, 80.00, 20],
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);
    ws['!cols'] = [{ wch: 35 }, { wch: 12 }, { wch: 15 }, { wch: 10 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Articles Standard');
    XLSX.writeFile(wb, 'modele_articles_standard.xlsx');
    showToast('Le modèle Excel Standard a été téléchargé !', 'success');
  };

  const fillClientSampleText = () => {
    const sample = [
      'Type de Document\t\t\t\tCOMMANDE',
      'Référence\t\t\t\tC00001',
      'Statut\t\t\t\tValide',
      'Date d\'émission\t\t\t\t17/01/2022',
      'Client / Partenaire\t\t\t\tMounir hssnaoui',
      'Téléphone Client\t\t\t\t0600000000',
      'Email Client\t\t\t\tmounir@example.com',
      'Adresse Client\t\t\t\tCasablanca, Maroc',
      '',
      'LIGNES DE FACTURE / ARTICLES',
      'Description/Libellé\t\t\t\tQuantité\tPrix Unitaire\tTaxe (%)\tTotal TTC (DH)',
      'Chaise Ergonomique de Bureau\t\t\t\t2\t1200.00\t20\t2880.00',
      'Bureau Ministériel en Bois\t\t\t\t1\t3500.00\t20\t4200.00',
      'Ecran Professionnel 27-pouces\t\t\t\t3\t2100.00\t20\t7560.00',
    ].join('\n');

    setPasteContent(sample);
    showToast('Exemple de Commande chargé dans la zone de texte !', 'info');
  };

  const onPasteConfirm = () => {
    handlePasteExcel(showToast, {
      clients,
      onClientDetected: (id) => setSelectedClientId(id),
      onDateDetected: (d) => setPurchaseDate(d),
      onApplyTaxDetected: (hasTax) => setApplyTax(hasTax),
    });
  };

  const taxRateGlobal = applyTax ? 20 : 0;
  const { subtotal, taxAmount, total } = calculateDocumentTotals(items, taxRateGlobal);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedClientId) {
      showToast('Veuillez sélectionner un client.', 'error');
      return;
    }

    if (items.some((i) => !i.description || ((!i.type || i.type === 'product') && i.price <= 0))) {
      showToast('Veuillez remplir correctement toutes les lignes.', 'error');
      return;
    }

    setLoading(true);

    try {
      const totalCreditNotesApplied = Object.values(selectedCreditNotes).reduce<number>((a, b) => Number(a) + Number(b), 0);
      const remainingToPay = Math.max(0, Number(total) - totalCreditNotesApplied);

      const pAmountPaid =
        docType === 'devis' ? 0 : paymentStatus === 'paid' ? remainingToPay : parseFloat(amountPaid) || 0;
      const pPaymentStatus = docType === 'devis' ? 'credit' : paymentStatus;

      if (!user) return;

      let attachmentUrl = null;
      let attachmentName = null;

      if (attachment) {
        setUploading(true);
        try {
          const toBase64 = (file: File) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.readAsDataURL(file);
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = (error) => reject(error);
            });
          attachmentUrl = await toBase64(attachment);
          attachmentName = attachment.name;
        } catch (error) {
          console.error('File conversion error:', error);
          showToast("Le fichier n'a pas pu être traité.", 'error');
        }
        setUploading(false);
      }

      const itemsWithTax = items.map((item) => ({
        ...item,
        taxRate: taxRateGlobal,
      }));

      // Determine the next static sequence number for this document type
      let calculatedRefId = '';
      if (docType !== 'facture') {
        try {
          const qRef = query(
            collectionGroup(db, 'purchases'),
            where('ownerId', '==', user.uid),
            where('type', '==', docType)
          );
          const refSnapshot = await getDocs(qRef);
          let maxNum = 0;
          refSnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const refVal = data.refId;
            if (refVal && typeof refVal === 'string') {
              const match = refVal.match(/(\d+)$/);
              if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) {
                  maxNum = num;
                }
              }
            }
          });
          const nextNum = maxNum + 1;
          if (docType === 'devis') {
            calculatedRefId = `S${String(nextNum).padStart(5, '0')}`;
          } else {
            calculatedRefId = `C${String(nextNum).padStart(5, '0')}`;
          }
        } catch (err) {
          console.error('Error calculating static reference:', err);
        }
      }

      // We save the purchase with its items
      const docRef = await addDoc(collection(db, 'clients', selectedClientId, 'purchases'), {
        ownerId: user.uid,
        clientId: selectedClientId,
        type: docType,
        conditions_paiement: conditionsPaiement,
        mode_reglement: modeReglement,
        items: itemsWithTax,
        description: items.length === 1 ? items[0].description : `${items.length} Produits`,
        price: items.length === 1 ? items[0].price : 0, // Legacy support
        quantity: items.reduce((a, b) => a + b.quantity, 0),
        subtotal,
        taxAmount,
        taxRate: taxRateGlobal,
        total,
        paymentStatus: pPaymentStatus,
        amountPaid: pAmountPaid,
        dueDate:
          (pPaymentStatus === 'credit' || docType === 'devis') && dueDate
            ? new Date(dueDate)
            : null,
        date: purchaseDate ? new Date(purchaseDate + 'T00:00:00') : serverTimestamp(),
        notes:
          notesList
            .map((n) => n.trim())
            .filter(Boolean)
            .join('\n') || null,
        notesList: notesList.map((n) => n.trim()).filter(Boolean),
        attachmentUrl,
        attachmentName,
        refId: docType === 'facture' ? null : calculatedRefId,
        status: docType === 'facture' ? 'Brouillon' : 'Validée',
      });

      // Apply credit notes if any are selected
      if (Object.keys(selectedCreditNotes).length > 0) {
        try {
          await creditNoteService.applyCreditNotes(selectedClientId, docRef.id, selectedCreditNotes);
        } catch (cnError) {
          console.error('Error applying credit notes:', cnError);
          showToast('La vente a été créée, mais l\'application des avoirs a échoué.', 'error');
        }
      }

      const successMsg =
        docType === 'devis'
          ? 'Devis enregistré avec succès'
          : docType === 'facture'
            ? 'Facture (Brouillon) enregistrée avec succès'
            : 'Vente enregistrée avec succès';

      showToast(successMsg, 'success');
      navigate(`/purchase/${selectedClientId}/${docRef.id}?type=${docType}`);
    } catch (error) {
      console.error(error);
      const isPermissionError =
        error instanceof Error && error.message.includes('permission-denied');
      showToast(
        isPermissionError
          ? 'Erreur de permission : vérifiez votre compte'
          : "Erreur lors de l'enregistrement",
        'error'
      );
      handleFirestoreError(error, OperationType.CREATE, 'purchases');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full py-4 space-y-6 animate-fadeIn">
      <AnimatePresence>
        {linkedPartnerInfo && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 w-full shrink-0"
          >
            <div className="bg-indigo-600 text-white w-full rounded-xl px-6 py-3 flex flex-col md:flex-row items-center justify-center gap-4 text-xs font-medium tracking-wide shadow-sm relative z-40">
              <div className="flex items-center justify-center gap-2 flex-wrap md:flex-nowrap text-center">
                <span className="flex items-center gap-1.5 bg-white/20 text-white px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider leading-none">
                  <Link2 size={11} strokeWidth={2.5} />
                  Partenaire Lié
                </span>
                <span className="text-white/90">
                  Ce contact est lié au fournisseur{' '}
                  <span className="text-white font-bold uppercase">{linkedPartnerInfo.name}</span>
                </span>
                <span className="hidden md:inline text-white/40 font-normal">|</span>
                <span className="text-white/90">
                  Balance consolidée:{' '}
                  <span className="font-bold text-white">
                    {Math.abs(partnerBalance).toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    DH
                  </span>
                  <span className="text-[10px] opacity-90 ml-1.5 font-bold">
                    (
                    {partnerBalance > 0
                      ? 'Il vous doit'
                      : partnerBalance < 0
                        ? 'Vous lui devez'
                        : 'Soldé'}
                    )
                  </span>
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {true ? (
        <form id="add-purchase-form" onSubmit={handleSubmit} className="w-full">
          <main className="flex flex-col lg:flex-row gap-6 items-start">
            {/* Left Side: Live A4 Document Preview & WYSIWYG Items Editor */}
            <div className="flex-1 w-full space-y-6">
              <motion.div
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg shadow-xs overflow-hidden w-full"
              >
                <div className="p-8 md:p-12 print:p-10 font-sans min-h-[500px] print:min-h-[1123px] flex flex-col relative bg-white dark:bg-[#2b2c40]">
                  {/* Header of Devis Document */}
                  <div className="flex justify-between items-start border-b border-[#dbdade]/40 dark:border-[#434460]/40 pb-6 mb-6">
                    <div>
                      <h1 className="text-2xl font-bold text-[#566a7f] dark:text-[#a1acb8] tracking-tight uppercase">
                        {docType === 'devis'
                          ? 'DEVIS'
                          : docType === 'facture'
                            ? 'FACTURE'
                            : docType === 'reçu'
                              ? 'REÇU'
                              : 'COMMANDE'}
                      </h1>
                      <div className="text-[15px] font-medium text-[#696cff] dark:text-[#b1b4ff] mt-1 mb-4 flex items-center gap-2">
                        <span className="text-[#a1acb8] dark:text-[#707194]">#</span>
                        BROUILLON
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-[13px] text-[#566a7f] dark:text-[#a1acb8] mt-1 space-y-1">
                        <div className="flex justify-end gap-2">
                          <span className="font-semibold">Date d'émission :</span>
                          <span>
                            {purchaseDate
                              ? new Date(purchaseDate + 'T12:00:00').toLocaleDateString('fr-FR', {
                                  day: '2-digit',
                                  month: 'short',
                                  year: 'numeric',
                                })
                              : '-'}
                          </span>
                        </div>
                        {docType === 'devis' && (
                          <div className="flex justify-end gap-2">
                            <span className="font-semibold">Validité :</span>
                            <span>
                              {dueDate
                                ? new Date(dueDate + 'T12:00:00').toLocaleDateString('fr-FR', {
                                    day: '2-digit',
                                    month: 'short',
                                    year: 'numeric',
                                  })
                                : (() => {
                                    const baseDate = purchaseDate
                                      ? new Date(purchaseDate + 'T12:00:00')
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
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Customer and Terms details section */}
                  <div className="grid grid-cols-2 gap-8 my-8 text-[13px] text-[#566a7f] dark:text-[#a1acb8] leading-relaxed">
                    <div>
                      <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block mb-2 uppercase tracking-widest">
                        {docType === 'devis' ? 'Devis pour :' : "À l'attention de :"}
                      </span>
                      {selectedClientId && clients.find((c) => c.id === selectedClientId) ? (
                        (() => {
                          const client = clients.find((c) => c.id === selectedClientId)!;
                          return (
                            <>
                              <h2 className="font-bold text-[14px] text-[#566a7f] dark:text-[#dbdade] mb-1 uppercase">
                                {client.name}
                              </h2>
                              {client.addressLine1 && <p>{client.addressLine1}</p>}
                              {(client.city || client.city_ma || client.phone) && (
                                <p>
                                  {[
                                    client.city || client.city_ma,
                                    client.phone ? `Tél: ${client.phone}` : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' | ')}
                                </p>
                              )}
                              {client.ice && <p className="mt-1">ICE: {client.ice}</p>}
                            </>
                          );
                        })()
                      ) : (
                        <div
                          className="border border-dashed border-[#dbdade]/70 rounded-lg p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#2b2c40]/35 transition-all w-max mt-2"
                          onClick={() => document.getElementById('client-select-sidebar')?.focus()}
                        >
                          <p className="text-xs text-[#a1acb8] italic">Sélectionner un client...</p>
                        </div>
                      )}
                    </div>

                    <div className="text-right">
                      <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block mb-2 uppercase tracking-widest">
                        Règlement
                      </span>
                      <p>
                        <span className="font-semibold">Conditions :</span> {conditionsPaiement}
                      </p>
                      {modeReglement && (
                        <p>
                          <span className="font-semibold">Mode :</span>{' '}
                          {modeReglement.replace(/💵 |🏦 |⏳ |📄 /g, '')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* WYSIWYG Items Table inside layout */}
                  <div className="border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg overflow-hidden mb-5">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#dbdade]/70 dark:border-[#434460]/40 text-[#a1acb8] dark:text-[#707194] bg-[#f8f7fa] dark:bg-[#232333]">
                          <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] text-center w-10">
                            #
                          </th>
                          <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px]">
                            Désignation
                          </th>
                          <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] text-center w-20">
                            Qté
                          </th>
                          <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] text-right w-32">
                            P.U HT
                          </th>
                          <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] text-right w-32">
                            Total HT
                          </th>
                          <th className="py-3 px-3 w-12 text-center print:hidden"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f1f0f4] dark:divide-[#434460]/20">
                        {items.map((item, idx) => {
                          if (item.type === 'section') {
                            return (
                              <tr key={item.id} className="bg-slate-50/50 dark:bg-slate-800/10">
                                <td className="py-2.5 px-4 text-center align-middle">
                                  <div className="flex justify-center text-slate-300">
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <circle cx="9" cy="12" r="1" />
                                      <circle cx="9" cy="5" r="1" />
                                      <circle cx="9" cy="19" r="1" />
                                      <circle cx="15" cy="12" r="1" />
                                      <circle cx="15" cy="5" r="1" />
                                      <circle cx="15" cy="19" r="1" />
                                    </svg>
                                  </div>
                                </td>
                                <td colSpan={4} className="py-1 px-4 align-middle">
                                  <input
                                    type="text"
                                    placeholder="Nom de la section (ex: Matériel Informatique)"
                                    value={item.description}
                                    onChange={(e) =>
                                      updateItem(item.id, 'description', e.target.value)
                                    }
                                    className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none font-bold text-[#566a7f] dark:text-[#dbdade] text-[14px] placeholder:text-slate-400"
                                  />
                                </td>
                                <td className="py-2 px-2 text-center align-middle print:hidden w-10">
                                  <button
                                    type="button"
                                    onClick={() => removeItem(item.id)}
                                    className="text-slate-300 hover:text-rose-500 transition-colors p-1"
                                    title="Supprimer la section"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            );
                          }

                          if (item.type === 'note') {
                            return (
                              <tr
                                key={item.id}
                                className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors"
                              >
                                <td className="py-2.5 px-4 text-center align-top pt-3.5">
                                  <div className="flex justify-center text-slate-300">
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <circle cx="9" cy="12" r="1" />
                                      <circle cx="9" cy="5" r="1" />
                                      <circle cx="9" cy="19" r="1" />
                                      <circle cx="15" cy="12" r="1" />
                                      <circle cx="15" cy="5" r="1" />
                                      <circle cx="15" cy="19" r="1" />
                                    </svg>
                                  </div>
                                </td>
                                <td colSpan={4} className="py-1 px-4 align-top">
                                  <textarea
                                    ref={(el) => {
                                      if (el) {
                                        el.style.height = 'auto';
                                        el.style.height = el.scrollHeight + 'px';
                                      }
                                    }}
                                    rows={1}
                                    placeholder="Ajouter une description ou note..."
                                    value={item.description}
                                    onChange={(e) =>
                                      updateItem(item.id, 'description', e.target.value)
                                    }
                                    className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none font-medium italic text-slate-500 dark:text-slate-400 text-[13px] resize-none overflow-hidden placeholder:text-slate-300 placeholder:italic"
                                    onInput={(e: any) => {
                                      e.target.style.height = 'auto';
                                      e.target.style.height = e.target.scrollHeight + 'px';
                                    }}
                                  />
                                </td>
                                <td className="py-2 px-2 text-center align-top print:hidden w-10 pt-3">
                                  <button
                                    type="button"
                                    onClick={() => removeItem(item.id)}
                                    className="text-slate-300 hover:text-rose-500 transition-colors p-1"
                                    title="Supprimer la note"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </td>
                              </tr>
                            );
                          }

                          return (
                            <tr
                              key={item.id}
                              className="hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors"
                            >
                              <td className="py-2.5 px-4 font-mono text-[13px] text-slate-400 font-bold align-top pt-3.5 text-center">
                                {idx + 1}
                              </td>
                              <td className="py-1 px-4 align-top">
                                <textarea
                                  ref={(el) => {
                                    if (el) {
                                      el.style.height = 'auto';
                                      el.style.height = el.scrollHeight + 'px';
                                    }
                                  }}
                                  required
                                  rows={1}
                                  placeholder="Désignation du produit ou service..."
                                  value={item.description}
                                  onChange={(e) =>
                                    updateItem(item.id, 'description', e.target.value)
                                  }
                                  className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none font-semibold text-[#566a7f] dark:text-[#dbdade] text-[13px] resize-none overflow-hidden placeholder:text-slate-300 border-none outline-none leading-relaxed"
                                  onInput={(e: any) => {
                                    e.target.style.height = 'auto';
                                    e.target.style.height = e.target.scrollHeight + 'px';
                                  }}
                                />
                              </td>
                              <td className="py-1 px-4 align-top w-24">
                                <input
                                  type="number"
                                  min="1"
                                  value={item.quantity}
                                  onChange={(e) =>
                                    updateItem(item.id, 'quantity', parseInt(e.target.value) || 0)
                                  }
                                  className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none text-center font-bold text-[#566a7f] dark:text-[#dbdade] text-[13px] border-none outline-none"
                                />
                              </td>
                              <td className="py-1 px-4 align-top w-32">
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={item.price || ''}
                                  onChange={(e) =>
                                    updateItem(item.id, 'price', parseFloat(e.target.value) || 0)
                                  }
                                  className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none text-right font-mono font-semibold text-[#566a7f] dark:text-[#dbdade] text-[12px] border-none outline-none"
                                />
                              </td>
                              <td className="py-3 px-4 font-mono font-bold text-[#566a7f] dark:text-[#dbdade] text-[12px] text-right align-top">
                                {(item.price * item.quantity).toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                              <td className="py-2 px-2 text-center align-top print:hidden w-10 pt-3">
                                <button
                                  type="button"
                                  onClick={() => removeItem(item.id)}
                                  className="text-slate-300 hover:text-rose-500 transition-colors p-1"
                                  disabled={items.length === 1}
                                  title="Supprimer la ligne"
                                >
                                  <Trash2 size={15} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex gap-6 p-4 border border-t-0 border-[#dbdade]/40 dark:border-[#434460]/40 rounded-b-xl mb-10 bg-white dark:bg-[#2b2c40] print:hidden">
                    <button
                      type="button"
                      onClick={() => addItem('product')}
                      className="flex items-center gap-1.5 text-[13px] font-bold text-teal-600 hover:text-teal-700 transition-colors"
                    >
                      <Plus size={14} className="stroke-[3]" /> Ajouter un produit
                    </button>
                    <button
                      type="button"
                      onClick={() => addItem('section')}
                      className="flex items-center gap-1.5 text-[13px] font-bold text-teal-600 hover:text-teal-700 transition-colors"
                    >
                      <Plus size={14} className="stroke-[3]" /> Ajouter une section
                    </button>
                    <button
                      type="button"
                      onClick={() => addItem('note')}
                      className="flex items-center gap-1.5 text-[13px] font-bold text-teal-600 hover:text-teal-700 transition-colors"
                    >
                      <Plus size={14} className="stroke-[3]" /> Ajouter une note
                    </button>
                  </div>

                  {/* Excel Paste block */}
                  <div className="flex justify-end mb-10 print:hidden"></div>

                  {/* Footer info: General Conditions and Totals */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-10">
                    {/* Left: Notes & Observations Editor */}
                    <div className="text-[13px] text-[#566a7f] dark:text-[#a1acb8] space-y-4">
                      <div className="mb-8 bg-[#fffbeb] dark:bg-[#4b3e2e]/30 border-l-[3px] border-[#ffab00] p-3 rounded-r-md">
                        <p className="text-[12px] font-medium leading-relaxed text-[#566a7f] dark:text-[#a1acb8]">
                          Arrêté{' '}
                          {docType === 'devis'
                            ? 'la présente proposition'
                            : docType === 'facture'
                              ? 'la présente facture'
                              : docType === 'reçu'
                                ? 'le présent reçu'
                                : 'la présente commande'}{' '}
                          au montant de : <br />
                          <strong className="text-[#566a7f] dark:text-[#dbdade] mt-1 block uppercase">
                            {convertNumberToFrenchWords(Number(total || 0))}
                          </strong>
                        </p>
                      </div>
                      <div>
                        <span className="font-bold block uppercase tracking-wider text-[11px] text-[#a1acb8] dark:text-[#707194] mb-2">
                          Notes & Observations
                        </span>
                        <div className="space-y-1.5 md:pr-10">
                          {notesList.map((note, idx) => (
                            <div key={idx} className="flex items-start gap-1.5">
                              <textarea
                                ref={(el) => {
                                  if (el) {
                                    el.style.height = 'auto';
                                    el.style.height = el.scrollHeight + 'px';
                                  }
                                }}
                                rows={1}
                                value={note}
                                onChange={(e) => {
                                  const newList = [...notesList];
                                  newList[idx] = e.target.value;
                                  setNotesList(newList);
                                }}
                                onInput={(e: any) => {
                                  e.target.style.height = 'auto';
                                  e.target.style.height = e.target.scrollHeight + 'px';
                                }}
                                placeholder={`Clause générale #${idx + 1}...`}
                                className="flex-1 bg-transparent border-0 border-b border-transparent focus:border-[#696cff] focus:ring-0 p-0 text-[13px] text-[#566a7f] dark:text-[#dbdade] placeholder:text-slate-300 italic focus:outline-none transition-colors outline-none resize-none overflow-hidden leading-relaxed"
                              />
                              {notesList.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setNotesList(notesList.filter((_, i) => i !== idx))
                                  }
                                  className="text-[#a1acb8] hover:text-[#ff3e1d] transition-colors p-1"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setNotesList([...notesList, ''])}
                          className="flex items-center gap-1 text-[11px] font-bold text-[#696cff] hover:text-[#5f61e6] transition-all py-1 print:hidden animate-fadeIn mt-1 cursor-pointer"
                        >
                          <Plus size={12} /> Ajouter une note/clause
                        </button>
                      </div>
                    </div>

                    {/* Right: Totals */}
                    <div className="flex flex-col justify-start items-end">
                      <div className="w-full max-w-[280px] text-[13px] text-[#566a7f] dark:text-[#a1acb8]">
                        <div className="flex justify-between py-1.5 px-2">
                          <span className="font-medium">Sous-Total :</span>
                          <span className="font-semibold font-mono text-[12px]">
                            {subtotal.toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            DH
                          </span>
                        </div>

                        {applyTax && (
                          <div className="flex justify-between py-1.5 px-2 hover:bg-[#f8f7fa] dark:hover:bg-[#232333] transition-colors rounded-md cursor-pointer group">
                            <span className="font-medium">Taxe (20%) :</span>
                            <span className="font-semibold font-mono text-[12px] group-hover:text-[#696cff] transition-colors">
                              {taxAmount.toLocaleString('fr-FR', {
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
                            {total.toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            DH
                          </span>
                        </div>

                        {availableCreditNotes.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-slate-200/60">
                            <h4 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-3">Avoirs disponibles</h4>
                            <div className="space-y-2">
                              {availableCreditNotes.map((cn, idx) => {
                                const available = cn.total - (cn.amountUsed || 0);
                                const isSelected = selectedCreditNotes[cn.id] !== undefined;
                                return (
                                  <div key={cn.id + "_" + String(idx)} className="flex flex-col gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200/60">
                                    <div className="flex items-center justify-between">
                                      <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={(e) => {
                                            if (e.target.checked) {
                                              // Auto-apply max possible
                                              const currentTotalApplied = Object.values(selectedCreditNotes).reduce<number>((a, b) => Number(a) + Number(b), 0);
                                              const remainingToPay = Math.max(0, Number(total) - currentTotalApplied);
                                              const toApply = Math.min(available, remainingToPay);
                                              setSelectedCreditNotes(prev => ({ ...prev, [cn.id]: toApply }));
                                            } else {
                                              const newSelection = { ...selectedCreditNotes };
                                              delete newSelection[cn.id];
                                              setSelectedCreditNotes(newSelection);
                                            }
                                          }}
                                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                        />
                                        <span className="text-sm font-medium text-slate-700">{cn.refId}</span>
                                      </label>
                                      <span className="text-sm font-mono text-emerald-600 font-medium">
                                        {available.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
                                      </span>
                                    </div>
                                    {isSelected && (
                                      <div className="pl-6 flex items-center gap-2">
                                        <span className="text-xs text-slate-500">Montant à utiliser :</span>
                                        <input
                                          type="number"
                                          step="0.01"
                                          min="0"
                                          max={available}
                                          value={selectedCreditNotes[cn.id] || ''}
                                          onChange={(e) => {
                                            const val = Math.min(available, parseFloat(e.target.value) || 0);
                                            setSelectedCreditNotes(prev => ({ ...prev, [cn.id]: val }));
                                          }}
                                          className="w-24 px-2 py-1 text-right text-sm border border-slate-200 rounded focus:outline-none focus:border-indigo-500"
                                        />
                                        <span className="text-xs font-mono text-slate-500">DH</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            
                            {Object.keys(selectedCreditNotes).length > 0 && (
                              <div className="flex justify-between items-center text-[13px] p-2 mt-2 rounded font-bold text-orange-600 bg-orange-50 border border-orange-100">
                                <span>Reste à payer :</span>
                                <span className="font-mono">
                                  {Math.max(0, Number(total) - Object.values(selectedCreditNotes).reduce<number>((a, b) => Number(a) + Number(b), 0)).toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  DH
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Right Side: Configuration Sidebar */}
            <div className="w-full lg:w-[320px] shrink-0 space-y-6 print:hidden">
              <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 space-y-4 shadow-sm animate-fadeIn">
                <h3 className="text-xs font-black text-[#566a7f] dark:text-[#dbdade] border-b border-[#f1f0f4] dark:border-[#434460]/40 pb-3 flex items-center gap-1.5 uppercase tracking-wider">
                  <FileText size={16} className="text-[#696cff]" />
                  Propriétés{' '}
                  {docType === 'devis'
                    ? 'du Devis'
                    : docType === 'facture'
                      ? 'de la Facture'
                      : 'de la Commande'}
                </h3>

                {/* Client select */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                    Client Destinataire
                  </label>
                  <div className="flex gap-2 items-center">
                    <SearchableSelect
                      id="client-select-sidebar"
                      options={clientOptions}
                      value={selectedClientId}
                      onChange={setSelectedClientId}
                      placeholder="-- Choisir un client --"
                      searchPlaceholder="Rechercher un client (Nom, ICE, Ville)..."
                      required
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => setShowClientModal(true)}
                      className="bg-white dark:bg-transparent border border-slate-205 dark:border-[#434460]/50 hover:bg-slate-50 dark:hover:bg-[#34354c] p-2 rounded-lg transition-colors flex items-center justify-center shrink-0 h-[34px] w-[34px]"
                      title="Nouveau Client"
                    >
                      <UserPlus size={15} className="text-[#566a7f] dark:text-[#dbdade]" />
                    </button>
                  </div>
                </div>

                {/* Date Emission */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                    Date d'Émission
                  </label>
                  <input
                    type="date"
                    required
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="w-full bg-white dark:bg-[#2b2c40] border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-slate-800 dark:text-[#dbdade] text-xs rounded-lg px-2.5 py-1.5 transition-all cursor-pointer"
                  />
                </div>

                {/* Date Expiration */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                    {docType === 'devis' ? "Date d'Expiration" : "Date d'Échéance"}
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full bg-white dark:bg-[#2b2c40] border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-slate-800 dark:text-[#dbdade] text-xs rounded-lg px-2.5 py-1.5 transition-all cursor-pointer"
                  />
                </div>

                {/* Conditions */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                    Conditions de paiement
                  </label>
                  <select
                    value={conditionsPaiement}
                    onChange={(e) => setConditionsPaiement(e.target.value)}
                    className="w-full bg-white dark:bg-[#2b2c40] border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-slate-800 dark:text-[#dbdade] text-xs rounded-lg px-2.5 py-1.5 transition-all cursor-pointer"
                  >
                    <option value="Paiement immédiat">Paiement immédiat</option>
                    <option value="15 jours">15 jours</option>
                    <option value="21 jours">21 jours</option>
                    <option value="30 jours">30 jours</option>
                    <option value="45 jours">45 jours</option>
                    <option value="Fin du mois suivant">Fin du mois suivant</option>
                    <option value="Le solde à 60 jours">Le solde à 60 jours</option>
                  </select>
                </div>

                {/* Mode de règlement */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-[11px] font-black text-[#697a8d] dark:text-slate-400 uppercase tracking-wider block">
                    Mode de règlement
                  </label>
                  <div className="relative">
                    <select
                      className="w-full bg-white dark:bg-[#2b2c40] border border-[#d9dee3] dark:border-[#434460]/40 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-[#697a8d] dark:text-[#dbdade] text-[13px] rounded-md px-2.5 py-1 transition-all cursor-pointer appearance-none"
                      value={modeReglement}
                      onChange={(e) => setModeReglement(e.target.value)}
                    >
                      <option value="" disabled>
                        Choisir le paiement...
                      </option>
                      <option value="Espèces à la livraison">💵 Espèces à la livraison</option>
                      <option value="Virement Bancaire">🏦 Virement Bancaire</option>
                      <option value="Virement à la commande">⏳ Virement à la commande</option>
                      <option value="Chèque Bancaire">📄 Chèque Bancaire</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-[#697a8d] dark:text-slate-400">
                      <svg
                        className="fill-current h-4 w-4"
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                      >
                        <path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" />
                      </svg>
                    </div>
                  </div>
                </div>

                {/* Payment status (ONLY if non-devis) */}
                {docType !== 'devis' && (
                  <>
                    <div className="space-y-1.5 pt-1">
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider block">
                        Statut de Paiement
                      </label>
                      <div className="flex p-0.5 bg-slate-100 dark:bg-[#232333]/50 rounded-lg border border-[#dbdade]/30 dark:border-[#434460]/20 h-8">
                        <button
                          type="button"
                          onClick={() => setPaymentStatus('paid')}
                          className={`flex-1 rounded text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${paymentStatus === 'paid' ? 'bg-white dark:bg-[#2b2c40] text-emerald-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          Comptant
                        </button>
                        <button
                          type="button"
                          onClick={() => setPaymentStatus('credit')}
                          className={`flex-1 rounded text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${paymentStatus === 'credit' ? 'bg-white dark:bg-[#2b2c40] text-orange-400 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                          À Crédit
                        </button>
                      </div>
                    </div>
                    {paymentStatus !== 'paid' && (
                      <div className="space-y-1.5 animate-fadeIn">
                        <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider block">
                          Acompte Versé (DH)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={amountPaid}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val !== '' && Number(val) > total) {
                              showToast(`Le reste à payer est de ${total} DH.`, 'error');
                              setAmountPaid(total.toString());
                            } else {
                              setAmountPaid(val);
                            }
                          }}
                          className="w-full bg-white dark:bg-[#2b2c40] border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-bold text-slate-800 dark:text-[#dbdade] text-xs rounded-lg px-2.5 py-1.5 transition-all font-mono"
                          placeholder="0.00"
                        />
                      </div>
                    )}
                  </>
                )}

                {/* TVA switch */}
                <div className="flex items-center pt-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={applyTax}
                      onChange={(e) => setApplyTax(e.target.checked)}
                    />
                    <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#696cff]"></div>
                    <span className="ms-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      Appliquer TVA (20%)
                    </span>
                  </label>
                </div>

                {/* Attachment */}
                <div className="space-y-1.5 pt-2">
                  <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider block">
                    Pièce Jointe
                  </label>
                  <input
                    type="file"
                    id="attachment-upload"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 800 * 1024) {
                          showToast('Le fichier est trop volumineux (max 800 KB)', 'error');
                          return;
                        }
                        setAttachment(file);
                      }
                    }}
                  />
                  {attachment ? (
                    <div className="flex items-center justify-between p-2.5 bg-slate-50 dark:bg-slate-800/10 border border-slate-200/50 rounded-lg">
                      <div className="overflow-hidden">
                        <p className="text-xs font-bold text-slate-700 dark:text-[#dbdade] truncate">
                          {attachment.name}
                        </p>
                        <p className="text-[9px] text-[#a5abb3]">
                          {(attachment.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAttachment(null)}
                        className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <label
                      htmlFor="attachment-upload"
                      className="flex flex-col items-center justify-center w-full h-14 border border-dashed border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-all group"
                    >
                      <div className="flex items-center gap-1.5">
                        <Plus size={14} className="text-slate-400 group-hover:text-[#696cff]" />
                        <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wider">
                          Ajouter un fichier
                        </p>
                      </div>
                    </label>
                  )}
                </div>

                {/* Major Submit Button */}
                <div className="pt-3 space-y-3">
                  <button
                    type="button"
                    onClick={() => setShowPasteModal(true)}
                    className="w-full h-11 border border-indigo-100 bg-indigo-50 text-[#696cff] min-h-[44px] rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-indigo-100 active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 cursor-pointer"
                  >
                    <ClipboardPaste size={16} />
                    Importer Excel (Paste)
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full h-11 bg-[#696cff] text-white rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-[#5f61e6] active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 shadow-sm cursor-pointer disabled:opacity-60"
                  >
                    {loading ? (
                      <>
                        <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        Enregistrement...
                      </>
                    ) : (
                      <>
                        <Check size={16} />
                        {docType === 'devis'
                          ? 'Sauvegarder le devis'
                          : docType === 'facture'
                            ? 'Sauvegarder la facture'
                            : 'Sauvegarder la commande'}
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </main>
        </form>
      ) : (
        <form id="add-purchase-form" onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white border border-slate-200/60 rounded-lg shadow-[0_2px_12px_rgba(15,23,42,0.04)] overflow-hidden">
            <div className="px-5 md:px-6 pt-6 pb-4">
              <h1 className="text-3xl lg:text-4xl font-normal text-slate-800 tracking-tight">
                Nouveau{' '}
                {docType === 'devis' ? 'devis' : docType === 'facture' ? 'facture' : 'commande'}
              </h1>
            </div>

            <div className="px-5 py-5 md:px-6 md:pb-6 grid grid-cols-1 lg:grid-cols-2 gap-x-16 gap-y-6">
              {/* Left Column */}
              <div className="space-y-3">
                <div className="flex items-center">
                  <label className="w-1/3 text-sm font-medium text-slate-700">Client</label>
                  <div className="w-2/3 flex gap-2 items-center">
                    <div className="flex-1">
                      <SearchableSelect
                        options={clientOptions}
                        value={selectedClientId}
                        onChange={setSelectedClientId}
                        placeholder="-- Choisir un client --"
                        searchPlaceholder="Rechercher un client (Nom, ICE, Ville)..."
                        required
                        className="w-full"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowClientModal(true)}
                      className="bg-white border border-slate-205 text-slate-700 hover:bg-slate-50 p-2 rounded-lg transition-colors flex items-center justify-center shrink-0 h-[34px] w-[34px]"
                      title="Nouveau Client"
                    >
                      <UserPlus size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center">
                  <label className="w-1/3 text-sm font-medium text-slate-700">
                    Date {docType === 'devis' ? 'devis' : 'de vente'}
                  </label>
                  <div className="w-2/3">
                    <input
                      type="date"
                      required
                      value={purchaseDate}
                      onChange={(e) => setPurchaseDate(e.target.value)}
                      className="w-full bg-white border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-slate-900 text-sm rounded-lg px-2.5 py-1.5 transition-all cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center">
                  <label className="w-1/3 text-sm font-medium text-slate-700">TVA</label>
                  <div className="w-2/3 flex h-8 items-center">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={applyTax}
                        onChange={(e) => setApplyTax(e.target.checked)}
                      />
                      <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#696cff]"></div>
                      <span className="ms-3 text-sm text-slate-700">Appliquer TVA (20%)</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-3">
                <div className="flex items-center">
                  <label className="w-1/3 text-sm font-medium text-slate-700">
                    {docType === 'devis' ? 'Expiration' : 'Échéance'}
                  </label>
                  <div className="w-2/3">
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full bg-white border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-slate-900 text-sm rounded-lg px-2.5 py-1.5 transition-all cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center">
                  <label className="w-1/3 text-sm font-medium text-slate-700">Conditions</label>
                  <div className="w-2/3">
                    <select
                      value={conditionsPaiement}
                      onChange={(e) => setConditionsPaiement(e.target.value)}
                      className="w-full bg-white border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-slate-900 text-sm rounded-lg px-2.5 py-1.5 transition-all cursor-pointer"
                    >
                      <option value="Paiement immédiat">Paiement immédiat</option>
                      <option value="15 jours">15 jours</option>
                      <option value="21 jours">21 jours</option>
                      <option value="30 jours">30 jours</option>
                      <option value="45 jours">45 jours</option>
                      <option value="Fin du mois suivant">Fin du mois suivant</option>
                      <option value="Le solde à 60 jours">Le solde à 60 jours</option>
                    </select>
                  </div>
                </div>

                {docType !== 'devis' && (
                  <>
                    <div className="flex items-center pt-2">
                      <label className="w-1/3 text-sm font-medium text-slate-700">Statut</label>
                      <div className="w-2/3">
                        <div className="flex p-0.5 bg-slate-100 rounded-lg border border-slate-200/60 h-8">
                          <button
                            type="button"
                            onClick={() => setPaymentStatus('paid')}
                            className={`flex-1 rounded text-xs font-semibold transition-all ${paymentStatus === 'paid' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
                          >
                            Comptant
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentStatus('credit')}
                            className={`flex-1 rounded text-xs font-semibold transition-all ${paymentStatus === 'credit' ? 'bg-white text-orange-400 shadow-sm' : 'text-slate-600 hover:text-slate-800'}`}
                          >
                            À Crédit
                          </button>
                        </div>
                      </div>
                    </div>
                    {paymentStatus !== 'paid' && (
                      <div className="flex items-center">
                        <label className="w-1/3 text-sm font-medium text-slate-700">
                          Acompte (DH)
                        </label>
                        <div className="w-2/3">
                          <input
                            type="number"
                            step="0.01"
                            value={amountPaid}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val !== '' && Number(val) > total) {
                                showToast(`Le reste à payer est de ${total} DH.`, 'error');
                                setAmountPaid(total.toString());
                              } else {
                                setAmountPaid(val);
                              }
                            }}
                            className="w-full bg-white border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-slate-900 text-sm rounded-lg px-2.5 py-1.5 transition-all font-mono"
                            placeholder="0.00"
                          />
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Tabs for Table */}
            <div className="px-5 md:px-6 flex gap-6 border-b border-slate-200/60 mt-2">
              <button
                type="button"
                className="pb-3 text-sm font-semibold text-[#696cff] border-b-2 border-[#696cff]"
              >
                Lignes{' '}
                {docType === 'devis'
                  ? 'du devis'
                  : docType === 'facture'
                    ? 'de la facture'
                    : 'de la commande'}
              </button>
            </div>

            <div className="px-5 md:px-6 py-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPasteModal(true)}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-[#696cff] transition-colors bg-white border border-slate-205 px-3 py-1.5 rounded-lg shadow-sm"
              >
                <ClipboardPaste size={14} />
                Coller depuis Excel
              </button>
            </div>

            <div className="px-5 md:px-6 pb-6">
              <div className="overflow-x-auto border border-slate-200/60 rounded-lg">
                <table className="w-full min-w-[600px] text-left">
                  <thead>
                    <tr className="bg-slate-100/70 border-b border-slate-200/60 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-5">Désignation</th>
                      <th className="py-3 px-5 text-center w-28">Qté</th>
                      <th className="py-3 px-5 text-right w-36">P.U HT (DH)</th>
                      <th className="py-3 px-5 text-right w-36">Total HT (DH)</th>
                      <th className="py-3 px-5 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <AnimatePresence initial={false}>
                      {items.map((item) => (
                        <motion.tr
                          key={item.id}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="bg-white hover:bg-slate-50/50 transition-colors"
                        >
                          <td className="px-5 py-2 align-top">
                            <textarea
                              ref={(el) => {
                                if (el) {
                                  el.style.height = 'auto';
                                  el.style.height = el.scrollHeight + 'px';
                                }
                              }}
                              required
                              rows={1}
                              placeholder="Désignation..."
                              value={item.description}
                              onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                              className="w-full bg-transparent border-0 border-b border-transparent focus:border-[#696cff] focus:ring-0 px-0 py-1.5 focus:outline-none font-normal text-slate-900 text-sm resize-none overflow-hidden placeholder:text-slate-400 transition-colors"
                              onInput={(e: any) => {
                                e.target.style.height = 'auto';
                                e.target.style.height = e.target.scrollHeight + 'px';
                              }}
                            />
                          </td>
                          <td className="px-5 py-2 align-top w-28">
                            <input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) =>
                                updateItem(item.id, 'quantity', parseInt(e.target.value) || 0)
                              }
                              className="w-full bg-transparent border-0 border-b border-transparent focus:border-[#696cff] focus:ring-0 px-0 py-1.5 focus:outline-none text-center font-medium text-slate-900 text-sm transition-colors"
                            />
                          </td>
                          <td className="px-5 py-2 align-top w-36">
                            <input
                              type="number"
                              step="0.01"
                              placeholder="0.00"
                              value={item.price || ''}
                              onChange={(e) =>
                                updateItem(item.id, 'price', parseFloat(e.target.value) || 0)
                              }
                              className="w-full bg-transparent border-0 border-b border-transparent focus:border-[#696cff] focus:ring-0 px-0 py-1.5 focus:outline-none text-right font-medium text-slate-900 text-sm transition-colors"
                            />
                          </td>
                          <td className="px-5 py-3 text-right font-mono font-medium text-slate-900 text-sm align-top w-36">
                            {(item.price * item.quantity).toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                          <td className="px-5 py-2 text-center align-top w-12">
                            <button
                              type="button"
                              onClick={() => removeItem(item.id)}
                              className="text-slate-400 hover:text-rose-500 transition-colors p-1.5 mt-0.5"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>

              <div className="mt-2 flex gap-4">
                <button
                  type="button"
                  onClick={() => addItem()}
                  className="flex items-center gap-1.5 text-sm font-medium text-[#696cff] hover:text-[#5f61e6] transition-colors py-2"
                >
                  Ajouter un produit
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-slate-200/60 px-5 md:px-6 py-6 border-b border-slate-200/60">
              {/* Left: Notes & Attachment */}
              <div className="space-y-6">
                {/* Notes / Observations section with dynamic list */}
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    Conditions générales...
                  </label>
                  <div className="space-y-2">
                    {notesList.map((note, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="flex-1">
                          <input
                            type="text"
                            value={note}
                            onChange={(e) => {
                              const newList = [...notesList];
                              newList[index] = e.target.value;
                              setNotesList(newList);
                            }}
                            placeholder={`Note / Condition #${index + 1}...`}
                            className="w-full bg-transparent border-0 border-b border-slate-200 focus:border-[#696cff] focus:ring-0 px-0 py-2 focus:outline-none text-sm text-slate-800 transition-colors placeholder:text-slate-400 italic"
                          />
                        </div>
                        {notesList.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setNotesList(notesList.filter((_, i) => i !== index))}
                            className="text-slate-400 hover:text-rose-500 transition-colors p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setNotesList([...notesList, ''])}
                    className="flex items-center gap-1 text-xs font-medium text-[#696cff] hover:text-[#5f61e6] transition-all w-fit py-1"
                  >
                    <Plus size={14} /> Ajouter une note
                  </button>
                </div>

                <div className="space-y-3 pt-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 focus:outline-none">
                    Pièce Jointe
                  </label>
                  <div className="relative">
                    <input
                      type="file"
                      id="attachment-upload"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 800 * 1024) {
                            showToast('Le fichier est trop volumineux (max 800 KB)', 'error');
                            return;
                          }
                          setAttachment(file);
                        }
                      }}
                    />
                    {attachment ? (
                      <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200/60 rounded-lg shadow-sm max-w-xs">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-white border border-slate-205 rounded-md flex items-center justify-center shrink-0">
                            {attachment.type.startsWith('image/') ? (
                              <ImageIcon size={16} className="text-slate-500" />
                            ) : (
                              <FileText size={16} className="text-slate-500" />
                            )}
                          </div>
                          <div className="overflow-hidden">
                            <p className="text-xs font-semibold text-slate-700 truncate max-w-[180px]">
                              {attachment.name}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              {(attachment.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setAttachment(null)}
                          className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <label
                        htmlFor="attachment-upload"
                        className="flex flex-col items-center justify-center w-full max-w-xs h-16 px-4 bg-slate-50/50 border border-dashed border-slate-300 rounded cursor-pointer hover:bg-slate-50 transition-all group"
                      >
                        <div className="flex items-center gap-2">
                          <Plus
                            size={16}
                            className="text-slate-400 group-hover:text-[#696cff] transition-colors"
                          />
                          <p className="text-xs text-slate-500">Ajouter un fichier (Max 800 KB)</p>
                        </div>
                      </label>
                    )}
                  </div>
                </div>
              </div>

              {/* Right: Totals */}
              <div className="space-y-3 md:ml-auto w-full max-w-xs">
                <div className="bg-slate-50 rounded p-4 border border-slate-200/60">
                  {applyTax && (
                    <>
                      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200/60">
                        <span className="text-sm text-slate-600">Montant hors taxes:</span>
                        <span className="text-sm font-mono font-bold text-slate-800">
                          {subtotal.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                      </div>
                      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200/60">
                        <span className="text-sm text-slate-600">TVA (20%):</span>
                        <span className="text-sm font-mono font-medium text-slate-700">
                          {taxAmount.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                      </div>
                    </>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-sm text-slate-600">Total:</span>
                    <span className="text-xl font-black font-mono text-[#222222]">
                      {total.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 md:px-6 py-4 flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="bg-[#696cff] text-white px-6 py-2.5 rounded text-sm font-semibold hover:bg-[#5f61e6] active:scale-95 transition-all shadow-sm focus:ring-4 focus:ring-[#696cff]/20 disabled:opacity-60 flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Enregistrement...
                  </>
                ) : (
                  <>
                    <Check size={16} />
                    {docType === 'devis'
                      ? 'Sauvegarder le devis'
                      : docType === 'facture'
                        ? 'Sauvegarder la facture'
                        : 'Sauvegarder la commande'}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* New Client Modal */}
      <AnimatePresence>
        {showClientModal && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowClientModal(false)}
              className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-xl w-full max-w-md relative z-10 shadow-lg overflow-hidden border border-slate-200/60"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 bg-slate-50/50">
                <h3 className="text-base font-semibold text-slate-800">Ajouter un Client</h3>
                <button
                  onClick={() => setShowClientModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X size={18} />
                </button>
              </div>

              <form
                onSubmit={handleAddClient}
                className="p-6 space-y-4 max-h-[70vh] overflow-y-auto"
              >
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600">Nom Complet ou STE</label>
                  <input
                    required
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value.toUpperCase())}
                    className="w-full px-3 py-2 bg-white border border-slate-205 rounded-lg focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none text-sm text-slate-900 transition-all uppercase"
                    placeholder="SMART COMPUTING S.A."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Email (Envoi PDF)</label>
                    <input
                      type="email"
                      value={newClientEmail}
                      onChange={(e) => setNewClientEmail(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-205 rounded-lg focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none text-sm text-slate-900 transition-all"
                      placeholder="contact@client.com"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Téléphone</label>
                    <input
                      type="tel"
                      value={newClientPhone}
                      onChange={(e) => setNewClientPhone(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-205 rounded-lg focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none text-sm text-slate-900 transition-all"
                      placeholder="06 XX XX XX XX"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600">Adresse Ligne 1</label>
                  <input
                    type="text"
                    value={newClientAddressLine1}
                    onChange={(e) => setNewClientAddressLine1(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-205 rounded-lg focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none text-sm text-slate-900 transition-all"
                    placeholder="Numéro, Rue, Quartier..."
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-600">Adresse Ligne 2</label>
                  <input
                    type="text"
                    value={newClientAddressLine2}
                    onChange={(e) => setNewClientAddressLine2(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-205 rounded-lg focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none text-sm text-slate-900 transition-all"
                    placeholder="Bâtiment, Étage, Appartement..."
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">Ville</label>
                    <input
                      type="text"
                      value={newClientCity}
                      onChange={(e) => setNewClientCity(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-205 rounded-lg focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none text-sm text-slate-900 transition-all"
                      placeholder="Ville"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600">ICE</label>
                    <input
                      type="text"
                      maxLength={14}
                      value={newClientIce}
                      onChange={(e) => setNewClientIce(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-205 rounded-lg focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none text-sm text-slate-900 transition-all font-mono"
                      placeholder="14 chiffres"
                    />
                  </div>
                </div>
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#696cff] text-white font-semibold text-sm py-2.5 rounded-lg hover:bg-[#5f61e6] transition-all shadow-sm active:scale-95 disabled:opacity-60"
                  >
                    {loading ? 'Création...' : 'Valider & Sélectionner'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Paste Excel Modal */}
      <AnimatePresence>
        {showPasteModal && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPasteModal(false)}
              className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white rounded-xl w-full max-w-2xl relative z-10 shadow-lg overflow-hidden border border-slate-200/60"
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 bg-slate-50/50">
                <h3 className="text-base font-semibold text-slate-800">Importer depuis Excel</h3>
                <button
                  onClick={() => setShowPasteModal(false)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <p className="text-slate-500 text-xs uppercase font-bold tracking-wider">
                  Copiez vos colonnes ou votre document Excel complet (Commande / Devis / Facture)
                </p>

                {/* Modèles Excel à télécharger / Exemple */}
                <div className="bg-slate-50 border border-slate-200/80 p-3 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                      <Download size={14} className="text-[#696cff]" />
                      Modèles Excel disponibles
                    </span>
                    <span className="text-[11px] text-slate-500 italic">
                      Format standard avec en-tête inclus
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={downloadClientOrderTemplate}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                    >
                      <Download size={13} />
                      Modèle Document (.xlsx)
                    </button>
                    <button
                      type="button"
                      onClick={fillClientSampleText}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#696cff] hover:bg-[#5b5eeb] text-white rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                    >
                      <ClipboardPaste size={13} />
                      Remplir avec l'exemple
                    </button>
                    <button
                      type="button"
                      onClick={downloadStandardTemplate}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold transition-all active:scale-95"
                    >
                      <Download size={13} />
                      Modèle Articles (.xlsx)
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <textarea
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    className="w-full h-48 px-4 py-3 bg-white border border-slate-205 rounded-lg focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-mono text-xs text-slate-900 transition-all placeholder:text-slate-300"
                    placeholder="Collez ici les lignes d'articles ou le document Excel complet..."
                  />
                  <div className="bg-[#696cff]/5 border border-[#696cff]/20 rounded-lg p-3">
                    <p className="text-xs text-[#696cff] font-semibold mb-1">💡 Détection Automatique :</p>
                    <p className="text-xs text-[#696cff]/90 leading-relaxed">
                      Détecte automatiquement la <b>Date d'émission</b>, le <b>Client</b>, et les colonnes <b>Désignation</b>, <b>Quantité</b>, <b>Prix Unitaire</b> et <b>TVA</b>.
                    </p>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowPasteModal(false)}
                    className="flex-1 bg-white border border-slate-205 text-slate-700 font-semibold text-sm py-2.5 rounded-lg hover:bg-slate-50 transition-all active:scale-95"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={onPasteConfirm}
                    className="flex-[2] bg-[#696cff] text-white font-semibold text-sm py-2.5 rounded-lg hover:bg-[#5f61e6] transition-all shadow-sm active:scale-95 flex items-center justify-center gap-2"
                  >
                    <Check size={16} />
                    Importer l'analyse
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

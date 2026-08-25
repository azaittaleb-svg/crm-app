import { useState, useEffect, FormEvent } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useNotification } from '../context/NotificationContext';
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
  collection,
  getDocs,
  query,
  orderBy,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { convertNumberToFrenchWords } from '../utils/numberToWords';
import { calculateDocumentTotals } from '../utils/calculations';
import { useInvoiceFormItems, OrderItem } from '../hooks/useInvoiceFormItems';
import {
  ShoppingCart,
  ArrowLeft,
  Plus,
  Trash2,
  Package,
  Check,
  FileText,
  Paperclip,
  ImageIcon,
  X,
  ClipboardPaste,
  Link2,
  Download,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import { COMPANY_INFO } from '../constants';

export default function EditPurchasePage() {
  const { clientId, purchaseId } = useParams();

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
  } = useInvoiceFormItems([]);

  // Doc Type & Conditions
  const [docType, setDocType] = useState('commande');
  const [conditionsPaiement, setConditionsPaiement] = useState('Paiement à la livraison');
  const [modeReglement, setModeReglement] = useState('');

  // Tax and Payment
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'credit'>('paid');
  const [amountPaid, setAmountPaid] = useState(''); // This represents INITIAL amount
  const [purchaseDate, setPurchaseDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notesList, setNotesList] = useState<string[]>(['']);
  const [applyTax, setApplyTax] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [existingAttachmentUrl, setExistingAttachmentUrl] = useState<string | null>(null);
  const [existingAttachmentName, setExistingAttachmentName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [payments, setPayments] = useState<any[]>([]);

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);

  const [linkedPartnerInfo, setLinkedPartnerInfo] = useState<any>(null);
  const [partnerBalance, setPartnerBalance] = useState(0);
  const [clientInfo, setClientInfo] = useState<any>(null);

  const { user } = useAuth();
  const { showToast } = useNotification();
  const navigate = useNavigate();

  useEffect(() => {
    if (!clientId || !purchaseId || !user) return;

    // Fetch Linked Partner Data & Client Info
    const fetchPartnerData = async () => {
      try {
        const clientSnap = await getDoc(doc(db, 'clients', clientId));
        if (!clientSnap.exists()) return;
        const client = clientSnap.data();
        setClientInfo({ id: clientSnap.id, ...client });

        if (!client.linkedPartnerId) return;

        const partnerSnap = await getDoc(doc(db, 'suppliers', client.linkedPartnerId));
        if (partnerSnap.exists()) {
          const partnerData = partnerSnap.id ? { id: partnerSnap.id, ...partnerSnap.data() } : null;
          setLinkedPartnerInfo(partnerData);

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

          const qClientPurchases = query(
            collection(db, 'clients', clientId, 'purchases'),
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

    setFetching(true);
    const unsubPurchase = onSnapshot(
      doc(db, 'clients', clientId, 'purchases', purchaseId),
      (snap) => {
        if (snap.exists()) {
          const pData = snap.data();
          if (pData.ownerId !== user.uid) {
            showToast('Accès non autorisé', 'error');
            navigate(-1);
            return;
          }

          // State validation check for Odoo invoicing
          const invoiceStatus = pData.status || (pData.refId ? 'Validée' : 'Brouillon');
          if (pData.type === 'facture' && invoiceStatus !== 'Brouillon') {
            showToast('Une facture validée ou annulée ne peut pas être modifiée.', 'error');
            navigate(-1);
            return;
          }

          // Handle legacy vs new structure
          if (pData.items) {
            setItems(
              pData.items.map((item: any) => ({
                ...item,
                taxRate: item.taxRate !== undefined ? item.taxRate : pData.taxRate || 0,
              }))
            );
          } else {
            setItems([
              {
                id: 'legacy',
                description: pData.description || '',
                price: pData.price || 0,
                quantity: pData.quantity || 1,
                taxRate: pData.taxRate || 0,
              },
            ]);
          }

          setPaymentStatus(pData.paymentStatus || 'credit');
          setDocType(pData.type || 'commande');
          setConditionsPaiement(pData.conditions_paiement || 'Paiement à la livraison');
          setModeReglement(pData.mode_reglement || '');

          if (pData.notesList && Array.isArray(pData.notesList)) {
            setNotesList(pData.notesList.length > 0 ? pData.notesList : ['']);
          } else if (pData.notes) {
            setNotesList(
              pData.notes
                .split('\n')
                .filter(Boolean)
                .map((n: string) => n.trim())
            );
          } else {
            setNotesList(['']);
          }

          setApplyTax(
            (pData.taxAmount || 0) > 0 ||
              (pData.taxRate || 0) > 0 ||
              (pData.items && pData.items.some((i: any) => i.taxRate > 0))
          );
          setExistingAttachmentUrl(pData.attachmentUrl || null);
          setExistingAttachmentName(pData.attachmentName || null);

          if (pData.date instanceof Timestamp) {
            setPurchaseDate(pData.date.toDate().toISOString().split('T')[0]);
          } else if (pData.date) {
            const d = new Date(pData.date);
            if (!isNaN(d.getTime())) setPurchaseDate(d.toISOString().split('T')[0]);
          }

          if (pData.dueDate instanceof Timestamp) {
            setDueDate(pData.dueDate.toDate().toISOString().split('T')[0]);
          } else if (pData.dueDate) {
            try {
              const d = new Date(pData.dueDate);
              if (!isNaN(d.getTime())) {
                setDueDate(d.toISOString().split('T')[0]);
              }
            } catch (e) {
              console.error('Error parsing dueDate:', e);
            }
          }
        } else {
          showToast('Vente introuvable', 'error');
          navigate(-1);
        }
        setFetching(false);
      }
    );

    // Fetch payments to block status edit if payments exist
    const qPayments = query(
      collection(db, 'clients', clientId, 'payments'),
      where('purchaseId', '==', purchaseId),
      where('ownerId', '==', user?.uid || ''),
      orderBy('date', 'desc')
    );
    const unsubPayments = onSnapshot(qPayments, (snap) => {
      setPayments(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubPurchase();
      unsubPayments();
    };
  }, [clientId, purchaseId, user]);

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
      onDateDetected: (d) => setPurchaseDate(d),
      onApplyTaxDetected: (hasTax) => setApplyTax(hasTax),
    });
  };

  const taxRateGlobal = applyTax ? 20 : 0;
  const { subtotal, taxAmount, total } = calculateDocumentTotals(items, taxRateGlobal);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clientId || !purchaseId) return;

    if (items.some((i) => !i.description || ((!i.type || i.type === 'product') && i.price <= 0))) {
      showToast('Veuillez remplir correctement toutes les lignes.', 'error');
      return;
    }

    setLoading(true);

    try {
      // Direct Firestore check to ensure we aren't modifying a validated/canceled invoice
      const freshSnap = await getDoc(doc(db, 'clients', clientId, 'purchases', purchaseId));
      if (freshSnap.exists()) {
        const freshData = freshSnap.data();
        const invoiceStatus = freshData.status || (freshData.refId ? 'Validée' : 'Brouillon');
        if (freshData.type === 'facture' && invoiceStatus !== 'Brouillon') {
          showToast('Une facture validée ou annulée ne peut pas être modifiée.', 'error');
          setLoading(false);
          return;
        }
      }

      let attachmentUrl = existingAttachmentUrl;
      let attachmentName = existingAttachmentName;

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

      const totalPayments =
        docType === 'devis' ? 0 : payments.reduce((acc, p) => acc + (Number(p.amount) || 0), 0);
      const computedStatus =
        docType === 'devis' ? 'credit' : totalPayments >= total ? 'paid' : 'credit';
      const pAmountPaid =
        docType === 'devis' ? 0 : paymentStatus === 'paid' ? total : totalPayments;

      const itemsWithTax = items.map((item) => ({
        ...item,
        taxRate: taxRateGlobal,
      }));

      await updateDoc(doc(db, 'clients', clientId, 'purchases', purchaseId), {
        type: docType,
        conditions_paiement: conditionsPaiement,
        mode_reglement: modeReglement,
        items: itemsWithTax,
        description: items.length === 1 ? items[0].description : `${items.length} Produits`,
        price: items.length === 1 ? items[0].price : 0,
        quantity: items.reduce((a, b) => a + b.quantity, 0),
        subtotal,
        taxAmount,
        taxRate: taxRateGlobal,
        total,
        paymentStatus: computedStatus,
        amountPaid: pAmountPaid,
        dueDate:
          (computedStatus === 'credit' || docType === 'devis') && dueDate
            ? new Date(dueDate)
            : null,
        date: purchaseDate ? new Date(purchaseDate + 'T00:00:00') : serverTimestamp(),
        attachmentUrl,
        attachmentName,
        notes:
          notesList
            .map((n) => n.trim())
            .filter(Boolean)
            .join('\n') || null,
        notesList: notesList.map((n) => n.trim()).filter(Boolean),
        updatedAt: serverTimestamp(),
      });

      const successMsg =
        docType === 'devis'
          ? 'Devis mis à jour avec succès'
          : docType === 'facture'
            ? 'Facture mise à jour avec succès'
            : 'Vente mise à jour avec succès';

      showToast(successMsg, 'success');
      navigate(`/purchase/${clientId}/${purchaseId}`);
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `clients/${clientId}/purchases/${purchaseId}`
      );
    } finally {
      setLoading(false);
    }
  };

  if (fetching) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-500 font-bold uppercase tracking-wider text-xs">
          Chargement de la vente...
        </p>
      </div>
    );
  }

  return (
    <div className="w-full py-4 space-y-6">
      <div className="w-full animate-fadeIn flex flex-col">
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
          <form id="edit-purchase-form" onSubmit={handleSubmit} className="w-full">
            <main className="flex flex-col lg:flex-row gap-6 items-start">
              {/* Left Side: Live A4 Document Preview & WYSIWYG Items Editor */}
              <div className="flex-1 w-full space-y-6">
                <motion.div
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg shadow-xs overflow-hidden w-full"
                >
                  <div className="p-8 md:p-12 print:p-10 font-sans min-h-[500px] print:min-h-[1123px] flex flex-col relative bg-white dark:bg-[#2b2c40]">
                    {/* Watermark / Header decoration */}
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
                          {docType === 'devis' ? 'DEV' : docType === 'facture' ? 'FAC' : 'CMD'}-
                          {purchaseId?.slice(0, 8).toUpperCase()}
                        </div>
                        {(!docType || docType === 'commande') && (
                          <p className="text-[11px] text-[#a1acb8] dark:text-[#707194] lowercase mt-[-0.5rem] mb-4">
                            (commande n°: #{purchaseId?.slice(0, 8).toUpperCase()})
                          </p>
                        )}
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

                    <div className="grid grid-cols-2 gap-8 my-8 text-[13px] text-[#566a7f] dark:text-[#a1acb8] leading-relaxed">
                      <div>
                        <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block mb-2 uppercase tracking-widest">
                          {docType === 'devis' ? 'Devis pour :' : "À l'attention de :"}
                        </span>
                        {clientInfo ? (
                          <>
                            <h2 className="font-bold text-[14px] text-[#566a7f] dark:text-[#dbdade] mb-1 uppercase">
                              {clientInfo.name}
                            </h2>
                            {clientInfo.addressLine1 && <p>{clientInfo.addressLine1}</p>}
                            {(clientInfo.city || clientInfo.city_ma || clientInfo.phone) && (
                              <p>
                                {[
                                  clientInfo.city || clientInfo.city_ma,
                                  clientInfo.phone ? `Tél: ${clientInfo.phone}` : '',
                                ]
                                  .filter(Boolean)
                                  .join(' | ')}
                              </p>
                            )}
                            {clientInfo.ice && <p className="mt-1">ICE: {clientInfo.ice}</p>}
                          </>
                        ) : (
                          <div className="text-xs text-slate-400 italic">
                            Chargement du client...
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
                            <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-12 text-center">
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
                        <tbody className="divide-y divide-slate-100 dark:divide-[#434460]/40">
                          {items.map((item, idx) => {
                            if (item.type === 'section') {
                              return (
                                <tr
                                  key={item.id}
                                  className="bg-slate-50/50 dark:bg-slate-800/10 transition-all font-sans"
                                >
                                  <td className="px-4 py-2.5 text-center align-middle">
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
                                  <td colSpan={4} className="px-6 py-2.5 align-middle">
                                    <input
                                      type="text"
                                      placeholder="Nom de la section (ex: Matériel Informatique)"
                                      value={item.description}
                                      onChange={(e) =>
                                        updateItem(item.id, 'description', e.target.value)
                                      }
                                      className="w-full bg-transparent border-0 border-b border-transparent focus:border-[#696cff] focus:ring-0 p-0 font-bold text-[#233446] dark:text-[#dbdade] text-[14px] placeholder:text-slate-400 transition-all"
                                    />
                                  </td>
                                  <td className="px-3 py-2.5 align-middle w-12 text-center print:hidden">
                                    <button
                                      type="button"
                                      onClick={() => removeItem(item.id)}
                                      className="text-slate-400 hover:text-rose-500 transition-colors p-1 rounded-md"
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
                                  className="hover:bg-slate-50/40 dark:hover:bg-[#2b2c40]/20 transition-all font-sans"
                                >
                                  <td className="px-4 py-2.5 text-center align-top pt-3.5">
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
                                  <td colSpan={4} className="px-6 py-2.5 align-top">
                                    <textarea
                                      ref={(el) => {
                                        if (el) {
                                          el.style.height = 'auto';
                                          el.style.height = el.scrollHeight + 'px';
                                        }
                                      }}
                                      rows={1}
                                      value={item.description}
                                      onChange={(e) =>
                                        updateItem(item.id, 'description', e.target.value)
                                      }
                                      className="w-full bg-transparent border-0 border-b border-transparent focus:border-[#696cff] focus:ring-0 p-0 font-medium italic text-slate-500 dark:text-slate-400 text-[13px] resize-none overflow-hidden placeholder:text-slate-300 placeholder:italic transition-all"
                                      placeholder="Ajouter une description ou note..."
                                      onInput={(e: any) => {
                                        e.target.style.height = 'auto';
                                        e.target.style.height = e.target.scrollHeight + 'px';
                                      }}
                                    />
                                  </td>
                                  <td className="px-3 py-2.5 align-top w-12 text-center print:hidden pt-3">
                                    <button
                                      type="button"
                                      onClick={() => removeItem(item.id)}
                                      className="text-slate-400 hover:text-rose-500 transition-colors p-1 rounded-md"
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
                                className="hover:bg-slate-50/40 dark:hover:bg-[#2b2c40]/20 transition-all font-sans"
                              >
                                <td className="px-4 py-2.5 align-top text-center font-mono text-[13px] text-slate-400 font-bold pt-3.5">
                                  {idx + 1}
                                </td>
                                <td className="px-6 py-2.5 align-top">
                                  <textarea
                                    ref={(el) => {
                                      if (el) {
                                        el.style.height = 'auto';
                                        el.style.height = el.scrollHeight + 'px';
                                      }
                                    }}
                                    required
                                    rows={1}
                                    value={item.description}
                                    onChange={(e) =>
                                      updateItem(item.id, 'description', e.target.value)
                                    }
                                    className="w-full bg-transparent border-0 border-b border-transparent focus:border-[#696cff] focus:ring-0 p-0 font-medium text-[#233446] dark:text-[#dbdade] text-[13px] resize-none overflow-hidden placeholder:text-slate-300 transition-all"
                                    placeholder="Saisir la désignation du produit/service..."
                                    onInput={(e: any) => {
                                      e.target.style.height = 'auto';
                                      e.target.style.height = e.target.scrollHeight + 'px';
                                    }}
                                  />
                                </td>
                                <td className="px-4 py-2.5 align-top w-20 text-center">
                                  <input
                                    type="number"
                                    required
                                    min="1"
                                    value={item.quantity}
                                    onChange={(e) =>
                                      updateItem(item.id, 'quantity', parseInt(e.target.value) || 0)
                                    }
                                    className="w-12 bg-transparent border-0 border-b border-transparent focus:border-[#696cff] focus:ring-0 p-0 text-center font-bold text-[#233446] dark:text-[#dbdade] text-[13px]"
                                  />
                                </td>
                                <td className="px-4 py-2.5 align-top w-32 text-right">
                                  <input
                                    type="number"
                                    required
                                    step="0.01"
                                    placeholder="0.00"
                                    value={item.price || ''}
                                    onChange={(e) =>
                                      updateItem(item.id, 'price', parseFloat(e.target.value) || 0)
                                    }
                                    className="w-full bg-transparent border-0 border-b border-transparent focus:border-[#696cff] focus:ring-0 p-0 text-right font-bold text-[#233446] dark:text-[#dbdade] text-[13px]"
                                  />
                                </td>
                                <td className="px-6 py-3.5 align-top w-32 text-[13px] text-right font-mono text-[#233446] dark:text-[#dbdade] font-semibold">
                                  {(item.price * item.quantity).toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </td>
                                <td className="px-3 py-2.5 align-top w-12 text-center print:hidden">
                                  <button
                                    type="button"
                                    disabled={items.length === 1}
                                    onClick={() => removeItem(item.id)}
                                    className="text-slate-400 hover:text-rose-500 transition-colors p-1 rounded-md disabled:opacity-30 mt-0.5"
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

                    <div className="flex gap-6 p-4 border border-t-0 border-[#dbdade]/70 dark:border-[#434460]/40 rounded-b-lg mb-10 bg-white dark:bg-transparent print:hidden">
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

                    {/* Add action row */}
                    <div className="flex justify-end mb-10 print:hidden"></div>

                    {/* Footer (Notes + Totals) inside sheet layout */}
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
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>

              {/* Right Side: Configuration Sidebar */}
              <div className="w-full lg:w-[320px] shrink-0 space-y-6 print:hidden lg:sticky lg:top-24">
                {/* Card 1: Propriétés et Client */}
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

                  {/* Client select or display */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                      Client Destinataire
                    </label>
                    <div className="bg-slate-50 border border-slate-205 rounded-lg px-3 py-2 text-xs font-bold text-slate-700">
                      {clientInfo ? clientInfo.name : 'Chargement...'}
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
                </div>

                {/* Card 2: Paramètres Financiers */}
                <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 space-y-4 shadow-sm animate-fadeIn">
                  <h3 className="text-xs font-black text-[#566a7f] dark:text-[#dbdade] border-b border-[#f1f0f4] dark:border-[#434460]/40 pb-3 flex items-center gap-1.5 uppercase tracking-wider">
                    <ShoppingCart size={16} className="text-[#696cff]" />
                    Paramètres Financiers
                  </h3>

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

                  {/* TVA Switch toggle */}
                  <div className="flex items-center pt-2">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={applyTax}
                        onChange={(e) => setApplyTax(e.target.checked)}
                      />
                      <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#696cff]"></div>
                      <span className="ms-2.5 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Appliquer TVA (20%)
                      </span>
                    </label>
                  </div>
                </div>

                {/* Card 3: Pièce jointe & Actions importer */}
                <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 space-y-4 shadow-sm animate-fadeIn">
                  <h3 className="text-xs font-black text-[#566a7f] dark:text-[#dbdade] border-b border-[#f1f0f4] dark:border-[#434460]/40 pb-3 flex items-center gap-1.5 uppercase tracking-wider">
                    <Paperclip size={16} className="text-[#696cff]" />
                    Pièces Jointes & Avancé
                  </h3>

                  {/* Pièce jointe */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                      Fichier Attaché
                    </label>
                    <div className="relative">
                      <input
                        type="file"
                        id="attachment-upload-sidebar"
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

                      {attachment || existingAttachmentUrl ? (
                        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200/60 rounded-lg shadow-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-white border border-slate-205 rounded-md flex items-center justify-center shrink-0">
                              {attachment?.type.startsWith('image/') ||
                              existingAttachmentName?.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                                <ImageIcon size={14} className="text-slate-500" />
                              ) : (
                                <FileText size={14} className="text-slate-500" />
                              )}
                            </div>
                            <div className="overflow-hidden">
                              <p className="text-[11px] font-bold text-slate-700 truncate max-w-[150px]">
                                {attachment?.name || existingAttachmentName || 'Fichier'}
                              </p>
                              <p className="text-[9px] text-slate-400">
                                {attachment
                                  ? `${(attachment.size / 1024).toFixed(1)} KB`
                                  : 'Fichier existant'}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setAttachment(null);
                              if (!attachment) setExistingAttachmentUrl(null);
                            }}
                            className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : (
                        <label
                          htmlFor="attachment-upload-sidebar"
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
                  </div>

                  {/* Import Excel */}
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setShowPasteModal(true)}
                      className="w-full h-10 border border-indigo-100 bg-indigo-50 text-[#696cff] rounded-lg font-bold text-xs uppercase tracking-widest hover:bg-indigo-100 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <ClipboardPaste size={14} />
                      Importer Excel (Lignes)
                    </button>
                  </div>
                </div>

                {/* Main Actions */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-[#696cff] hover:bg-[#5f61e6] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(105,108,255,0.4)] py-[0.85rem] px-5 rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-all text-white font-medium shadow-sm disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
                  >
                    {loading ? (
                      <>
                        <div className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                        <span className="whitespace-nowrap uppercase text-[13px] tracking-wider font-bold">
                          Enregistrement...
                        </span>
                      </>
                    ) : (
                      <>
                        <Check size={18} />
                        <span className="whitespace-nowrap uppercase text-[13px] tracking-wider font-bold">
                          {docType === 'devis'
                            ? 'Sauvegarder le devis'
                            : docType === 'facture'
                              ? 'Sauvegarder la facture'
                              : 'Sauvegarder la commande'}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </main>
          </form>
        ) : (
          <form id="edit-purchase-form" onSubmit={handleSubmit} className="space-y-6">
            <div className="bg-white border border-slate-200/60 rounded-lg shadow-[0_2px_12px_rgba(15,23,42,0.04)] overflow-hidden">
              <div className="px-5 md:px-6 pt-6 pb-4">
                <h1 className="text-3xl lg:text-4xl font-normal text-slate-800 tracking-tight flex items-center justify-between">
                  <span>
                    Modification{' '}
                    {docType === 'devis'
                      ? 'du devis'
                      : docType === 'facture'
                        ? 'de la facture'
                        : 'de la commande'}
                  </span>
                  <span className="text-xl font-medium text-slate-400">
                    {purchaseId?.slice(0, 8).toUpperCase()}
                  </span>
                </h1>
              </div>

              <div className="px-5 py-5 md:px-6 md:pb-6 grid grid-cols-1 lg:grid-cols-2 gap-x-16 gap-y-6">
                {/* Left Column */}
                <div className="space-y-3">
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

                  {docType !== 'devis' && (
                    <div className="pt-2">
                      <div className="flex items-start">
                        <label className="w-1/3 text-sm font-medium text-slate-700 pt-1.5">
                          Paiements
                        </label>
                        <div className="w-2/3">
                          <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5">
                            Statut calculé dynamiquement ({payments.length} reçus).
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
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
                            <td className="px-5 py-2 align-top w-28 text-center">
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
                            <td className="px-5 py-2 align-top w-36 text-right">
                              <input
                                type="number"
                                step="0.01"
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
                    onClick={addItem}
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
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 animate-fadeIn">
                      Conditions générales...
                    </label>
                    <div className="space-y-2">
                      {notesList.map((note, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <div className="flex-1">
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
                                newList[index] = e.target.value;
                                setNotesList(newList);
                              }}
                              onInput={(e: any) => {
                                e.target.style.height = 'auto';
                                e.target.style.height = e.target.scrollHeight + 'px';
                              }}
                              placeholder={`Note / Condition #${index + 1}...`}
                              className="w-full bg-transparent border-0 border-b border-slate-200 focus:border-[#696cff] focus:ring-0 px-0 py-2 focus:outline-none text-sm text-slate-800 transition-colors placeholder:text-slate-400 italic outline-none resize-none"
                            />
                          </div>
                          {notesList.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setNotesList(notesList.filter((_, i) => i !== index))}
                              className="text-slate-400 hover:text-rose-500 transition-colors mt-2"
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
                      className="flex items-center gap-1 text-xs font-medium text-[#696cff] hover:text-[#5f61e6] transition-all w-fit py-1 cursor-pointer"
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
                        id="attachment-upload-edit"
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

                      {attachment || existingAttachmentUrl ? (
                        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200/60 rounded-lg shadow-sm max-w-xs">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-white border border-slate-205 rounded-md flex items-center justify-center shrink-0">
                              {attachment?.type.startsWith('image/') ||
                              existingAttachmentName?.match(/\.(jpg|jpeg|png|gif)$/i) ? (
                                <ImageIcon size={16} className="text-slate-500" />
                              ) : (
                                <FileText size={16} className="text-slate-500" />
                              )}
                            </div>
                            <div className="overflow-hidden">
                              <p className="text-sm font-medium text-slate-700 truncate max-w-[150px]">
                                {attachment?.name || existingAttachmentName || 'Fichier'}
                              </p>
                              <p className="text-xs text-slate-400">
                                {attachment
                                  ? `${(attachment.size / 1024).toFixed(1)} KB`
                                  : 'Fichier existant'}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setAttachment(null);
                              if (!attachment) setExistingAttachmentUrl(null);
                            }}
                            className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <label
                          htmlFor="attachment-upload-edit"
                          className="flex flex-col items-center justify-center w-full max-w-xs h-16 px-4 bg-slate-50/50 border border-dashed border-slate-300 rounded cursor-pointer hover:bg-slate-50 transition-all group"
                        >
                          <div className="flex items-center gap-2">
                            <Plus
                              size={16}
                              className="text-slate-400 group-hover:text-[#696cff] transition-colors"
                            />
                            <p className="text-xs text-slate-500">Ajouter / Remplacer</p>
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

              <div className="px-5 md:px-6 py-4 flex justify-end bg-slate-50 border-t border-slate-200/60">
                <button
                  type="submit"
                  disabled={loading}
                  className="bg-[#696cff] text-white px-6 py-2.5 rounded text-sm font-semibold hover:bg-[#5f61e6] active:scale-95 transition-all shadow-sm focus:ring-4 focus:ring-[#696cff]/20 disabled:opacity-60 flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg
                        className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Sauvegarde...
                    </>
                  ) : (
                    <>
                      <ShoppingCart size={18} />
                      Mettre à jour
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Paste Excel Modal */}
        <AnimatePresence>
          {showPasteModal && (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-transparent backdrop-blur-sm"
                onClick={() => setShowPasteModal(false)}
              />
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden relative z-10 flex flex-col max-h-[90vh]"
              >
                <div className="px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-transparent">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-transparent dark:bg-transparent text-[#696cff] dark:text-[#b1b4ff] flex items-center justify-center">
                      <ClipboardPaste size={20} />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 tracking-tight font-display">
                        Coller depuis Excel
                      </h3>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-0.5">
                        Import rapide de lignes de commande
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPasteModal(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <div className="p-8 space-y-5 overflow-y-auto">
                  {/* Modèles Excel à télécharger / Exemple */}
                  <div className="bg-slate-50 border border-slate-200/80 p-3.5 rounded-xl space-y-2.5">
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

                  <div className="space-y-4">
                    <div>
                      <textarea
                        value={pasteContent}
                        onChange={(e) => setPasteContent(e.target.value)}
                        className="w-full h-52 px-4 py-3 bg-slate-100 border border-slate-300 rounded-2xl focus:ring-4 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-mono text-xs text-slate-900 transition-all placeholder:text-slate-400"
                        placeholder="Collez ici les lignes d'articles ou le document Excel complet..."
                      />
                      <div className="mt-2 bg-transparent">
                        <p className="text-[11px] text-[#696cff] leading-relaxed">
                          💡 <b>Détection Automatique :</b> Détecte la <b>Date d'émission</b> et les colonnes <b>Désignation</b>, <b>Quantité</b>, <b>Prix Unitaire</b> et <b>TVA</b>.
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-4 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowPasteModal(false)}
                        className="flex-1 bg-slate-100 text-slate-600 font-bold uppercase tracking-widest text-xs py-3.5 rounded-2xl hover:bg-slate-200 transition-all active:scale-95"
                      >
                        Annuler
                      </button>
                      <button
                        type="button"
                        onClick={onPasteConfirm}
                        className="flex-[2] bg-slate-900 text-white font-bold uppercase tracking-widest text-xs py-3.5 rounded-2xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 active:scale-95 flex items-center justify-center gap-2"
                      >
                        <Check size={16} />
                        Importer l'analyse
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

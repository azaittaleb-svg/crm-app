import { useState, useEffect, FormEvent } from 'react';
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
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { SearchableSelect } from '../components/ui/SearchableSelect';
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
  Zap,
  Download,
  UserPlus,
  Globe,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { backendService } from '../services/backendService';

interface OrderItem {
  id: string;
  type?: 'product' | 'section' | 'note';
  description: string;
  price: number;
  quantity: number;
  // Motcho fields
  prix_achat_usd?: number;
  frais_douane_usd?: number;
  diw_mad?: number;
  shipping_usd?: number;
  prix_achat_net_unit_mad?: number;
}

export default function AddSupplierPurchasePage() {
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  const supplierOptions = suppliers.map((sup) => ({
    value: sup.id,
    label: sup.name || 'Fournisseur sans nom',
    subtitle: sup.ice ? `ICE: ${sup.ice}` : sup.phone ? `Tél: ${sup.phone}` : sup.email ? sup.email : undefined,
    badge: sup.city || undefined,
  }));

  // New Supplier Modal state
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Excel Paste state
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteContent, setPasteContent] = useState('');

  // AI Extraction state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiContent, setAiContent] = useState('');
  const [extracting, setExtracting] = useState(false);

  // Purchase Details
  const [description, setDescription] = useState('');
  const [refId, setRefId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [amountPaid, setAmountPaid] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'credit'>('credit');
  const [dueDate, setDueDate] = useState('');
  const [applyTax, setApplyTax] = useState(false);
  const [notesList, setNotesList] = useState<string[]>(['']);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Items
  const [items, setItems] = useState<OrderItem[]>([
    { id: '1', type: 'product', description: '', price: 0, quantity: 1 },
  ]);

  const [loading, setLoading] = useState(false);
  // Motcho specialized state
  const [isMotcho, setIsMotcho] = useState(false);
  const [exchangeRate, setExchangeRate] = useState<string>('10.00');

  useEffect(() => {
    const selectedSupplier = suppliers.find((s) => s.id === selectedSupplierId);
    if (selectedSupplier && selectedSupplier.name.toUpperCase().includes('MOTCHO')) {
      setIsMotcho(true);
    } else {
      setIsMotcho(false);
    }
  }, [selectedSupplierId, suppliers]);

  useEffect(() => {
    if (isMotcho) {
      const rate = parseFloat(exchangeRate) || 0;
      setItems((prev) =>
        prev.map((item) => {
          const usdVal = item.prix_achat_usd || 0;
          const customsVal = usdVal * 0.365;
          const diwVal = item.diw_mad || 0;
          const shipUsdVal = item.shipping_usd || 0;

          const priceFromUsdMad = (usdVal + customsVal + shipUsdVal) * rate;
          const finalPriceMad = priceFromUsdMad + diwVal;

          return {
            ...item,
            frais_douane_usd: Number(customsVal.toFixed(2)),
            diw_mad: Number(diwVal.toFixed(2)),
            shipping_usd: Number(shipUsdVal.toFixed(2)),
            prix_achat_net_unit_mad: Number(finalPriceMad.toFixed(2)),
            price: Number(finalPriceMad.toFixed(2)), // Sync with main price field
          };
        })
      );
    }
  }, [isMotcho, exchangeRate]);
  const { showToast, confirm } = useNotification();
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;

    // Fetch suppliers
    const fetchSuppliers = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'suppliers'));
        const list = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((s: any) => !s.ownerId || s.ownerId === user.uid);
        setSuppliers(list);
      } catch (error) {
        console.warn('Erreur chargement fournisseurs:', error);
      }
    };

    fetchSuppliers();
  }, [user]);

  // Pre-fill supplier if in current URL params
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const supplierIdParam = searchParams.get('supplierId');
    if (supplierIdParam && suppliers.some((s) => s.id === supplierIdParam)) {
      setSelectedSupplierId(supplierIdParam);
    }
  }, [suppliers]);

  const handleAddSupplier = async (e: FormEvent) => {
    e.preventDefault();
    if (!newSupplierName || !user) return;
    setIsSubmitting(true);
    try {
      const q = query(
        collection(db, 'suppliers'),
        where('ownerId', '==', user.uid),
        where('name', '==', newSupplierName.trim())
      );

      const querySnapshot = await getDocs(q);
      if (!querySnapshot.empty) {
        showToast('Un fournisseur avec ce nom existe déjà', 'error');
        setIsSubmitting(false);
        return;
      }

      confirm({
        title: "Confirmer l'ajout",
        message: `Voulez-vous ajouter le fournisseur "${newSupplierName.trim()}" ?`,
        onConfirm: async () => {
          try {
            setIsSubmitting(true);
            const docRef = await addDoc(collection(db, 'suppliers'), {
              ownerId: user.uid,
              name: newSupplierName.trim(),
              phone: newSupplierPhone || null,
              createdAt: serverTimestamp(),
            });
            setSuppliers((prev) => [
              { id: docRef.id, name: newSupplierName.trim(), phone: newSupplierPhone || null },
              ...prev,
            ]);
            setSelectedSupplierId(docRef.id);
            showToast('Fournisseur ajouté et sélectionné', 'success');
            setShowSupplierModal(false);
            setNewSupplierName('');
            setNewSupplierPhone('');
            setIsSubmitting(false);
          } catch (error) {
            console.error('Add supplier error:', error);
            showToast("Erreur lors de l'enregistrement", 'error');
            setIsSubmitting(false);
          }
        },
        onCancel: () => {
          setIsSubmitting(false);
        },
      });
    } catch (error) {
      console.error('Add supplier error:', error);
      setIsSubmitting(false);
    }
  };

  const addItem = (type: 'product' | 'section' | 'note' = 'product') => {
    const newItem: OrderItem = {
      id: crypto.randomUUID(),
      type,
      description: '',
      price: 0,
      quantity: 1,
    };
    setItems([...items, newItem]);
  };

  const updateItem = (id: string, field: keyof OrderItem, value: any) => {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const removeItem = (id: string) => {
    if (items.length === 1) return;
    setItems(items.filter((item) => item.id !== id));
  };

  const downloadMotchoTemplate = () => {
    const templateData = [
      ['Type de Document', '', '', '', 'ACHAT FOURNISSEUR'],
      ['Référence', '', '', '', 'FqUFylwlKXvYcjIY8yNw'],
      ['Statut Paiement', '', '', '', 'Crédit'],
      ['Date d\'émission', '', '', '', '03/06/2026'],
      ['Fournisseur / Partenaire', '', '', '', 'MOTCHO'],
      ['Téléphone Fournisseur', '', '', '', '0600000000'],
      ['Email Fournisseur', '', '', '', 'contact@motcho.com'],
      ['Adresse Fournisseur', '', '', '', 'Guangzhou, Chine'],
      [''],
      ['LIGNES DE FACTURE / ARTICLES'],
      ['Description/Libellé', '', '', '', 'Quantité', 'Prix Unitaire', 'Taxe (%)', 'DIW (DH)', 'Transport (USD)', 'Prix Revient (Total HT (DH))'],
      ['Sac d\'emballage Motcho Premium 50L', '', '', '', 100, 2.50, 0, 0.50, 0.15, 36.23],
      ['Carton d\'expédition renforcé', '', '', '', 500, 0.80, 0, 0.20, 0.05, 11.28],
      ['Pochette de protection étanche', '', '', '', 250, 1.20, 0, 0.30, 0.08, 17.15],
    ];

    const ws = XLSX.utils.aoa_to_sheet(templateData);
    ws['!cols'] = [
      { wch: 35 },
      { wch: 5 },
      { wch: 5 },
      { wch: 5 },
      { wch: 25 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
      { wch: 16 },
      { wch: 28 },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Achat MOTCHO');
    XLSX.writeFile(wb, 'modele_achat_motcho.xlsx');
    showToast('Le modèle Excel MOTCHO a été téléchargé !', 'success');
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
    XLSX.utils.book_append_sheet(wb, ws, 'Achat Standard');
    XLSX.writeFile(wb, 'modele_achat_standard.xlsx');
    showToast('Le modèle Excel Standard a été téléchargé !', 'success');
  };

  const fillMotchoSampleText = () => {
    const sample = [
      'Type de Document\t\t\t\tACHAT FOURNISSEUR',
      'Référence\t\t\t\tFqUFylwlKXvYcjIY8yNw',
      'Statut Paiement\t\t\t\tCrédit',
      'Date d\'émission\t\t\t\t03/06/2026',
      'Fournisseur / Partenaire\t\t\t\tMOTCHO',
      'Téléphone Fournisseur\t\t\t\t0600000000',
      'Email Fournisseur\t\t\t\tcontact@motcho.com',
      'Adresse Fournisseur\t\t\t\tGuangzhou, Chine',
      '',
      'LIGNES DE FACTURE / ARTICLES',
      'Description/Libellé\t\t\t\tQuantité\tPrix Unitaire\tTaxe (%)\tDIW (DH)\tTransport (USD)\tPrix Revient (Total HT (DH))',
      'Sac d\'emballage Motcho Premium 50L\t\t\t\t100\t2.50\t0\t0.50\t0.15\t36.23',
      'Carton d\'expédition renforcé\t\t\t\t500\t0.80\t0\t0.20\t0.05\t11.28',
      'Pochette de protection étanche\t\t\t\t250\t1.20\t0\t0.30\t0.08\t17.15',
    ].join('\n');

    setPasteContent(sample);
    showToast('Exemple MOTCHO chargé dans la zone de texte !', 'info');
  };

  const handlePasteExcel = () => {
    if (!pasteContent.trim()) return;

    const lines = pasteContent.trim().split('\n');
    const rate = parseFloat(exchangeRate) || 0;

    let parsedRefId = '';
    let parsedDate = '';
    let parsedSupplierName = '';
    let isFullInvoiceFormat = false;
    let itemsStartIndex = 0;
    let headersRow: string[] = [];

    // Scan for headers & invoice metadata
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split('\t');
      const header = (parts[0] || '').trim().toLowerCase();
      const valuePart = (parts.slice(1).find((p) => p.trim()) || '').trim();

      if (header.includes('référence') || header.includes('reference')) {
        if (valuePart) parsedRefId = valuePart;
        isFullInvoiceFormat = true;
      } else if (
        header.includes("date d'émission") ||
        header.includes("date d'emission") ||
        header.includes('date')
      ) {
        if (valuePart) {
          const dParts = valuePart.split(/[\/\-]/);
          if (dParts.length === 3) {
            if (dParts[0].length === 2 && dParts[2].length === 4) {
              parsedDate = `${dParts[2]}-${dParts[1]}-${dParts[0]}`;
            } else if (dParts[0].length === 4) {
              parsedDate = `${dParts[0]}-${dParts[1]}-${dParts[2]}`;
            }
          }
        }
        isFullInvoiceFormat = true;
      } else if (header.includes('fournisseur') || header.includes('partenaire')) {
        if (valuePart) {
          parsedSupplierName = valuePart;
          isFullInvoiceFormat = true;
        }
      } else if (
        header.includes('lignes de facture') ||
        header.includes('description/libellé') ||
        header.includes('description / libellé') ||
        header.includes('description') ||
        header.includes('désignation') ||
        header.includes('designation')
      ) {
        isFullInvoiceFormat = true;
        itemsStartIndex = i + 1;

        if (header.includes('description') || header.includes('désignation')) {
          headersRow = parts;
          itemsStartIndex = i + 1;
        } else {
          for (let j = 1; j <= 3; j++) {
            if (lines[i + j]) {
              const nextParts = lines[i + j].split('\t');
              const nextFirst = (nextParts[0] || '').toLowerCase();
              if (
                nextFirst.includes('description') ||
                nextFirst.includes('libellé') ||
                nextFirst.includes('désignation')
              ) {
                headersRow = nextParts;
                itemsStartIndex = i + j + 1;
                break;
              }
            }
          }
        }
        break;
      }
    }

    // Fallback search for table header if metadata wasn't detected
    if (!isFullInvoiceFormat || headersRow.length === 0) {
      for (let i = 0; i < Math.min(15, lines.length); i++) {
        const parts = lines[i].split('\t');
        const first = (parts[0] || '').toLowerCase();
        if (
          first.includes('description') ||
          first.includes('libellé') ||
          first.includes('désignation')
        ) {
          headersRow = parts;
          itemsStartIndex = i + 1;
          break;
        }
      }
    }

    let actualSupplierId = selectedSupplierId;
    let actualIsMotcho = false;

    if (parsedSupplierName) {
      const matched = suppliers.find(
        (s) =>
          s.name?.toLowerCase().trim() === parsedSupplierName.toLowerCase().trim() ||
          (parsedSupplierName.toUpperCase().includes('MOTCHO') &&
            s.name?.toUpperCase().includes('MOTCHO'))
      );
      if (matched) {
        actualSupplierId = matched.id;
        actualIsMotcho = matched.isInternational || matched.name.toUpperCase().includes('MOTCHO');
      } else if (parsedSupplierName.toUpperCase().includes('MOTCHO')) {
        actualIsMotcho = true;
      }
    }

    if (!actualIsMotcho) {
      const selSup = suppliers.find((s) => s.id === actualSupplierId);
      actualIsMotcho = selSup?.isInternational || selSup?.name.toUpperCase().includes('MOTCHO') || false;
    }

    const itemLines =
      isFullInvoiceFormat || headersRow.length > 0 ? lines.slice(itemsStartIndex) : lines;

    const headersWithIndices = headersRow
      .map((h, index) => ({ header: h.trim().toLowerCase(), index }))
      .filter((item) => item.header !== '');

    const findIdx = (synonyms: string[]) => {
      const match = headersWithIndices.find((item) =>
        synonyms.some((s) => item.header.includes(s))
      );
      return match ? match.index : -1;
    };

    const idxDesc = findIdx(['description', 'libellé', 'libelle', 'désignation']);
    const idxQty = findIdx(['quantité', 'quantite', 'qty', 'qte']);
    const idxPrice = findIdx(['prix unitaire', 'prix', 'pu']);
    const idxTax = findIdx(['taxe', 'tva']);
    const idxDiw = findIdx(['diw']);
    const idxTransport = findIdx(['transport', 'shipping']);

    const newItems: OrderItem[] = itemLines
      .map((line) => {
        const columns = line.split('\t');
        if (!columns[0] || !columns[0].trim()) return null;

        const firstColLower = (columns[0] || '').toLowerCase().trim();
        if (
          firstColLower.includes('résumé') ||
          firstColLower.includes('sous-total') ||
          firstColLower.includes('total')
        ) {
          return null;
        }

        let description = '';
        let quantity = 0;
        let price = 0;
        let taxRate = 20;
        let diw_mad = 0;
        let shipping_usd = 0;

        let hasValidQuantity = false;
        let hasValidPrice = false;

        if (headersRow.length > 0) {
          description = idxDesc >= 0 ? (columns[idxDesc] || '').trim() : columns[0].trim();

          if (idxQty >= 0 && columns[idxQty]) {
            const v = parseInt(columns[idxQty].replace(/[^\d.-]/g, ''));
            if (!isNaN(v) && v !== 0) {
              quantity = v;
              hasValidQuantity = true;
            }
          }
          if (idxPrice >= 0 && columns[idxPrice]) {
            const v = parseFloat(columns[idxPrice].replace(',', '.').replace(/[^\d.-]/g, ''));
            if (!isNaN(v) && v !== 0) {
              price = v;
              hasValidPrice = true;
            }
          }
          if (idxTax >= 0 && columns[idxTax]) {
            const v = parseFloat(columns[idxTax].replace(',', '.').replace(/[^\d.-]/g, ''));
            if (!isNaN(v)) {
              taxRate = v;
            }
          }
          if (idxDiw >= 0 && columns[idxDiw]) {
            const v = parseFloat(columns[idxDiw].replace(',', '.').replace(/[^\d.-]/g, ''));
            if (!isNaN(v)) {
              diw_mad = v;
            }
          }
          if (idxTransport >= 0 && columns[idxTransport]) {
            const v = parseFloat(columns[idxTransport].replace(',', '.').replace(/[^\d.-]/g, ''));
            if (!isNaN(v)) {
              shipping_usd = v;
            }
          }
        } else {
          const nonCols = columns.filter((c) => c.trim() !== '');
          description = (nonCols[0] || '').trim();

          if (nonCols.length >= 3) {
            const cleanQty = nonCols[1].replace(/[^\d.-]/g, '');
            if (cleanQty) {
              const parsedQty = parseInt(cleanQty);
              if (!isNaN(parsedQty) && parsedQty !== 0) {
                quantity = parsedQty;
                hasValidQuantity = true;
              }
            }
            const cleanPrice = nonCols[2].replace(',', '.').replace(/[^\d.-]/g, '');
            if (cleanPrice) {
              const parsedPrice = parseFloat(cleanPrice);
              if (!isNaN(parsedPrice) && parsedPrice !== 0) {
                price = parsedPrice;
                hasValidPrice = true;
              }
            }
            if (nonCols.length >= 4) {
              const cleanTax = nonCols[3].replace(',', '.').replace(/[^\d.-]/g, '');
              if (cleanTax) {
                const parsedTax = parseFloat(cleanTax);
                if (!isNaN(parsedTax)) {
                  taxRate = parsedTax;
                }
              }
            }
            if (actualIsMotcho && nonCols.length >= 6) {
              const cleanDiw = nonCols[4] ? nonCols[4].replace(',', '.').replace(/[^\d.-]/g, '') : '';
              if (cleanDiw) diw_mad = parseFloat(cleanDiw) || 0;
              const cleanTrans = nonCols[5] ? nonCols[5].replace(',', '.').replace(/[^\d.-]/g, '') : '';
              if (cleanTrans) shipping_usd = parseFloat(cleanTrans) || 0;
            }
          } else if (nonCols.length === 2) {
            const valStr = nonCols[1].replace(',', '.').replace(/[^\d.-]/g, '');
            if (valStr) {
              const val = parseFloat(valStr);
              if (!isNaN(val) && val !== 0) {
                if (val > 1000) {
                  price = val;
                  hasValidPrice = true;
                } else {
                  quantity = parseInt(valStr);
                  hasValidQuantity = true;
                }
              }
            }
          }
        }

        let type: 'product' | 'section' | 'note' = 'product';
        if (!hasValidQuantity && !hasValidPrice) {
          type = 'note';
        }

        if (type === 'product' && !hasValidQuantity) {
          quantity = 1;
        }

        let prix_achat_usd = 0;
        let frais_douane_usd = 0;
        let prix_achat_net_unit_mad = 0;

        const isProduct = type === 'product';
        if ((actualIsMotcho || diw_mad > 0 || shipping_usd > 0) && isProduct) {
          prix_achat_usd = price;
          frais_douane_usd = prix_achat_usd * 0.365;

          prix_achat_net_unit_mad =
            (prix_achat_usd + frais_douane_usd + shipping_usd) * rate + diw_mad;
          price = prix_achat_net_unit_mad;
        }

        return {
          id: crypto.randomUUID(),
          type,
          description,
          price: Number(price.toFixed(2)),
          quantity,
          taxRate,
          prix_achat_usd: (actualIsMotcho || prix_achat_usd > 0) ? prix_achat_usd : null,
          frais_douane_usd: (actualIsMotcho || frais_douane_usd > 0) ? Number(frais_douane_usd.toFixed(2)) : null,
          diw_mad: (actualIsMotcho || diw_mad > 0) ? diw_mad : null,
          shipping_usd: (actualIsMotcho || shipping_usd > 0) ? shipping_usd : null,
          prix_achat_net_unit_mad: (actualIsMotcho || prix_achat_net_unit_mad > 0) ? Number(prix_achat_net_unit_mad.toFixed(2)) : null,
        } as OrderItem;
      })
      .filter(Boolean) as OrderItem[];

    if (newItems.length > 0) {
      if (items.length === 1 && !items[0].description && items[0].price === 0) {
        setItems(newItems);
      } else {
        setItems([...items, ...newItems]);
      }

      if (parsedRefId) setRefId(parsedRefId);
      if (parsedDate) setDate(parsedDate);
      if (parsedSupplierName) {
        const matched = suppliers.find(
          (s) =>
            s.name?.toLowerCase().trim() === parsedSupplierName.toLowerCase().trim() ||
            (parsedSupplierName.toUpperCase().includes('MOTCHO') &&
              s.name?.toUpperCase().includes('MOTCHO'))
        );
        if (matched) {
          setSelectedSupplierId(matched.id);
          if (matched.isInternational || matched.name.toUpperCase().includes('MOTCHO')) {
            setIsMotcho(true);
          }
        } else {
          showToast(`Fournisseur '${parsedSupplierName}' sélectionné.`, 'info');
        }
      } else if (actualIsMotcho) {
        setIsMotcho(true);
      }

      if (newItems.some((i) => i.prix_achat_usd && i.prix_achat_usd > 0)) {
        setIsMotcho(true);
      }

      showToast(`Import excel réussi. ${newItems.length} lignes ajoutées.`, 'success');
      setShowPasteModal(false);
      setPasteContent('');
    } else {
      showToast(
        'Format non reconnu. Assurez-vous de copier les colonnes depuis Excel.',
        'error'
      );
    }
  };

  const handleAiExtraction = async () => {
    if (!aiContent.trim()) return;
    setExtracting(true);
    try {
      const data = await backendService.extractItems(aiContent, parseFloat(exchangeRate) || 10);

      if (data.items && Array.isArray(data.items)) {
        const rate = parseFloat(exchangeRate) || 10;
        const newItems: OrderItem[] = data.items.map((item: any, index: number) => {
          const usdVal = item.prix_dollar || 0;
          const markupUsd = item.price_markup_usd || usdVal * 1.365;
          const shipUsdVal = item.ship_usd || 0;
          const diwVal = item.diw_dh || 0;

          const finalPriceMad = (markupUsd + shipUsdVal) * rate + diwVal;

          return {
            id: (Date.now() + index).toString() + Math.random().toString(36).substr(2, 5),
            description: item.designation || 'Article sans nom',
            quantity: item.qte || 1,
            price: Number(finalPriceMad.toFixed(2)),
            prix_achat_usd: usdVal,
            frais_douane_usd: Number((markupUsd - usdVal).toFixed(2)),
            diw_mad: diwVal,
            shipping_usd: shipUsdVal,
            prix_achat_net_unit_mad: Number(finalPriceMad.toFixed(2)),
          };
        });

        if (items.length === 1 && !items[0].description && items[0].price === 0) {
          setItems(newItems);
        } else {
          setItems([...items, ...newItems]);
        }

        if (newItems.some(i => i.prix_achat_usd && i.prix_achat_usd > 0)) {
           setIsMotcho(true);
        }

        showToast(`${newItems.length} articles extraits par l'IA.`, 'success');
        setShowAiModal(false);
        setAiContent('');
      } else {
        showToast('Aucun article trouvé dans le texte.', 'info');
      }
    } catch (error) {
      console.error(error);
      showToast('Erreur lors de l’extraction IA.', 'error');
    } finally {
      setExtracting(false);
    }
  };

  const exportToExcel = () => {
    try {
      const dataToExport = items.map((item) => ({
        Désignation: item.description,
        Quantité: item.quantity,
        'Prix Unitaire (USD)': item.prix_achat_usd || 0,
        'Markup (USD)': item.frais_douane_usd || 0,
        'Transport (USD)': item.shipping_usd || 0,
        'DIW (DH)': item.diw_mad || 0,
        'Prix Revient (DH)': item.prix_achat_net_unit_mad || item.price,
        'Total (DH)': (item.prix_achat_net_unit_mad || item.price) * item.quantity,
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Articles');
      XLSX.writeFile(wb, `Nouvel_Achat_Stock.xlsx`);
      showToast('Export Excel réussi', 'success');
    } catch (error) {
      console.error('Export error:', error);
      showToast('Erreur lors de l export Excel', 'error');
    }
  };

  const subtotal = items.reduce((acc, item) => {
    if (item.type && item.type !== 'product') return acc;
    return acc + item.price * item.quantity;
  }, 0);
  const taxRateGlobal = applyTax ? 20 : 0;
  const taxAmount = subtotal * (taxRateGlobal / 100);
  const total = subtotal + taxAmount;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierId) {
      showToast('Veuillez sélectionner un fournisseur.', 'error');
      return;
    }
    if (items.some((i) => !i.description || ((!i.type || i.type === 'product') && i.price <= 0))) {
      showToast('Veuillez remplir correctement toutes les lignes.', 'error');
      return;
    }

    setLoading(true);

    try {
      const pAmountPaid = paymentStatus === 'paid' ? total : parseFloat(amountPaid) || 0;
      const finalStatus =
        paymentStatus === 'paid' ? 'paid' : pAmountPaid >= total ? 'paid' : 'credit';

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

      const itemsWithTax = items.map((item) => {
        const cleaned = Object.fromEntries(Object.entries(item).filter(([_, v]) => v !== undefined));
        return { ...cleaned, taxRate: taxRateGlobal };
      });

      const totalQteGlobal = items.reduce((a, b) => a + b.quantity, 0);
      const totalShippingUsd = items.reduce((a, b) => a + (b.shipping_usd || 0) * b.quantity, 0);
      const totalDiwMad = items.reduce((a, b) => a + (b.diw_mad || 0) * b.quantity, 0);
      const totalFraisDouaneUsd = items.reduce(
        (a, b) => a + (b.frais_douane_usd || 0) * b.quantity,
        0
      );

      const docRef = await addDoc(collection(db, 'suppliers', selectedSupplierId, 'purchases'), {
        ownerId: user.uid,
        supplierId: selectedSupplierId,
        refId: refId.trim() || null,
        items: itemsWithTax,
        isInternational: isMotcho,
        exchangeRate: isMotcho ? parseFloat(exchangeRate) : null,
        totalShippingUsd: isMotcho ? totalShippingUsd : null,
        totalDiwMad: isMotcho ? totalDiwMad : null,
        totalFraisDouaneUsd: isMotcho ? totalFraisDouaneUsd : null,
        totalQteGlobal,
        description:
          items.length === 1 ? items[0].description : `${items.length} Articles en stock`,
        price: items.length === 1 ? items[0].price : 0,
        quantity: items.reduce((a, b) => a + b.quantity, 0),
        subtotal,
        taxAmount,
        taxRate: taxRateGlobal,
        total,
        amountPaid: pAmountPaid,
        paymentStatus: finalStatus,
        dueDate: finalStatus === 'credit' && dueDate ? new Date(dueDate) : null,
        date: new Date(date + 'T00:00:00'),
        notes:
          notesList
            .map((n) => n.trim())
            .filter(Boolean)
            .join('\n') || null,
        notesList: notesList.map((n) => n.trim()).filter(Boolean),
        attachmentUrl,
        attachmentName,
        createdAt: serverTimestamp(),
      });

      showToast('Achat stock enregistré', 'success');
      navigate(`/supplier-purchase/${selectedSupplierId}/${docRef.id}`);
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, 'suppliers/purchases');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <form id="add-supplier-purchase-form" onSubmit={handleSubmit} className="w-full">
        <main className="flex flex-col lg:flex-row gap-6 items-start py-4">
          {/* Left Side: Live A4 Document Preview & WYSIWYG Items Editor */}
          <div className="flex-1 w-full space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg shadow-xs overflow-hidden w-full relative"
            >
              <div className="p-8 md:p-12 print:p-10 font-sans min-h-[500px] print:min-h-[1123px] flex flex-col relative bg-white dark:bg-[#2b2c40]">
                {/* Header of Purchase Document */}
                <div className="flex justify-between items-start border-b border-[#dbdade]/40 dark:border-[#434460]/40 pb-6 mb-6">
                  <div>
                    <h1 className="text-2xl font-bold text-[#566a7f] dark:text-[#a1acb8] tracking-tight uppercase">
                      ACHAT FOURNISSEUR
                    </h1>
                    <div className="text-[15px] font-medium text-[#696cff] dark:text-[#b1b4ff] mt-1 mb-4 flex items-center gap-2">
                      <span className="text-[#a1acb8] dark:text-[#707194]">#</span>
                      NOUVEAU
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-[13px] text-[#566a7f] dark:text-[#a1acb8] mt-1 space-y-1">
                      <div className="flex justify-end gap-2">
                        <span className="font-semibold">Date d'achat :</span>
                        <span>
                          {date
                            ? new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })
                            : '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Supplier details section */}
                <div className="grid grid-cols-2 gap-8 my-8 text-[13px] text-[#566a7f] dark:text-[#a1acb8] leading-relaxed">
                  <div>
                    <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block mb-2 uppercase tracking-widest">
                      Fournisseur / Distributeur :
                    </span>
                    {selectedSupplierId && suppliers.find((s) => s.id === selectedSupplierId) ? (
                      (() => {
                        const supplier = suppliers.find((s) => s.id === selectedSupplierId)!;
                        return (
                          <>
                            <h2 className="font-bold text-[14px] text-[#566a7f] dark:text-[#dbdade] mb-1 uppercase">
                              {supplier.name}
                            </h2>
                            {supplier.phone && <p>Tél: {supplier.phone}</p>}
                          </>
                        );
                      })()
                    ) : (
                      <div className="border border-dashed border-[#dbdade]/70 rounded-lg p-4 cursor-pointer hover:bg-slate-50 dark:hover:bg-[#2b2c40]/35 transition-all w-max mt-2">
                        <p className="text-xs text-[#a1acb8] italic">
                          Sélectionner un fournisseur depuis le menu à droite...
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block mb-2 uppercase tracking-widest">
                      Règlement
                    </span>
                    <p>
                      <span className="font-semibold">Mode :</span>{' '}
                      {paymentStatus === 'paid' ? 'Comptant' : 'À Crédit'}
                    </p>
                  </div>
                </div>

                {/* Quick Actions Array */}
                <div className="flex justify-between items-center mb-4 print:hidden">
                  <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] block uppercase tracking-widest">
                    Lignes d'articles :
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAiModal(true)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-[#696cff] bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors border border-indigo-100/50"
                    >
                      <Zap size={14} /> Scan par AI
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPasteModal(true)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors border border-slate-200/60"
                    >
                      <ClipboardPaste size={14} /> Coller Excel
                    </button>
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
                        <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] text-right w-28">
                          {isMotcho ? 'P.Achat ($)' : 'P.U (DH)'}
                        </th>
                        {isMotcho && (
                          <>
                            <th className="py-3 px-2 font-bold uppercase tracking-wider text-[11px] text-right w-20 text-[#696cff]">
                              +36.5% ($)
                            </th>
                            <th className="py-3 px-2 font-bold uppercase tracking-wider text-[11px] text-right w-20 text-[#696cff]">
                              DIW (DH)
                            </th>
                            <th className="py-3 px-2 font-bold uppercase tracking-wider text-[11px] text-right w-20 text-[#696cff]">
                              Transp ($)
                            </th>
                          </>
                        )}
                        <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] text-right w-32">
                          {isMotcho ? 'Revient' : 'Total (DH)'}
                        </th>
                        <th className="py-3 px-3 w-12 text-center print:hidden"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f1f0f4] dark:divide-[#434460]/20">
                      {items.map((item, idx) => {
                        if (item.type === 'section') {
                          return (
                            <tr key={(item.id || 'sec') + "_" + idx} className="bg-slate-50/50 dark:bg-slate-800/10">
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
                              <td colSpan={isMotcho ? 7 : 4} className="py-1 px-4 align-middle">
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
                              key={(item.id || 'note') + "_" + idx}
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
                              <td colSpan={isMotcho ? 7 : 4} className="py-1 px-4 align-top">
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
                            key={(item.id || 'prod') + "_" + idx}
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
                                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                                className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none font-semibold text-[#566a7f] dark:text-[#dbdade] text-[13px] resize-none overflow-hidden placeholder:text-slate-300 border-none outline-none leading-relaxed shadow-none"
                                onInput={(e: any) => {
                                  e.target.style.height = 'auto';
                                  e.target.style.height = e.target.scrollHeight + 'px';
                                }}
                              />
                            </td>
                            <td className="py-1 px-4 align-top w-20">
                              <input
                                type="number"
                                min="1"
                                value={item.quantity}
                                onChange={(e) =>
                                  updateItem(item.id, 'quantity', parseInt(e.target.value) || 0)
                                }
                                className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none text-center font-bold text-[#566a7f] dark:text-[#dbdade] text-[13px] border-none outline-none shadow-none"
                              />
                            </td>
                            <td className="py-1 px-4 align-top w-28">
                              <input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={isMotcho ? item.prix_achat_usd || '' : item.price || ''}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 0;
                                  if (isMotcho) {
                                    const rate = parseFloat(exchangeRate) || 0;
                                    const customs = val * 0.365;
                                    const diw = item.diw_mad || 0;
                                    const shipping = item.shipping_usd || 0;
                                    const finalPrice = (val + customs + shipping) * rate + diw;
                                    const updates = {
                                      prix_achat_usd: val,
                                      frais_douane_usd: customs,
                                      prix_achat_net_unit_mad: finalPrice,
                                      price: finalPrice,
                                    };
                                    setItems(
                                      items.map((it) =>
                                        it.id === item.id ? { ...it, ...updates } : it
                                      )
                                    );
                                  } else {
                                    updateItem(item.id, 'price', val);
                                  }
                                }}
                                className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none text-right font-mono font-semibold text-[#566a7f] dark:text-[#dbdade] text-[12px] border-none outline-none shadow-none"
                              />
                            </td>
                            {isMotcho && (
                              <>
                                <td className="py-3 px-2 font-mono text-[11px] text-[#696cff] font-medium align-top pt-3.5 text-right w-20">
                                  {(
                                    (item.prix_achat_usd || 0) + (item.frais_douane_usd || 0)
                                  ).toFixed(2)}
                                </td>
                                <td className="py-1 px-2 align-top w-20">
                                  <input
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={item.diw_mad || ''}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 0;
                                      const rate = parseFloat(exchangeRate) || 0;
                                      const base = item.prix_achat_usd || 0;
                                      const customs = base * 0.365;
                                      const shipping = item.shipping_usd || 0;
                                      const finalPrice = (base + customs + shipping) * rate + val;
                                      const updates = {
                                        diw_mad: val,
                                        frais_douane_usd: customs,
                                        prix_achat_net_unit_mad: finalPrice,
                                        price: finalPrice,
                                      };
                                      setItems(
                                        items.map((it) =>
                                          it.id === item.id ? { ...it, ...updates } : it
                                        )
                                      );
                                    }}
                                    className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none text-right font-mono font-semibold text-[#696cff] border-none shadow-none text-[12px]"
                                  />
                                </td>
                                <td className="py-1 px-2 align-top w-20">
                                  <input
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={item.shipping_usd || ''}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value) || 0;
                                      const rate = parseFloat(exchangeRate) || 0;
                                      const base = item.prix_achat_usd || 0;
                                      const customs = base * 0.365;
                                      const diw = item.diw_mad || 0;
                                      const finalPrice = (base + customs + val) * rate + diw;
                                      const updates = {
                                        shipping_usd: val,
                                        frais_douane_usd: customs,
                                        prix_achat_net_unit_mad: finalPrice,
                                        price: finalPrice,
                                      };
                                      setItems(
                                        items.map((it) =>
                                          it.id === item.id ? { ...it, ...updates } : it
                                        )
                                      );
                                    }}
                                    className="w-full bg-transparent border-0 focus:ring-0 px-0 py-2 focus:outline-none text-right font-mono font-semibold text-[#696cff] border-none shadow-none text-[12px]"
                                  />
                                </td>
                              </>
                            )}
                            <td className="py-3 px-4 font-mono font-bold text-[#566a7f] dark:text-[#dbdade] text-[12px] text-right align-top pt-3.5 w-32">
                              {isMotcho ? (
                                <div className="flex flex-col items-end">
                                  <span>
                                    {(item.prix_achat_net_unit_mad || 0).toLocaleString('fr-FR', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </span>
                                  <span className="text-[10px] text-[#a1acb8] font-normal leading-tight">
                                    T:{' '}
                                    {(
                                      (item.prix_achat_net_unit_mad || 0) * item.quantity
                                    ).toLocaleString('fr-FR', {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })}
                                  </span>
                                </div>
                              ) : (
                                <span>
                                  {((item.price || 0) * item.quantity).toLocaleString('fr-FR', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-2 text-center align-top print:hidden w-12 pt-3">
                              <button
                                type="button"
                                onClick={() => removeItem(item.id)}
                                className="text-[#a1acb8] hover:text-rose-500 transition-colors p-1"
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

                <div className="flex gap-6 p-4 border border-t-0 border-[#dbdade]/70 dark:border-[#434460]/40 rounded-b-lg mb-10 bg-white dark:bg-[#2b2c40] print:hidden">
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

                {/* Footer info: General Conditions and Totals */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-10">
                  {/* Left: Notes & Observations Editor */}
                  <div className="text-[13px] text-[#566a7f] dark:text-[#a1acb8] space-y-4">
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
                              placeholder="Ajouter une observation..."
                              className="flex-1 bg-transparent border-none outline-none focus:ring-0 p-0 text-[12px] italic text-[#566a7f] dark:text-[#a1acb8] resize-none overflow-hidden placeholder:text-[#a1acb8]/50 shadow-none leading-relaxed"
                              onInput={(e: any) => {
                                e.target.style.height = 'auto';
                                e.target.style.height = e.target.scrollHeight + 'px';
                              }}
                            />
                            {notesList.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setNotesList(notesList.filter((_, i) => i !== idx))}
                                className="text-[#a1acb8] hover:text-rose-500 p-1"
                              >
                                <svg
                                  width="12"
                                  height="12"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </svg>
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setNotesList([...notesList, ''])}
                        className="text-[10px] font-bold text-[#696cff] flex items-center gap-1 mt-1.5 uppercase hover:opacity-80 transition-opacity"
                      >
                        + Ajouter ligne
                      </button>
                    </div>
                  </div>

                  {/* Right: Totals Calculation */}
                  <div className="space-y-1 w-full xl:w-[360px] ml-auto">
                    {isMotcho && (
                      <div className="space-y-1 mb-3 pb-3 border-b border-[#dbdade]/70 dark:border-[#434460]/40">
                        <div className="flex justify-between items-center py-1">
                          <span className="font-semibold text-[#566a7f] dark:text-[#a1acb8] text-[13px]">
                            Total DIW
                          </span>
                          <span className="font-mono text-[13px] font-bold text-[#696cff]">
                            {items
                              .reduce((acc, it) => acc + (it.diw_mad || 0) * it.quantity, 0)
                              .toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                            DH
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="font-semibold text-[#566a7f] dark:text-[#a1acb8] text-[13px]">
                            Total Transp ($)
                          </span>
                          <span className="font-mono text-[13px] font-bold text-[#696cff]">
                            {items
                              .reduce((acc, it) => acc + (it.shipping_usd || 0) * it.quantity, 0)
                              .toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                            $
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="flex justify-between items-center py-1.5 px-2">
                      <span className="font-semibold text-[#566a7f] dark:text-[#a1acb8] text-[13px]">
                        Sous-total HT
                      </span>
                      <span className="font-mono text-[13px] text-[#566a7f] dark:text-[#dbdade] font-medium">
                        {subtotal.toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        DH
                      </span>
                    </div>

                    {applyTax && (
                      <div className="flex justify-between items-center py-1.5 px-2 text-[#a1acb8]">
                        <span className="font-semibold text-[13px]">TVA (20%)</span>
                        <span className="font-mono text-[13px]">
                          {taxAmount.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                      </div>
                    )}

                    <div className="flex justify-between items-center py-3 px-4 mt-2 bg-[#f8f7fa] dark:bg-[#232333]/50 rounded-lg border border-[#dbdade]/50 dark:border-[#434460]/20">
                      <span className="font-bold text-[#233446] dark:text-[#dbdade] text-[14px] uppercase tracking-wider">
                        Total TTC
                      </span>
                      <span className="font-mono text-[16px] font-black text-[#696cff]">
                        {total.toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        DH
                      </span>
                    </div>
                  </div>
                </div>

                {/* Empty Flexible Space to push footer down if content is short */}
                <div className="flex-1 min-h-[40px]"></div>
              </div>
            </motion.div>
          </div>

          {/* Right Side: Configuration Sidebar */}
          <div className="w-full lg:w-[340px] shrink-0 space-y-6 print:hidden">
            <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 space-y-5 shadow-xs">
              <h3 className="text-xs font-black text-[#566a7f] dark:text-[#dbdade] uppercase tracking-widest border-b border-[#dbdade]/40 dark:border-[#434460]/40 pb-3 flex items-center gap-2">
                <FileText size={16} className="text-[#696cff]" />
                Paramètres d'Achat
              </h3>

              {/* Import / Coller Excel Action */}
              <div className="pb-3 border-b border-[#dbdade]/40 dark:border-[#434460]/40">
                <button
                  type="button"
                  onClick={() => setShowPasteModal(true)}
                  className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 active:scale-[0.98] dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40 border border-indigo-150 rounded-lg text-xs font-bold text-[#696cff] dark:text-[#b1b4ff] uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer h-9 shadow-xs"
                >
                  <ClipboardPaste size={14} />
                  Importer depuis Excel
                </button>
              </div>

              {/* Fournisseur */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-widest">
                  Fournisseur / Distributeur *
                </label>
                <div className="flex gap-2 items-center">
                  <SearchableSelect
                    options={supplierOptions}
                    value={selectedSupplierId}
                    onChange={setSelectedSupplierId}
                    placeholder="-- Choisir un fournisseur --"
                    searchPlaceholder="Rechercher un fournisseur..."
                    required
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSupplierModal(true)}
                    className="bg-white dark:bg-transparent border border-slate-205 dark:border-[#434460]/50 hover:bg-slate-50 dark:hover:bg-[#34354c] p-2 rounded-lg transition-colors flex items-center justify-center shrink-0 h-[34px] w-[34px]"
                    title="Nouveau Fournisseur"
                  >
                    <UserPlus size={15} className="text-[#566a7f] dark:text-[#dbdade]" />
                  </button>
                </div>
              </div>

              {/* Toggle Format International / MOTCHO */}
              <div className="p-3 bg-indigo-50/60 dark:bg-[#282a42] border border-indigo-100/80 dark:border-indigo-900/40 rounded-lg flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe size={16} className="text-[#696cff] shrink-0" />
                  <div className="min-w-0">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block leading-tight truncate">
                      Format International / MOTCHO
                    </span>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 block leading-tight truncate">
                      USD, Douane (+36.5%), Transport & DIW
                    </span>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0" title="Activer / Désactiver le format international">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={isMotcho}
                    onChange={(e) => setIsMotcho(e.target.checked)}
                  />
                  <div className="w-8 h-4 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#696cff]"></div>
                </label>
              </div>

              {/* Taux de Change */}
              <AnimatePresence>
                {isMotcho && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="space-y-1.5 overflow-hidden"
                  >
                    <label className="text-[11px] font-bold text-[#696cff] uppercase tracking-widest">
                      Taux (USD / MAD) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={exchangeRate}
                      onChange={(e) => setExchangeRate(e.target.value)}
                      className="w-full bg-indigo-50/50 border border-indigo-100/50 focus:ring-2 focus:ring-[#696cff]/20 outline-none font-bold text-[#696cff] text-xs rounded-lg px-2.5 py-1.5 transition-all"
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Date */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-widest">
                  Référence / N° Facture
                </label>
                <input
                  type="text"
                  value={refId}
                  onChange={(e) => setRefId(e.target.value)}
                  placeholder="Ex: BILL/2026/05/0001"
                  className="w-full bg-white dark:bg-[#2b2c40] border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-slate-800 dark:text-[#dbdade] text-xs rounded-lg px-2.5 py-1.5 transition-all mb-3"
                />
                <label className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-widest">
                  Date d'Achat *
                </label>
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-white dark:bg-[#2b2c40] border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-medium text-slate-800 dark:text-[#dbdade] text-xs rounded-lg px-2.5 py-1.5 transition-all cursor-pointer"
                />
              </div>

              {/* Paiement */}
              <div className="space-y-1.5 pt-1">
                <label className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-widest block">
                  Mode de Paiement *
                </label>
                <div className="flex p-[3px] bg-[#f8f7fa] dark:bg-[#232333] rounded-lg border border-[#dbdade]/30 h-9">
                  <button
                    type="button"
                    onClick={() => setPaymentStatus('paid')}
                    className={`flex-1 rounded text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${paymentStatus === 'paid' ? 'bg-white dark:bg-[#2b2c40] text-emerald-600 shadow-sm border border-[#dbdade]/40' : 'text-[#a1acb8] hover:text-[#566a7f]'}`}
                  >
                    Comptant
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentStatus('credit')}
                    className={`flex-1 rounded text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${paymentStatus === 'credit' ? 'bg-white dark:bg-[#2b2c40] text-orange-400 shadow-sm border border-[#dbdade]/40' : 'text-[#a1acb8] hover:text-[#566a7f]'}`}
                  >
                    À Crédit
                  </button>
                </div>
              </div>

              {paymentStatus !== 'paid' && (
                <div className="space-y-1.5 animate-fadeIn">
                  <label className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-widest block">
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
                    placeholder="0.00"
                    className="w-full bg-white dark:bg-[#2b2c40] border border-slate-205 focus:ring-2 focus:ring-[#696cff]/20 focus:border-[#696cff] outline-none font-bold text-[#566a7f] dark:text-[#dbdade] text-xs rounded-lg px-2.5 py-2 transition-all font-mono shadow-none"
                  />
                </div>
              )}

              {/* TVA */}
              <div className="flex items-center pt-2 pb-1">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={applyTax}
                    onChange={(e) => setApplyTax(e.target.checked)}
                  />
                  <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#696cff]"></div>
                  <span className="ms-3 text-xs font-semibold text-[#566a7f] dark:text-[#a1acb8] uppercase tracking-wider">
                    Appliquer TVA (20%)
                  </span>
                </label>
              </div>

              {/* Piece Jointe */}
              <div className="space-y-1.5 pt-2 border-t border-[#dbdade]/40 dark:border-[#434460]/40">
                <label className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-widest block mt-3">
                  Document Joint (Optionnel)
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
                  <div className="flex items-center justify-between p-3 bg-[#f8f7fa] dark:bg-[#232333] border border-[#dbdade]/50 dark:border-[#434460]/40 rounded-lg mt-2">
                    <div className="overflow-hidden flex items-center gap-2">
                      <Paperclip size={14} className="text-[#a1acb8]" />
                      <div>
                        <p className="text-xs font-bold text-[#566a7f] dark:text-[#dbdade] truncate w-40">
                          {attachment.name}
                        </p>
                        <p className="text-[9px] text-[#a1acb8] font-mono">
                          {(attachment.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="p-1.5 text-[#a1acb8] hover:text-rose-500 bg-white dark:bg-[#2b2c40] rounded shadow-sm"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <label
                    htmlFor="attachment-upload"
                    className="flex flex-col items-center justify-center w-full h-16 border-2 border-dashed border-[#dbdade]/60 dark:border-[#434460]/40 mt-2 rounded-lg cursor-pointer hover:bg-slate-50 dark:hover:bg-[#232333]/30 transition-all group"
                  >
                    <div className="flex flex-col items-center gap-1">
                      <Plus
                        size={16}
                        className="text-[#a1acb8] group-hover:text-[#696cff] transition-colors stroke-2"
                      />
                      <p className="text-[10px] text-[#a1acb8] font-bold uppercase tracking-wider group-hover:text-[#696cff] transition-colors">
                        Ajouter un fichier
                      </p>
                    </div>
                  </label>
                )}
              </div>

              {/* Major Submit Button */}
              <div className="pt-4 space-y-3">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 bg-[#696cff] text-white rounded-lg font-bold text-[13px] uppercase tracking-widest hover:bg-[#5f61e6] active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Enregistrement...
                    </>
                  ) : (
                    <>
                      <Check size={18} className="stroke-[2.5]" />
                      Confirmer l'Achat
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className="w-full h-10 border border-[#dbdade]/70 hover:bg-slate-50 dark:border-[#434460]/60 dark:hover:bg-[#232333]/30 text-[#697a8d] dark:text-[#a3a4cc] rounded-lg font-bold text-xs uppercase tracking-widest active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer mt-3"
                >
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </main>
      </form>

      <AnimatePresence>
        {showSupplierModal && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSupplierModal(false)}
              className="absolute inset-0 bg-transparent backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-xl w-full max-w-md p-10 relative z-10 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-blue-600" />
              <button
                onClick={() => setShowSupplierModal(false)}
                className="absolute top-6 right-6 text-slate-600 hover:text-slate-600 p-2"
              >
                <X size={20} />
              </button>

              <h3 className="text-2xl font-bold text-slate-900 font-display mb-1 tracking-tight">
                Ajouter un Fournisseur
              </h3>
              <p className="text-slate-600 text-xs font-bold uppercase tracking-widest mb-8">
                Nouveau partenaire stock
              </p>

              <form onSubmit={handleAddSupplier} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-600 tracking-widest ml-1">
                    Nom complet
                  </label>
                  <input
                    required
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value.toUpperCase())}
                    className="w-full px-5 py-3.5 bg-slate-100 border border-slate-300 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none font-bold text-slate-900 transition-all uppercase"
                    placeholder="EVALUATION S.A."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase text-slate-600 tracking-widest ml-1">
                    Téléphone
                  </label>
                  <input
                    value={newSupplierPhone}
                    onChange={(e) => setNewSupplierPhone(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-100 border border-slate-300 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none font-bold text-slate-900 transition-all"
                    placeholder="06 XX XX XX XX"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-blue-600 text-white font-bold uppercase tracking-widest text-xs py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 active:scale-95 disabled:opacity-50 mt-4"
                >
                  {isSubmitting ? 'Création...' : 'Valider & Sélectionner'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPasteModal && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowPasteModal(false)}
              className="absolute inset-0 bg-transparent backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-xl w-full max-w-2xl p-10 relative z-10 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-blue-600" />
              <button
                onClick={() => setShowPasteModal(false)}
                className="absolute top-6 right-6 text-slate-600 hover:text-slate-600 p-2"
              >
                <X size={20} />
              </button>

              <h3 className="text-2xl font-bold text-slate-900 font-display mb-1 tracking-tight">
                Coller depuis Excel
              </h3>
              <p className="text-slate-600 text-xs font-bold uppercase tracking-widest mb-4">
                Copiez vos colonnes ou votre tableau Excel complet (Format Standard ou MOTCHO Chine)
              </p>

              {/* Modèles Excel à télécharger / Exemple */}
              <div className="bg-slate-50 border border-slate-200/80 p-3.5 rounded-xl mb-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                    <Download size={14} className="text-[#696cff]" />
                    Modèles Excel disponibles
                  </span>
                  <span className="text-[11px] text-slate-500 italic">
                    Modèle MOTCHO complet inclus
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={downloadMotchoTemplate}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                  >
                    <Download size={13} />
                    Modèle MOTCHO (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={fillMotchoSampleText}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#696cff] hover:bg-[#5b5eeb] text-white rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95"
                  >
                    <ClipboardPaste size={13} />
                    Remplir avec l'exemple MOTCHO
                  </button>
                  <button
                    type="button"
                    onClick={downloadStandardTemplate}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-bold transition-all active:scale-95"
                  >
                    <Download size={13} />
                    Modèle Standard (.xlsx)
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <textarea
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    className="w-full h-52 px-4 py-3 bg-slate-100 border border-slate-300 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none font-mono text-xs text-slate-900 transition-all placeholder:text-slate-400"
                    placeholder="Collez ici les lignes d'articles ou la facture Excel complète (MOTCHO ou Standard)..."
                  />
                  <div className="mt-2 bg-transparent">
                    <p className="text-[11px] text-[#696cff] leading-relaxed">
                      💡 <b>Format MOTCHO supporté :</b> Détection automatique de la référence, de la date, du fournisseur MOTCHO, des prix en USD, DIW (DH) et Transport (USD).
                    </p>
                  </div>
                </div>
                <div className="flex gap-4 pt-2">
                  <button
                    onClick={() => setShowPasteModal(false)}
                    className="flex-1 bg-slate-100 text-slate-600 font-bold uppercase tracking-widest text-xs py-3.5 rounded-2xl hover:bg-slate-200 transition-all active:scale-95"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handlePasteExcel}
                    className="flex-2 bg-slate-900 text-white font-bold uppercase tracking-widest text-xs py-3.5 rounded-2xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 active:scale-95 flex items-center justify-center gap-2"
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

      <AnimatePresence>
        {showAiModal && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !extracting && setShowAiModal(false)}
              className="absolute inset-0 bg-transparent backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-xl w-full max-w-2xl p-10 relative z-10 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-blue-600" />
              <button
                onClick={() => setShowAiModal(false)}
                disabled={extracting}
                className="absolute top-6 right-6 text-slate-600 hover:text-slate-600 p-2 disabled:opacity-50"
              >
                <X size={20} />
              </button>

              <h3 className="text-2xl font-bold text-slate-900 font-display mb-1 tracking-tight uppercase">
                AI SCAN - MOTCHO MATRIX
              </h3>
              <p className="text-slate-600 text-xs font-bold uppercase tracking-widest mb-6 italic">
                Extraction intelligente suivant la logique Excel Motcho
              </p>

              <div className="space-y-6">
                <div className="space-y-4">
                  <textarea
                    value={aiContent}
                    onChange={(e) => setAiContent(e.target.value)}
                    disabled={extracting}
                    className="w-full h-80 px-5 py-4 bg-slate-100 border border-slate-300 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none font-medium text-sm text-slate-900 transition-all placeholder:text-slate-300 resize-none font-mono"
                    placeholder="Coller ici les données de votre facture..."
                  />
                  <div className="bg-transparent dark:bg-transparent dark:bg-transparent">
                    <p className="text-xs text-[#696cff] dark:text-[#b1b4ff] font-bold uppercase tracking-widest mb-1 italic">
                      Logique Equation :
                    </p>
                    <p className="text-[10px] text-[#696cff] dark:text-[#b1b4ff] leading-relaxed font-semibold">
                      P.Revient = ((Prix$ * Markup%) + Transp$) * Taux + DIW(DH)
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setShowAiModal(false)}
                    disabled={extracting}
                    className="flex-1 bg-slate-100 text-slate-600 font-bold uppercase tracking-widest text-xs py-4 rounded-2xl hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleAiExtraction}
                    disabled={extracting || !aiContent.trim()}
                    className="flex-2 bg-blue-600 text-white font-bold uppercase tracking-widest text-xs py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {extracting ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        Extraction en cours...
                      </>
                    ) : (
                      <>
                        <Zap size={16} fill="currentColor" />
                        Lancer l'Extraction
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAiModal && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !extracting && setShowAiModal(false)}
              className="absolute inset-0 bg-transparent backdrop-blur-md"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-xl w-full max-w-2xl p-10 relative z-10 shadow-2xl overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-blue-600" />
              <button
                onClick={() => setShowAiModal(false)}
                disabled={extracting}
                className="absolute top-6 right-6 text-slate-600 hover:text-slate-600 p-2 disabled:opacity-50"
              >
                <X size={20} />
              </button>

              <h3 className="text-2xl font-bold text-slate-900 font-display mb-1 tracking-tight uppercase">
                AI SCAN - MOTCHO MATRIX
              </h3>
              <p className="text-slate-600 text-xs font-bold uppercase tracking-widest mb-6 italic">
                Extraction intelligente suivant la logique Excel Motcho
              </p>

              <div className="space-y-6">
                <div className="space-y-4">
                  <textarea
                    value={aiContent}
                    onChange={(e) => setAiContent(e.target.value)}
                    disabled={extracting}
                    className="w-full h-80 px-5 py-4 bg-slate-100 border border-slate-300 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none font-medium text-sm text-slate-900 transition-all placeholder:text-slate-300 resize-none font-mono"
                    placeholder="Coller ici les données de votre facture..."
                  />
                  <div className="bg-transparent dark:bg-transparent dark:bg-transparent">
                    <p className="text-xs text-[#696cff] dark:text-[#b1b4ff] font-bold uppercase tracking-widest mb-1 italic">
                      Logique Equation :
                    </p>
                    <p className="text-[10px] text-[#696cff] dark:text-[#b1b4ff] leading-relaxed font-semibold">
                      P.Revient = ((Prix$ * Markup%) + Transp$) * Taux + DIW(DH)
                    </p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setShowAiModal(false)}
                    disabled={extracting}
                    className="flex-1 bg-slate-100 text-slate-600 font-bold uppercase tracking-widest text-xs py-4 rounded-2xl hover:bg-slate-200 transition-all active:scale-95 disabled:opacity-50"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleAiExtraction}
                    disabled={extracting || !aiContent.trim()}
                    className="flex-2 bg-blue-600 text-white font-bold uppercase tracking-widest text-xs py-4 rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {extracting ? (
                      <>
                        <div className="w-3 h-3 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                        Extraction en cours...
                      </>
                    ) : (
                      <>
                        <Zap size={16} fill="currentColor" />
                        Lancer l'Extraction
                      </>
                    )}
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

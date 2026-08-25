import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import {
  collection,
  collectionGroup,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import {
  X,
  Upload,
  Plus,
  Trash2,
  Loader2,
  Check,
  AlertCircle,
  Calendar,
  Sparkles,
  Info,
  FileText,
} from 'lucide-react';

interface PurchasePdfScanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ParsedItem {
  description: string;
  price: number;
  quantity: number;
}

interface ParsingWarning {
  level: 'info' | 'warning' | 'error';
  message: string;
}

interface StandardizedPurchaseJson {
  reference: string;
  date: string;
  supplier: string;
  currency: string;
  totals: {
    subtotal: number;
    vat: number;
    total: number;
  };
  items: ParsedItem[];
  confidence: number;
  warnings: string[];
  attachment?: {
    filename: string;
    mime: string;
    base64: string;
  };
}

interface PdfRow {
  text: string;
  minX: number;
  maxX: number;
  items?: { x: number; text: string }[];
}

// Supplier details extraction helpers
const extractSupplierName = (text: string, rows: PdfRow[]): string => {
  const commonExclusions = [
    /facture/i,
    /devis/i,
    /commande/i,
    /invoice/i,
    /client/i,
    /destinataire/i,
    /date/i,
    /page/i,
    /tel/i,
    /téléphone/i,
    /email/i,
    /e-mail/i,
    /site/i,
    /web/i,
    /ice/i,
    /rc/i,
    /if/i,
    /patente/i,
    /banque/i,
    /rib/i,
    /iban/i,
    /swift/i,
    /adresse/i,
    /somme/i,
    /montant/i,
    /total/i,
    /ttc/i,
    /ht/i,
    /tva/i,
    /bon de/i,
    /livraison/i,
    /réception/i,
    /reception/i,
    /remise/i,
    /acompte/i,
  ];

  const candidates = rows
    .slice(0, 8)
    .map((r) => r.text.trim())
    .filter((line) => {
      if (line.length < 3 || line.length > 50) return false;
      if (commonExclusions.some((regex) => regex.test(line))) return false;
      if (/\d/.test(line) && !/sarl|s\.a\.r\.l|sa\b|s\.a\b/i.test(line)) {
        if (line.replace(/\s/g, '').length > 8 && /\d{8,}/.test(line.replace(/\s/g, '')))
          return false;
      }
      return true;
    });

  if (candidates.length > 0) {
    return candidates[0].toUpperCase();
  }
  return 'NOUVEAU FOURNISSEUR';
};

const extractEmail = (text: string): string | null => {
  const match = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  return match ? match[0] : null;
};

const extractPhone = (text: string): string | null => {
  const cleanText = text.replace(/\s+/g, ' ');
  const phoneRegex =
    /(?:tél|tel|téléphone|phone|gsm|mob|fixe)?\s*[:\.\-]?\s*\b((?:\+212|0)[567]\s*[0-9](?:\s*[\.\-]?\s*[0-9]){7})\b/i;
  const match = cleanText.match(phoneRegex);
  if (match) {
    return match[1].trim();
  }
  const simpleMatch = text.match(/\b((?:\+212|0)[567][0-9]{8})\b/);
  if (simpleMatch) return simpleMatch[1];

  const genericMatch = text.match(/\b((?:\+212|0)\s*[567](?:\s*[0-9]){8})\b/);
  return genericMatch ? genericMatch[1].replace(/\s+/g, '') : null;
};

const extractICE = (text: string): string | null => {
  const cleanText = text.replace(/\s+/g, ' ');
  const iceRegex = /(?:ice|identifiant\s*commun\s*de\s*l['’]entreprise)\s*[:\-\s]*\s*\b(\d{15})\b/i;
  const match = cleanText.match(iceRegex);
  if (match) {
    return match[1];
  }
  const fifteenDigitsMatch = text.match(/\b(\d{15})\b/);
  return fifteenDigitsMatch ? fifteenDigitsMatch[1] : null;
};

const extractAddress = (text: string, rows: PdfRow[]): string | null => {
  const addressKeywords =
    /\b(rue|avenue|av\.|bd\b|boulevard|quartier|q\.\b|zone\s+industrielle|z\.i\b|route|rte|secteur|immeuble|imm\b|résidence|res\b|n°|numéro|no\.|b\.p\b|bp\b)\b/i;
  const cityKeywords =
    /\b(casablanca|rabat|tanger|marrakech|fès|fes|agadir|meknès|meknes|oujda|kénitra|kenitra|nador|tétouan|tetouan|mohammedia|el\s+jadida|safi|témara|temara|salé|sale)\b/i;

  const candidateRows = rows.filter((r) => {
    const txt = r.text.toLowerCase();
    if (
      txt.includes('total') ||
      txt.includes('ttc') ||
      txt.includes('facture') ||
      txt.includes('devis')
    )
      return false;
    return addressKeywords.test(txt) || cityKeywords.test(txt);
  });

  if (candidateRows.length > 0) {
    const premiumCandidate = candidateRows.find((r) => {
      const txt = r.text.toLowerCase();
      return addressKeywords.test(txt) && cityKeywords.test(txt);
    });

    if (premiumCandidate) {
      return premiumCandidate.text.trim();
    }
    return candidateRows[0].text.trim();
  }

  return null;
};

const extractCity = (address: string | null, text: string): string | null => {
  const cityKeywords =
    /\b(casablanca|rabat|tanger|marrakech|fès|fes|agadir|meknès|meknes|oujda|kénitra|kenitra|nador|tétouan|tetouan|mohammedia|el\s+jadida|safi|témara|temara|salé|sale)\b/i;
  if (address) {
    const match = address.match(cityKeywords);
    if (match) {
      return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }
  }
  const generalMatch = text.match(cityKeywords);
  return generalMatch
    ? generalMatch[1].charAt(0).toUpperCase() + generalMatch[1].slice(1).toLowerCase()
    : null;
};

export default function PurchasePdfScanModal({
  isOpen,
  onClose,
  onSuccess,
}: PurchasePdfScanModalProps) {
  const { user } = useAuth();
  const { showToast } = useNotification();

  // Step state: 'upload' | 'validate' | 'loading'
  const [step, setStep] = useState<'upload' | 'loading' | 'validate'>('upload');
  const [loadingText, setLoadingText] = useState('Chargement du moteur de scan...');
  const [isScannedImage, setIsScannedImage] = useState(false);

  // Suppliers list
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');

  // Extracted values state
  const [extractedRef, setExtractedRef] = useState('');
  const [extractedDate, setExtractedDate] = useState('');
  const [extractedTotal, setExtractedTotal] = useState<number>(0);
  const [extractedSubtotal, setExtractedSubtotal] = useState<number>(0);
  const [applyTax, setApplyTax] = useState(false);
  const [taxRate, setTaxRate] = useState<number>(20); // default 20%
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'credit'>('credit');
  const [amountPaid, setAmountPaid] = useState<string>('0');
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [pdfRawText, setPdfRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileBase64, setFileBase64] = useState<string | null>(null);

  // Confidence score & parsing analysis
  const [confidence, setConfidence] = useState<number>(0);
  const [warnings, setWarnings] = useState<ParsingWarning[]>([]);
  const [parsingLogs, setParsingLogs] = useState<string[]>([]);
  const [standardizedJson, setStandardizedJson] = useState<StandardizedPurchaseJson | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [duplicateReason, setDuplicateReason] = useState('');

  // New supplier extracted details
  const [isCreatingNewSupplier, setIsCreatingNewSupplier] = useState(false);
  const [extractedSupplierName, setExtractedSupplierName] = useState('');
  const [extractedSupplierEmail, setExtractedSupplierEmail] = useState('');
  const [extractedSupplierPhone, setExtractedSupplierPhone] = useState('');
  const [extractedSupplierAddress, setExtractedSupplierAddress] = useState('');
  const [extractedSupplierIce, setExtractedSupplierIce] = useState('');
  const [extractedSupplierCity, setExtractedSupplierCity] = useState('');

  // Load suppliers
  useEffect(() => {
    if (!user || !isOpen) return;

    const fetchSuppliers = async () => {
      try {
        const q = query(collection(db, 'suppliers'), where('ownerId', '==', user.uid));
        const snap = await getDocs(q);
        const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setSuppliers(list);
        if (list.length > 0) {
          setSelectedSupplierId(list[0].id);
        }
      } catch (err) {
        console.error('Error loading suppliers:', err);
      }
    };

    fetchSuppliers();
  }, [user, isOpen]);

  // Clean-up states on close
  useEffect(() => {
    if (!isOpen) {
      setStep('upload');
      setItems([]);
      setExtractedRef('');
      setExtractedDate(new Date().toISOString().split('T')[0]);
      setExtractedTotal(0);
      setExtractedSubtotal(0);
      setAmountPaid('0');
      setPaymentStatus('credit');
      setApplyTax(false);
      setIsScannedImage(false);
      setIsCreatingNewSupplier(false);
      setExtractedSupplierName('');
      setExtractedSupplierEmail('');
      setExtractedSupplierPhone('');
      setExtractedSupplierAddress('');
      setExtractedSupplierIce('');
      setExtractedSupplierCity('');
      setPdfRawText('');
      setFileName('');
      setFileBase64(null);
      setConfidence(0);
      setWarnings([]);
      setParsingLogs([]);
      setStandardizedJson(null);
      setIsDuplicate(false);
      setDuplicateReason('');
    }
  }, [isOpen]);

  // Dynamic Loader for PDF.js from CDN
  const loadPdfJs = (): Promise<any> => {
    return new Promise((resolve, reject) => {
      if ((window as any).pdfjsLib) {
        resolve((window as any).pdfjsLib);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
      script.onload = () => {
        const pdfjsLib = (window as any).pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
        resolve(pdfjsLib);
      };
      script.onerror = () => reject(new Error('Impossible de charger le moteur PDF.js'));
      document.head.appendChild(script);
    });
  };

  // Helper to correct common OCR errors in numbers
  const correctOcrErrorsInNumber = (str: string): string => {
    if (!str) return str;
    // We only correct strings that look like potential numbers or short tokens in numeric columns
    // We target classic errors: O -> 0, I -> 1, l -> 1, S -> 5, B -> 8
    // To ensure we don't touch descriptions, this is only used in numeric-parsing contexts.
    let corrected = str;
    if (/^[0-9OolIS|B\.,\-\s%DHmadMAD]+$/i.test(str)) {
      corrected = str
        .replace(/O/g, '0')
        .replace(/o/g, '0')
        .replace(/I/g, '1')
        .replace(/l/g, '1')
        .replace(/\|/g, '1')
        .replace(/S/g, '5')
        .replace(/B/g, '8');
    }
    return corrected;
  };

  // Helper to parse European/Moroccan formatted numbers
  const parseInvoiceNumber = (str: string): number => {
    if (!str) return NaN;

    // Correct OCR errors first
    const correctedStr = correctOcrErrorsInNumber(str);

    // Strip spaces, trailing letters/currencies
    let clean = correctedStr.replace(/\s/g, '').replace(/[^\d\.,\-]/g, '');
    if (!clean) return NaN;

    const dotsCount = (clean.match(/\./g) || []).length;
    const commasCount = (clean.match(/,/g) || []).length;

    if (dotsCount > 1 && commasCount === 0) {
      // Multiple dots, e.g. "1.500.000" -> remove all dots
      clean = clean.replace(/\./g, '');
    } else if (commasCount > 1 && dotsCount === 0) {
      // Multiple commas, e.g. "1,500,000" -> remove all commas
      clean = clean.replace(/,/g, '');
    } else {
      // Standard mix or single separator
      const lastComma = clean.lastIndexOf(',');
      const lastDot = clean.lastIndexOf('.');

      if (lastComma > lastDot) {
        // Comma is decimal, e.g., "1.234,56" or "1234,56"
        clean = clean.replace(/\./g, '').replace(/,/g, '.');
      } else if (lastDot > lastComma) {
        // Dot is decimal, e.g., "1,234.56" or "1234.56"
        clean = clean.replace(/,/g, '');
      } else {
        // Either only comma, only dot, or none
        clean = clean.replace(/,/g, '.');
      }
    }

    const result = parseFloat(clean);
    return result;
  };

  // Helper to parse dates from string
  const extractDateFromString = (text: string): string => {
    const cleanText = text.replace(/\s+/g, ' ');

    // 1. User's specific date pattern
    const dateRegex =
      /(?:date\s*(?:de\s*la\s*facture|facture|du)?|le)\s*[:\-\s]*\s*([0-9]{2}[/-][0-9]{2}[/-][0-9]{4}|[0-9]{4}[/-][0-9]{2}[/-][0-9]{2})/i;
    const dateMatch = cleanText.match(dateRegex);

    // 2. Fallback to generic date format DD/MM/YYYY
    const genericDateRegex = /\b([0-9]{2}[/-][0-9]{2}[/-][0-9]{4})\b/;
    const genericDateMatch = cleanText.match(genericDateRegex);

    let rawDate = '';
    if (dateMatch) {
      rawDate = dateMatch[1];
    } else if (genericDateMatch) {
      rawDate = genericDateMatch[1];
    }

    if (rawDate) {
      // Convert to YYYY-MM-DD
      const dMatch = rawDate.match(/(\d{2})[/-](\d{2})[/-](\d{4})/);
      if (dMatch) {
        return `${dMatch[3]}-${dMatch[2]}-${dMatch[1]}`;
      }
      const yMatch = rawDate.match(/(\d{4})[/-](\d{2})[/-](\d{2})/);
      if (yMatch) {
        return `${yMatch[1]}-${yMatch[2]}-${yMatch[3]}`;
      }
    }

    // French written months fallback
    const monthsFr = [
      'janvier',
      'février',
      'mars',
      'avril',
      'mai',
      'juin',
      'juillet',
      'août',
      'septembre',
      'octobre',
      'novembre',
      'décembre',
      'jan',
      'feb',
      'mar',
      'avr',
      'mai',
      'jun',
      'jul',
      'aou',
      'sep',
      'oct',
      'nov',
      'dec',
    ];
    const monthRegex = new RegExp(
      `(?:le\\s+)?(\\d{1,2})\\s+(${monthsFr.join('|')})\\s+(\\d{4})`,
      'i'
    );
    const monthMatch = text.match(monthRegex);
    if (monthMatch) {
      const day = monthMatch[1].padStart(2, '0');
      const monthStr = monthMatch[2].toLowerCase();
      let monthIndex = monthsFr.findIndex((m) => monthStr.startsWith(m));
      if (monthIndex !== -1) {
        const monthNum = String((monthIndex % 12) + 1).padStart(2, '0');
        const year = monthMatch[3];
        return `${year}-${monthNum}-${day}`;
      }
    }

    return new Date().toISOString().split('T')[0];
  };

  // Helper to extract invoice ref
  const extractRefFromString = (text: string): string => {
    const cleanText = text.replace(/\s+/g, ' ');

    const refRegexes = [
      // Matches "Facture N° : FV-2026-04", "Facture N° FV2026-10", "Facture : FV2026-10", "Réf : FV2026-10", "N°: FV-2026-04"
      /(?:facture|fact|invoice|référence|réf|ref|document|doc|n°|numéro|num|n)\s*(?:n°|numéro|num|ref|réf|:|\.|\s)+\s*([A-Za-z0-9\-_/]{3,30})/i,
      // Matches stand-alone typical Moroccan / corporate invoice reference patterns
      /\b([A-Za-z]{1,4}-\d{4}-\d{3,})\b/i,
      /\b(F\d{5,})\b/i,
      // Fallback for "N° XXXXX" where XXXXX is alphanumeric
      /\bn°\s*[:\-\s]?\s*([A-Za-z0-9\-_/]{3,30})\b/i,
      // Fallback for "N°:XXXXX"
      /\bn°:([A-Za-z0-9\-_/]{3,30})\b/i,
      // General broad reference search
      /(?:facture|ref|réf|n°|num)\s*[:\s\-#]+\s*([A-Za-z0-9\-_/]{3,30})/i,
    ];

    for (const regex of refRegexes) {
      const match = cleanText.match(regex);
      if (match && match[1] && match[1].trim().length > 2) {
        const candidate = match[1].trim();
        // Check exclusions (ensure it's not a common invoice label or total/date indicator)
        if (
          !/^(devis|client|date|total|ht|ttc|tva|ice|rc|if|patente|page|tel|email|rib|iban|somme|bon|livraison|reception|téléphone)$/i.test(
            candidate
          )
        ) {
          // Exclude dates (e.g. DD/MM/YYYY or YYYY-MM-DD)
          if (
            !/^\d{2}[/-]\d{2}[/-]\d{4}$/.test(candidate) &&
            !/^\d{4}[/-]\d{2}[/-]\d{2}$/.test(candidate)
          ) {
            return candidate.toUpperCase();
          }
        }
      }
    }
    return '';
  };

  // Helper to parse amounts
  const extractTotalAmount = (
    text: string
  ): { total: number; subtotal: number; hasTva: boolean } => {
    const cleanText = text.replace(/\s+/g, ' ');
    let total = 0;
    let subtotal = 0;
    let hasTva = false;

    // 1. User's specific Total TTC pattern
    const totalRegex =
      /(?:total\s*(?:ttc|ttc|net\s*à\s*payer|a\s*payer|facturé)|net\s*a\s*payer)\s*[:\-\s]*\s*([0-9\s,.]+\.[0-9]{2}|[0-9\s.,]+)/i;
    const totalMatch = cleanText.match(totalRegex);
    if (totalMatch) {
      const rawAmount = totalMatch[1].trim();
      const val = parseInvoiceNumber(rawAmount);
      if (!isNaN(val)) {
        total = val;
      }
    }

    // 2. Existing multi-keyword line-by-line fallback
    const lines = text.split('\n');
    const totalKeywords =
      /(?:total\s*ttc|net\s*à\s*payer|net\s*payer|montant\s*ttc|ttc|total\s*due|net\s*to\s*pay|total\s*mad|total\s*dh)/i;
    const htKeywords = /(?:total\s*ht|montant\s*ht|total\s*hors|ht|hors\s*taxe)/i;
    const tvaKeywords = /(?:tva|taxe|t\.v\.a)/i;

    for (const line of lines) {
      const lower = line.toLowerCase();
      if (totalKeywords.test(lower)) {
        const words = line.split(/\s+/);
        for (const word of words) {
          const val = parseInvoiceNumber(word);
          if (!isNaN(val) && val > total) {
            total = val;
          }
        }
      }
      if (htKeywords.test(lower)) {
        const words = line.split(/\s+/);
        for (const word of words) {
          const val = parseInvoiceNumber(word);
          if (!isNaN(val) && val > subtotal) {
            subtotal = val;
          }
        }
      }
      if (tvaKeywords.test(lower)) {
        hasTva = true;
      }
    }

    if (total === 0 && subtotal > 0) {
      total = subtotal * (hasTva ? 1.2 : 1.0);
    }
    if (subtotal === 0 && total > 0) {
      subtotal = hasTva ? total / 1.2 : total;
    }

    return { total, subtotal, hasTva };
  };

  // Check if a line is a non-product line to exclude (headers, footers, bank details, totals)
  const isExcludedLine = (line: string): boolean => {
    const lower = line.toLowerCase().trim();

    // 1. Check for standard terms, conditions, late penalties, payment terms, or legal clauses
    const conditionsAndTerms = [
      'condition',
      'pénalité',
      'penalite',
      'retard',
      'règlement',
      'reglement',
      'loi n',
      'tribunal',
      'litige',
      'conflit',
      'compétent',
      'competent',
      'propriété',
      'propriete',
      'paiement',
      'échéance',
      'echeance',
      'échoir',
      'virement',
      'chèque',
      'cheque',
      'traite',
      'effet',
      'bancaire',
      'cachet',
      'signature',
      'confiance',
      'remercie',
      'merci',
      'délais',
      'delais',
      'facturation',
      'capital social',
      'siège social',
      'siege social',
      'rcs',
      'tva non applicable',
      'exoneration',
      'exonéré',
      'indemnité',
      'recouvrement',
      'veuillez',
      'agréer',
      'disposition',
      'collaboration',
      'nous vous',
      'notre part',
      'sauf erreur',
      'bon pour',
      'lu et approuvé',
      'lu et approuve',
      'conditions générales',
      'conditions generales',
      'générales de vente',
      'generales de vente',
      'cgv',
    ];

    if (conditionsAndTerms.some((term) => lower.includes(term))) {
      return true;
    }

    // Header patterns
    if (
      /^(facture|devis|commande|invoice|n°|numéro|reference|réf|ref|date|page|client|fournisseur|destinataire|adresse|téléphone|tel|email|site|web|ice|rc|if|patente)\s*:/i.test(
        lower
      )
    ) {
      return true;
    }

    // Company registration and bank info
    if (
      /\b(ice|rc|if|patente|cnss|banque|rib|iban|swift|capital|s\.a\.r\.l|sarl|sa|siege\s+social|siège\s+social|rcs)\b/i.test(
        lower
      )
    ) {
      return true;
    }

    // Summary/Total rows
    if (
      /^(total|net|tva|remise|escompte|acompte|solde|taxe|timbre|frais\s+de\s+timbre)\b/i.test(
        lower
      )
    ) {
      return true;
    }

    if (
      /\b(total\s+ttc|total\s+ht|montant\s+tva|net\s+a\s+payer|net\s+à\s+payer|net\s+payer|total\s+general|total\s+général)\b/i.test(
        lower
      )
    ) {
      return true;
    }

    // If the line has no digits at all, it can't be a product line item
    if (!/\d/.test(line)) {
      return true;
    }

    return false;
  };

  // Parser: advanced rule-based / regex token suffix extractor (sans IA)
  const parsePdfContent = (
    text: string,
    extractedRows: PdfRow[] = [],
    documentMaxX: number = 0
  ) => {
    setPdfRawText(text);
    const logs: string[] = ['Démarrage du processus de scan déterministe du PDF...'];
    const collectedWarnings: ParsingWarning[] = [];

    const refVal = extractRefFromString(text);
    const dateVal = extractDateFromString(text);
    const { total: totalVal, subtotal: subtotalVal, hasTva } = extractTotalAmount(text);

    const parsedItems: ParsedItem[] = [];

    // Predefined units and currency/tax terms for suffix scanning
    const unitSet = new Set([
      'u',
      'pcs',
      'kg',
      'm',
      'l',
      't',
      'sac',
      'pces',
      'pce',
      'boite',
      'bt',
      'rlx',
      'pot',
      'unite',
      'unité',
      'unites',
      'unités',
    ]);
    const extraTerms = new Set(['dh', 'mad', 'eur', 'usd', 'ht', 'ttc', 'tva']);

    const isNumericOrColToken = (token: string): boolean => {
      const corrected = correctOcrErrorsInNumber(token);
      const clean = corrected
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]/g, '');
      if (unitSet.has(clean) || extraTerms.has(clean)) {
        return true;
      }

      // Strip common units/currencies from token to check if it's a number
      let stripped = corrected.replace(/(dh|mad|eur|€|\%|pcs|u|kg|m|sac|t|ht|ttc)$/i, '').trim();
      // Also remove any dots, commas or minus to check if it's pure digits
      stripped = stripped.replace(/[\.\,\-\s]/g, '');
      return /^\d+$/.test(stripped);
    };

    const rowsToProcess: PdfRow[] =
      extractedRows.length > 0
        ? extractedRows
        : text.split('\n').map((line) => ({ text: line, minX: 0, maxX: 1000 }));

    // 8. Colonnes plus intelligentes: Detect coordinates, columns layout & labels
    let descXLimit = documentMaxX * 0.55; // default fallback
    let qtyColumnX = 0;
    let priceColumnX = 0;
    let totalColumnX = 0;
    let tvaColumnX = 0;
    let columnsDetected = false;

    for (const row of rowsToProcess.slice(0, 15)) {
      if (row.items && row.items.length > 1) {
        let hasDesc = false;
        let hasQty = false;
        let hasPrice = false;
        let hasTotal = false;
        let currentQtyX = 0;
        let currentPriceX = 0;
        let currentTotalX = 0;
        let currentTvaX = 0;
        let currentDescX = 0;

        for (const item of row.items) {
          const lowerTxt = item.text.toLowerCase().trim();
          if (
            /designation|désignation|description|article|libellé|libelle|produit/i.test(lowerTxt)
          ) {
            hasDesc = true;
            currentDescX = item.x;
          } else if (/qte|qté|quantité|quantite|qty/i.test(lowerTxt)) {
            hasQty = true;
            currentQtyX = item.x;
          } else if (/p\.u|pu|prix\s+unitaire|p\.u\s*ht/i.test(lowerTxt)) {
            hasPrice = true;
            currentPriceX = item.x;
          } else if (/total|montant|ttc|total\s*ht/i.test(lowerTxt)) {
            hasTotal = true;
            currentTotalX = item.x;
          } else if (/tva|taux/i.test(lowerTxt)) {
            currentTvaX = item.x;
          }
        }

        if (hasDesc && (hasQty || hasPrice || hasTotal)) {
          descXLimit = currentDescX + documentMaxX * 0.1; // add small margin
          if (currentQtyX > 0) qtyColumnX = currentQtyX;
          if (currentPriceX > 0) priceColumnX = currentPriceX;
          if (currentTotalX > 0) totalColumnX = currentTotalX;
          if (currentTvaX > 0) tvaColumnX = currentTvaX;
          columnsDetected = true;
          logs.push(
            `INFO: Disposition intelligente des colonnes détectée via les en-têtes. Limite Description X: ${descXLimit.toFixed(0)}`
          );
          break;
        }
      }
    }

    if (!columnsDetected) {
      logs.push(
        'INFO: En-têtes de colonnes non détectés, utilisation du seuil par défaut (55% de la largeur du document).'
      );
    }

    const isProductRowCandidate = (row: PdfRow): boolean => {
      if (isExcludedLine(row.text)) {
        return false;
      }
      // If we have documentMaxX and row.items, we can be extremely precise!
      if (documentMaxX > 0 && row.items && row.items.length > 0) {
        const colThreshold = columnsDetected ? descXLimit : documentMaxX * 0.6;
        const numItems = row.items.filter((item) => item.x >= colThreshold);
        // It must have at least one numeric item in the column area to be a product row candidate
        const hasDigitInColumns = numItems.some((item) => /\d/.test(item.text));
        if (numItems.length === 0 || !hasDigitInColumns) {
          return false;
        }
      } else if (documentMaxX > 0 && row.maxX < documentMaxX * 0.7) {
        return false;
      }
      return true;
    };

    const shouldAppendDescription = (row: PdfRow): boolean => {
      if (isExcludedLine(row.text)) {
        return false;
      }
      if (!/[a-zA-Z]/.test(row.text)) {
        return false;
      }
      return true;
    };

    for (const row of rowsToProcess) {
      const trimmed = row.text.trim();
      if (trimmed.length < 5) continue;

      if (!isProductRowCandidate(row)) {
        // Append this line as part of the previous item's description if appropriate
        if (parsedItems.length > 0 && shouldAppendDescription(row)) {
          const lastItem = parsedItems[parsedItems.length - 1];
          if (!lastItem.description.includes(trimmed)) {
            lastItem.description += ' ' + trimmed;
            logs.push(
              `INFO: Description fusionnée: "${trimmed}" ajoutée à "${lastItem.description.slice(0, 20)}..."`
            );
          }
        }
        continue;
      }

      let description = '';
      let colTokens: string[] = [];

      if (documentMaxX > 0 && row.items && row.items.length > 0) {
        const colThreshold = columnsDetected ? descXLimit : documentMaxX * 0.6;
        const descItems = row.items.filter((item) => item.x < colThreshold);
        const numItems = row.items.filter((item) => item.x >= colThreshold);

        description = descItems
          .map((item) => item.text)
          .join(' ')
          .trim();

        if (columnsDetected) {
          numItems.sort((a, b) => a.x - b.x);
          colTokens = numItems.map((item) => item.text);
          logs.push(
            `DEBUG: Ligne "${description}" - Tri des jetons numériques par coordonnées de colonnes.`
          );
        } else {
          colTokens = numItems.map((item) => item.text);
        }
      } else {
        const tokens = trimmed.split(/\s+/);
        if (tokens.length < 2) continue;

        let boundaryIndex = tokens.length;
        let foundNumeric = false;

        for (let i = tokens.length - 1; i >= 0; i--) {
          const token = tokens[i];
          if (isNumericOrColToken(token)) {
            boundaryIndex = i;
            if (/\d/.test(token)) {
              foundNumeric = true;
            }
          } else {
            if (foundNumeric) {
              break;
            }
          }
        }

        if (!foundNumeric) {
          if (parsedItems.length > 0 && shouldAppendDescription(row)) {
            const lastItem = parsedItems[parsedItems.length - 1];
            if (!lastItem.description.includes(trimmed)) {
              lastItem.description += ' ' + trimmed;
              logs.push(
                `INFO: Description fusionnée: "${trimmed}" ajoutée à "${lastItem.description.slice(0, 20)}..."`
              );
            }
          }
          continue;
        }

        const descTokens = tokens.slice(0, boundaryIndex);
        colTokens = tokens.slice(boundaryIndex);
        description = descTokens.join(' ').trim();
      }

      // Clean up description
      description = description.replace(/^[^a-zA-Z0-9\s]+/, '').trim(); // strip leading punctuation
      description = description.replace(/[^a-zA-Z0-9\s)]+$/, '').trim(); // strip trailing punctuation

      if (!description || description.length < 2) {
        if (parsedItems.length > 0 && shouldAppendDescription(row)) {
          const lastItem = parsedItems[parsedItems.length - 1];
          if (!lastItem.description.includes(trimmed)) {
            lastItem.description += ' ' + trimmed;
          }
        }
        continue;
      }

      // Now, parse numbers from the colTokens
      const numbers: number[] = [];
      let lineTaxRate = 20;
      let hasLinePercentage = false;

      for (const colToken of colTokens) {
        // Check if it's a percentage (TVA)
        if (colToken.includes('%')) {
          const pctVal = parseFloat(colToken.replace(/[^\d\.]/g, ''));
          if (!isNaN(pctVal)) {
            lineTaxRate = pctVal;
            hasLinePercentage = true;
          }
          continue;
        }

        const val = parseInvoiceNumber(colToken);
        if (!isNaN(val) && val > 0) {
          numbers.push(val);
        }
      }

      // If we don't have any numbers, skip or treat as description
      if (numbers.length === 0) {
        if (parsedItems.length > 0 && shouldAppendDescription(row)) {
          const lastItem = parsedItems[parsedItems.length - 1];
          if (!lastItem.description.includes(trimmed)) {
            lastItem.description += ' ' + trimmed;
          }
        }
        continue;
      }

      // We scan numbers right-to-left
      // numbers[0] is rightmost (total), numbers[1] is second rightmost (price or qty), etc.
      numbers.reverse();

      let quantity = 1;
      let price = 0;
      let matched = false;

      // Try 3-number multiplication match: Total = Price * Qty
      if (numbers.length >= 3) {
        const v1 = numbers[0]; // Line Total (rightmost)
        const v2 = numbers[1]; // Price or Qty
        const v3 = numbers[2]; // Qty or Price

        // Check if v2 * v3 ≈ v1 (allowing 2% deviation or ±2 delta)
        if (Math.abs(v2 * v3 - v1) < 2.0 || Math.abs((v2 * v3 - v1) / v1) < 0.02) {
          if (Number.isInteger(v3) && !Number.isInteger(v2)) {
            quantity = v3;
            price = v2;
          } else if (Number.isInteger(v2) && !Number.isInteger(v3)) {
            quantity = v2;
            price = v3;
          } else {
            // Default to smaller number as quantity
            quantity = Math.min(v2, v3);
            price = Math.max(v2, v3);
          }
          matched = true;
        } else {
          // Try any pair in the numbers array multiplying to the rightmost one (Total)
          const totalCandidate = numbers[0];
          for (let j = 1; j < numbers.length; j++) {
            for (let k = j + 1; k < numbers.length; k++) {
              const vA = numbers[j];
              const vB = numbers[k];
              if (
                Math.abs(vA * vB - totalCandidate) < 2.0 ||
                Math.abs((vA * vB - totalCandidate) / totalCandidate) < 0.02
              ) {
                if (Number.isInteger(vB) && !Number.isInteger(vA)) {
                  quantity = vB;
                  price = vA;
                } else if (Number.isInteger(vA) && !Number.isInteger(vB)) {
                  quantity = vA;
                  price = vB;
                } else {
                  quantity = Math.min(vA, vB);
                  price = Math.max(vA, vB);
                }
                matched = true;
                break;
              }
            }
            if (matched) break;
          }
        }
      }

      // If no 3-number match, try 2-number fallback
      if (!matched && numbers.length >= 2) {
        const v1 = numbers[0]; // rightmost (usually total or price)
        const v2 = numbers[1]; // second rightmost (usually price or qty)

        // If v1 is significantly larger than v2 and v1 / v2 is close to an integer, it's total and price
        if (v1 > v2 && v2 > 0) {
          const computedQty = Math.round(v1 / v2);
          if (computedQty > 0 && computedQty < 1000 && Math.abs(computedQty * v2 - v1) < 2.0) {
            quantity = computedQty;
            price = v2;
            matched = true;
          }
        }

        if (!matched) {
          // If v2 is a small integer, assume it's quantity
          if (v2 < 500 && Number.isInteger(v2)) {
            quantity = v2;
            price = v1;
          } else {
            quantity = 1;
            price = v1; // default to rightmost
          }
          matched = true;
        }
      }

      // 1-number fallback
      if (!matched && numbers.length === 1) {
        quantity = 1;
        price = numbers[0];
        matched = true;
      }

      if (matched && price > 0 && quantity > 0) {
        parsedItems.push({
          description,
          price,
          quantity,
        });
      }
    }

    // Clean up parsed items description whitespaces
    parsedItems.forEach((item) => {
      item.description = item.description.replace(/\s+/g, ' ').trim();
    });

    // Auto match supplier if supplier name exists in the PDF text
    let matched = false;
    let nameExtracted = '';
    if (suppliers.length > 0) {
      const textLower = text.toLowerCase();
      const matchedSupplier = suppliers.find(
        (s) => s.name && textLower.includes(s.name.toLowerCase())
      );
      if (matchedSupplier) {
        setSelectedSupplierId(matchedSupplier.id);
        setIsCreatingNewSupplier(false);
        matched = true;
        nameExtracted = matchedSupplier.name;
        logs.push(`INFO: Fournisseur identifié automatiquement: "${matchedSupplier.name}"`);
      }
    }

    if (!matched) {
      // If not matched, auto extract details for a new supplier
      nameExtracted = extractSupplierName(text, extractedRows);
      const emailExtracted = extractEmail(text);
      const phoneExtracted = extractPhone(text);
      const addressExtracted = extractAddress(text, extractedRows);
      const iceExtracted = extractICE(text);
      const cityExtracted = extractCity(addressExtracted, text);

      setExtractedSupplierName(nameExtracted);
      setExtractedSupplierEmail(emailExtracted || '');
      setExtractedSupplierPhone(phoneExtracted || '');
      setExtractedSupplierAddress(addressExtracted || '');
      setExtractedSupplierIce(iceExtracted || '');
      setExtractedSupplierCity(cityExtracted || '');

      setSelectedSupplierId('_new_');
      setIsCreatingNewSupplier(true);
      logs.push(`INFO: Nouveau fournisseur détecté: "${nameExtracted}"`);
    } else {
      setExtractedSupplierName('');
      setExtractedSupplierEmail('');
      setExtractedSupplierPhone('');
      setExtractedSupplierAddress('');
      setExtractedSupplierIce('');
      setExtractedSupplierCity('');
    }

    setExtractedRef(refVal);
    setExtractedDate(dateVal);
    setItems(parsedItems);
    setApplyTax(hasTva);
    setTaxRate(20);

    if (totalVal > 0) {
      setExtractedTotal(totalVal);
    } else {
      const calcTotal = parsedItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
      setExtractedTotal(calcTotal);
    }

    if (subtotalVal > 0) {
      setExtractedSubtotal(subtotalVal);
    } else {
      const calcTotal = parsedItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
      setExtractedSubtotal(hasTva ? calcTotal / 1.2 : calcTotal);
    }

    if (parsedItems.length === 0 && text.trim().length < 50) {
      setIsScannedImage(true);
      logs.push('WARNING: Le fichier PDF semble vide ou être une image scannée sans OCR lisible.');
    }

    // --- 1. Confidence Score & Warnings Calculation ---
    let score = 0;

    // Reference: +15
    if (refVal) {
      score += 15;
      logs.push('CONFIDENCE: Référence trouvée (+15)');
    } else {
      collectedWarnings.push({ level: 'warning', message: 'Référence de facture non détectée' });
      logs.push('CONFIDENCE: Référence manquante (+0)');
    }

    // Date: +15
    if (dateVal) {
      score += 15;
      logs.push(`CONFIDENCE: Date trouvée: ${dateVal} (+15)`);
    } else {
      collectedWarnings.push({
        level: 'info',
        message: 'Date non détectée, date courante appliquée par défaut',
      });
      logs.push('CONFIDENCE: Date manquante (+0)');
    }

    // Total: +20
    if (totalVal > 0) {
      score += 20;
      logs.push(`CONFIDENCE: Total TTC trouvé: ${totalVal} DH (+20)`);
    } else {
      collectedWarnings.push({ level: 'warning', message: 'Montant total TTC non détecté' });
      logs.push('CONFIDENCE: Total TTC manquant (+0)');
    }

    // Subtotal: +10
    if (subtotalVal > 0) {
      score += 10;
      logs.push(`CONFIDENCE: Sous-total HT trouvé: ${subtotalVal} DH (+10)`);
    } else {
      collectedWarnings.push({ level: 'info', message: 'Montant sous-total HT non détecté' });
      logs.push('CONFIDENCE: Sous-total HT manquant (+0)');
    }

    // TVA: +10
    if (hasTva) {
      score += 10;
      logs.push('CONFIDENCE: TVA ou taux de TVA détecté (+10)');
    } else {
      collectedWarnings.push({ level: 'info', message: 'TVA non trouvée' });
      logs.push('CONFIDENCE: TVA non détectée (+0)');
    }

    // Product line: +20
    if (parsedItems.length > 0) {
      score += 20;
      logs.push(`CONFIDENCE: ${parsedItems.length} ligne(s) produit détectée(s) (+20)`);
    } else {
      collectedWarnings.push({ level: 'error', message: 'Aucune ligne produit détectée' });
      logs.push('CONFIDENCE: Aucune ligne produit (+0)');
    }

    // Consistent calculations: +10
    let calculationsConsistent = false;
    if (parsedItems.length > 0) {
      const computedSumHT = parsedItems.reduce((acc, item) => acc + item.price * item.quantity, 0);
      const computedSumTTC = computedSumHT * (hasTva ? 1.2 : 1.0);

      const diffTTC = totalVal > 0 ? Math.abs(computedSumTTC - totalVal) : 0;
      const diffHT = subtotalVal > 0 ? Math.abs(computedSumHT - subtotalVal) : 0;

      if ((totalVal > 0 && diffTTC <= 0.05) || (subtotalVal > 0 && diffHT <= 0.05)) {
        calculationsConsistent = true;
      } else if (totalVal === 0 && subtotalVal === 0) {
        calculationsConsistent = true;
      }

      parsedItems.forEach((item) => {
        logs.push(
          `DEBUG: Produit "${item.description}" - ${item.quantity} x ${item.price.toFixed(2)} DH = ${(item.quantity * item.price).toFixed(2)} DH`
        );
      });
    }

    if (calculationsConsistent) {
      score += 10;
      logs.push('CONFIDENCE: Cohérence des calculs validée (+10)');
    } else {
      collectedWarnings.push({
        level: 'warning',
        message:
          'Écart de calcul entre la somme des lignes et les totaux de la facture (> ±0.05 DH)',
      });
      logs.push('CONFIDENCE: Écart de calcul détecté (+0)');
    }

    const finalConfidence = Math.max(0, Math.min(100, score));
    logs.push(`Processus d'analyse terminé. Score de Confiance Final: ${finalConfidence}%`);

    setConfidence(finalConfidence);
    setWarnings(collectedWarnings);
    setParsingLogs(logs);

    // Build Standardized JSON object
    const finalSupplierName = matched ? nameExtracted : nameExtracted || 'Inconnu';
    const stdJson: StandardizedPurchaseJson = {
      reference: refVal || '',
      date: dateVal || '',
      supplier: finalSupplierName,
      currency: 'MAD',
      totals: {
        subtotal:
          subtotalVal || parsedItems.reduce((acc, item) => acc + item.price * item.quantity, 0),
        vat: hasTva
          ? subtotalVal
            ? subtotalVal * 0.2
            : parsedItems.reduce((acc, item) => acc + item.price * item.quantity, 0) * 0.2
          : 0,
        total:
          totalVal ||
          (hasTva
            ? subtotalVal
              ? subtotalVal * 1.2
              : parsedItems.reduce((acc, item) => acc + item.price * item.quantity, 0) * 1.2
            : parsedItems.reduce((acc, item) => acc + item.price * item.quantity, 0)),
      },
      items: parsedItems,
      confidence: finalConfidence,
      warnings: collectedWarnings.map((w) => w.message),
    };

    setStandardizedJson(stdJson);
  };

  // 5. Détection automatique des doublons
  const checkForDuplicates = async (ref: string, dateStr: string, totalTtc: number) => {
    if (!user) return;
    try {
      const q = query(collectionGroup(db, 'purchases'), where('ownerId', '==', user.uid));
      const snap = await getDocs(q);

      const matchedDup = snap.docs.find((doc) => {
        const data = doc.data();

        // Supporter 'refId' (achats fournisseurs) et 'reference' (autres)
        const docRef = (data.refId || data.reference || '').trim().toLowerCase();

        // Convertir le Timestamp Firestore en string YYYY-MM-DD
        let docDateStr = '';
        if (data.date) {
          try {
            const dateObj = data.date.toDate ? data.date.toDate() : new Date(data.date);
            docDateStr = dateObj.toISOString().split('T')[0];
          } catch (e) {
            console.error('Error parsing doc date:', e);
          }
        }

        const docTotal = Number(data.total) || 0;

        const isRefMatch = ref && docRef === ref.trim().toLowerCase();
        const isDateMatch = dateStr && docDateStr === dateStr;
        const isTotalMatch = Math.abs(docTotal - totalTtc) < 0.05; // ±0.05 tolerance

        return isRefMatch && isDateMatch && isTotalMatch;
      });

      if (matchedDup) {
        setIsDuplicate(true);
        setDuplicateReason(
          `Une facture avec la même référence ("${ref}"), la même date (${dateStr}) et le même total TTC (${totalTtc.toFixed(2)} DH) a déjà été enregistrée.`
        );
      } else {
        setIsDuplicate(false);
        setDuplicateReason('');
      }
    } catch (err) {
      console.error('Erreur de détection des doublons:', err);
    }
  };

  // File drop/upload handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      showToast('Veuillez sélectionner un fichier PDF valide.', 'error');
      return;
    }

    setFileName(file.name);

    // Convert to Base64 to attach to purchase later
    const base64Reader = new FileReader();
    base64Reader.onload = () => {
      setFileBase64(base64Reader.result as string);
    };
    base64Reader.readAsDataURL(file);

    setStep('loading');
    setLoadingText('Chargement du moteur de scan...');

    try {
      const pdfjsLib = await loadPdfJs();
      setLoadingText('Extraction du texte du PDF...');

      const fileReader = new FileReader();
      fileReader.onload = async (event) => {
        try {
          const typedArray = new Uint8Array(event.target?.result as ArrayBuffer);
          const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;

          let extractedText = '';
          const extractedRows: PdfRow[] = [];
          let documentMaxX = 0;

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();

            const items = content.items as any[];
            if (items.length === 0) continue;

            // Track maximum X coordinate to determine right margin
            items.forEach((item) => {
              if (item.transform && item.transform[4] > documentMaxX) {
                documentMaxX = item.transform[4];
              }
            });

            // Group text items by approximate Y coordinate (with a small threshold, e.g. 4)
            const rows: { [key: number]: any[] } = {};
            const tolerance = 4; // 4 points is usually less than font height but enough to align line baselines

            items.forEach((item) => {
              if (!item.str || item.str.trim() === '') return;

              // transform[4] is X coordinate, transform[5] is Y coordinate
              const x = item.transform[4];
              const y = item.transform[5];

              // Find if there's a row with a Y coordinate close to this one
              const foundRowYKey = Object.keys(rows).find(
                (ry) => Math.abs(Number(ry) - y) < tolerance
              );
              if (foundRowYKey !== undefined) {
                rows[Number(foundRowYKey)].push({ x, item });
              } else {
                rows[y] = [{ x, item }];
              }
            });

            // Sort rows descending (PDF coordinates: bottom is 0, top is max-height)
            const sortedYKeys = Object.keys(rows)
              .map(Number)
              .sort((a, b) => b - a);

            for (const yKey of sortedYKeys) {
              // Sort items in this row by their X coordinate (left to right)
              const rowItems = rows[yKey].sort((a, b) => a.x - b.x);
              const rowStr = rowItems.map((ri) => ri.item.str).join(' ');

              const minX = Math.min(...rowItems.map((ri) => ri.x));
              const maxX = Math.max(...rowItems.map((ri) => ri.x));

              extractedText += rowStr + '\n';
              extractedRows.push({
                text: rowStr,
                minX,
                maxX,
                items: rowItems.map((ri) => ({ x: ri.x, text: ri.item.str })),
              });
            }
          }

          setLoadingText('Extraction des données...');
          parsePdfContent(extractedText, extractedRows, documentMaxX);

          const refVal = extractRefFromString(extractedText);
          const dateVal = extractDateFromString(extractedText);
          const { total: totalVal } = extractTotalAmount(extractedText);
          await checkForDuplicates(refVal, dateVal, totalVal);

          setIsScannedImage(false);
          setStep('validate');
        } catch (err) {
          console.error('PDF read error:', err);
          showToast("Impossible d'extraire le texte de ce fichier PDF.", 'error');
          setStep('upload');
        }
      };

      fileReader.readAsArrayBuffer(file);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Erreur de chargement du moteur PDF.', 'error');
      setStep('upload');
    }
  };

  const handleAddItem = () => {
    setItems([...items, { description: 'Nouvel Article', price: 0, quantity: 1 }]);
  };

  const handleUpdateItem = (index: number, key: keyof ParsedItem, val: any) => {
    const updated = [...items];
    if (key === 'price') {
      updated[index].price = parseFloat(val) || 0;
    } else if (key === 'quantity') {
      updated[index].quantity = parseInt(val, 10) || 1;
    } else {
      updated[index].description = val;
    }
    setItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  // Calculated values
  const computedSubtotal = items.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const computedTaxAmount = applyTax ? computedSubtotal * (taxRate / 100) : 0;
  const computedTotal = computedSubtotal + computedTaxAmount;

  // Auto-set amountPaid if status is paid
  useEffect(() => {
    if (paymentStatus === 'paid') {
      setAmountPaid(computedTotal.toFixed(2));
    } else {
      setAmountPaid('0');
    }
  }, [paymentStatus, computedTotal]);

  // Submit and save supplier purchase
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreatingNewSupplier) {
      if (!extractedSupplierName.trim()) {
        showToast('Veuillez saisir le nom du nouveau fournisseur', 'error');
        return;
      }
    } else {
      if (!selectedSupplierId) {
        showToast('Veuillez sélectionner un fournisseur', 'error');
        return;
      }
    }
    if (items.length === 0) {
      showToast('Veuillez ajouter au moins un article', 'error');
      return;
    }

    setStep('loading');
    setLoadingText("Enregistrement de l'achat...");

    try {
      let supplierId = selectedSupplierId;

      if (isCreatingNewSupplier) {
        setLoadingText('Création du nouveau fournisseur...');
        const supplierDoc = await addDoc(collection(db, 'suppliers'), {
          ownerId: user?.uid || '',
          name: extractedSupplierName.trim().toUpperCase(),
          phone: extractedSupplierPhone.trim() || null,
          email: extractedSupplierEmail.trim() || null,
          address: extractedSupplierAddress.trim() || null,
          addressLine1: extractedSupplierAddress.trim() || null,
          addressLine2: null,
          city: extractedSupplierCity.trim() || null,
          ice: extractedSupplierIce.trim() || null,
          notes: 'Créé automatiquement depuis scan PDF',
          createdAt: serverTimestamp(),
        });
        supplierId = supplierDoc.id;
      }

      setLoadingText("Enregistrement de l'achat...");

      const finalItems = items.map((item) => ({
        ...item,
        taxRate: applyTax ? taxRate : 0,
      }));

      const totalQteGlobal = items.reduce((a, b) => a + b.quantity, 0);

      // Save to supplier purchases collection
      await addDoc(collection(db, 'suppliers', supplierId, 'purchases'), {
        ownerId: user?.uid || '',
        supplierId: supplierId,
        refId: extractedRef.trim() || null,
        items: finalItems,
        isInternational: false,
        exchangeRate: null,
        totalShippingUsd: null,
        totalDiwMad: null,
        totalFraisDouaneUsd: null,
        totalQteGlobal,
        description:
          items.length === 1 ? items[0].description : `${items.length} Articles en stock`,
        price: items.length === 1 ? items[0].price : 0,
        quantity: totalQteGlobal,
        subtotal: computedSubtotal,
        taxAmount: computedTaxAmount,
        taxRate: applyTax ? taxRate : 0,
        total: computedTotal,
        paymentStatus,
        amountPaid: parseFloat(amountPaid) || 0,
        dueDate: null,
        date: extractedDate ? new Date(extractedDate + 'T00:00:00') : new Date(),
        notes: extractedRef
          ? `Scanné depuis la facture PDF N° ${extractedRef}`
          : 'Scanné depuis PDF',
        notesList: [
          extractedRef ? `Scanné depuis la facture PDF N° ${extractedRef}` : 'Scanné depuis PDF',
        ],
        attachmentUrl: fileBase64,
        attachmentName: fileName,
        confidence,
        warnings: warnings.map((w) => ({ level: w.level, message: w.message })),
        parsingLogs,
        standardizedJson: standardizedJson
          ? {
              ...standardizedJson,
              attachment: {
                filename: fileName || '',
                mime: 'application/pdf',
                base64: fileBase64 || '',
              },
            }
          : null,
        createdAt: serverTimestamp(),
      });

      showToast('Achat fournisseur scanné et créé avec succès !', 'success');
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Save purchase error:', err);
      showToast("Une erreur est survenue lors de la création de l'achat.", 'error');
      setStep('validate');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div
        className={`bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700 w-full transition-all duration-300 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[95vh] ${step === 'validate' ? 'max-w-[96vw] xl:max-w-[1450px]' : 'max-w-2xl'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 text-[#696cff]">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-[16px] font-semibold text-slate-800 dark:text-white leading-tight font-sans">
                Scanner une facture d'Achat Fournisseur
              </h2>
              <p className="text-[12px] text-slate-400 font-sans">
                Extraction déterministe de facture PDF en achat de stock
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition-all cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto p-6 font-sans">
          {/* STEP 1: Upload */}
          {step === 'upload' && (
            <div className="flex flex-col items-center justify-center py-10 px-4 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50/50 dark:bg-slate-900/10 hover:bg-slate-50 dark:hover:bg-slate-900/20 transition-all">
              <Upload className="w-12 h-12 text-[#696cff] mb-4 stroke-[1.5]" />
              <h3 className="text-[15px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Sélectionnez la facture PDF fournisseur
              </h3>
              <p className="text-xs text-slate-400 mb-6 text-center max-w-md">
                Glissez-déposez ou cliquez pour importer votre facture d'achat. L'extraction va
                récupérer le fournisseur, les articles, prix, date et totaux instantanément.
              </p>

              <label className="bg-[#696cff] hover:bg-[#5f61e6] text-white px-5 py-2.5 rounded-lg font-semibold text-sm transition-all cursor-pointer shadow-xs">
                Parcourir les fichiers
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <div className="flex items-center gap-1.5 mt-8 text-[11px] text-slate-400">
                <Info size={13} />
                <span>
                  Le scanner s'exécute localement dans votre navigateur en respectant la
                  confidentialité de vos données.
                </span>
              </div>
            </div>
          )}

          {/* STEP 2: Loading spinner */}
          {step === 'loading' && (
            <div className="flex flex-col items-center justify-center py-16">
              <Loader2 className="w-10 h-10 text-[#696cff] animate-spin mb-4" />
              <h4 className="text-[14px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
                Analyse du document en cours...
              </h4>
              <p className="text-xs text-slate-400">{loadingText}</p>
            </div>
          )}

          {/* STEP 3: Validate and edit fields */}
          {step === 'validate' && (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                {/* LEFT COLUMN: Extracted Raw Text Display */}
                <div className="lg:col-span-4 flex flex-col h-[650px] lg:h-[calc(95vh-180px)] bg-slate-50 dark:bg-[#1f1f2e] border border-slate-200/60 dark:border-slate-800 rounded-xl overflow-hidden lg:sticky lg:top-4">
                  <div className="px-4 py-3 bg-slate-100/80 dark:bg-slate-900/40 border-b border-slate-200/60 dark:border-slate-800 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className="text-[#696cff]" />
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider font-sans">
                        Texte extrait du PDF
                      </span>
                    </div>
                    {fileName && (
                      <span
                        className="text-[10px] bg-white dark:bg-[#232333] px-2 py-0.5 rounded-md border border-slate-200/60 dark:border-slate-800 font-mono text-slate-500 max-w-[150px] truncate"
                        title={fileName}
                      >
                        {fileName}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-2 font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 whitespace-pre-wrap select-text selection:bg-[#696cff]/20">
                    {pdfRawText ? (
                      pdfRawText
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400 italic text-center p-4 font-sans space-y-2">
                        <AlertCircle className="text-slate-300" size={24} />
                        <span>Aucun texte brut extrait du fichier.</span>
                      </div>
                    )}
                  </div>

                  <div className="px-4 py-2 bg-slate-100/50 dark:bg-slate-900/20 border-t border-slate-200/60 dark:border-slate-800 text-[10px] text-slate-400 font-sans">
                    <details className="cursor-pointer group">
                      <summary className="list-none flex items-center justify-between text-slate-500 font-bold hover:text-slate-700 dark:hover:text-slate-200">
                        <span className="flex items-center gap-1">
                          <Sparkles size={11} className="text-[#696cff]" />
                          JOURNAL DE SCAN (DEBUG)
                        </span>
                        <span className="transition-transform group-open:rotate-180">▼</span>
                      </summary>
                      <div className="mt-2 max-h-36 overflow-y-auto space-y-1 font-mono text-[9px] text-slate-500 dark:text-slate-400 border-t border-slate-200/40 dark:border-slate-800 pt-2">
                        {parsingLogs.map((log, i) => (
                          <div key={i} className="truncate" title={log}>
                            {log}
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                </div>
                {/* RIGHT COLUMN: The Interactive validation form */}
                <div className="lg:col-span-8 space-y-6">
                  {isDuplicate && (
                    <div className="p-3.5 bg-rose-50/70 dark:bg-rose-950/20 border border-rose-200/60 rounded-lg text-rose-700 dark:text-rose-300 text-xs flex gap-2.5 shadow-2xs animate-fade-in">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold uppercase tracking-wide">
                          ⚠ Facture déjà importée :
                        </span>{' '}
                        {duplicateReason}
                        <p className="mt-1 text-[11px] text-rose-500">
                          Vous pouvez tout de même continuer si vous souhaitez forcer l'import.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Score de Confiance & Diagnostics d'Extraction (Style Sneat) */}
                  <div className="p-5 bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-800 rounded-xl space-y-4 shadow-2xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800 text-[#696cff]">
                          <Sparkles size={16} />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider font-sans">
                            Rapport d'Extraction Déterministe
                          </h4>
                          <p className="text-[11px] text-slate-400 font-sans">
                            Fiabilité de la numérisation et diagnostics d'analyse
                          </p>
                        </div>
                      </div>

                      {/* Confidence Score Display */}
                      <div className="flex items-center gap-3 font-sans">
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                          Score de Confiance :
                        </span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-500 ${
                                confidence >= 80
                                  ? 'bg-emerald-500'
                                  : confidence >= 50
                                    ? 'bg-amber-500'
                                    : 'bg-rose-500'
                              }`}
                              style={{ width: `${confidence}%` }}
                            />
                          </div>
                          <span
                            className={`font-mono text-sm font-bold ${
                              confidence >= 80
                                ? 'text-emerald-500'
                                : confidence >= 50
                                  ? 'text-amber-500'
                                  : 'text-rose-500'
                            }`}
                          >
                            {confidence}%
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Warnings List (Ghost style, no background colors) */}
                    {warnings.length > 0 && (
                      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block font-sans">
                          Diagnostics de conformité
                        </span>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {warnings.map((warn, i) => (
                            <div
                              key={i}
                              className="flex items-start gap-2 text-xs font-medium font-sans"
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                                  warn.level === 'error'
                                    ? 'bg-rose-500'
                                    : warn.level === 'warning'
                                      ? 'bg-amber-500'
                                      : 'bg-sky-500'
                                }`}
                              />
                              <span
                                className={`${
                                  warn.level === 'error'
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : warn.level === 'warning'
                                      ? 'text-amber-600 dark:text-amber-400'
                                      : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {warn.message}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {isScannedImage && (
                    <div className="p-3.5 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/50 rounded-lg text-amber-700 dark:text-amber-300 text-xs flex gap-2.5">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-semibold">Note d'extraction :</span> Ce fichier PDF
                        semble être une image scannée ou ne contient pas de texte lisible. Nous
                        avons pré-généré les formulaires pour vous permettre de saisir les détails
                        de l'achat manuellement.
                      </div>
                    </div>
                  )}

                  {/* General details grid */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {/* Supplier selection */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-2">
                        Fournisseur *
                      </label>
                      <select
                        value={selectedSupplierId}
                        onChange={(e) => {
                          setSelectedSupplierId(e.target.value);
                          if (e.target.value === '_new_') {
                            setIsCreatingNewSupplier(true);
                          } else {
                            setIsCreatingNewSupplier(false);
                          }
                        }}
                        required
                        className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-[#696cff] transition-all font-sans font-medium"
                      >
                        <option value="" disabled>
                          Sélectionner un fournisseur
                        </option>
                        <option value="_new_">+ Créer un nouveau fournisseur</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-2">
                        Date d'Achat *
                      </label>
                      <div className="relative">
                        <input
                          type="date"
                          value={extractedDate}
                          onChange={(e) => setExtractedDate(e.target.value)}
                          required
                          className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-[#696cff] transition-all"
                        />
                        <Calendar
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                          size={14}
                        />
                      </div>
                    </div>

                    {/* Reference */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-2">
                        Réf Facture Fournisseur
                      </label>
                      <input
                        type="text"
                        value={extractedRef}
                        onChange={(e) => setExtractedRef(e.target.value)}
                        placeholder="Ex: FACT-2026-987"
                        className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-[#696cff] transition-all"
                      />
                    </div>
                  </div>

                  {/* If creating a new supplier, show the extracted metadata form */}
                  {isCreatingNewSupplier && (
                    <div className="p-5 border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/10 rounded-lg space-y-4 animate-fadeIn">
                      <div className="flex items-center gap-2">
                        <div className="p-1 bg-[#696cff]/10 text-[#696cff] rounded-md">
                          <Sparkles size={14} />
                        </div>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide">
                          Nouveau Fournisseur Détecté / Saisie
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Nom */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                            Nom / Raison Sociale *
                          </label>
                          <input
                            type="text"
                            value={extractedSupplierName}
                            onChange={(e) => setExtractedSupplierName(e.target.value.toUpperCase())}
                            required={isCreatingNewSupplier}
                            placeholder="Ex: ABC SUPPLIER"
                            className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-[#696cff] transition-all"
                          />
                        </div>

                        {/* ICE */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                            ICE (15 Chiffres)
                          </label>
                          <input
                            type="text"
                            value={extractedSupplierIce}
                            onChange={(e) => setExtractedSupplierIce(e.target.value)}
                            placeholder="Ex: 001523456000089"
                            className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-[#696cff] transition-all font-mono"
                          />
                        </div>

                        {/* Téléphone */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                            Téléphone
                          </label>
                          <input
                            type="text"
                            value={extractedSupplierPhone}
                            onChange={(e) => setExtractedSupplierPhone(e.target.value)}
                            placeholder="Ex: 0522001122"
                            className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-[#696cff] transition-all font-mono"
                          />
                        </div>

                        {/* Email */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                            Adresse E-mail
                          </label>
                          <input
                            type="email"
                            value={extractedSupplierEmail}
                            onChange={(e) => setExtractedSupplierEmail(e.target.value)}
                            placeholder="Ex: contact@fournisseur.ma"
                            className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-[#696cff] transition-all"
                          />
                        </div>

                        {/* Ville */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                            Ville
                          </label>
                          <input
                            type="text"
                            value={extractedSupplierCity}
                            onChange={(e) => setExtractedSupplierCity(e.target.value)}
                            placeholder="Ex: Casablanca"
                            className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-[#696cff] transition-all"
                          />
                        </div>

                        {/* Adresse */}
                        <div>
                          <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider mb-1.5">
                            Adresse
                          </label>
                          <input
                            type="text"
                            value={extractedSupplierAddress}
                            onChange={(e) => setExtractedSupplierAddress(e.target.value)}
                            placeholder="Ex: Bd d'Anfa, N° 120"
                            className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 outline-none focus:border-[#696cff] transition-all"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Items Section */}
                  <div className="border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden">
                    <div className="bg-slate-50 dark:bg-slate-800/40 px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                      <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                        Articles Extraits ({items.length})
                      </h4>
                      <button
                        type="button"
                        onClick={handleAddItem}
                        className="text-xs text-[#696cff] hover:text-[#5f61e6] font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Plus size={13} />
                        <span>Ajouter une ligne</span>
                      </button>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-slate-100/60 dark:bg-slate-900/20 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800">
                            <th className="px-4 py-2.5">Description</th>
                            <th className="px-4 py-2.5 w-24 text-right">Qté</th>
                            <th className="px-4 py-2.5 w-32 text-right">P.U (DH)</th>
                            <th className="px-4 py-2.5 w-36 text-right">Total (DH)</th>
                            <th className="px-4 py-2.5 w-12 text-center"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                          {items.map((item, index) => (
                            <tr
                              key={index}
                              className="hover:bg-slate-50/40 dark:hover:bg-slate-900/5"
                            >
                              {/* Desc */}
                              <td className="px-4 py-2">
                                <input
                                  type="text"
                                  value={item.description}
                                  onChange={(e) =>
                                    handleUpdateItem(index, 'description', e.target.value)
                                  }
                                  className="w-full bg-transparent border-0 border-b border-transparent focus:border-slate-300 dark:focus:border-slate-600 px-1 py-1 text-slate-700 dark:text-slate-200 outline-none transition-all"
                                />
                              </td>
                              {/* Qty */}
                              <td className="px-4 py-2">
                                <input
                                  type="number"
                                  value={item.quantity}
                                  min="1"
                                  onChange={(e) =>
                                    handleUpdateItem(index, 'quantity', e.target.value)
                                  }
                                  className="w-full bg-transparent border-0 border-b border-transparent focus:border-slate-300 dark:focus:border-slate-600 px-1 py-1 text-right text-slate-700 dark:text-slate-200 outline-none transition-all font-mono font-medium"
                                />
                              </td>
                              {/* Price */}
                              <td className="px-4 py-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={item.price}
                                  onChange={(e) => handleUpdateItem(index, 'price', e.target.value)}
                                  className="w-full bg-transparent border-0 border-b border-transparent focus:border-slate-300 dark:focus:border-slate-600 px-1 py-1 text-right text-slate-700 dark:text-slate-200 outline-none transition-all font-mono font-medium"
                                />
                              </td>
                              {/* Total Line */}
                              <td className="px-4 py-2 text-right font-mono font-bold text-slate-700 dark:text-slate-200">
                                {(item.price * item.quantity).toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </td>
                              {/* Remove */}
                              <td className="px-4 py-2 text-center">
                                <button
                                  type="button"
                                  onClick={() => handleRemoveItem(index)}
                                  className="text-slate-400 hover:text-rose-500 p-1 rounded-lg transition-all cursor-pointer"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}

                          {items.length === 0 && (
                            <tr>
                              <td colSpan={5} className="text-center py-6 text-slate-400 text-xs">
                                Aucun produit extrait. Cliquez sur "Ajouter une ligne" pour
                                commencer à saisir.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Tax & Payment parameters */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Left side: payment settings */}
                    <div className="space-y-4">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 dark:border-slate-800 pb-1.5">
                        Règlement & Trésorerie
                      </h4>

                      {/* Status checkbox group */}
                      <div className="flex gap-4 items-center">
                        <span className="text-xs font-semibold text-slate-500">
                          Statut de paiement :
                        </span>

                        {/* Paid */}
                        <button
                          type="button"
                          onClick={() => setPaymentStatus('paid')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${paymentStatus === 'paid' ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border-emerald-200' : 'bg-transparent border-slate-200 dark:border-slate-700 text-slate-400'}`}
                        >
                          Payé (Régularisé)
                        </button>

                        {/* Credit */}
                        <button
                          type="button"
                          onClick={() => setPaymentStatus('credit')}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${paymentStatus === 'credit' ? 'bg-orange-50 dark:bg-[#4d3122]/20 text-orange-400 border-orange-200' : 'bg-transparent border-slate-200 dark:border-slate-700 text-slate-400'}`}
                        >
                          À Crédit (Créance)
                        </button>
                      </div>

                      {paymentStatus === 'credit' && (
                        <div className="space-y-1.5 animate-fadeIn">
                          <label className="block text-[11px] font-bold text-slate-400 dark:text-slate-300 uppercase tracking-wider">
                            Acompte payé (DH)
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            value={amountPaid}
                            onChange={(e) => setAmountPaid(e.target.value)}
                            className="w-full max-w-xs bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-700 dark:text-slate-200 font-mono"
                          />
                        </div>
                      )}
                    </div>

                    {/* Right side: invoice totals calculation */}
                    <div className="space-y-3 bg-slate-50/50 dark:bg-slate-900/10 p-4 border border-slate-100 dark:border-slate-800 rounded-lg">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest pb-1 border-b border-slate-100 dark:border-slate-800">
                        Calcul des Totaux
                      </h4>

                      {/* Apply Tax Toggle */}
                      <div className="flex items-center justify-between pb-1">
                        <span className="text-xs font-semibold text-slate-500">
                          Appliquer la TVA
                        </span>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={applyTax}
                            onChange={(e) => setApplyTax(e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-9 h-5 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#696cff]"></div>
                        </label>
                      </div>

                      {applyTax && (
                        <div className="flex items-center justify-between py-1 border-b border-slate-100 dark:border-slate-800/60 animate-fadeIn">
                          <span className="text-xs text-slate-400">Taux de TVA (%)</span>
                          <select
                            value={taxRate}
                            onChange={(e) => setTaxRate(Number(e.target.value))}
                            className="bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700 rounded-md px-1.5 py-0.5 text-xs text-slate-700 dark:text-slate-200 outline-none"
                          >
                            <option value={20}>20%</option>
                            <option value={14}>14%</option>
                            <option value={10}>10%</option>
                            <option value={7}>7%</option>
                            <option value={0}>0%</option>
                          </select>
                        </div>
                      )}

                      {/* Calculations breakdown */}
                      <div className="space-y-1.5 text-xs">
                        {/* Subtotal HT */}
                        <div className="flex justify-between text-slate-500">
                          <span>Total HT</span>
                          <span className="font-mono">
                            {computedSubtotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}{' '}
                            DH
                          </span>
                        </div>

                        {/* Tax Amount */}
                        {applyTax && (
                          <div className="flex justify-between text-slate-500">
                            <span>TVA ({taxRate}%)</span>
                            <span className="font-mono">
                              {computedTaxAmount.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                              })}{' '}
                              DH
                            </span>
                          </div>
                        )}

                        {/* Divider */}
                        <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />

                        {/* Total TTC */}
                        <div className="flex justify-between font-bold text-slate-800 dark:text-white text-sm">
                          <span>Total TTC</span>
                          <span className="font-mono text-[#696cff]">
                            {computedTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>{' '}
                {/* End right column */}
              </div>{' '}
              {/* End Grid */}
              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setStep('upload')}
                  className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-semibold transition-all cursor-pointer"
                >
                  Scanner un autre fichier
                </button>
                <button
                  type="submit"
                  className="bg-[#696cff] hover:bg-[#5f61e6] text-white px-5 py-2 h-[40px] rounded-lg font-semibold flex items-center gap-1.5 transition-all text-sm shadow-[0_2px_4px_0_rgba(105,108,255,0.4)] cursor-pointer"
                >
                  <Check size={15} strokeWidth={2.5} />
                  <span>Confirmer & Créer l'Achat</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

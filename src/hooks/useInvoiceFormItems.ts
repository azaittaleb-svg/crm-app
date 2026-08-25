import { useState } from 'react';

export type OrderItemType = 'product' | 'section' | 'note';

export interface OrderItem {
  id: string;
  type?: OrderItemType; // undefined defaults to 'product'
  description: string;
  price: number;
  quantity: number;
  taxRate?: number;
}

export interface PasteExcelOptions {
  clients?: any[];
  onClientDetected?: (clientId: string) => void;
  onDateDetected?: (dateStr: string) => void;
  onApplyTaxDetected?: (applyTax: boolean) => void;
}

export const useInvoiceFormItems = (initialItems?: OrderItem[]) => {
  const [items, setItems] = useState<OrderItem[]>(
    initialItems || [
      { id: '1', type: 'product', description: '', price: 0, quantity: 1, taxRate: 20 },
    ]
  );
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteContent, setPasteContent] = useState('');

  const addItem = (type: OrderItemType = 'product') => {
    const newItem: OrderItem = {
      id: crypto.randomUUID(),
      type,
      description: '',
      price: 0,
      quantity: 1,
      taxRate: 20,
    };
    setItems((prev) => [...prev, newItem]);
  };

  const updateItem = (id: string, field: keyof OrderItem, value: any) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const removeItem = (id: string) => {
    if (items.length === 1) return;
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handlePasteExcel = (
    showToast: (msg: string, type: string) => void,
    options?: PasteExcelOptions
  ) => {
    if (!pasteContent.trim()) return;

    const lines = pasteContent.split('\n').filter((l) => l.trim() !== '');

    let parsedDate = '';
    let parsedClientName = '';
    let parsedRef = '';
    let isFullDocFormat = false;
    let itemsStartIndex = 0;
    let headersRow: string[] = [];

    // Scan for document metadata & headers
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const parts = line.split('\t');
      const header = (parts[0] || '').trim().toLowerCase();
      const valuePart = (parts.slice(1).find((p) => p.trim()) || '').trim();

      if (header.includes('type de document') || header.includes('type document')) {
        isFullDocFormat = true;
      } else if (header.includes('référence') || header.includes('reference')) {
        if (valuePart) parsedRef = valuePart;
        isFullDocFormat = true;
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
              parsedDate = valuePart;
            }
          }
        }
        isFullDocFormat = true;
      } else if (
        header.includes('client / partenaire') ||
        header.includes('client') ||
        header.includes('partenaire') ||
        header.includes('fournisseur')
      ) {
        if (valuePart) {
          parsedClientName = valuePart;
          isFullDocFormat = true;
        }
      } else if (
        header.includes('lignes de facture') ||
        header.includes('description/libellé') ||
        header.includes('description / libellé') ||
        header.includes('description') ||
        header.includes('désignation') ||
        header.includes('designation')
      ) {
        isFullDocFormat = true;
        itemsStartIndex = i + 1;

        if (
          header.includes('description') ||
          header.includes('désignation') ||
          header.includes('libellé')
        ) {
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
      }
    }

    // Fallback searching for table header if metadata wasn't detected
    if (!isFullDocFormat || headersRow.length === 0) {
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

    // Match client if detected
    if (parsedClientName && options?.clients && options?.onClientDetected) {
      const matched = options.clients.find(
        (c) =>
          c.name?.toLowerCase().trim() === parsedClientName.toLowerCase().trim() ||
          c.company?.toLowerCase().trim() === parsedClientName.toLowerCase().trim()
      );
      if (matched) {
        options.onClientDetected(matched.id);
        showToast(`Client '${matched.name || matched.company}' sélectionné.`, 'info');
      } else {
        showToast(`Client '${parsedClientName}' détecté.`, 'info');
      }
    }

    if (parsedDate && options?.onDateDetected) {
      options.onDateDetected(parsedDate);
    }

    const itemLines =
      isFullDocFormat || headersRow.length > 0 ? lines.slice(itemsStartIndex) : lines;

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

    let detectedHasTax = false;

    const newItems: OrderItem[] = itemLines
      .map((line) => {
        const columns = line.split('\t');
        if (!columns[0] || !columns[0].trim()) return null;

        const firstColLower = (columns[0] || '').toLowerCase().trim();
        if (
          firstColLower.includes('résumé') ||
          firstColLower.includes('sous-total') ||
          firstColLower.includes('total') ||
          firstColLower.includes('téléphone') ||
          firstColLower.includes('email') ||
          firstColLower.includes('adresse')
        ) {
          return null;
        }

        let description = '';
        let quantity = 1;
        let price = 0;
        let taxRate = 20;

        let hasValidQuantity = false;
        let hasValidPrice = false;

        if (headersRow.length > 0) {
          description = idxDesc >= 0 ? (columns[idxDesc] || '').trim() : columns[0].trim();

          if (idxQty >= 0 && columns[idxQty]) {
            const v = parseFloat(columns[idxQty].replace(',', '.').replace(/[^\d.-]/g, ''));
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
              if (taxRate > 0) detectedHasTax = true;
            }
          }
        } else {
          // Fallback parsing non-empty columns
          const nonCols = columns.filter((c) => c.trim() !== '');
          description = (nonCols[0] || '').trim();

          if (nonCols.length >= 3) {
            const cleanQty = nonCols[1].replace(',', '.').replace(/[^\d.-]/g, '');
            if (cleanQty) {
              const parsedQty = parseFloat(cleanQty);
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
                  if (taxRate > 0) detectedHasTax = true;
                }
              }
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
                  quantity = val;
                  hasValidQuantity = true;
                }
              }
            }
          }
        }

        const type: OrderItemType = !hasValidQuantity && !hasValidPrice ? 'note' : 'product';

        if (type === 'product' && !hasValidQuantity) {
          quantity = 1;
        }

        return {
          id: crypto.randomUUID(),
          type,
          description,
          quantity,
          price: Number(price.toFixed(2)),
          taxRate,
        };
      })
      .filter((item) => item !== null && item.description !== '') as OrderItem[];

    if (detectedHasTax && options?.onApplyTaxDetected) {
      options.onApplyTaxDetected(true);
    }

    if (newItems.length > 0) {
      setItems((prev) => {
        if (prev.length === 1 && !prev[0].description && prev[0].price === 0) {
          return newItems;
        }
        return [...prev, ...newItems];
      });
      showToast(`${newItems.length} lignes ajoutées avec succès !`, 'success');
      setShowPasteModal(false);
      setPasteContent('');
    } else {
      showToast(
        'Format non reconnu. Assurez-vous de copier les colonnes depuis Excel.',
        'error'
      );
    }
  };

  return {
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
  };
};

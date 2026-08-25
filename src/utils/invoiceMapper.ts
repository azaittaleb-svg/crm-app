import { InvoiceData, InvoiceItem } from '../types';

/**
 * Standard utility to transform Firebase/App internal document format
 * securely into the standard `InvoiceData` payload used by the printing template.
 */
export const mapDocToInvoiceData = (
  doc: any, // The document object from firestore (devis, facture, purchase)
  client: any, // The client object attached to it
  computedRefId?: string // Optional dynamically computed refId
): InvoiceData => {
  // Normalize items array (fallback to legacy fields if needed)
  const items: InvoiceItem[] =
    doc.items && Array.isArray(doc.items)
      ? doc.items.map((it: any) => ({
          id: it.id || Math.random().toString(),
          description: it.description || '',
          quantity: it.quantity || 1,
          unitPrice: it.price || it.unitPrice || 0,
          type: it.type || 'product',
        }))
      : [
          {
            id: 'legacy',
            description: doc.description || '',
            quantity: doc.quantity || 1,
            unitPrice: doc.price || 0,
          },
        ];

  // Construct precise type
  let type: 'DEVIS' | 'FACTURE' | 'COMMANDE' = 'FACTURE';
  if (doc.type) {
    const rawType = doc.type.toLowerCase();
    if (rawType.includes('devis')) type = 'DEVIS';
    else if (rawType.includes('facture')) type = 'FACTURE';
    else type = 'COMMANDE';
  }

  // Ref ID
  const refId = computedRefId || doc.refId || doc.id?.substring(0, 8) || 'N/A';

  // Format Date Safely
  let dateStr = '---';
  if (doc.date?.toDate) {
    dateStr = doc.date
      .toDate()
      .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  } else if (doc.date) {
    dateStr = new Date(doc.date).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  // Validity Date Handling
  let validityStr = '';
  if (type === 'DEVIS') {
    if (doc.dueDate) {
      const d = new Date(doc.dueDate);
      if (!isNaN(d.valueOf())) {
        validityStr = d.toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      } else {
        validityStr = doc.dueDate;
      }
    } else if (doc.validity) {
      validityStr = doc.validity;
    }
  } else {
    // For FACTURE or COMMANDE, only show paymentDate if present from lettrage/reconciliation
    if (doc.paymentDate) {
      let pDate: Date | null = null;
      if (doc.paymentDate.toDate) {
        pDate = doc.paymentDate.toDate();
      } else {
        const d = new Date(doc.paymentDate);
        if (!isNaN(d.valueOf())) {
          pDate = d;
        }
      }
      if (pDate) {
        validityStr = pDate.toLocaleDateString('fr-FR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      }
    }
  }

  // Handle Note Assembly
  let assembledNotes = '';
  if (
    doc.notesList &&
    Array.isArray(doc.notesList) &&
    doc.notesList.some((n: string) => n?.toString().trim() !== '')
  ) {
    assembledNotes = doc.notesList.filter((n: string) => n?.toString().trim() !== '').join('\n');
  } else {
    assembledNotes = doc.notes || '';
  }

  return {
    type,
    number: refId,
    date: dateStr,
    validity: validityStr,
    paymentTerms: doc.conditions_paiement || doc.paymentTerms || 'Paiement à la livraison',
    conditionsPaiement: doc.conditions_paiement || '',
    modeReglement: doc.mode_reglement || '',
    client: {
      name: (client?.name || 'Client Inconnu').toUpperCase(),
      addressLine1: client?.addressLine1 || client?.adresse || '',
      city: client?.city || client?.ville || '',
      phone: client?.phone || client?.telephone || '',
      ice: client?.ice || '',
    },
    items,
    taxRate: (Number(doc.taxRate) || 0) > 1 ? Number(doc.taxRate) / 100 : Number(doc.taxRate) || 0,
    notes: assembledNotes,
    amountPaid:
      doc.amountPaid !== undefined && doc.amountPaid !== null
        ? Number(doc.amountPaid)
        : doc.paidAmount !== undefined && doc.paidAmount !== null
          ? Number(doc.paidAmount)
          : doc.avance !== undefined && doc.avance !== null
            ? Number(doc.avance)
            : doc.acompte !== undefined && doc.acompte !== null
              ? Number(doc.acompte)
              : doc.montantPaye !== undefined && doc.montantPaye !== null
                ? Number(doc.montantPaye)
                : undefined,
    paymentStatus: doc.paymentStatus || doc.status || undefined,
    total: doc.total !== undefined ? Number(doc.total) : undefined,
    subtotal:
      doc.subtotal !== undefined
        ? Number(doc.subtotal)
        : doc.subTotal !== undefined
          ? Number(doc.subTotal)
          : undefined,
  };
};

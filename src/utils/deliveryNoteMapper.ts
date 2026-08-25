import { DeliveryNoteData } from '../components/DeliveryNotePrint';

export const mapDocToDeliveryNoteData = (
  doc: any,
  client: any,
  computedRefId?: string
): DeliveryNoteData => {
  const refId = computedRefId || doc.refId || doc.id?.substring(0, 8) || '00001';

  let shippingDateStr = '';
  if (doc.dateExpedition) {
    const d = new Date(doc.dateExpedition);
    shippingDateStr = !isNaN(d.valueOf()) ? d.toLocaleDateString('fr-FR') : doc.dateExpedition;
  } else if (doc.shippingDate) {
    const d = new Date(doc.shippingDate);
    shippingDateStr = !isNaN(d.valueOf()) ? d.toLocaleDateString('fr-FR') : doc.shippingDate;
  } else if (doc.date?.toDate) {
    shippingDateStr = doc.date.toDate().toLocaleDateString('fr-FR');
  } else if (doc.date) {
    const d = new Date(doc.date);
    shippingDateStr = !isNaN(d.valueOf()) ? d.toLocaleDateString('fr-FR') : doc.date;
  } else {
    shippingDateStr = new Date().toLocaleDateString('fr-FR');
  }

  const items =
    doc.items && Array.isArray(doc.items)
      ? doc.items.map((it: any) => ({
          id: it.id || Math.random().toString(),
          description: it.description || it.name || '',
          quantity: Number(it.quantity) || 1,
          deliveredQuantity:
            it.deliveredQuantity !== undefined ? Number(it.deliveredQuantity) : Number(it.quantity) || 1,
          sn: it.sn || it.serialNumber || it.serialNumbers || undefined,
          type: it.type || 'product',
        }))
      : [
          {
            id: 'legacy',
            description: doc.description || 'Produit',
            quantity: Number(doc.quantity) || 1,
            deliveredQuantity: Number(doc.quantity) || 1,
            sn: doc.sn || undefined,
            type: 'product',
          },
        ];

  const blNum = doc.blNumber || doc.blRef || `WH/OUT/${refId}`;

  return {
    blNumber: blNum,
    internalOrder: doc.refId || refId,
    clientBcNumber: doc.clientBc || doc.bcNumber || doc.referenceBC || `BC-${new Date().getFullYear()}-${refId}`,
    shippingDate: shippingDateStr,
    transportMode: doc.transportMode || doc.modeTransport || 'Livraison Propre (1 Colis)',
    client: {
      name: (client?.name || client?.nom || 'CLIENT').toUpperCase(),
      attn: client?.contactName || client?.attn || client?.contact || undefined,
      phone: client?.phone || client?.telephone || undefined,
      addressLine1: client?.addressLine1 || client?.adresse || client?.address || undefined,
      city: client?.city || client?.ville || 'CASABLANCA',
    },
    items,
  };
};

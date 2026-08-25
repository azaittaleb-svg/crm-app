import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, collectionGroup } from 'firebase/firestore';
import { db } from '../lib/firebase';

export interface PartnerBalance {
  id: string;
  name: string;
  type: 'client' | 'supplier' | 'both';
  receivable: number;
  payable: number;
  phone?: string;
  email?: string;
  linkedPartnerId?: string;
}

export function usePartnersBalance(user: any) {
  const [balances, setBalances] = useState<PartnerBalance[]>([]);
  const [allPurchases, setAllPurchases] = useState<any[]>([]);
  const [allPayments, setAllPayments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    setIsLoading(true);

    const qClients = query(collection(db, 'clients'), where('ownerId', '==', user.uid));
    const qSuppliers = query(collection(db, 'suppliers'), where('ownerId', '==', user.uid));
    const qPurchases = query(collectionGroup(db, 'purchases'), where('ownerId', '==', user.uid));
    const qPayments = query(collectionGroup(db, 'payments'), where('ownerId', '==', user.uid));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let clients: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let suppliers: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let purchases: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let payments: any[] = [];

    const calculate = () => {
      const partnerMap = new Map<string, PartnerBalance>();

      clients.forEach((c) => {
        if (!c.id) return;
        partnerMap.set(c.id, {
          id: c.id,
          name: c.name || 'Client Sans Nom',
          type: 'client',
          receivable: 0,
          payable: 0,
          phone: c.phone || '',
          email: c.email || '',
          linkedPartnerId: c.linkedPartnerId || '',
        });
      });

      suppliers.forEach((s) => {
        if (!s.id) return;
        const linkedClient = clients.find(
          (c) => c.linkedPartnerId === s.id || c.id === s.linkedPartnerId
        );

        if (linkedClient && partnerMap.has(linkedClient.id)) {
          const partner = partnerMap.get(linkedClient.id)!;
          partner.type = 'both';
          partner.linkedPartnerId = s.id;
          if (!partner.phone && s.phone) partner.phone = s.phone;
          if (!partner.email && s.email) partner.email = s.email;
        } else if (!partnerMap.has(s.id)) {
          partnerMap.set(s.id, {
            id: s.id,
            name: s.name || 'Fournisseur Sans Nom',
            type: 'supplier',
            receivable: 0,
            payable: 0,
            phone: s.phone || '',
            email: s.email || '',
            linkedPartnerId: s.linkedPartnerId || '',
          });
        }
      });

      const partnersList = Array.from(partnerMap.values());

      // Helper to calculate total paid amount for a purchase
      const getPurchasePaidAmount = (p: any) => {
        const subcollectionPaid = payments
          .filter((pay) => pay.purchaseId === p.id)
          .reduce((sum, pay) => sum + (Number(pay.amount) || 0), 0);

        let directPaid = 0;
        if (p.amountPaid !== undefined && p.amountPaid !== null) {
          directPaid = Number(p.amountPaid) || 0;
        } else if (p.paymentStatus === 'paid' || p.status === 'Payée' || p.status === 'payée') {
          directPaid = Number(p.total) || 0;
        }

        return Math.max(subcollectionPaid, directPaid);
      };

      purchases
        .filter((p) => p.type !== 'devis' && p.status !== 'Annulée' && p.status !== 'Brouillon')
        .forEach((p) => {
          const total = Number(p.total) || 0;
          const credited = Number(p.creditNotesTotal) || 0;
          const paid = getPurchasePaidAmount(p);
          const due = Math.max(0, total - credited - paid);

          if (p.clientId) {
            const partner = partnerMap.get(p.clientId);
            if (partner) {
              partner.receivable += due;
            }
          } else if (p.supplierId) {
            const partner = partnersList.find(
              (pt) => pt.id === p.supplierId || pt.linkedPartnerId === p.supplierId
            );
            if (partner) {
              partner.payable += due;
            }
          }
        });

      // Deduct unlinked payments (advances without purchaseId)
      payments
        .filter((pay) => !pay.purchaseId)
        .forEach((pay) => {
          if (pay.clientId) {
            const partner = partnerMap.get(pay.clientId);
            if (partner) {
              partner.receivable -= Number(pay.amount) || 0;
            }
          } else if (pay.supplierId) {
            const partner = partnersList.find(
              (pt) => pt.id === pay.supplierId || pt.linkedPartnerId === pay.supplierId
            );
            if (partner) {
              partner.payable -= Number(pay.amount) || 0;
            }
          }
        });

      partnersList.forEach((p) => {
        p.receivable = Math.round(p.receivable * 100) / 100;
        p.payable = Math.round(p.payable * 100) / 100;
      });

      setBalances(partnersList);
      setIsLoading(false);
    };

    const unsubClients = onSnapshot(
      collection(db, 'clients'),
      (snap) => {
        clients = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((c: any) => !c.ownerId || c.ownerId === user.uid);
        calculate();
      },
      (error) => console.warn('Erreur chargement clients balance:', error)
    );

    const unsubSuppliers = onSnapshot(
      collection(db, 'suppliers'),
      (snap) => {
        suppliers = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((s: any) => !s.ownerId || s.ownerId === user.uid);
        calculate();
      },
      (error) => console.warn('Erreur chargement suppliers balance:', error)
    );

    const unsubPurchases = onSnapshot(
      collectionGroup(db, 'purchases'),
      (snap) => {
        purchases = snap.docs
          .map((docSnap) => {
            const dataObj = docSnap.data() as any;
            const pathParts = docSnap.ref.path.split('/').filter(Boolean);
            const clientsIndex = pathParts.indexOf('clients');
            const suppliersIndex = pathParts.indexOf('suppliers');
            const parentId = docSnap.ref.parent?.parent?.id;

            const clientId =
              dataObj.clientId ||
              (clientsIndex !== -1 ? pathParts[clientsIndex + 1] : undefined);
            const supplierId =
              dataObj.supplierId ||
              (suppliersIndex !== -1 ? pathParts[suppliersIndex + 1] : undefined);

            return {
              id: docSnap.id,
              ...dataObj,
              clientId: clientId || (suppliersIndex === -1 ? parentId : undefined),
              supplierId: supplierId || (clientsIndex === -1 ? parentId : undefined),
            };
          })
          .filter((p: any) => !p.ownerId || p.ownerId === user.uid);
        setAllPurchases(purchases);
        calculate();
      },
      (error) => console.warn('Erreur chargement purchases balance:', error)
    );

    const unsubPayments = onSnapshot(
      collectionGroup(db, 'payments'),
      (snap) => {
        payments = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((p: any) => !p.ownerId || p.ownerId === user.uid);
        setAllPayments(payments);
        calculate();
      },
      (error) => console.warn('Erreur chargement payments balance:', error)
    );

    return () => {
      unsubClients();
      unsubSuppliers();
      unsubPurchases();
      unsubPayments();
    };
  }, [user]);

  return { balances, allPurchases, allPayments, isLoading };
}

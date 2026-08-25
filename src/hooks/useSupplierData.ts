import { useState, useEffect } from 'react';
import { collection, collectionGroup, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function useSupplierData(user: any) {
  const [purchases, setPurchases] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [suppliersMap, setSuppliersMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;

    const unsubscribeSuppliers = onSnapshot(
      collection(db, 'suppliers'),
      (snapshot) => {
        const supplierList = snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((s: any) => !s.ownerId || s.ownerId === user.uid);
        setSuppliers(supplierList);

        const newMap: Record<string, string> = {};
        snapshot.forEach((docSnap) => {
          const sData = docSnap.data() as any;
          if (!sData.ownerId || sData.ownerId === user.uid) {
            newMap[docSnap.id] = sData.name || 'Fournisseur Inconnu';
          }
        });
        setSuppliersMap(newMap);
      },
      (error) => {
        console.warn('Erreur chargement fournisseurs:', error);
      }
    );

    const unsubscribePurchases = onSnapshot(
      collectionGroup(db, 'purchases'),
      (snapshot) => {
        const data = snapshot.docs
          .map((docSnap) => {
            const dataObj = docSnap.data() as any;
            const pathParts = docSnap.ref.path.split('/').filter(Boolean);
            const suppliersIndex = pathParts.indexOf('suppliers');
            const parentId = docSnap.ref.parent?.parent?.id;
            const parentPath = docSnap.ref.parent?.parent?.parent?.id;
            const supplierId =
              dataObj.supplierId ||
              parentId ||
              (suppliersIndex !== -1 ? pathParts[suppliersIndex + 1] : pathParts[1]) ||
              '';

            const isSupplierPurchase =
              parentPath === 'suppliers' ||
              suppliersIndex !== -1 ||
              docSnap.ref.path.startsWith('suppliers/') ||
              docSnap.ref.path.includes('/suppliers/');

            return {
              id: docSnap.id,
              ...dataObj,
              supplierId,
              isSupplierPurchase,
            } as any;
          })
          .filter(
            (p) =>
              p.isSupplierPurchase &&
              (!p.ownerId || p.ownerId === user.uid)
          );

        setPurchases(data);
      },
      (error) => {
        console.warn('Erreur chargement achats fournisseurs:', error);
      }
    );

    return () => {
      unsubscribeSuppliers();
      unsubscribePurchases();
    };
  }, [user]);

  return { purchases, suppliers, suppliersMap };
}


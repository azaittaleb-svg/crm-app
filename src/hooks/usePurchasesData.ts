import { useState, useEffect } from 'react';
import { collection, collectionGroup, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function usePurchasesData(user: any) {
  const [purchases, setPurchases] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [clientsMap, setClientsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;

    // Fetch clients
    const unsubscribeClients = onSnapshot(
      collection(db, 'clients'),
      (snapshot) => {
        const clientList = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((c: any) => !c.ownerId || c.ownerId === user.uid);
        setClients(clientList);

        const newMap: Record<string, string> = {};
        snapshot.forEach((doc) => {
          const cData = doc.data() as any;
          if (!cData.ownerId || cData.ownerId === user.uid) {
            newMap[doc.id] = cData.name || 'Client Inconnu';
          }
        });
        setClientsMap(newMap);
      },
      (error) => {
        console.warn('Erreur lors du chargement des clients:', error);
      }
    );

    // Fetch purchases collection group
    const unsubscribePurchases = onSnapshot(
      collectionGroup(db, 'purchases'),
      (snapshot) => {
        const data = snapshot.docs
          .map((doc) => {
            const dataObj = doc.data() as any;
            const pathParts = doc.ref.path.split('/').filter(Boolean);
            const clientsIndex = pathParts.indexOf('clients');
            const parentId = doc.ref.parent?.parent?.id;
            const parentPath = doc.ref.parent?.parent?.parent?.id;
            const clientId =
              dataObj.clientId ||
              parentId ||
              (clientsIndex !== -1 ? pathParts[clientsIndex + 1] : pathParts[1]) ||
              '';

            const isClientPurchase =
              parentPath === 'clients' ||
              clientsIndex !== -1 ||
              doc.ref.path.startsWith('clients/') ||
              doc.ref.path.includes('/clients/');

            return {
              id: doc.id,
              ...dataObj,
              clientId,
              isClientPurchase,
            } as any;
          })
          .filter(
            (p) =>
              p.isClientPurchase &&
              (!p.ownerId || p.ownerId === user.uid)
          );

        setPurchases(data);
      },
      (error) => {
        console.warn('Erreur lors du chargement des achats/commandes:', error);
      }
    );

    return () => {
      unsubscribeClients();
      unsubscribePurchases();
    };
  }, [user]);

  return { purchases, clients, clientsMap };
}


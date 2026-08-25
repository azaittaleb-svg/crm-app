import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  setDoc,
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, getCurrentUserId } from '../lib/firebase';

export interface ZakatPayout {
  id?: string;
  ownerId: string;
  templateId: string;
  titre?: string;
  name?: string;
  montant: number;
  date: string;
  note: string;
  hide: boolean;
  createdAt?: any;
}

const PAYOUTS_COLLECTION = 'zakat_payouts';

export const zakatService = {
  // Get all historical payouts for a template
  async getAllPayouts(templateId: string) {
    const userId = getCurrentUserId();
    if (!userId) return [];

    try {
      const q = query(
        collection(db, PAYOUTS_COLLECTION),
        where('ownerId', '==', userId),
        where('templateId', '==', templateId),
        orderBy('date', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ZakatPayout);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, PAYOUTS_COLLECTION);
      return [];
    }
  },

  // Add a new payout
  async addPayout(payout: Omit<ZakatPayout, 'id' | 'ownerId' | 'createdAt'>) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('User not authenticated');

    try {
      return await addDoc(collection(db, PAYOUTS_COLLECTION), {
        ...payout,
        ownerId: userId,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, PAYOUTS_COLLECTION);
    }
  },

  // Delete a payout
  async deletePayout(id: string) {
    try {
      const docRef = doc(db, PAYOUTS_COLLECTION, id);
      await deleteDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, PAYOUTS_COLLECTION);
    }
  },

  // Update a payout
  async updatePayout(
    id: string,
    updates: Partial<Omit<ZakatPayout, 'id' | 'ownerId' | 'createdAt'>>
  ) {
    try {
      const docRef = doc(db, PAYOUTS_COLLECTION, id);
      await updateDoc(docRef, updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, PAYOUTS_COLLECTION);
    }
  },
};

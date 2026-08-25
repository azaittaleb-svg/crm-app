import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  orderBy,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, getCurrentUserId } from '../lib/firebase';

export interface StaffAdvance {
  id?: string;
  ownerId: string;
  chargeTemplateId: string;
  montant: number;
  date: string;
  moisConcerné: string; // YYYY-MM
  note?: string;
  type?: 'avance' | 'remboursement'; // Default: 'avance'
  createdAt?: any;
}

export interface TemplateCharge {
  id: string;
  ownerId: string;
  titre: string;
  montant: number; // Base salary
  categorie: string; // SALAIRE
  type: string; // FIXED
}

const ADVANCES_COLLECTION = 'staff_advances';
const TEMPLATES_COLLECTION = 'expense_templates';

export const staffAdvanceService = {
  // Get all salary templates (employees)
  async getSalaryTemplates() {
    const userId = getCurrentUserId();
    if (!userId) return [];

    try {
      const q = query(
        collection(db, TEMPLATES_COLLECTION),
        where('ownerId', '==', userId),
        where('type', '==', 'FIXED')
      );
      const snap = await getDocs(q);
      const validCategories = ['salaire', 'personnel', 'personel'];

      return snap.docs
        .map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            titre: data.titre || data.name,
            montant: data.montant || data.amount,
            categorie: data.categorie || data.category,
          } as TemplateCharge;
        })
        .filter((t) => {
          const cat = (t.categorie || '').toLowerCase();
          return validCategories.some((c) => cat.includes(c));
        });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, TEMPLATES_COLLECTION);
      return [];
    }
  },

  // Get template by ID
  async getTemplateById(id: string) {
    try {
      const docRef = doc(db, TEMPLATES_COLLECTION, id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        return {
          id: snap.id,
          ...data,
          titre: data.titre || data.name,
          montant: data.montant || data.amount,
          categorie: data.categorie || data.category,
        } as TemplateCharge;
      }
      return null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `${TEMPLATES_COLLECTION}/${id}`);
      return null;
    }
  },

  // Get advances for a template in a specific month
  async getAdvancesByMonth(templateId: string, monthYear: string) {
    const userId = getCurrentUserId();
    if (!userId) return [];

    try {
      const q = query(
        collection(db, ADVANCES_COLLECTION),
        where('ownerId', '==', userId),
        where('chargeTemplateId', '==', templateId),
        where('moisConcerné', '==', monthYear),
        orderBy('date', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as StaffAdvance);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, ADVANCES_COLLECTION);
      return [];
    }
  },

  // Get all historical advances/repayments for a template
  async getAllAdvances(templateId: string) {
    const userId = getCurrentUserId();
    if (!userId) return [];

    try {
      const q = query(
        collection(db, ADVANCES_COLLECTION),
        where('ownerId', '==', userId),
        where('chargeTemplateId', '==', templateId),
        orderBy('date', 'desc')
      );
      const snap = await getDocs(q);
      return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as StaffAdvance);
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, ADVANCES_COLLECTION);
      return [];
    }
  },

  // Add a new advance
  async addAdvance(advance: Omit<StaffAdvance, 'id' | 'ownerId' | 'createdAt'>) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('User not authenticated');

    try {
      return await addDoc(collection(db, ADVANCES_COLLECTION), {
        ...advance,
        ownerId: userId,
        createdAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, ADVANCES_COLLECTION);
    }
  },

  // Delete an advance
  async deleteAdvance(id: string) {
    try {
      const docRef = doc(db, ADVANCES_COLLECTION, id);
      await deleteDoc(docRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, ADVANCES_COLLECTION);
    }
  },

  // Update an advance
  async updateAdvance(
    id: string,
    updates: Partial<Omit<StaffAdvance, 'id' | 'ownerId' | 'createdAt'>>
  ) {
    try {
      const docRef = doc(db, ADVANCES_COLLECTION, id);
      await updateDoc(docRef, updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, ADVANCES_COLLECTION);
    }
  },
};

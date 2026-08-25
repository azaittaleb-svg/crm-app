import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  getDoc,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ExpenseStatus, ExpenseTemplate } from './expenseService';

const EXPENSES_COLLECTION = 'expenses';
const TEMPLATES_COLLECTION = 'expenseTemplates';

export const expenseTemplateService = {
  async createTemplate(templateData: Omit<ExpenseTemplate, 'id' | 'createdAt' | 'ownerId'>) {
    const newDocRef = doc(collection(db, TEMPLATES_COLLECTION));
    const ownerId = 'todo_auth_user';
    const template: ExpenseTemplate = {
      ...templateData,
      id: newDocRef.id,
      createdAt: new Date().toISOString(),
      ownerId,
    };
    await setDoc(newDocRef, template);
    return template;
  },

  async getTemplates(userId?: string) {
    if (!userId) {
      console.warn("getTemplates called without userId");
      return [];
    }
    const q = query(collection(db, TEMPLATES_COLLECTION), where('ownerId', '==', userId));
    const snap = await getDocs(q);
    const rawTemplates = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ExpenseTemplate);
    const uniqueTemplates: ExpenseTemplate[] = [];
    rawTemplates.forEach((tpl) => uniqueTemplates.push(tpl));
    return uniqueTemplates;
  },

  async updateTemplate(id: string, updates: Partial<ExpenseTemplate>) {
    const docRef = doc(db, TEMPLATES_COLLECTION, id);
    await updateDoc(docRef, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  },

  async deleteTemplate(id: string) {
    const templateRef = doc(db, TEMPLATES_COLLECTION, id);
    const templateSnap = await getDoc(templateRef);
    if (!templateSnap.exists()) return;

    await deleteDoc(templateRef);
  },
};

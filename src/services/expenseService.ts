import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  setDoc,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  Timestamp,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType, auth, getCurrentUserId } from '../lib/firebase';

export enum ExpenseType {
  FIXED = 'FIXED',
  VARIABLE = 'VARIABLE',
  CONSUMPTION = 'CONSUMPTION',
}

export enum ExpenseStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
}

export interface ExpenseTemplate {
  id?: string;
  ownerId: string;
  name: string; // Internal: mapped to 'titre' in firestore
  type: ExpenseType;
  amount: number; // Internal: mapped to 'montant' in firestore
  category: string; // Internal: mapped to 'categorie' in firestore
  isActive: boolean;
  dueDay?: number; // Day of month (e.g., 20 for utilities)
  startMonth?: number; // Active from month (1-12)
  endMonth?: number; // Active until month (1-12)
  createdAt: any;
}

export interface MonthlyExpense {
  id?: string;
  ownerId: string;
  templateId: string;
  name: string;
  monthYear: string; // YYYY-MM
  amount: number;
  status: ExpenseStatus;
  type: ExpenseType;
  dueDay?: number;
  validatedAt?: any;
  createdAt: any;
}

const TEMPLATES_COLLECTION = 'expense_templates';
const EXPENSES_COLLECTION = 'expenses';
const SETTINGS_COLLECTION = 'settings';

const syncPromises = new Map<string, Promise<void>>();

let earliestMonthCache: { [userId: string]: string } = {};

export const invalidateEarliestMonthCache = (userId: string) => {
  if (userId) {
    delete earliestMonthCache[userId];
  }
};

async function getEarliestMonthYear(userId: string): Promise<string> {
  if (earliestMonthCache[userId]) {
    return earliestMonthCache[userId];
  }

  try {
    const q = query(
      collection(db, EXPENSES_COLLECTION),
      where('ownerId', '==', userId)
    );
    const snap = await getDocs(q);
    const expenses = snap.docs.map((d) => d.data());
    const realExpenses = expenses.filter(
      (e: any) => !e.deleted && (String(e.status).toUpperCase() === 'PAID' || e.templateId === 'instant')
    );

    const today = new Date();
    let earliest = today.toISOString().slice(0, 7); // Default to current month
    if (realExpenses.length > 0) {
      realExpenses.forEach((e: any) => {
        if (e.monthYear && e.monthYear < earliest) {
          earliest = e.monthYear;
        }
      });
    }
    earliestMonthCache[userId] = earliest;
    return earliest;
  } catch (e) {
    console.error('Error fetching earliest month:', e);
    const today = new Date();
    return today.toISOString().slice(0, 7);
  }
}

const invalidateSyncCache = async (userId: string) => {
  if (!userId) return;
  invalidateEarliestMonthCache(userId);
  try {
    const today = new Date();
    const currentMonthYear = today.toISOString().slice(0, 7);
    localStorage.removeItem(`sz_sync_month_${userId}_${currentMonthYear}`);
    const syncDocRef = doc(db, SETTINGS_COLLECTION, `sync_${userId}_${currentMonthYear}`);
    await setDoc(syncDocRef, { lastSyncedMonth: '' }, { merge: true });
  } catch (e) {
    console.warn('Could not invalidate sync cache:', e);
  }
};

export const expenseService = {
  // Check and Sync Monthly Expenses
  async syncMonthlyExpenses(targetMonthYear?: string | boolean, force = false) {
    const userId = getCurrentUserId();
    if (!userId) return;

    let currentMonthYear: string;
    let forceSync = force;

    if (typeof targetMonthYear === 'boolean') {
      forceSync = targetMonthYear;
      currentMonthYear = new Date().toISOString().slice(0, 7);
    } else if (typeof targetMonthYear === 'string' && targetMonthYear) {
      currentMonthYear = targetMonthYear;
    } else {
      currentMonthYear = new Date().toISOString().slice(0, 7); // YYYY-MM
    }

    const promiseKey = `${userId}_${currentMonthYear}`;
    if (syncPromises.has(promiseKey)) {
      return syncPromises.get(promiseKey)!;
    }

    const currentPromise = (async () => {
      // Prevent sync if target monthYear is before the user's earliest actual tracking month
      const earliestMonth = await getEarliestMonthYear(userId);
      if (currentMonthYear < earliestMonth) {
        console.log(`Skipping sync for ${currentMonthYear} because it is before earliest tracking month ${earliestMonth}`);
        // Automatically clean up any phantom pending expenses that exist in months before earliestMonth
        try {
          const q = query(
            collection(db, EXPENSES_COLLECTION),
            where('ownerId', '==', userId),
            where('monthYear', '==', currentMonthYear)
          );
          const snap = await getDocs(q);
          const activePendingInstances = snap.docs.filter((d) => {
            const data = d.data();
            return !data.deleted && String(data.status).toUpperCase() !== 'PAID';
          });
          for (const docSnap of activePendingInstances) {
            await deleteDoc(docSnap.ref);
            console.log(`Cleaned up phantom pending expense prior to earliest tracking month: ${docSnap.id}`);
          }
        } catch (e) {
          console.error('Error cleaning up earlier phantom expenses:', e);
        }
        return;
      }

      const cacheKey = `sz_sync_month_${userId}_${currentMonthYear}`;
      const syncDocRef = doc(db, SETTINGS_COLLECTION, `sync_${userId}_${currentMonthYear}`);

      if (!forceSync) {
        // 1. Instantly skip if localStorage has already synced this month
        if (localStorage.getItem(cacheKey) === currentMonthYear) {
          return;
        }

        // 2. Fallback to Firestore check if localStorage was cleared
        try {
          const syncSnap = await getDoc(syncDocRef);
          if (syncSnap.exists() && syncSnap.data().lastSyncedMonth === currentMonthYear) {
            localStorage.setItem(cacheKey, currentMonthYear);
            return;
          }
        } catch (error) {
          console.warn('Could not retrieve sync document:', error);
        }
      }

      // 3. Perform actual synchronization
      // A. Fetch templates
      let templatesSnap;
      try {
        const templatesQuery = query(
          collection(db, TEMPLATES_COLLECTION),
          where('ownerId', '==', userId)
        );
        templatesSnap = await getDocs(templatesQuery);
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, TEMPLATES_COLLECTION);
        return;
      }

      // B. Fetch expenses for the target month (INCLUDING DELETED!)
      let existingExpenses: any[] = [];
      try {
        const expensesQuery = query(
          collection(db, EXPENSES_COLLECTION),
          where('ownerId', '==', userId),
          where('monthYear', '==', currentMonthYear)
        );
        const expensesSnap = await getDocs(expensesQuery);
        existingExpenses = expensesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      } catch (error) {
        handleFirestoreError(error, OperationType.LIST, EXPENSES_COLLECTION);
        return;
      }

      const creationPromises = templatesSnap.docs.map(async (templateDoc) => {
        const data = templateDoc.data();
        const template: ExpenseTemplate = {
          id: templateDoc.id,
          ownerId: data.ownerId,
          name: data.titre || data.name, // Support both during transition if needed
          type: data.type,
          amount: data.montant || data.amount,
          category: data.categorie || data.category,
          isActive: data.isActive !== false, // Default to true if missing
          dueDay: data.dueDay ? Number(data.dueDay) : undefined,
          startMonth: data.startMonth ? Number(data.startMonth) : undefined,
          endMonth: data.endMonth ? Number(data.endMonth) : undefined,
          createdAt: data.createdAt,
        };

        if (!template.isActive) return;

        // Skip Zakat templates as they are annual charges and not monthly expenses
        const isZakat =
          (template.name || '').toLowerCase().includes('zakat') ||
          (template.category || '').toLowerCase().includes('zakat');
        if (isZakat) return;

        // Seasonal Check
        const cMY = typeof currentMonthYear === 'string' ? currentMonthYear : String(currentMonthYear || '');
        if (template.startMonth && template.endMonth && cMY.includes('-')) {
          const m = parseInt(cMY.split('-')[1], 10);
          const start = template.startMonth;
          const end = template.endMonth;

          let isActiveMonth = false;
          if (start <= end) {
            isActiveMonth = m >= start && m <= end;
          } else {
            // Overlaps year end (e.g. 9 to 6)
            isActiveMonth = m >= start || m <= end;
          }

          if (!isActiveMonth) return;
        }

        // Check if currentMonthYear is before the template's creation month
        if (template.createdAt) {
          const createdAtDate = template.createdAt?.toDate ? template.createdAt.toDate() : new Date(template.createdAt.seconds ? template.createdAt.seconds * 1000 : template.createdAt);
          if (!isNaN(createdAtDate.getTime())) {
            const templateMonthYear = createdAtDate.toISOString().slice(0, 7);
            if (currentMonthYear < templateMonthYear) {
              // Clean up any accidentally generated pending expenses for months before creation
              const activePendingInstances = existingExpenses.filter(
                (exp) => !exp.deleted && exp.templateId === template.id && String(exp.status).toUpperCase() !== 'PAID'
              );
              for (const instance of activePendingInstances) {
                try {
                  await deleteDoc(doc(db, EXPENSES_COLLECTION, instance.id));
                  console.log(`Cleaned up old pending expense generated before template creation: ${template.name}`);
                } catch (e) {
                  console.error('Cleanup error: ', e);
                }
              }
              return; // Skip generating pending expense
            }
          }
        }

        // Find ALL matching expenses (active or soft-deleted), matching templateId OR name
        const matches = existingExpenses.filter(
          (exp) =>
            exp.templateId === template.id ||
            (exp.name || '')
              .trim()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase() ===
              (template.name || '')
                .trim()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase()
        );

        // If any matching record (even if soft-deleted or manual) exists, we DO NOT create any new pending document
        if (matches.length > 0) {
          // If we have duplicates (multiple active ones of the same template ID), clean them down to one
          const activeTemplateInstances = matches.filter(
            (exp) => !exp.deleted && exp.templateId === template.id
          );
          if (activeTemplateInstances.length > 1) {
            // Sort: PAID is better, oldest first
            activeTemplateInstances.sort((a, b) => {
              const paidA = a.status === ExpenseStatus.PAID ? 0 : 1;
              const paidB = b.status === ExpenseStatus.PAID ? 0 : 1;
              if (paidA !== paidB) return paidA - paidB;
              const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
              const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
              return tA - tB;
            });

            // Keep the first, delete the others to prevent duplicates in DB
            for (let i = 1; i < activeTemplateInstances.length; i++) {
              if (activeTemplateInstances[i].status !== ExpenseStatus.PAID) {
                try {
                  await deleteDoc(doc(db, EXPENSES_COLLECTION, activeTemplateInstances[i].id));
                  console.log(`Deduplication: Cleaned duplicate for ${template.name}`);
                } catch (e) {
                  console.error('Deduplication error: ', e);
                }
              }
            }
          }
          return;
        }

        // Create the pending template monthly expense
        let amount = template.amount;
        if (template.type === ExpenseType.VARIABLE) {
          // fetch placeholder from last month relative to target month
          const parts = cMY.split('-');
          const targetYear = parts[0] ? parseInt(parts[0], 10) : new Date().getFullYear();
          const targetMonth = parts[1] ? parseInt(parts[1], 10) : new Date().getMonth() + 1;
          const lastMonth = new Date(targetYear, targetMonth - 2, 1)
            .toISOString()
            .slice(0, 7);
          try {
            const lastMonthQuery = query(
              collection(db, EXPENSES_COLLECTION),
              where('ownerId', '==', userId),
              where('templateId', '==', template.id),
              where('monthYear', '==', lastMonth),
              limit(1)
            );
            const lastMonthSnap = await getDocs(lastMonthQuery);
            if (!lastMonthSnap.empty) {
              amount = lastMonthSnap.docs[0].data().amount;
            }
          } catch (e) {
            console.error('Error fetching last month expense:', e);
          }
        } else if (template.type === ExpenseType.CONSUMPTION) {
          amount = 0; // Starts at 0
        }

        try {
          await addDoc(collection(db, EXPENSES_COLLECTION), {
            ownerId: userId,
            templateId: template.id,
            name: template.name,
            monthYear: currentMonthYear,
            amount: amount,
            status: ExpenseStatus.PENDING,
            type: template.type,
            dueDay: template.dueDay || null,
            createdAt: serverTimestamp(),
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, EXPENSES_COLLECTION);
        }
      });

      await Promise.all(creationPromises);

      // Update sync marker for record-keeping
      try {
        await setDoc(
          syncDocRef,
          {
            ownerId: userId,
            lastSyncDate: serverTimestamp(),
            lastSyncedMonth: currentMonthYear,
          },
          { merge: true }
        );
        localStorage.setItem(cacheKey, currentMonthYear);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `${SETTINGS_COLLECTION}/sync_${userId}_${currentMonthYear}`);
      }
    })();

    syncPromises.set(promiseKey, currentPromise);
    try {
      await currentPromise;
    } finally {
      syncPromises.delete(promiseKey);
    }
  },

  // Get expenses for a specific month
  async getMonthlyExpenses(monthYear: string) {
    const userId = getCurrentUserId();

    try {
      const q = query(
        collection(db, EXPENSES_COLLECTION),
        where('ownerId', '==', userId),
        where('monthYear', '==', monthYear),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(q);
      const rawData = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as MonthlyExpense);
      return rawData.filter(
        (e) => !(e.name || '').toLowerCase().includes('zakat') && !(e as any).deleted
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, EXPENSES_COLLECTION);
      return [];
    }
  },

  // Validate Variable Expense
  async validateExpense(id: string, amount: number) {
    try {
      const userId = getCurrentUserId();
      invalidateEarliestMonthCache(userId);
      const ref = doc(db, EXPENSES_COLLECTION, id);
      await updateDoc(ref, {
        amount,
        status: ExpenseStatus.PAID,
        validatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${EXPENSES_COLLECTION}/${id}`);
    }
  },

  // Create Template
  async createTemplate(templateData: Omit<ExpenseTemplate, 'id' | 'createdAt' | 'ownerId'>) {
    const userId = getCurrentUserId();

    try {
      const docRef = await addDoc(collection(db, TEMPLATES_COLLECTION), {
        name: templateData.name,
        titre: templateData.name,
        type: templateData.type,
        amount: templateData.amount,
        montant: templateData.amount,
        category: templateData.category,
        categorie: templateData.category,
        isActive: templateData.isActive,
        dueDay: templateData.dueDay || null,
        startMonth: templateData.startMonth || null,
        endMonth: templateData.endMonth || null,
        ownerId: userId,
        createdAt: serverTimestamp(),
      });

      // Invalidate caches and trigger force sync to generate pending instance instantly
      await invalidateSyncCache(userId);
      await this.syncMonthlyExpenses(undefined, true);

      return docRef;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, TEMPLATES_COLLECTION);
    }
  },

  // Create Instant Expense
  async addInstantExpense(name: string, amount: number, customDate?: string) {
    const userId = getCurrentUserId();
    const dateObj = customDate ? new Date(customDate) : new Date();
    const monthYear = dateObj.toISOString().slice(0, 7);
    const dateStr = customDate || dateObj.toISOString().split('T')[0];

    try {
      invalidateEarliestMonthCache(userId);
      return await addDoc(collection(db, EXPENSES_COLLECTION), {
        ownerId: userId,
        templateId: 'instant',
        name,
        monthYear,
        amount,
        status: ExpenseStatus.PAID,
        type: ExpenseType.VARIABLE,
        date: dateStr,
        createdAt: customDate ? new Date(customDate + 'T12:00:00') : serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, EXPENSES_COLLECTION);
    }
  },

  // Get Expense History by Name
  async getExpenseHistoryByName(name: string) {
    const userId = getCurrentUserId();

    try {
      const q = query(collection(db, EXPENSES_COLLECTION), where('ownerId', '==', userId));
      const snap = await getDocs(q);
      const normalizedQueryName = (name || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

      const data = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as MonthlyExpense);
      return data
        .filter((e) => {
          if ((e as any).deleted) return false;
          const normalizedName = (e.name || '')
            .trim()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
          return normalizedName === normalizedQueryName;
        })
        .sort((a, b) => {
          const timeB = b.createdAt?.toDate
            ? b.createdAt.toDate().getTime()
            : new Date(b.createdAt || 0).getTime();
          const timeA = a.createdAt?.toDate
            ? a.createdAt.toDate().getTime()
            : new Date(a.createdAt || 0).getTime();
          return timeB - timeA;
        });
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, EXPENSES_COLLECTION);
      return [];
    }
  },

  // Get all expenses for analytics
  async getAllExpensesForAnalytics() {
    const userId = getCurrentUserId();

    try {
      const q = query(collection(db, EXPENSES_COLLECTION), where('ownerId', '==', userId));
      const snap = await getDocs(q);
      const rawData = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as MonthlyExpense);
      return rawData.filter(
        (e) => !(e.name || '').toLowerCase().includes('zakat') && !(e as any).deleted
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, EXPENSES_COLLECTION);
      return [];
    }
  },

  // Get Templates
  async getTemplates() {
    const userId = getCurrentUserId();
    if (!userId) return [];

    try {
      const q = query(collection(db, TEMPLATES_COLLECTION), where('ownerId', '==', userId));
      const snap = await getDocs(q);
      const rawTemplates = snap.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ownerId: data.ownerId,
          name: data.titre || data.name,
          type: data.type,
          amount: data.montant || data.amount,
          category: data.categorie || data.category,
          isActive: data.isActive !== false,
          dueDay: data.dueDay ? Number(data.dueDay) : undefined,
          startMonth: data.startMonth ? Number(data.startMonth) : undefined,
          endMonth: data.endMonth ? Number(data.endMonth) : undefined,
          createdAt: data.createdAt,
        } as ExpenseTemplate;
      });

      const seen = new Map<string, string>(); // name.toLowerCase() -> keptTemplateId
      const uniqueTemplates: ExpenseTemplate[] = [];
      const duplicatesToDelete: { dupId: string; keptId: string; name: string }[] = [];

      rawTemplates.forEach((tpl) => {
        const rawName = (tpl.name || '').trim();
        if (!rawName) return;
        const key = rawName
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase();

        if (!seen.has(key)) {
          seen.set(key, tpl.id!);
          uniqueTemplates.push(tpl);
        } else {
          duplicatesToDelete.push({
            dupId: tpl.id!,
            keptId: seen.get(key)!,
            name: tpl.name,
          });
        }
      });

      if (duplicatesToDelete.length > 0) {
        (async () => {
          for (const item of duplicatesToDelete) {
            try {
              const docRef = doc(db, TEMPLATES_COLLECTION, item.dupId);
              try {
                await deleteDoc(docRef);
              } catch (e) {
                console.error(`Error deleting duplicate template ${item.dupId}:`, e);
                throw e;
              }
              console.log(
                `Deduplicated template from list: Deleted duplicate ${item.dupId} ("${item.name}")`
              );

              // Update any expenses pointing to the duplicate template
              const expensesQuery = query(
                collection(db, EXPENSES_COLLECTION),
                where('ownerId', '==', userId),
                where('templateId', '==', item.dupId)
              );
              let expSnap;
              try {
                expSnap = await getDocs(expensesQuery);
              } catch (e) {
                console.error(`Error querying expenses for duplicate template ${item.dupId}:`, e);
                throw e;
              }
              for (const expDoc of expSnap.docs) {
                try {
                  await updateDoc(doc(db, EXPENSES_COLLECTION, expDoc.id), {
                    templateId: item.keptId,
                  });
                } catch (e) {
                  console.error(`Error updating expense ${expDoc.id} for duplicate template ${item.dupId}:`, e);
                  throw e;
                }
              }
            } catch (err) {
              console.error('Error cleaning up duplicates in getTemplates:', err);
            }
          }
        })();
      }

      return uniqueTemplates;
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, TEMPLATES_COLLECTION);
      return [];
    }
  },

  // Update Template
  async updateTemplate(id: string, updates: Partial<ExpenseTemplate>) {
    try {
      const docRef = doc(db, TEMPLATES_COLLECTION, id);
      const dbUpdates: any = {};
      if (updates.name !== undefined) {
        dbUpdates.name = updates.name;
        dbUpdates.titre = updates.name;
      }
      if (updates.amount !== undefined) {
        dbUpdates.amount = updates.amount;
        dbUpdates.montant = updates.amount;
      }
      if (updates.category !== undefined) {
        dbUpdates.category = updates.category;
        dbUpdates.categorie = updates.category;
      }
      if (updates.type !== undefined) dbUpdates.type = updates.type;
      if (updates.isActive !== undefined) dbUpdates.isActive = updates.isActive;
      if (updates.dueDay !== undefined) dbUpdates.dueDay = updates.dueDay;
      if (updates.startMonth !== undefined) dbUpdates.startMonth = updates.startMonth;
      if (updates.endMonth !== undefined) dbUpdates.endMonth = updates.endMonth;

      await updateDoc(docRef, dbUpdates);

      const userId = getCurrentUserId();
      await invalidateSyncCache(userId);
      await this.syncMonthlyExpenses(undefined, true);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${TEMPLATES_COLLECTION}/${id}`);
    }
  },

  // Delete Template
  async deleteTemplate(id: string) {
    try {
      const docRef = doc(db, TEMPLATES_COLLECTION, id);
      await deleteDoc(docRef);

      const userId = getCurrentUserId();
      await invalidateSyncCache(userId);

      // Clean up un-validated pending monthly expenses linked to this deleted template
      try {
        const today = new Date();
        const currentMonthYear = today.toISOString().slice(0, 7);
        const q = query(
          collection(db, EXPENSES_COLLECTION),
          where('ownerId', '==', userId),
          where('templateId', '==', id),
          where('monthYear', '==', currentMonthYear),
          where('status', '==', ExpenseStatus.PENDING)
        );
        const snap = await getDocs(q);
        for (const d of snap.docs) {
          await deleteDoc(doc(db, EXPENSES_COLLECTION, d.id));
        }
      } catch (err) {
        console.warn('Cleared template orphan expenses error:', err);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${TEMPLATES_COLLECTION}/${id}`);
    }
  },

  async deleteExpense(id: string) {
    try {
      const userId = getCurrentUserId();
      invalidateEarliestMonthCache(userId);
      const docRef = doc(db, EXPENSES_COLLECTION, id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.templateId && data.templateId !== 'instant') {
          // If it's a recurring expense monthly instance, mark it as deleted
          // so syncMonthlyExpenses doesn't recreate it
          await updateDoc(docRef, {
            deleted: true,
          });
        } else {
          // If it's an instant expense, delete it permanently
          await deleteDoc(docRef);
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `${EXPENSES_COLLECTION}/${id}`);
    }
  },

  async updateExpense(id: string, updates: { name?: string; amount?: number }) {
    try {
      const userId = getCurrentUserId();
      invalidateEarliestMonthCache(userId);
      await updateDoc(doc(db, EXPENSES_COLLECTION, id), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${EXPENSES_COLLECTION}/${id}`);
    }
  },

  async updateExpenseStatus(id: string, status: ExpenseStatus) {
    try {
      const userId = getCurrentUserId();
      invalidateEarliestMonthCache(userId);
      await updateDoc(doc(db, EXPENSES_COLLECTION, id), {
        status,
        validatedAt: status === ExpenseStatus.PAID ? serverTimestamp() : null,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `${EXPENSES_COLLECTION}/${id}`);
    }
  },
};

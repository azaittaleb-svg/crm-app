import {
  collection,
  writeBatch,
  getDocs,
  getDoc,
  doc,
  addDoc,
  serverTimestamp,
  Timestamp,
  query,
  where,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

/**
 * Hard reset: Deletes all data in the specified collections for a specific user.
 */
export const forceDeleteAllData = async (uid: string) => {
  console.log('Starting forceDeleteAllData for uid:', uid);
  try {
    let batch = writeBatch(db);
    let opCount = 0;
    let totalDeletedCount = 0;

    const collectionsToClear = [
      'clients',
      'expenses',
      'expense_templates',
      'staff_advances',
      'zakat_payouts',
      'settings',
      'suppliers',
      'bank_reconciliations',
      'miscellaneous_operations',
      'tva_declarations',
      'returns_notes',
      'sequences',
      'vat_audit_trail',
    ];

    const commitIfNeeded = async (force = false) => {
      if (force || opCount >= 490) {
        if (opCount > 0) {
          await batch.commit();
          batch = writeBatch(db);
          opCount = 0;
        }
      }
    };

    for (const colName of collectionsToClear) {
      console.log(`Clearing collection: ${colName}`);
      const fieldName = colName === 'vat_audit_trail' ? 'calculatedBy' : 'ownerId';
      const q = query(collection(db, colName), where(fieldName, '==', uid));
      const snap = await getDocs(q);

      for (const d of snap.docs) {
        batch.delete(d.ref);
        opCount++;
        totalDeletedCount++;
        await commitIfNeeded();

        // Subcollections for clients
        if (colName === 'clients') {
          const purchasesSnap = await getDocs(
            query(collection(db, 'clients', d.id, 'purchases'), where('ownerId', '==', uid))
          );
          for (const p of purchasesSnap.docs) {
            // Check for audit logs inside this purchase
            const auditLogsSnap = await getDocs(
              collection(db, 'clients', d.id, 'purchases', p.id, 'audit_logs')
            );
            for (const log of auditLogsSnap.docs) {
              batch.delete(log.ref);
              opCount++;
              totalDeletedCount++;
              await commitIfNeeded();
            }

            batch.delete(p.ref);
            opCount++;
            totalDeletedCount++;
            await commitIfNeeded();
          }

          const paymentsSnap = await getDocs(
            query(collection(db, 'clients', d.id, 'payments'), where('ownerId', '==', uid))
          );
          for (const p of paymentsSnap.docs) {
            batch.delete(p.ref);
            opCount++;
            totalDeletedCount++;
            await commitIfNeeded();
          }
        }

        // Subcollections for suppliers
        if (colName === 'suppliers') {
          const purchasesSnap = await getDocs(
            query(collection(db, 'suppliers', d.id, 'purchases'), where('ownerId', '==', uid))
          );
          for (const p of purchasesSnap.docs) {
            batch.delete(p.ref);
            opCount++;
            totalDeletedCount++;
            await commitIfNeeded();
          }

          const paymentsSnap = await getDocs(
            query(collection(db, 'suppliers', d.id, 'payments'), where('ownerId', '==', uid))
          );
          for (const p of paymentsSnap.docs) {
            batch.delete(p.ref);
            opCount++;
            totalDeletedCount++;
            await commitIfNeeded();
          }
        }
      }
    }

    // Specifically delete sync_${uid} and zakat_password_${uid} in case they didn't have ownerId field but were created for this user
    const syncDocRef = doc(db, 'settings', `sync_${uid}`);
    batch.delete(syncDocRef);
    opCount++;
    await commitIfNeeded();

    const zakatPwdDocRef = doc(db, 'settings', `zakat_password_${uid}`);
    batch.delete(zakatPwdDocRef);
    opCount++;
    await commitIfNeeded();

    await commitIfNeeded(true);
    console.log(`Successfully cleared ${totalDeletedCount} documents.`);
  } catch (error) {
    console.error('Error clearing data:', error);
    throw error;
  }
};

/**
 * Exports data to JSON
 */
export const exportBackupData = async (uid: string) => {
  const exportData: any = {
    clients: [],
    suppliers: [],
    expenses: [],
    expense_templates: [],
    staff_advances: [],
    zakat_payouts: [],
    bank_reconciliations: [],
    miscellaneous_operations: [],
    tva_declarations: [],
    returns_notes: [],
    sequences: [],
    settings: [],
    vat_audit_trail: [],
  };

  try {
    // Clients
    const clientsSnap = await getDocs(
      query(collection(db, 'clients'), where('ownerId', '==', uid))
    );
    for (const d of clientsSnap.docs) {
      const clientData = { id: d.id, ...d.data(), purchases: [] as any[], payments: [] as any[] };

      // Purchases
      const purchasesSnap = await getDocs(
        query(collection(db, 'clients', d.id, 'purchases'), where('ownerId', '==', uid))
      );
      for (const p of purchasesSnap.docs) {
        const purchaseData = { id: p.id, ...p.data(), audit_logs: [] as any[] };
        const auditLogsSnap = await getDocs(
          collection(db, 'clients', d.id, 'purchases', p.id, 'audit_logs')
        );
        auditLogsSnap.forEach((l) => {
          purchaseData.audit_logs.push({ id: l.id, ...l.data() });
        });
        clientData.purchases.push(purchaseData);
      }

      // Payments
      const paymentsSnap = await getDocs(
        query(collection(db, 'clients', d.id, 'payments'), where('ownerId', '==', uid))
      );
      paymentsSnap.forEach((p) => {
        clientData.payments.push({ id: p.id, ...p.data() });
      });

      exportData.clients.push(clientData);
    }

    // Suppliers
    const suppliersSnap = await getDocs(
      query(collection(db, 'suppliers'), where('ownerId', '==', uid))
    );
    for (const d of suppliersSnap.docs) {
      const supplierData = { id: d.id, ...d.data(), purchases: [] as any[], payments: [] as any[] };

      // Purchases
      const purchasesSnap = await getDocs(
        query(collection(db, 'suppliers', d.id, 'purchases'), where('ownerId', '==', uid))
      );
      purchasesSnap.forEach((p) => {
        supplierData.purchases.push({ id: p.id, ...p.data() });
      });

      // Payments
      const paymentsSnap = await getDocs(
        query(collection(db, 'suppliers', d.id, 'payments'), where('ownerId', '==', uid))
      );
      paymentsSnap.forEach((p) => {
        supplierData.payments.push({ id: p.id, ...p.data() });
      });

      exportData.suppliers.push(supplierData);
    }

    // Expenses
    const expensesSnap = await getDocs(
      query(collection(db, 'expenses'), where('ownerId', '==', uid))
    );
    expensesSnap.forEach((d) => {
      exportData.expenses.push({ id: d.id, ...d.data() });
    });

    // Expense templates
    const templatesSnap = await getDocs(
      query(collection(db, 'expense_templates'), where('ownerId', '==', uid))
    );
    templatesSnap.forEach((d) => {
      exportData.expense_templates.push({ id: d.id, ...d.data() });
    });

    // Staff advances
    const advancesSnap = await getDocs(
      query(collection(db, 'staff_advances'), where('ownerId', '==', uid))
    );
    advancesSnap.forEach((d) => {
      exportData.staff_advances.push({ id: d.id, ...d.data() });
    });

    // Zakat payouts
    const payoutsSnap = await getDocs(
      query(collection(db, 'zakat_payouts'), where('ownerId', '==', uid))
    );
    payoutsSnap.forEach((d) => {
      exportData.zakat_payouts.push({ id: d.id, ...d.data() });
    });

    // Bank reconciliations
    const bankSnap = await getDocs(
      query(collection(db, 'bank_reconciliations'), where('ownerId', '==', uid))
    );
    bankSnap.forEach((d) => {
      exportData.bank_reconciliations.push({ id: d.id, ...d.data() });
    });

    // Miscellaneous operations
    const miscSnap = await getDocs(
      query(collection(db, 'miscellaneous_operations'), where('ownerId', '==', uid))
    );
    miscSnap.forEach((d) => {
      exportData.miscellaneous_operations.push({ id: d.id, ...d.data() });
    });

    // TVA declarations
    const tvaSnap = await getDocs(
      query(collection(db, 'tva_declarations'), where('ownerId', '==', uid))
    );
    tvaSnap.forEach((d) => {
      exportData.tva_declarations.push({ id: d.id, ...d.data() });
    });

    // Returns notes
    const returnsSnap = await getDocs(
      query(collection(db, 'returns_notes'), where('ownerId', '==', uid))
    );
    returnsSnap.forEach((d) => {
      exportData.returns_notes.push({ id: d.id, ...d.data() });
    });

    // Sequences
    const sequencesSnap = await getDocs(
      query(collection(db, 'sequences'), where('ownerId', '==', uid))
    );
    sequencesSnap.forEach((d) => {
      exportData.sequences.push({ id: d.id, ...d.data() });
    });

    // Settings
    const settingsSnap = await getDocs(
      query(collection(db, 'settings'), where('ownerId', '==', uid))
    );
    settingsSnap.forEach((d) => {
      exportData.settings.push({ id: d.id, ...d.data() });
    });

    // Also explicitly pull sync_${uid} and zakat_password_${uid} if they aren't already fetched
    try {
      const syncDoc = await getDoc(doc(db, 'settings', `sync_${uid}`));
      if (syncDoc.exists() && !exportData.settings.some((s: any) => s.id === syncDoc.id)) {
        exportData.settings.push({ id: syncDoc.id, ...syncDoc.data() });
      }
    } catch (e) {
      console.warn('Could not fetch sync settings doc:', e);
    }

    try {
      const zakatPwdDoc = await getDoc(doc(db, 'settings', `zakat_password_${uid}`));
      if (
        zakatPwdDoc.exists() &&
        !exportData.settings.some((s: any) => s.id === zakatPwdDoc.id)
      ) {
        exportData.settings.push({ id: zakatPwdDoc.id, ...zakatPwdDoc.data() });
      }
    } catch (e) {
      console.warn('Could not fetch zakat password doc:', e);
    }

    // VAT audit trail (queried by calculatedBy)
    const vatAuditSnap = await getDocs(
      query(collection(db, 'vat_audit_trail'), where('calculatedBy', '==', uid))
    );
    vatAuditSnap.forEach((d) => {
      exportData.vat_audit_trail.push({ id: d.id, ...d.data() });
    });

    // Serialize Timestamps
    const jsonString = JSON.stringify(
      exportData,
      (key, value) => {
        if (
          value &&
          typeof value === 'object' &&
          value.seconds !== undefined &&
          value.nanoseconds !== undefined
        ) {
          // Assume it's a Firestore Timestamp
          return {
            __type: 'FirestoreTimestamp',
            seconds: value.seconds,
            nanoseconds: value.nanoseconds,
          };
        }
        return value;
      },
      2
    );

    return jsonString;
  } catch (error) {
    console.error('Export backup failed:', error);
    throw error;
  }
};

/**
 * Imports data from JSON
 */
export const importBackupData = async (uid: string, jsonData: string) => {
  try {
    let rawData: any;
    try {
      rawData = JSON.parse(jsonData, (key, value) => {
        if (value && typeof value === 'object' && value.__type === 'FirestoreTimestamp') {
          return new Timestamp(value.seconds, value.nanoseconds);
        }
        return value;
      });
    } catch (err) {
      throw new Error('Fichier JSON invalide.');
    }

    // First delete all data
    await forceDeleteAllData(uid);

    // Now insert
    let currentBatch = writeBatch(db);
    let opCount = 0;

    const checkBatch = async () => {
      opCount++;
      if (opCount >= 400) {
        await currentBatch.commit();
        currentBatch = writeBatch(db);
        opCount = 0;
      }
    };

    // Clients
    if (rawData.clients && Array.isArray(rawData.clients)) {
      for (const client of rawData.clients) {
        const { id, purchases, payments, ...clientData } = client;
        const cRef = doc(db, 'clients', id);
        currentBatch.set(cRef, { ...clientData, ownerId: uid });
        await checkBatch();

        if (purchases && Array.isArray(purchases)) {
          for (const p of purchases) {
            const { id: pId, audit_logs, ...pData } = p;
            const pRef = doc(db, 'clients', id, 'purchases', pId);
            currentBatch.set(pRef, { ...pData, ownerId: uid, clientId: id });
            await checkBatch();

            if (audit_logs && Array.isArray(audit_logs)) {
              for (const log of audit_logs) {
                const { id: logId, ...logData } = log;
                const logRef = doc(db, 'clients', id, 'purchases', pId, 'audit_logs', logId);
                currentBatch.set(logRef, logData);
                await checkBatch();
              }
            }
          }
        }

        if (payments && Array.isArray(payments)) {
          for (const p of payments) {
            const { id: payId, ...pData } = p;
            const payRef = doc(db, 'clients', id, 'payments', payId);
            currentBatch.set(payRef, { ...pData, ownerId: uid });
            await checkBatch();
          }
        }
      }
    }

    // Suppliers
    if (rawData.suppliers && Array.isArray(rawData.suppliers)) {
      for (const supplier of rawData.suppliers) {
        const { id, purchases, payments, ...supplierData } = supplier;
        const sRef = doc(db, 'suppliers', id);
        currentBatch.set(sRef, { ...supplierData, ownerId: uid });
        await checkBatch();

        if (purchases && Array.isArray(purchases)) {
          for (const p of purchases) {
            const { id: pId, ...pData } = p;
            const pRef = doc(db, 'suppliers', id, 'purchases', pId);
            currentBatch.set(pRef, { ...pData, ownerId: uid, supplierId: id });
            await checkBatch();
          }
        }

        if (payments && Array.isArray(payments)) {
          for (const p of payments) {
            const { id: payId, ...pData } = p;
            const payRef = doc(db, 'suppliers', id, 'payments', payId);
            currentBatch.set(payRef, { ...pData, ownerId: uid });
            await checkBatch();
          }
        }
      }
    }

    // Expenses
    if (rawData.expenses && Array.isArray(rawData.expenses)) {
      for (const e of rawData.expenses) {
        const { id, ...eData } = e;
        const eRef = doc(db, 'expenses', id);
        currentBatch.set(eRef, { ...eData, ownerId: uid });
        await checkBatch();
      }
    }

    // Expense templates
    if (rawData.expense_templates && Array.isArray(rawData.expense_templates)) {
      for (const t of rawData.expense_templates) {
        const { id, ...tData } = t;
        const tRef = doc(db, 'expense_templates', id);
        currentBatch.set(tRef, { ...tData, ownerId: uid });
        await checkBatch();
      }
    }

    // Staff advances
    if (rawData.staff_advances && Array.isArray(rawData.staff_advances)) {
      for (const sa of rawData.staff_advances) {
        const { id, ...saData } = sa;
        const saRef = doc(db, 'staff_advances', id);
        currentBatch.set(saRef, { ...saData, ownerId: uid });
        await checkBatch();
      }
    }

    // Zakat payouts
    if (rawData.zakat_payouts && Array.isArray(rawData.zakat_payouts)) {
      for (const zp of rawData.zakat_payouts) {
        const { id, ...zpData } = zp;
        const zpRef = doc(db, 'zakat_payouts', id);
        currentBatch.set(zpRef, { ...zpData, ownerId: uid });
        await checkBatch();
      }
    }

    // Bank reconciliations
    if (rawData.bank_reconciliations && Array.isArray(rawData.bank_reconciliations)) {
      for (const item of rawData.bank_reconciliations) {
        const { id, ...itemData } = item;
        const ref = doc(db, 'bank_reconciliations', id);
        currentBatch.set(ref, { ...itemData, ownerId: uid });
        await checkBatch();
      }
    }

    // Miscellaneous operations
    if (rawData.miscellaneous_operations && Array.isArray(rawData.miscellaneous_operations)) {
      for (const op of rawData.miscellaneous_operations) {
        const { id, ...opData } = op;
        const ref = doc(db, 'miscellaneous_operations', id);
        currentBatch.set(ref, { ...opData, ownerId: uid });
        await checkBatch();
      }
    }

    // TVA declarations
    if (rawData.tva_declarations && Array.isArray(rawData.tva_declarations)) {
      for (const decl of rawData.tva_declarations) {
        const { id, ...declData } = decl;
        const ref = doc(db, 'tva_declarations', id);
        currentBatch.set(ref, { ...declData, ownerId: uid });
        await checkBatch();
      }
    }

    // Returns notes
    if (rawData.returns_notes && Array.isArray(rawData.returns_notes)) {
      for (const note of rawData.returns_notes) {
        const { id, ...noteData } = note;
        const ref = doc(db, 'returns_notes', id);
        currentBatch.set(ref, { ...noteData, ownerId: uid });
        await checkBatch();
      }
    }

    // Sequences
    if (rawData.sequences && Array.isArray(rawData.sequences)) {
      for (const seq of rawData.sequences) {
        const { id, ...seqData } = seq;
        const ref = doc(db, 'sequences', id);
        currentBatch.set(ref, { ...seqData, ownerId: uid });
        await checkBatch();
      }
    }

    // Settings
    if (rawData.settings && Array.isArray(rawData.settings)) {
      for (const set of rawData.settings) {
        const { id, ...setData } = set;
        const ref = doc(db, 'settings', id);
        currentBatch.set(ref, { ...setData, ownerId: uid });
        await checkBatch();
      }
    }

    // VAT audit trail
    if (rawData.vat_audit_trail && Array.isArray(rawData.vat_audit_trail)) {
      for (const item of rawData.vat_audit_trail) {
        const { id, ...itemData } = item;
        const ref = doc(db, 'vat_audit_trail', id);
        currentBatch.set(ref, { ...itemData, calculatedBy: uid });
        await checkBatch();
      }
    }

    if (opCount > 0) {
      await currentBatch.commit();
    }
  } catch (error) {
    console.error('Import backup failed:', error);
    throw error;
  }
};

/**
 * Resets and seeds the database with IT-business relevant sample data.
 */
export const resetAndSeedData = async (uid: string) => {
  console.log('Starting resetAndSeedData...');

  // 1. Delete all existing data
  await forceDeleteAllData(uid);

  // 2. Perform seeding
  console.log(`Now seeding new data for user: ${uid}`);
  try {
    // 0. Suppliers (IT Context)
    const suppliers = [
      {
        name: 'Intel Morocco',
        phone: '0522001122',
        city: 'Casablanca',
        createdAt: serverTimestamp(),
        ownerId: uid,
      },
      {
        name: 'Microsoft Partners',
        phone: '0522334455',
        city: 'Casablanca',
        createdAt: serverTimestamp(),
        ownerId: uid,
      },
      {
        name: 'Logitech MENA',
        phone: '0522112233',
        city: 'Casablanca',
        createdAt: serverTimestamp(),
        ownerId: uid,
      },
    ];

    for (const supplier of suppliers) {
      const supplierRef = await addDoc(collection(db, 'suppliers'), supplier);

      // Seed purchases from this supplier
      const items = [
        'Licences Office 365',
        'Serveurs Dell',
        'Processeurs Core i9',
        'Cartes Graphiques RTX',
        'Casques & Micro',
        'Onduleurs APC',
      ];
      for (let i = 0; i < 4; i++) {
        const price = Math.floor(Math.random() * 10000) + 1000;
        const qty = 1;
        const total = price * qty;
        const d = new Date();
        d.setMonth(d.getMonth() - Math.floor(Math.random() * 3));

        await addDoc(collection(db, 'suppliers', supplierRef.id, 'purchases'), {
          description: items[Math.floor(Math.random() * items.length)],
          price,
          quantity: qty,
          total,
          paymentStatus: 'credit',
          amountPaid: 0,
          date: Timestamp.fromDate(d),
          ownerId: uid,
          supplierId: supplierRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    // 1. Clients (IT Context)
    const clients = [
      {
        name: 'Cyber Cafe Elite',
        phone: '0612345678',
        city: 'Casablanca',
        createdAt: serverTimestamp(),
        ownerId: uid,
      },
      {
        name: 'Youssef Gamer',
        phone: '0687654321',
        city: 'Rabat',
        createdAt: serverTimestamp(),
        ownerId: uid,
      },
      {
        name: 'Agence Design 3D',
        phone: '0699887766',
        city: 'Tanger',
        createdAt: serverTimestamp(),
        ownerId: uid,
      },
      {
        name: 'Ayoub Tech',
        phone: '0655443322',
        city: 'Marrakech',
        createdAt: serverTimestamp(),
        ownerId: uid,
      },
    ];

    for (const client of clients) {
      const clientRef = await addDoc(collection(db, 'clients'), client);

      // Seed purchases for each client over the last 6 months
      const purchaseDescs = [
        'Clavier Mécanique RGB',
        'Souris Gamer Logitech',
        'Écran 27" 144Hz',
        'PC Gamer Custom (RTX 4070)',
        'Casque HyperX',
        'Webcam 4K',
        'Tapis de souris XXL',
        'Disque SSD 1To NVMe',
        'Mémoire RAM 32Go DDR5',
        'Refroidissement Watercooling',
        'Siège Gamer',
        'Microphone Podcast',
      ];

      for (let i = 0; i < 8; i++) {
        const pastMonthOffset = Math.floor(Math.random() * 6);
        const d = new Date();
        d.setMonth(d.getMonth() - pastMonthOffset);
        d.setDate(Math.floor(Math.random() * 28) + 1);

        const price = Math.floor(Math.random() * 4000) + 150;
        const quantity = Math.floor(Math.random() * 3) + 1;
        const total = price * quantity;
        const paymentStatus = Math.random() > 0.3 ? 'paid' : 'credit';
        const amountPaid = paymentStatus === 'paid' ? total : 0;

        const purchaseRef = await addDoc(collection(db, 'clients', clientRef.id, 'purchases'), {
          description: purchaseDescs[Math.floor(Math.random() * purchaseDescs.length)],
          price,
          quantity,
          total,
          paymentStatus,
          amountPaid,
          date: Timestamp.fromDate(d),
          ownerId: uid,
          clientId: clientRef.id,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (amountPaid > 0) {
          await addDoc(collection(db, 'clients', clientRef.id, 'payments'), {
            ownerId: uid,
            amount: amountPaid,
            date: Timestamp.fromDate(d),
            purchaseId: purchaseRef.id,
            notes: `Paiement initial`,
          });
        }
      }
    }

    // 2. Charge Templates
    const templates = [
      {
        titre: 'Salaire Employé 1',
        type: 'FIXED',
        montant: 4500,
        categorie: 'SALAIRE',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 1,
      },
      {
        titre: 'Salaire Employé 2',
        type: 'FIXED',
        montant: 4500,
        categorie: 'SALAIRE',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 1,
      },
      {
        titre: 'Salaire Employé 3',
        type: 'FIXED',
        montant: 5000,
        categorie: 'SALAIRE',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 1,
      },
      {
        titre: 'Salaire Employé 4',
        type: 'FIXED',
        montant: 4000,
        categorie: 'SALAIRE',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 1,
      },
      {
        titre: 'Assurance Auto 1',
        type: 'FIXED',
        montant: 400,
        categorie: 'AUTO',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 5,
      },
      {
        titre: 'Assurance Auto 2',
        type: 'FIXED',
        montant: 350,
        categorie: 'AUTO',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 5,
      },
      {
        titre: 'Assurance Auto 3',
        type: 'FIXED',
        montant: 350,
        categorie: 'AUTO',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 5,
      },
      {
        titre: 'Carburant Auto 1',
        type: 'VARIABLE',
        montant: 1500,
        categorie: 'AUTO',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 15,
      },
      {
        titre: 'Carburant Auto 2',
        type: 'VARIABLE',
        montant: 1200,
        categorie: 'AUTO',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 15,
      },
      {
        titre: 'Carburant Auto 3',
        type: 'VARIABLE',
        montant: 1000,
        categorie: 'AUTO',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 15,
      },
      {
        titre: 'Loyer Local',
        type: 'FIXED',
        montant: 6000,
        categorie: 'LOYER',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 1,
      },
      {
        titre: 'Électricité & Internet',
        type: 'VARIABLE',
        montant: 1500,
        categorie: 'UTILITÉS',
        isActive: true,
        ownerId: uid,
        createdAt: serverTimestamp(),
        dueDay: 20,
      },
    ];

    for (const t of templates) {
      const tRef = await addDoc(collection(db, 'expense_templates'), t);

      // Seed historical data for the last 6 months
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const nowStr = d.toISOString().slice(0, 7);

        let shouldSeed = true;

        if (shouldSeed) {
          let amount = t.montant;
          if (t.type === 'VARIABLE' || t.type === 'CONSUMPTION') {
            amount = Math.floor(amount * (0.8 + Math.random() * 0.4)); // +/- 20%
          }

          const status = i > 0 ? 'PAID' : Math.random() > 0.5 ? 'PAID' : 'PENDING';

          await addDoc(collection(db, 'expenses'), {
            templateId: tRef.id,
            name: t.titre,
            type: t.type,
            amount: amount,
            monthYear: nowStr,
            status: status,
            ownerId: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    console.log('Data reset and seeded successfully.');
  } catch (error) {
    console.error('Error seeding data:', error);
    throw error;
  }
};

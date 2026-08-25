import {
  collection,
  doc,
  getDocs,
  getDoc,
  query,
  where,
  addDoc,
  updateDoc,
  serverTimestamp,
  runTransaction,
  collectionGroup,
} from 'firebase/firestore';
import { db, getCurrentUserId } from '../lib/firebase';
import { CreditNote, CreditNoteSchema } from '../types/creditNote';
import { invoiceService } from './invoiceService';

export const creditNoteService = {
  /**
   * Retrieves the next available reference number for a credit note.
   * E.g. AV-2026-00001
   */
  async getProposedCreditNoteNumber(userId: string): Promise<string> {
    const currentYear = new Date().getFullYear();
    const q = query(
      collectionGroup(db, 'credit_notes'),
      where('ownerId', '==', userId),
      where('refId', '>=', `AV-${currentYear}-`),
      where('refId', '<=', `AV-${currentYear}-\uf8ff`)
    );

    const snap = await getDocs(q);
    let maxNum = 0;
    snap.forEach((d) => {
      const refId = d.data().refId;
      if (refId) {
        const parts = refId.split('-');
        if (parts.length === 3) {
          const num = parseInt(parts[2], 10);
          if (!isNaN(num) && num > maxNum) {
            maxNum = num;
          }
        }
      }
    });

    const nextNum = maxNum + 1;
    return `AV-${currentYear}-${String(nextNum).padStart(5, '0')}`;
  },

  /**
   * Calculates the totals (HT, TVA, TTC) for a list of items.
   */
  calculateTotals(items: any[]) {
    let subtotal = 0;
    let taxAmount = 0;

    items.forEach((item) => {
      const lineTotalHT = item.quantity * item.unitPrice;
      const lineTax = lineTotalHT * (item.taxRate || 0);
      subtotal += lineTotalHT;
      taxAmount += lineTax;
    });

    return {
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
    };
  },

  /**
   * Creates a new draft credit note.
   */
  async createCreditNote(data: Partial<CreditNote>) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('Non autorisé');

    const totals = this.calculateTotals(data.items || []);

    const creditNoteData = {
      ...data,
      ownerId: userId,
      status: 'Brouillon',
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      total: totals.total,
      amountUsed: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Note: Zod validation could be called here if needed, but since it has Dates, it needs preprocessing from Firestore timestamps.
    const docRef = await addDoc(
      collection(db, 'clients', data.clientId!, 'credit_notes'),
      creditNoteData
    );

    return docRef.id;
  },

  /**
   * Validates a credit note, assigning it a final reference number and updating the original invoice.
   */
  async validateCreditNote(clientId: string, creditNoteId: string) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('Non autorisé');

    const creditNoteRef = doc(db, 'clients', clientId, 'credit_notes', creditNoteId);

    await runTransaction(db, async (transaction) => {
      const creditNoteSnap = await transaction.get(creditNoteRef);
      if (!creditNoteSnap.exists()) {
        throw new Error("Avoir introuvable.");
      }

      const creditNoteData = creditNoteSnap.data();
      if (creditNoteData.status !== 'Brouillon') {
        throw new Error("Seul un avoir en brouillon peut être validé.");
      }

      // Generate reference
      const currentYear = new Date().getFullYear();
      
      const seqRef = doc(db, 'sequences', `credit_notes_${userId}_${currentYear}`);
      const seqSnap = await transaction.get(seqRef);
      
      let invoiceRef = null;
      let invoiceSnap = null;
      if (creditNoteData.invoiceId) {
        invoiceRef = doc(db, 'clients', clientId, 'purchases', creditNoteData.invoiceId);
        invoiceSnap = await transaction.get(invoiceRef);
      }

      let nextNum = 1;
      if (seqSnap.exists()) {
        nextNum = (seqSnap.data().last_number || 0) + 1;
      }
      const refId = `AV-${currentYear}-${String(nextNum).padStart(5, '0')}`;
      
      // -- ALL READS DONE -- 
      
      transaction.set(seqRef, { last_number: nextNum }, { merge: true });

      // Update credit note
      console.log('validateCreditNote: Updating credit note...', creditNoteId);
      transaction.update(creditNoteRef, {
        status: 'Validé',
        refId,
        ownerId: creditNoteData.ownerId || userId, // enforce ownerId just in case
        updatedAt: serverTimestamp(),
      });
      console.log('validateCreditNote: Updating original invoice if total cancellation...');
      // Update original invoice status if it's a total cancellation
      if (invoiceSnap && invoiceSnap.exists()) {
        const invoiceData = invoiceSnap.data();
        if (creditNoteData.reason === 'Annulation totale') {
          // If total cancellation, mark invoice as 'Annulée' (Or keep Validée but fully credited)
          // Actually, in many ERPs, it remains 'Validée' but its balance is offset.
          // To keep it simple, we could add a flag or keep it. Let's not mutate the invoice directly unless strictly needed.
          // Wait, the prompt says: "Ne jamais supprimer ni modifier la facture d'origine. Conserver un historique."
        }
      }
    });
  },

  /**
   * Retrieves all credit notes for a specific user.
   */
  async getAllCreditNotes(userId: string) {
    const q = query(collectionGroup(db, 'credit_notes'), where('ownerId', '==', userId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, clientId: d.ref.parent.parent?.id, ...d.data() }));
  },

  /**
   * Cancels a credit note.
   */
  async cancelCreditNote(clientId: string, creditNoteId: string) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('Non autorisé');

    const creditNoteRef = doc(db, 'clients', clientId, 'credit_notes', creditNoteId);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(creditNoteRef);
      if (!snap.exists()) throw new Error("Avoir introuvable");

      const data = snap.data();
      if (data.amountUsed > 0) {
        throw new Error("Impossible d'annuler un avoir déjà partiellement utilisé.");
      }

      transaction.update(creditNoteRef, {
        status: 'Annulé',
        updatedAt: serverTimestamp(),
      });
    });
  },

  /**
   * Applies selected credit notes to a purchase
   */
  async applyCreditNotes(clientId: string, purchaseId: string, usedCredits: Record<string, number>) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('Non autorisé');

    await runTransaction(db, async (transaction) => {
      let totalApplied = 0;
      const updates = [];

      // Verify and collect updates
      for (const [noteId, amountToUse] of Object.entries(usedCredits)) {
        if (amountToUse <= 0) continue;

        const noteRef = doc(db, 'clients', clientId, 'credit_notes', noteId);
        const snap = await transaction.get(noteRef);
        
        if (!snap.exists()) {
          throw new Error(`Avoir ${noteId} introuvable.`);
        }

        const data = snap.data();
        if (data.status !== 'Validé' && data.status !== 'Utilisé') {
          throw new Error(`L'avoir ${data.refId} n'est pas utilisable.`);
        }

        const available = data.total - (data.amountUsed || 0);
        if (amountToUse > available + 0.01) { // 0.01 tolerance for floating point
          throw new Error(`Fonds insuffisants sur l'avoir ${data.refId}.`);
        }

        const newUsed = (data.amountUsed || 0) + amountToUse;
        
        updates.push({
          ref: noteRef,
          data: {
            amountUsed: newUsed,
            status: 'Utilisé', // Even if partially used, we can mark it as "Utilisé" or keep "Validé" if partial. Let's just say 'Utilisé'.
            updatedAt: serverTimestamp(),
          }
        });

        totalApplied += amountToUse;
      }

      // Apply updates
      for (const update of updates) {
        transaction.update(update.ref, update.data);
      }

      // Update the purchase document
      if (totalApplied > 0) {
        const purchaseRef = doc(db, 'clients', clientId, 'purchases', purchaseId);
        transaction.update(purchaseRef, {
          creditNotesUsed: usedCredits,
          creditNotesTotal: totalApplied,
        });
      }
    });
  },
};

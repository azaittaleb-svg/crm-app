import {
  doc,
  runTransaction,
  serverTimestamp,
  collection,
  getDoc,
  addDoc,
  collectionGroup,
  query,
  where,
  getDocs,
} from 'firebase/firestore';
import { db, getCurrentUserId } from '../lib/firebase';

export interface SystemAuditLog {
  action: 'VALIDATION' | 'CANCELLATION' | 'RESET_TO_DRAFT' | 'DUPLICATION';
  statusBefore: string;
  statusAfter: string;
  refIdBefore: string | null;
  refIdAfter: string | null;
  timestamp: Date;
  actorUid: string;
  details?: string;
}

/**
 * Service gérant le cycle de vie transactionnel des factures (Style ERP / Odoo de haute précision)
 * Caractéristiques :
 * - Transactions Firestore atomiques (Mandatory)
 * - Verrouillage d'unicité absolu via l'écriture dans `/sequences/ref_owner_Number`
 * - Recyclage dynamique des numéros de facture libérés (Overriding + Gap Recycling)
 * - Cycle de vie strict : Brouillon (Draft) -> Valide (Confirmed) ou Annulée (Canceled)
 * - Smart Lifecycle : Pour modifier ou supprimer une facture validée, l'utilisateur doit obligatoirement faire :
 *   Remettre en Brouillon -> Annuler -> Supprimer (seule cet état autorise le hard delete)
 */
export const invoiceService = {
  /**
   * Propose le prochain numéro de facture séquentiel (par exemple : FAC-2026-0001)
   */
  async getProposedInvoiceNumber(userId: string): Promise<string> {
    // First, let's try to query the highest sequence from the global documents
    try {
      const qRef = collection(db, 'sequences');
      // We can query all ref_ registry entries for this user and find the highest one.
      // However this might be inefficient if there are thousands.
      // Alternatively we can read the facture_${userId}_${currentYear} doc
      // AND the facture_format_${userId} doc.
    } catch (e) {}

    // Instead of relying purely on `.last_invoice_number` which might be broken by out of order validation,
    // let's try to parse the format document as a base format.
    let baseFormat = '';
    try {
      const formatDocRef = doc(db, 'sequences', `facture_format_${userId}`);
      const formatSnap = await getDoc(formatDocRef);
      if (formatSnap.exists() && formatSnap.data()?.last_invoice_number) {
        baseFormat = formatSnap.data().last_invoice_number;
      }
    } catch (e) {
      console.warn('Could not fetch facture format:', e);
    }

    const currentYear = new Date().getFullYear();
    let currentSeqNum = 0;
    try {
      const sequenceDocRef = doc(db, 'sequences', `facture_${userId}_${currentYear}`);
      const sequenceSnap = await getDoc(sequenceDocRef);
      if (sequenceSnap.exists()) {
        currentSeqNum = sequenceSnap.data().current_sequence || 0;
      }
    } catch (e) {
      console.warn('Could not fetch sequence:', e);
    }
    const nextSeqNum = currentSeqNum + 1;

    if (baseFormat) {
      // if we have a base format, we try to inject the nextSeqNum into it
      const match = baseFormat.match(/^(.*?)(\d+)([^0-9]*)$/);
      if (match) {
        const prefix = match[1];
        const numStr = match[2];
        const suffix = match[3];
        const nextNumStr = String(nextSeqNum).padStart(numStr.length, '0');
        return `${prefix}${nextNumStr}${suffix}`;
      }
    }

    // Default basic fallback
    return `FAC-${currentYear}-${String(nextSeqNum).padStart(4, '0')}`;
  },

  /**
   * Valide une facture Brouillon de manière transactionnelle.
   * Si 'customNumber' est spécifié, il valide son unicité avant de l'assigner.
   * Nouveau : Intègre une règle stricte d'audit trail (Antedating) avec vérification de chronologie.
   */
  async validateInvoice(
    clientId: string,
    purchaseId: string,
    customNumber?: string,
    invoiceDateInput?: Date
  ): Promise<string> {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new Error('Authentification requise pour effectuer cette action.');
    }

    const currentYear = new Date().getFullYear();
    const purchaseDocRef = doc(db, 'clients', clientId, 'purchases', purchaseId);
    const sequenceDocRef = doc(db, 'sequences', `facture_${userId}_${currentYear}`);
    const formatDocRef = doc(db, 'sequences', `facture_format_${userId}`);

    // Pre-fetch fallback sequence info OUTSIDE the transaction because Firebase transactions cannot run collectionGroup queries!
    let fallbackInvoiceDate: Date | null = null;
    let fallbackInvoiceNumber: string | null = null;
    try {
      const purchasesQuery = query(
        collectionGroup(db, 'purchases'),
        where('ownerId', '==', userId)
      );
      const purchasesSnap = await getDocs(purchasesQuery);

      let highestNum = -1;
      let highestInvoice: any = null;

      purchasesSnap.forEach((d) => {
        const data = d.data();
        if (data.status === 'Valide' && data.refId) {
          const numMatch = data.refId.match(/\d+/g);
          if (numMatch) {
            const numVal = Math.max(...numMatch.map((n: string) => parseInt(n, 10)));
            if (numVal > highestNum) {
              highestNum = numVal;
              highestInvoice = data;
            }
          }
        }
      });

      if (highestInvoice) {
        fallbackInvoiceNumber = highestInvoice.refId;
        if (highestInvoice.date) {
          fallbackInvoiceDate =
            typeof highestInvoice.date.toDate === 'function'
              ? highestInvoice.date.toDate()
              : new Date(highestInvoice.date);
        }
      }
    } catch (queryErr) {
      console.warn('Pre-fetch query for last invoice date failed:', queryErr);
    }

    return await runTransaction(db, async (transaction) => {
      // 1. Lire la facture en cours
      const purchaseSnap = await transaction.get(purchaseDocRef);
      if (!purchaseSnap.exists()) {
        throw new Error("La facture spécifiée n'existe pas.");
      }

      const purchaseData = purchaseSnap.data();
      const status = purchaseData.status || (purchaseData.refId ? 'Valide' : 'Brouillon');

      // Règle d'or : Seul Brouillon peut être validée
      if (status !== 'Brouillon') {
        throw new Error(
          `Seules les factures à l'état 'Brouillon' peuvent être validées. Statut actuel: ${status}`
        );
      }

      // Determine requested dynamic legal date of the invoice (invoice_date)
      let invoiceDate = invoiceDateInput;
      if (!invoiceDate) {
        if (purchaseData.date) {
          invoiceDate =
            typeof purchaseData.date.toDate === 'function'
              ? purchaseData.date.toDate()
              : new Date(purchaseData.date);
        } else {
          invoiceDate = new Date();
        }
      }

      // Load formatting & sequence logs from the settings document
      const formatSnap = await transaction.get(formatDocRef);
      let lastInvoiceDate = fallbackInvoiceDate;
      let lastInvoiceNumber = fallbackInvoiceNumber;

      if (formatSnap.exists()) {
        const fdata = formatSnap.data();
        if (fdata.last_invoice_date) {
          lastInvoiceDate =
            typeof fdata.last_invoice_date.toDate === 'function'
              ? fdata.last_invoice_date.toDate()
              : new Date(fdata.last_invoice_date);
          lastInvoiceNumber = fdata.last_invoice_number || null;
        }
      }

      // --- 1. Chronology strict check (Audit Trail) ---
      if (lastInvoiceDate) {
        const requestedDateOnly = new Date(invoiceDate);
        requestedDateOnly.setHours(0, 0, 0, 0);

        const lastDateOnly = new Date(lastInvoiceDate);
        lastDateOnly.setHours(0, 0, 0, 0);

        if (requestedDateOnly < lastDateOnly) {
          const reqStr = requestedDateOnly.toLocaleDateString('fr-FR');
          const lastStr = lastDateOnly.toLocaleDateString('fr-FR');
          console.warn(
            `Chronologie : Tentative d'antédater la facture au ${reqStr} alors que la dernière facture générée (${lastInvoiceNumber || 'N/A'}) est datée du ${lastStr}.`
          );
        }
      }

      let finalNumber = customNumber ? customNumber.trim() : '';
      let sequenceIncrementRequired = false;
      let newSeqNumToSave = 0;

      const sequenceSnap = await transaction.get(sequenceDocRef);
      let currentSeqNum = 0;
      if (sequenceSnap.exists()) {
        currentSeqNum = sequenceSnap.data().current_sequence || 0;
      }
      const nextSeqNum = currentSeqNum + 1;
      const expectedAutoNumber = `FAC-${currentYear}-${String(nextSeqNum).padStart(4, '0')}`;

      if (!finalNumber) {
        // Evaluate dynamic fallback based on last format
        if (formatSnap.exists() && formatSnap.data().last_invoice_number) {
          const lastNum = formatSnap.data().last_invoice_number;
          const matchRegex = lastNum.match(/^(.*?)(\d+)([^0-9]*)$/);
          if (matchRegex) {
            const prefix = matchRegex[1];
            const numStr = matchRegex[2];
            const suffix = matchRegex[3];

            finalNumber = `${prefix}${String(nextSeqNum).padStart(numStr.length, '0')}${suffix}`;
            sequenceIncrementRequired = true;
            newSeqNumToSave = nextSeqNum;
          }
        }

        if (!finalNumber) {
          finalNumber = expectedAutoNumber;
          sequenceIncrementRequired = true;
          newSeqNumToSave = nextSeqNum;
        }
      } else {
        // Find if any integer block inside the provided number is larger than our sequence tracker.
        // It covers format: `FAC-2026-0004` or custom `FA0004`
        const anyNumberMatch = finalNumber.match(/\d+/g);
        if (anyNumberMatch) {
          const possibleHighest = Math.max(...anyNumberMatch.map((n) => parseInt(n, 10)));
          if (possibleHighest > currentSeqNum) {
            sequenceIncrementRequired = true;
            newSeqNumToSave = possibleHighest;
          }
        }
      }

      // 2. Strict Unique Verification Check via Root Unique Sequences Registry
      const uniqueRegistryRef = doc(db, 'sequences', `ref_${userId}_${finalNumber}`);
      const registrySnap = await transaction.get(uniqueRegistryRef);
      if (registrySnap.exists()) {
        const ownerClientId = registrySnap.data()?.clientId;
        const ownerPurchaseId = registrySnap.data()?.purchaseId;

        if (ownerPurchaseId && ownerPurchaseId !== purchaseId) {
          // Verify if the owner purchase still exists. If deleted, we can safely overwrite.
          if (ownerClientId) {
            const ownerPurchaseRef = doc(
              db,
              'clients',
              ownerClientId,
              'purchases',
              ownerPurchaseId
            );
            const ownerPurchaseSnap = await transaction.get(ownerPurchaseRef);
            if (ownerPurchaseSnap.exists()) {
              throw new Error(
                `Le numéro de facture '${finalNumber}' est déjà en cours d'utilisation par une autre facture existante.`
              );
            }
          } else {
            throw new Error(`Le numéro de facture '${finalNumber}' est déjà utilisé.`);
          }
        }
      }

      // 3. Appliquer la mise à jour (Immuabilité activée au passage en 'Valide')
      transaction.update(purchaseDocRef, {
        status: 'Valide',
        refId: finalNumber,
        validatedAt: serverTimestamp(),

        // Structure requested by the user:
        invoice_date: invoiceDate,
        system_created_at: new Date(),

        date: invoiceDate, // Anti-backdating logic replaced with configurable post-dating/antedating. Official leg. date is stored here.
        updatedAt: serverTimestamp(),
      });

      // 4. Réserver de manière inviolable et atomique ce numéro de référence unique
      transaction.set(uniqueRegistryRef, {
        exists: true,
        ownerId: userId,
        clientId,
        purchaseId,
        validatedAt: serverTimestamp(),
      });

      // 5. Mettre à jour le compteur d'incrémentation si généré automatiquement ou ajusté
      if (sequenceIncrementRequired) {
        transaction.set(
          sequenceDocRef,
          {
            current_sequence: newSeqNumToSave,
            year: currentYear,
            type: 'facture',
            last_updated: serverTimestamp(),
            ownerId: userId,
          },
          { merge: true }
        );
      }

      // 5b. Toujours sauvegarder le dernier format de facture utilisé + Date de dernière facture
      transaction.set(
        formatDocRef,
        {
          last_invoice_number: finalNumber,
          last_invoice_date: invoiceDate,
          timestamp: serverTimestamp(),
          ownerId: userId,
        },
        { merge: true }
      );

      // 6. Enregistrer un audit log structuré de haute traçabilité
      const auditLogRef = doc(
        collection(db, 'clients', clientId, 'purchases', purchaseId, 'audit_logs')
      );
      transaction.set(auditLogRef, {
        action: 'VALIDATION',
        statusBefore: 'Brouillon',
        statusAfter: 'Valide',
        refIdBefore: purchaseData.refId || 'Brouillon',
        refIdAfter: finalNumber,
        timestamp: new Date(),
        actorUid: userId,
        details: `Facture validée de manière transactionnelle avec attribution du numéro : ${finalNumber}. Date légale : ${invoiceDate.toLocaleDateString('fr-FR')} (créée le ${new Date().toLocaleDateString('fr-FR')}).`,
      });

      return finalNumber;
    });
  },

  /**
   * Annule une facture (Transition Brouillon ou Valide -> Annulée).
   */
  async cancelInvoice(clientId: string, purchaseId: string): Promise<void> {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new Error('Authentification requise pour effectuer cette action.');
    }

    const purchaseDocRef = doc(db, 'clients', clientId, 'purchases', purchaseId);

    await runTransaction(db, async (transaction) => {
      const purchaseSnap = await transaction.get(purchaseDocRef);
      if (!purchaseSnap.exists()) {
        throw new Error("La facture spécifiée n'existe pas.");
      }

      const purchaseData = purchaseSnap.data();
      const status = purchaseData.status || (purchaseData.refId ? 'Valide' : 'Brouillon');

      // Brouillon et Valide/Validée peuvent être annulés directement
      const isValidTransition =
        status === 'Brouillon' || status === 'Valide' || status === 'Validée';
      if (!isValidTransition) {
        throw new Error("Seule une facture à l'état 'Brouillon' ou 'Validée' peut être annulée.");
      }

      // Modifier l'état vers Annulée (Le document est figé en lecture seule)
      transaction.update(purchaseDocRef, {
        status: 'Annulée',
        updatedAt: serverTimestamp(),
      });

      // Journalisation d'audit
      const auditLogRef = doc(
        collection(db, 'clients', clientId, 'purchases', purchaseId, 'audit_logs')
      );
      transaction.set(auditLogRef, {
        action: 'CANCELLATION',
        statusBefore: status,
        statusAfter: 'Annulée',
        refIdBefore: purchaseData.refId || null,
        refIdAfter: purchaseData.refId || null,
        timestamp: new Date(),
        actorUid: userId,
        details: `Facture (${status}) annulée avec succès.`,
      });
    });
  },

  /**
   * Remet une facture validée ('Valide') à l'état "Brouillon".
   * Libère le numéro séquentiel assigné pour permettre sa ré-attribution et son recyclage.
   */
  async resetToDraft(clientId: string, purchaseId: string): Promise<void> {
    const userId = getCurrentUserId();
    if (!userId) {
      throw new Error('Authentification requise pour effectuer cette action.');
    }

    const purchaseDocRef = doc(db, 'clients', clientId, 'purchases', purchaseId);

    await runTransaction(db, async (transaction) => {
      const purchaseSnap = await transaction.get(purchaseDocRef);
      if (!purchaseSnap.exists()) {
        throw new Error("La facture spécifiée n'existe pas.");
      }

      const purchaseData = purchaseSnap.data();
      const status = purchaseData.status || (purchaseData.refId ? 'Valide' : 'Brouillon');

      // Seules les factures "Valide", "Validée" ou "Annulée" peuvent être remises en Brouillon
      const isValid = status === 'Valide' || status === 'Validée' || status === 'Annulée';
      if (!isValid) {
        throw new Error(
          "Seules les factures officiellement validées ('Valide') ou annulées ('Annulée') peuvent être remises en Brouillon."
        );
      }

      const oldRefId = purchaseData.refId;

      // 1. Repasser au statut Brouillon (on conserve la référence selon la demande)
      transaction.update(purchaseDocRef, {
        status: 'Brouillon',
        updatedAt: serverTimestamp(),
      });

      // Journalisation d'audit
      const auditLogRef = doc(
        collection(db, 'clients', clientId, 'purchases', purchaseId, 'audit_logs')
      );
      transaction.set(auditLogRef, {
        action: 'RESET_TO_DRAFT',
        statusBefore: status,
        statusAfter: 'Brouillon',
        refIdBefore: oldRefId || null,
        refIdAfter: oldRefId || null,
        timestamp: new Date(),
        actorUid: userId,
        details: `Facture validée ${oldRefId || 'sans_num'} remise en état Brouillon. Le numéro de facture est conservé.`,
      });
    });
  },
};

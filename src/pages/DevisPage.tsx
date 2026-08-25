import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { backendService } from '../services/backendService';
import {
  collectionGroup,
  collection,
  onSnapshot,
  doc,
  writeBatch,
  query,
  where,
  addDoc,
  getDocs,
  deleteField,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  Calendar,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  FileText,
  Eye,
  Pencil,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  ArrowUpDown,
  ShoppingBag,
  Clock,
  ArrowRight,
  Copy,
  Printer,
  Send,
  MessageSquare,
  ChevronDown,
  X,
  Settings,
  Check,
  MoreVertical,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import html2pdf from 'html2pdf.js';
import { generatePDF, getPDFBase64 } from '../utils/pdfGenerator';
import { mapDocToInvoiceData } from '../utils/invoiceMapper';
import { COMPANY_INFO } from '../constants';
import { isLandlinePhone } from '../services/whatsappService';
import { convertNumberToFrenchWords } from '../utils/numberToWords';
import { InvoicePrint } from '../components/InvoicePrint';
import { InvoiceData } from '../types';

export default function DevisPage() {
  const [allPurchases, setAllPurchases] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [clientsMap, setClientsMap] = useState<Record<string, string>>({});
  const [search, setSearch] = useState(() => localStorage.getItem('devis_filter_search') || '');
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'converted'>(() => {
    const val = localStorage.getItem('devis_filter_activeTab');
    return (val as any) || 'all';
  });
  const [sortBy, setSortBy] = useState<
    'recent' | 'oldest' | 'highest' | 'lowest' | 'ref_asc' | 'ref_desc'
  >(() => {
    const val = localStorage.getItem('devis_filter_sortBy');
    return (val as any) || 'recent';
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const val = localStorage.getItem('devis_filter_pageSize');
    return val ? Number(val) : 10;
  });
  const [selectedDevisIds, setSelectedDevisIds] = useState<string[]>([]);
  const [isBulkDropdownOpen, setIsBulkDropdownOpen] = useState(false);
  const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
  const [openActionDropdownId, setOpenActionDropdownId] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'year'>('all');
  const [isDateDropdownOpen, setIsDateDropdownOpen] = useState(false);

  // Persist filter states to localStorage
  useEffect(() => {
    localStorage.setItem('devis_filter_search', search);
  }, [search]);

  useEffect(() => {
    localStorage.setItem('devis_filter_activeTab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem('devis_filter_sortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('devis_filter_pageSize', String(pageSize));
  }, [pageSize]);

  // Email dispatch states
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailingInvoice, setEmailingInvoice] = useState<any>(null);

  // Printing Queue states
  const [printingQueue, setPrintingQueue] = useState<any[]>([]);
  const [currentPrintIndex, setCurrentPrintIndex] = useState(-1);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, activeTab, dateFilter]);

  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;

    // Fetch clients mapping
    const unsubscribeClients = onSnapshot(
      query(collection(db, 'clients'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        const clientList = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        setClients(clientList);

        const newMap: Record<string, string> = {};
        snapshot.forEach((doc) => {
          newMap[doc.id] = doc.data().name || 'Client Inconnu';
        });
        setClientsMap(newMap);
      }
    );

    // Fetch comprehensive purchases list to compute dynamic chronological indexes
    const unsubscribePurchases = onSnapshot(
      query(collectionGroup(db, 'purchases'), where('ownerId', '==', user.uid)),
      (snapshot) => {
        const data = snapshot.docs
          .map((doc) => {
            const parts = doc.ref.path.split('/');
            return {
              id: doc.id,
              ...doc.data(),
              clientId: parts[1] || doc.ref.parent.parent?.id,
              parentPath: parts[0] || doc.ref.parent.parent?.parent.id,
            } as any;
          })
          .filter((p) => p.parentPath === 'clients');

        setAllPurchases(data);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'collectionGroup(purchases) for Devis');
      }
    );

    return () => {
      unsubscribeClients();
      unsubscribePurchases();
    };
  }, [user]);

  // Compute dynamic references for devis based on ascending chronolgoical order
  const devisListWithRefs = useMemo(() => {
    const rawDevis = allPurchases.filter((p) => p.type === 'devis');
    rawDevis.sort((a, b) => {
      const dateA = a.date?.toMillis
        ? a.date.toMillis()
        : a.date instanceof Date
          ? a.date.getTime()
          : 0;
      const dateB = b.date?.toMillis
        ? b.date.toMillis()
        : b.date instanceof Date
          ? b.date.getTime()
          : 0;
      return dateA - dateB;
    });

    return rawDevis.map((item, index) => ({
      ...item,
      refId: item.refId || `S${String(index + 1).padStart(5, '0')}`,
    }));
  }, [allPurchases]);

  // Valid purchases (commandes or factures) to determine dynamic 'Converti' status
  const validConvertedIds = useMemo(() => {
    return new Set(
      allPurchases
        .filter(
          (p) =>
            (p.type === 'commande' || p.type === 'facture') &&
            p.status !== 'Annulée' &&
            p.status !== 'Annulé'
        )
        .map((p) => p.id)
    );
  }, [allPurchases]);

  // Synchronize and persist calculated refIds back to Firestore for permanent non-shifting
  useEffect(() => {
    if (!user || allPurchases.length === 0 || devisListWithRefs.length === 0) return;

    const devisMissing = allPurchases.filter((p) => p.type === 'devis' && !p.refId);
    if (devisMissing.length > 0) {
      const batch = writeBatch(db);
      let count = 0;
      devisMissing.forEach((item) => {
        const calculated = devisListWithRefs.find((r) => r.id === item.id);
        if (calculated && calculated.refId && item.clientId) {
          const docRef = doc(db, 'clients', item.clientId, 'purchases', item.id);
          batch.update(docRef, { refId: calculated.refId });
          count++;
        }
      });
      if (count > 0) {
        batch
          .commit()
          .then(() => console.log(`Persisted ${count} devis refIds.`))
          .catch((err) => console.error('Error migrating devis static references:', err));
      }
    }
  }, [allPurchases, devisListWithRefs, user]);

  // Statistics
  const stats = useMemo(() => {
    let totalCount = devisListWithRefs.length;
    let convertedCount = 0;
    let pendingCount = 0;
    let totalVolume = 0;
    let convertedVolume = 0;
    let pendingVolume = 0;

    devisListWithRefs.forEach((d) => {
      const total = Number(d.total) || 0;
      totalVolume += total;
      if (d.child_id) {
        convertedCount++;
        convertedVolume += total;
      } else {
        pendingCount++;
        pendingVolume += total;
      }
    });

    const conversionRate = totalCount > 0 ? (convertedCount / totalCount) * 100 : 0;

    return {
      totalCount,
      convertedCount,
      pendingCount,
      totalVolume,
      convertedVolume,
      pendingVolume,
      conversionRate,
    };
  }, [devisListWithRefs]);

  // Handle conversion of quote to custom document type ('commande' or 'facture')
  const handleConvert = async (dev: any, targetType: 'commande' | 'facture') => {
    confirm({
      title:
        targetType === 'commande'
          ? 'Convertir en Commande ?'
          : 'Convertir en Facture (Brouillon) ?',
      message:
        targetType === 'commande'
          ? `Voulez-vous générer un document de type commande à partir de ce devis ${dev.refId} ?`
          : `Voulez-vous générer une facture de vente sous l'état "Brouillon" à partir de ce devis ${dev.refId} ? Elle pourra être validée ultérieurement.`,
      onConfirm: async () => {
        try {
          // Determine next static sequence number for target document type
          let calculatedRefId = '';
          if (targetType === 'commande') {
            let maxNum = 0;
            allPurchases.forEach((p) => {
              const isTargetType = !p.type || p.type === 'commande';

              if (isTargetType) {
                const refVal = p.refId;
                if (refVal && typeof refVal === 'string') {
                  const match = refVal.match(/(\d+)$/);
                  if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) {
                      maxNum = num;
                    }
                  }
                }
              }
            });
            const nextNum = maxNum + 1;
            calculatedRefId = `C${String(nextNum).padStart(5, '0')}`;
          }

          const batch = writeBatch(db);

          // 1. Create target document
          const newDocRef = doc(collection(db, 'clients', dev.clientId, 'purchases'));
          const newDocId = newDocRef.id;

          const newDocData = {
            ownerId: dev.ownerId,
            clientId: dev.clientId,
            items: dev.items || [],
            description: dev.description || '',
            price: dev.price || 0,
            quantity: dev.quantity || 0,
            subtotal: dev.subtotal || 0,
            taxAmount: dev.taxAmount || 0,
            taxRate: dev.taxRate || 0,
            total: dev.total || 0,
            paymentStatus: 'credit',
            amountPaid: 0,
            date: new Date(), // Conversion timestamp
            parent_id: dev.id,
            type: targetType,
            conditions_paiement: dev.conditions_paiement || 'Paiement à la livraison',
            notes: `Converti automatiquement depuis le Devis ${dev.refId}.`,
            notesList: [`Converti automatiquement depuis le Devis ${dev.refId}.`],
            refId: targetType === 'facture' ? null : calculatedRefId,
            status: targetType === 'facture' ? 'Brouillon' : 'Validée',
          };

          batch.set(newDocRef, newDocData);

          // 2. Link child to parent
          const devRef = doc(db, 'clients', dev.clientId, 'purchases', dev.id);
          batch.update(devRef, { child_id: newDocId });

          await batch.commit();
          showToast(
            targetType === 'commande'
              ? 'Devis converti en commande avec succès !'
              : 'Devis converti en Facture (Brouillon) avec succès !',
            'success'
          );
          navigate(targetType === 'commande' ? '/purchases' : '/facturation');
        } catch (err) {
          console.error(err);
          showToast('Une erreur est survenue lors de la conversion.', 'error');
        }
      },
    });
  };

  const handleDuplicate = async (dev: any) => {
    confirm({
      title: 'Dupliquer le devis ?',
      message: `Voulez-vous créer une copie exacte de ce devis (${dev.refId}) ?`,
      onConfirm: async () => {
        try {
          // Determine next sequence number for devis using state list
          let maxNum = 0;
          devisListWithRefs.forEach((d) => {
            const refVal = d.refId;
            if (refVal && typeof refVal === 'string') {
              const match = refVal.match(/(\d+)$/);
              if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) {
                  maxNum = num;
                }
              }
            }
          });
          const nextNum = maxNum + 1;
          const calculatedRefId = `S${String(nextNum).padStart(5, '0')}`;

          // 2. Add duplicated document
          await addDoc(collection(db, 'clients', dev.clientId, 'purchases'), {
            ownerId: user.uid,
            clientId: dev.clientId,
            type: 'devis',
            conditions_paiement: dev.conditions_paiement || 'Paiement immédiat',
            items: dev.items || [],
            description: dev.description || '',
            price: dev.price || 0,
            quantity: dev.quantity || 0,
            subtotal: dev.subtotal || 0,
            taxAmount: dev.taxAmount || 0,
            taxRate: dev.taxRate || 0,
            total: dev.total || 0,
            paymentStatus: dev.paymentStatus || 'credit',
            amountPaid: dev.amountPaid || 0,
            dueDate: dev.dueDate || null,
            date: new Date(), // Today is the duplication date
            notes: (dev.notes ? dev.notes + '\n' : '') + `Dupliqué depuis Devis ${dev.refId}`,
            notesList: [...(dev.notesList || []), `Dupliqué depuis Devis ${dev.refId}`],
            refId: calculatedRefId,
          });

          showToast('Devis dupliqué avec succès !', 'success');
        } catch (error) {
          console.error(error);
          showToast('Erreur lors de la duplication', 'error');
          handleFirestoreError(error, OperationType.CREATE, 'purchases');
        }
      },
    });
  };

  const handleBulkConvertToFacture = async () => {
    if (selectedDevisIds.length === 0) return;
    const selectedDevisRaw = devisListWithRefs.filter((d) => selectedDevisIds.includes(d.id));
    const selectedDevis = selectedDevisRaw.filter(
      (d) => !(d.child_id && validConvertedIds.has(d.child_id))
    );

    if (selectedDevis.length === 0) {
      showToast('Tous les devis sélectionnés ont déjà été convertis.', 'error');
      return;
    }

    confirm({
      title: 'Convertir en Factures (Brouillon) ?',
      message: `Voulez-vous générer ${selectedDevis.length} facture(s) de vente sous l'état "Brouillon" à partir des devis non convertis sélectionnés ?`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          selectedDevis.forEach((dev) => {
            const newDocRef = doc(collection(db, 'clients', dev.clientId, 'purchases'));
            const newDocId = newDocRef.id;

            const newDocData = {
              ownerId: dev.ownerId,
              clientId: dev.clientId,
              items: dev.items || [],
              description: dev.description || '',
              price: dev.price || 0,
              quantity: dev.quantity || 0,
              subtotal: dev.subtotal || 0,
              taxAmount: dev.taxAmount || 0,
              taxRate: dev.taxRate || 0,
              total: dev.total || 0,
              paymentStatus: 'credit',
              amountPaid: 0,
              date: new Date(),
              parent_id: dev.id,
              type: 'facture',
              conditions_paiement: dev.conditions_paiement || 'Paiement à la livraison',
              notes: `Converti automatiquement depuis le Devis ${dev.refId}.`,
              notesList: [`Converti automatiquement depuis le Devis ${dev.refId}.`],
              refId: null,
              status: 'Brouillon',
            };

            batch.set(newDocRef, newDocData);

            const devRef = doc(db, 'clients', dev.clientId, 'purchases', dev.id);
            batch.update(devRef, { child_id: newDocId });
          });

          await batch.commit();
          showToast(
            `${selectedDevis.length} devis convertis en facture(s) "Brouillon" avec succès !`,
            'success'
          );
          setSelectedDevisIds([]);
          navigate('/facturation');
        } catch (err) {
          console.error(err);
          showToast('Une erreur est survenue lors de la conversion.', 'error');
        }
      },
    });
  };

  const handleBulkConvertToCommande = async () => {
    if (selectedDevisIds.length === 0) return;
    const selectedDevisRaw = devisListWithRefs.filter((d) => selectedDevisIds.includes(d.id));
    const selectedDevis = selectedDevisRaw.filter(
      (d) => !(d.child_id && validConvertedIds.has(d.child_id))
    );

    if (selectedDevis.length === 0) {
      showToast('Tous les devis sélectionnés ont déjà été convertis.', 'error');
      return;
    }

    confirm({
      title: 'Convertir en Commandes ?',
      message: `Voulez-vous générer ${selectedDevis.length} commande(s) à partir des devis non convertis sélectionnés ?`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);

          let maxNum = 0;
          allPurchases.forEach((p) => {
            const isTargetType = !p.type || p.type === 'commande';
            if (isTargetType) {
              const refVal = p.refId;
              if (refVal && typeof refVal === 'string') {
                const match = refVal.match(/(\d+)$/);
                if (match) {
                  const num = parseInt(match[1], 10);
                  if (num > maxNum) {
                    maxNum = num;
                  }
                }
              }
            }
          });

          selectedDevis.forEach((dev, idx) => {
            const nextNum = maxNum + 1 + idx;
            const calculatedRefId = `C${String(nextNum).padStart(5, '0')}`;

            const newDocRef = doc(collection(db, 'clients', dev.clientId, 'purchases'));
            const newDocId = newDocRef.id;

            const newDocData = {
              ownerId: dev.ownerId,
              clientId: dev.clientId,
              items: dev.items || [],
              description: dev.description || '',
              price: dev.price || 0,
              quantity: dev.quantity || 0,
              subtotal: dev.subtotal || 0,
              taxAmount: dev.taxAmount || 0,
              taxRate: dev.taxRate || 0,
              total: dev.total || 0,
              paymentStatus: 'credit',
              amountPaid: 0,
              date: new Date(),
              parent_id: dev.id,
              type: 'commande',
              conditions_paiement: dev.conditions_paiement || 'Paiement à la livraison',
              notes: `Converti automatiquement depuis le Devis ${dev.refId}.`,
              notesList: [`Converti automatiquement depuis le Devis ${dev.refId}.`],
              refId: calculatedRefId,
              status: 'Validée',
            };

            batch.set(newDocRef, newDocData);

            const devRef = doc(db, 'clients', dev.clientId, 'purchases', dev.id);
            batch.update(devRef, { child_id: newDocId });
          });

          await batch.commit();
          showToast(
            `${selectedDevis.length} devis convertis en commande(s) avec succès !`,
            'success'
          );
          setSelectedDevisIds([]);
          navigate('/purchases');
        } catch (err) {
          console.error(err);
          showToast('Une erreur est survenue lors de la conversion.', 'error');
        }
      },
    });
  };

  const handleBulkDuplicate = async () => {
    if (selectedDevisIds.length === 0) return;
    const selectedDevis = devisListWithRefs.filter((d) => selectedDevisIds.includes(d.id));

    confirm({
      title: 'Dupliquer les devis sélectionnés ?',
      message: `Voulez-vous créer une copie exacte des ${selectedDevis.length} devis sélectionnés ?`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);

          let maxNum = 0;
          devisListWithRefs.forEach((d) => {
            const refVal = d.refId;
            if (refVal && typeof refVal === 'string') {
              const match = refVal.match(/(\d+)$/);
              if (match) {
                const num = parseInt(match[1], 10);
                if (num > maxNum) {
                  maxNum = num;
                }
              }
            }
          });

          selectedDevis.forEach((dev, idx) => {
            const nextNum = maxNum + 1 + idx;
            const calculatedRefId = `S${String(nextNum).padStart(5, '0')}`;

            const newDocRef = doc(collection(db, 'clients', dev.clientId, 'purchases'));
            const newDocData = {
              ownerId: user.uid,
              clientId: dev.clientId,
              type: 'devis',
              conditions_paiement: dev.conditions_paiement || 'Paiement immédiat',
              items: dev.items || [],
              description: dev.description || '',
              price: dev.price || 0,
              quantity: dev.quantity || 0,
              subtotal: dev.subtotal || 0,
              taxAmount: dev.taxAmount || 0,
              taxRate: dev.taxRate || 0,
              total: dev.total || 0,
              paymentStatus: dev.paymentStatus || 'credit',
              amountPaid: dev.amountPaid || 0,
              dueDate: dev.dueDate || null,
              date: new Date(),
              notes: (dev.notes ? dev.notes + '\n' : '') + `Dupliqué depuis Devis ${dev.refId}`,
              notesList: [...(dev.notesList || []), `Dupliqué depuis Devis ${dev.refId}`],
              refId: calculatedRefId,
            };

            batch.set(newDocRef, newDocData);
          });

          await batch.commit();
          showToast(`${selectedDevis.length} devis dupliqués avec succès !`, 'success');
          setSelectedDevisIds([]);
        } catch (error) {
          console.error(error);
          showToast('Erreur lors de la duplication en bloc', 'error');
        }
      },
    });
  };

  const handleBulkDelete = async () => {
    if (selectedDevisIds.length === 0) return;
    const selectedDevis = devisListWithRefs.filter((d) => selectedDevisIds.includes(d.id));

    confirm({
      title: 'Supprimer les devis sélectionnés ?',
      message: `Attention, cette opération supprimera définitivement les ${selectedDevis.length} pièces de devis client sélectionnées.`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          selectedDevis.forEach((dev) => {
            batch.delete(doc(db, 'clients', dev.clientId, 'purchases', dev.id));
            if (dev.parent_id) {
              batch.update(doc(db, 'clients', dev.clientId, 'purchases', dev.parent_id), { child_id: deleteField() });
            }
          });
          await batch.commit();
          showToast(`${selectedDevis.length} devis supprimés`, 'success');
          setSelectedDevisIds([]);
        } catch (err) {
          console.error(err);
          showToast('Erreur de suppression', 'error');
        }
      },
    });
  };

  const handleBulkSend = async () => {
    const selected = devisListWithRefs.filter((f) => selectedDevisIds.includes(f.id));
    if (selected.length === 0) {
      showToast('Veuillez sélectionner un devis à envoyer.', 'error');
      return;
    }
    if (selected.length > 1) {
      showToast("Veuillez sélectionner un seul devis pour l'envoi par email.", 'error');
      return;
    }

    const dev = selected[0];
    const clientName = clientsMap[dev.clientId] || 'Client';
    const clientObj = clients.find((c) => c.id === dev.clientId);
    setEmailingInvoice(dev);
    setEmailTo(clientObj?.email || '');
    const computedRefId = dev.refId || 'Brouillon';
    setEmailSubject(`Votre devis - ${computedRefId}`);
    const totalFormatted = Number(dev.total || 0).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    setEmailBody(
      `Bonjour ${clientName},\n\nVotre devis ${computedRefId} d'un montant de ${totalFormatted} DH attend votre validation.\n\nN'hésitez pas à nous contacter si vous avez des questions.\n\nCordialement.`
    );
    setShowEmailModal(true);
  };

  const handlePrintSingle = (dev: any) => {
    setPrintingQueue([dev]);
    setCurrentPrintIndex(0);
  };

  const handleSendSingle = (dev: any) => {
    const clientName = clientsMap[dev.clientId] || 'Client';
    const clientObj = clients.find((c) => c.id === dev.clientId);
    setEmailingInvoice(dev);
    setEmailTo(clientObj?.email || '');
    const computedRefId = dev.refId || 'Brouillon';
    setEmailSubject(`Votre devis - ${computedRefId}`);
    const totalFormatted = Number(dev.total || 0).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    setEmailBody(
      `Bonjour ${clientName},\n\nVotre devis ${computedRefId} d'un montant de ${totalFormatted} DH attend votre validation.\n\nN'hésitez pas à nous contacter si vous avez des questions.\n\nCordialement.`
    );
    setShowEmailModal(true);
  };

  const handleDeleteSingle = (dev: any) => {
    confirm({
      title: 'Supprimer ce devis ?',
      message: `Attention, cette opération supprimera définitivement le devis ${dev.refId}.`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          batch.delete(doc(db, 'clients', dev.clientId, 'purchases', dev.id));
          if (dev.parent_id) {
            batch.update(doc(db, 'clients', dev.clientId, 'purchases', dev.parent_id), { child_id: deleteField() });
          }
          await batch.commit();
          showToast(`Devis ${dev.refId} supprimé`, 'success');
        } catch (err) {
          console.error(err);
          showToast('Erreur de suppression', 'error');
        }
      },
    });
  };

  const handleSendEmail = async () => {
    if (!emailTo) {
      showToast('Veuillez saisir une adresse email.', 'error');
      return;
    }
    setSendingEmail(true);
    try {
      const element = document.getElementById('hidden-pdf-content');
      if (!element) {
        throw new Error("L'élément de devis est introuvable.");
      }

      const computedRefId = emailingInvoice.refId || 'Brouillon';
      const pType = emailingInvoice.type || 'devis';

      const pdfBase64 = await getPDFBase64(element, { filename: `${pType}_${computedRefId}.pdf` });

      await backendService.sendEmail({
        to: emailTo,
        subject: emailSubject,
        body: emailBody.replace(/\n/g, '<br>'),
        attachmentName: `${pType}_${computedRefId}.pdf`,
        pdfBase64,
      });

      showToast('Email envoyé avec succès !', 'success');
      setShowEmailModal(false);
      setEmailingInvoice(null);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Impossible d'envoyer l'email.", 'error');
    } finally {
      setSendingEmail(false);
    }
  };

  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);
  const handleSendWhatsApp = async () => {
    if (!emailingInvoice) return;
    const clientObj = clients.find((c) => c.id === emailingInvoice.clientId);
    const phone = clientObj?.phone || '';
    if (!phone) {
      showToast("Ce client n'a pas de numéro de téléphone renseigné.", 'error');
      return;
    }
    if (isLandlinePhone(phone)) {
      showToast("Le numéro de ce client est une ligne fixe (05...), impossible d'envoyer par WhatsApp.", 'error');
      return;
    }
    setSendingWhatsApp(true);
    try {
      showToast('Envoi du devis par WhatsApp via OpenWA...', 'info');
      const { sendWhatsAppMessage } = await import('../services/whatsappService');
      const res = await sendWhatsAppMessage(phone, emailBody);
      if (res.success) {
        showToast('Devis envoyé par WhatsApp avec succès.', 'success');
        setShowEmailModal(false);
        setEmailingInvoice(null);
      } else {
        showToast('Erreur WhatsApp: ' + res.error, 'error');
      }
    } catch (err: any) {
      showToast(err.message || "Erreur lors de l'envoi WhatsApp.", 'error');
    } finally {
      setSendingWhatsApp(false);
    }
  };

  useEffect(() => {
    if (printingQueue.length === 0) return;

    const timer = setTimeout(async () => {
      const element = document.getElementById('hidden-pdf-content');
      if (!element) {
        console.error('hidden-pdf-content template element not found in DOM');
        setPrintingQueue([]);
        return;
      }

      const filename =
        printingQueue.length === 1
          ? `${printingQueue[0].type || 'devis'}_${printingQueue[0].refId || 'Brouillon'}.pdf`
          : `Export_${printingQueue.length}_devis.pdf`;

      try {
        await generatePDF(element, { filename });
        showToast(
          printingQueue.length === 1 ? `PDF généré avec succès` : `PDF groupé généré avec succès`,
          'success'
        );
      } catch (err) {
        console.error('Error generating grouped PDF', err);
        showToast(`Erreur lors de la génération du PDF`, 'error');
      }

      setPrintingQueue([]);
      setSelectedDevisIds([]);
    }, 450);

    return () => clearTimeout(timer);
  }, [printingQueue]);

  const handleBulkPrint = () => {
    const selected = devisListWithRefs.filter((f) => selectedDevisIds.includes(f.id));
    if (selected.length === 0) {
      showToast('Veuillez sélectionner au moins un devis à imprimer.', 'error');
      return;
    }
    showToast(`Génération du PDF groupé pour ${selected.length} devis lancé...`, 'success');
    setPrintingQueue(selected);
  };

  // Filtered and Sorted devis list
  const filteredDevis = useMemo(() => {
    let list = devisListWithRefs.filter((p) => {
      const clientName = clientsMap[p.clientId] || 'Client Inconnu';
      const matchQuery =
        p.description.toLowerCase().includes(search.toLowerCase()) ||
        clientName.toLowerCase().includes(search.toLowerCase()) ||
        p.refId.toLowerCase().includes(search.toLowerCase());

      if (!matchQuery) return false;

      const isConverted = p.child_id && validConvertedIds.has(p.child_id);
      if (activeTab === 'pending') return !isConverted;
      if (activeTab === 'converted') return isConverted;

      return true;
    });

    if (dateFilter !== 'all') {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      list = list.filter((p) => {
        const pDate = p.date?.toDate ? p.date.toDate() : p.date ? new Date(p.date) : null;
        if (!pDate) return false;

        if (dateFilter === 'today') {
          const pZero = new Date(pDate.getFullYear(), pDate.getMonth(), pDate.getDate());
          return pZero.getTime() === todayStart.getTime();
        }
        if (dateFilter === 'week') {
          const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          return pDate >= oneWeekAgo;
        }
        if (dateFilter === 'month') {
          const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          return pDate >= oneMonthAgo;
        }
        if (dateFilter === 'year') {
          const oneYearAgo = new Date(now.getFullYear(), 0, 1);
          return pDate >= oneYearAgo;
        }
        return true;
      });
    }

    list.sort((a, b) => {
      const dateA = a.date?.toMillis ? a.date.toMillis() : 0;
      const dateB = b.date?.toMillis ? b.date.toMillis() : 0;
      const totalA = Number(a.total) || 0;
      const totalB = Number(b.total) || 0;

      if (sortBy === 'oldest') return dateA - dateB;
      if (sortBy === 'highest') return totalB - totalA;
      if (sortBy === 'lowest') return totalA - totalB;
      if (sortBy === 'ref_asc') return (a.refId || '').localeCompare(b.refId || '');
      if (sortBy === 'ref_desc') return (b.refId || '').localeCompare(a.refId || '');
      return dateB - dateA; // default recent
    });

    return list;
  }, [devisListWithRefs, clientsMap, search, activeTab, sortBy, dateFilter]);

  const totalEntries = filteredDevis.length;
  const totalPages = Math.ceil(totalEntries / pageSize) || 1;
  const paginatedDevis = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredDevis.slice(startIndex, startIndex + pageSize);
  }, [filteredDevis, currentPage, pageSize]);

  const entryStart = totalEntries === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const entryEnd = Math.min(currentPage * pageSize, totalEntries);

  const isAllSelected =
    paginatedDevis.length > 0 && paginatedDevis.every((s) => selectedDevisIds.includes(s.id));
  const isSomeSelected =
    paginatedDevis.length > 0 &&
    paginatedDevis.some((s) => selectedDevisIds.includes(s.id)) &&
    !isAllSelected;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pageIds = paginatedDevis.map((s) => s.id);
      setSelectedDevisIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = paginatedDevis.map((s) => s.id);
      setSelectedDevisIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    }
  };

  const getAvatarStyle = (name: string) => {
    const char = name ? name.trim().charAt(0).toUpperCase() : '?';
    return {
      bg: 'bg-transparent',
      text: 'text-[#696cff] dark:text-[#b1b4ff]',
      ring: 'ring-[#696cff]/10',
    };
  };

  return (
    <div className="w-full select-none relative bg-transparent py-4 space-y-6">
      {/* Core Analytics Banner - Sneat KPI Card Style */}
      <div className="w-full bg-[#ffffff] dark:bg-[#2b2c40] border border-[#eceef1] dark:border-[#434460]/60 rounded-xl shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:shadow-none overflow-hidden mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Total Devis Émis */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40]">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Total Devis Émis
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#222222] dark:text-[#dbdade]">
                  {stats.totalVolume.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-[#222222] dark:text-[#eceeff]">
                  {stats.totalCount}
                </span>
                <span>Document{stats.totalCount > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <FileText size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 2: Volume Gagné */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t-0 md:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Volume Gagné
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-emerald-600 dark:text-[#71dd37]">
                  {stats.convertedVolume.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-emerald-600 dark:text-[#71dd37]">
                  {stats.convertedCount}
                </span>
                <span>Converti{stats.convertedCount > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <CheckCircle2 size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 3: Volume En cours */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Volume En cours
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-orange-400">
                  {stats.pendingVolume.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-orange-400">{stats.pendingCount}</span>
                <span>En attente</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <Clock size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 4: Taux de Conversion */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 md:border-l lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Taux de Conversion
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-purple-600 dark:text-[#b1b4ff]">
                  {stats.conversionRate.toFixed(1)}%
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium mt-1">
                <span>Devis convertis</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <TrendingUp size={22} className="stroke-[2.2]" />
            </div>
          </div>
        </div>
      </div>

      {/* Table Directory Box */}
      <div className="sneat-table-container w-full overflow-visible mb-8">
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* ==========================================
                 SNEAT STYLE - EN-TÊTE FACTURATION (TABS)
                 ========================================== */

              /* Table Control Header Bar (Search & Tabs / Bulk Selection swap) */
              .table-nav {
                  position: relative;
                  min-height: 76px;
                  border-bottom: 1px solid #eceef1;
                  background: #ffffff;
                  overflow: visible;
                  display: flex;
                  align-items: center;
                  border-top-left-radius: 8px;
                  border-top-right-radius: 8px;
              }
              .dark .table-nav {
                  border-bottom-color: rgba(67, 68, 96, 0.4);
                  background: #2b2c40;
              }

              /* VIEW A: Standard Header with original Tabs navigation */
              .nav-default-view {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  padding: 16px 24px;
                  width: 100%;
                  min-height: 76px;
                  transition: transform 0.2s ease, opacity 0.2s ease;
              }

              /* VIEW B: Dynamic Checked Items Bulk Bar view */
              .nav-selection-view {
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  min-height: 76px;
                  background: #ffffff;
                  display: flex;
                  align-items: center;
                  gap: 12px;
                  padding: 16px 24px;
                  transform: translateY(-100%);
                  opacity: 0;
                  transition: transform 0.2s ease, opacity 0.2s ease;
                  border-top-left-radius: 8px;
                  border-top-right-radius: 8px;
                  pointer-events: none;
              }
              .dark .nav-selection-view {
                  background: #2b2c40;
              }

              /* State Triggers for Bulk Actions Bar */
              .table-nav.has-selection .nav-default-view {
                  transform: translateY(100%);
                  opacity: 0;
                  pointer-events: none;
              }

              .table-nav.has-selection .nav-selection-view {
                  transform: translateY(0);
                  opacity: 1;
                  pointer-events: auto;
              }

              /* Original Tabs Layout styled like Sneat Admin */
              .tabs { 
                  display: flex; 
                  gap: 6px; 
              }

              .tab-btn {
                  padding: 8px 16px; 
                  font-size: 14px; 
                  font-weight: 500;
                  border-radius: 0.375rem; 
                  border: none; 
                  cursor: pointer; 
                  color: #697a8d; 
                  background: transparent;
                  transition: all 0.15s ease;
                  font-family: "Public Sans", -apple-system, sans-serif;
              }
              .dark .tab-btn {
                  color: #a3a4cc;
              }

              .tab-btn:hover {
                  background-color: #f5f5f9;
                  color: #566a7f;
              }
              .dark .tab-btn:hover {
                  background-color: #323249;
                  color: #dbdade;
              }

              /* Active Tab with Sneat Indigo Accent + Box Shadow */
              .tab-btn.active { 
                  background-color: #696cff; 
                  color: #ffffff; 
                  box-shadow: 0 0.125rem 0.25rem rgba(105, 108, 255, 0.4);
                  font-weight: 600;
              }
              .dark .tab-btn.active {
                  background-color: #696cff;
                  color: #ffffff;
                  box-shadow: 0 0.125rem 0.25rem rgba(105, 108, 255, 0.4);
              }

              /* Sneat Styled Search Input (Filtrer) */
              .search-input {
                  padding: 8px 14px;
                  font-size: 14px;
                  color: #435971;
                  border: 1px solid #d9dee3;
                  border-radius: 0.375rem;
                  width: 220px;
                  outline: none;
                  transition: border-color 0.15s ease-in-out;
                  background-color: #ffffff;
                  font-family: "Public Sans", -apple-system, sans-serif;
              }
              .dark .search-input {
                  background-color: #232333;
                  border-color: rgba(67, 68, 96, 0.4);
                  color: #dbdade;
              }

              .search-input:focus {
                  border-color: #696cff;
                  box-shadow: 0 0 0 0.2rem rgba(105, 108, 255, 0.1);
              }

              /* Bulk Buttons Style (Sneat secondary light gray) */
              .action-bar-btn {
                  background-color: #eceef1;
                  border: none;
                  color: #435971;
                  padding: 8px 16px;
                  border-radius: 0.375rem;
                  font-size: 13.5px;
                  font-weight: 500;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  transition: all 0.2s ease;
              }
              .dark .action-bar-btn {
                  background-color: #323249;
                  color: #a3a4cc;
              }

              .action-bar-btn:hover {
                  background-color: #e1e4e8;
                  color: #233446;
              }
              .dark .action-bar-btn:hover {
                  background-color: #3c3d5a;
                  color: #dbdade;
              }

              /* Counter Badge (Success Green Capsule) */
              .counter-badge {
                  background-color: #e8fadf;
                  border: 1px solid #71dd37;
                  color: #71dd37;
                  font-size: 13px;
                  font-weight: 600;
                  padding: 6px 14px;
                  border-radius: 0.375rem;
                  display: flex;
                  align-items: center;
                  gap: 10px;
              }
              .dark .counter-badge {
                  background-color: rgba(113, 221, 55, 0.12);
                  border-color: rgba(113, 221, 55, 0.2);
                  color: #71dd37;
              }

              .counter-close { 
                  cursor: pointer; 
                  font-weight: bold; 
              }

              /* ==========================================
                 SNEAT STYLE - REAL TABLE STYLING
                 ========================================== */
              .sneat-table-container {
                  background: #ffffff;
                  border: 1px solid #eceef1;
                  border-radius: 8px;
                  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.03);
              }
              .dark .sneat-table-container {
                  background: #2b2c40;
                  border-color: rgba(67, 68, 96, 0.4);
                  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
              }

              .sneat-table {
                  width: 100%;
                  border-collapse: collapse;
                  font-family: "Public Sans", -apple-system, sans-serif;
              }

              .sneat-table th {
                  background-color: #ffffff;
                  color: #566a7f;
                  font-size: 12.5px;
                  font-weight: 600;
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
                  border-bottom: 1px solid #eceef1;
                  padding: 14px 20px;
              }
              .dark .sneat-table th {
                  background-color: #2b2c40;
                  color: #a3a4cc;
                  border-bottom-color: rgba(67, 68, 96, 0.4);
              }

              .sneat-table td {
                  padding: 14px 20px;
                  font-size: 14px;
                  color: #697a8d;
                  border-bottom: 1px solid #eceef1;
              }
              .dark .sneat-table td {
                  color: #dbdade;
                  border-bottom-color: rgba(67, 68, 96, 0.4);
              }

              .sneat-table tr:hover {
                  background-color: #fcfcfd;
              }
              .dark .sneat-table tr:hover {
                  background-color: #2f3044;
              }

              .sneat-checkbox {
                  width: 17px;
                  height: 17px;
                  border: 1.5px solid #d9dee3;
                  border-radius: 4px;
                  accent-color: #696cff;
                  cursor: pointer;
                  transition: all 0.15s ease;
              }
              .sneat-checkbox:checked {
                  background-color: #696cff;
                  border-color: #696cff;
              }

              /* Pagination container stuck directly below table */
              .sneat-pagination-bar {
                  display: flex;
                  flex-wrap: wrap;
                  justify-content: space-between;
                  align-items: center;
                  padding: 16px 24px;
                  background-color: #ffffff;
                  border-top: 1px solid #eceef1;
                  margin-top: 0 !important;
              }
              .dark .sneat-pagination-bar {
                  background-color: #2b2c40;
                  border-top-color: rgba(67, 68, 96, 0.4);
              }

              .sneat-pagination-control {
                  display: flex;
                  gap: 6px;
                  align-items: center;
              }

              .sneat-pag-btn {
                  width: 32px;
                  height: 32px;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  background-color: #f5f5f9;
                  border: none;
                  color: #697a8d;
                  font-size: 13px;
                  font-weight: 500;
                  border-radius: 4px;
                  cursor: pointer;
                  transition: all 0.15s ease;
              }
              .dark .sneat-pag-btn {
                  background-color: #323249;
                  color: #a3a4cc;
              }

              .sneat-pag-btn:hover:not(:disabled) {
                  background-color: #eceef1;
                  color: #566a7f;
              }
              .dark .sneat-pag-btn:hover:not(:disabled) {
                  background-color: #3c3d5a;
                  color: #dbdade;
              }

              .sneat-pag-btn.active {
                  background-color: #696cff;
                  color: #ffffff;
                  box-shadow: 0 0.125rem 0.25rem rgba(105, 108, 255, 0.4);
              }

              .sneat-pag-btn:disabled {
                  opacity: 0.4;
                  cursor: not-allowed;
              }
            `,
          }}
        />

        <div className={`table-nav ${selectedDevisIds.length > 0 ? 'has-selection' : ''}`}>
          {/* VIEW A: Standard Filters */}
          <div className="nav-default-view flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full gap-4">
            {/* Left Side: Entries Selector + Create Devis Button conforming to Sneat placement */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
              <span className="text-sm font-medium text-[#8592a3] dark:text-[#a3afbb]">Show</span>
              <div className="relative">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 pl-3 pr-8 py-1.5 rounded-[6px] text-sm font-semibold text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none focus:border-[#696cff] w-20 text-left h-[38px] transition-all"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <ChevronDown
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8592a3] pointer-events-none"
                  size={13}
                  strokeWidth={2.5}
                />
              </div>

              {/* Create Devis Button - directly inline with Show Entries dropdown on the left */}
              <Link
                to="/add-purchase?type=devis"
                className="bg-[#696cff] hover:bg-[#5f61e6] active:bg-[#5f61e6] text-white px-4 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm shadow-[0_2px_4px_0_rgba(105,108,255,0.4)] hover:shadow-[0_4px_8px_0_rgba(105,108,255,0.4)] cursor-pointer whitespace-nowrap ml-2 sm:ml-3"
              >
                <Plus size={16} strokeWidth={2.5} />
                <span>Créer Devis</span>
              </Link>
            </div>

            {/* Right Side Actions Group (Search + Status Filter + Date Filter) */}
            <div className="flex items-center gap-3 flex-wrap md:flex-nowrap justify-end">
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search Devis"
                  className="search-input w-[180px] md:w-[260px] h-[38px] transition-all"
                />
              </div>

              {/* Date Filter Dropdown conforming to Sneat styling */}
              <div className="relative text-left w-[140px]">
                <button
                  type="button"
                  onClick={() => setIsDateDropdownOpen(!isDateDropdownOpen)}
                  className="w-full appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none flex items-center justify-between shadow-xs transition-all tracking-wide h-[38px] hover:border-[#696cff] focus:border-[#696cff] active:border-[#696cff]"
                >
                  <span className="truncate">
                    {dateFilter === 'all' && 'Toutes les dates'}
                    {dateFilter === 'today' && "Aujourd'hui"}
                    {dateFilter === 'week' && 'Cette semaine'}
                    {dateFilter === 'month' && 'Ce mois'}
                    {dateFilter === 'year' && 'Cette année'}
                  </span>
                  <ChevronDown
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8592a3]"
                    size={15}
                    strokeWidth={2.2}
                  />
                </button>

                {isDateDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsDateDropdownOpen(false)}
                    />
                    <div className="absolute top-[110%] right-0 bg-white dark:bg-[#2c2d42] border border-[#d9dee3] dark:border-[#434460]/40 rounded-lg shadow-md min-w-[180px] z-50 py-1 flex flex-col font-sans">
                      {[
                        { value: 'all', label: 'Toutes les dates' },
                        { value: 'today', label: "Aujourd'hui" },
                        { value: 'week', label: 'Cette semaine' },
                        { value: 'month', label: 'Ce mois' },
                        { value: 'year', label: 'Cette année' },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setDateFilter(opt.value as any);
                            setIsDateDropdownOpen(false);
                          }}
                          className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${dateFilter === opt.value ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Status Dropdown conforming to Sneat list styling with neutral border */}
              <div className="relative text-left w-[140px]">
                <button
                  id="devis-status-dropdown-btn"
                  type="button"
                  onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                  className="w-full appearance-none bg-white dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] pl-4 pr-10 py-2 text-sm font-medium text-[#566a7f] dark:text-[#dbdade] cursor-pointer outline-none flex items-center justify-between shadow-xs transition-all tracking-wide h-[38px] hover:border-[#696cff] focus:border-[#696cff] active:border-[#696cff]"
                >
                  <span className="truncate">
                    {activeTab === 'all' && 'Devis Status'}
                    {activeTab === 'pending' && 'En Attente'}
                    {activeTab === 'converted' && 'Convertis'}
                  </span>
                  <ChevronDown
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#8592a3]"
                    size={15}
                    strokeWidth={2.2}
                  />
                </button>

                {isStatusDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setIsStatusDropdownOpen(false)}
                    />
                    <div className="absolute top-[110%] right-0 bg-white dark:bg-[#2c2d42] border border-[#d9dee3] dark:border-[#434460]/40 rounded-lg shadow-md min-w-[190px] z-50 py-1 flex flex-col font-sans">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('all');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'all' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Devis Status
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('pending');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'pending' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        En Attente
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('converted');
                          setIsStatusDropdownOpen(false);
                        }}
                        className={`w-full text-left px-5 py-2.5 text-sm font-medium transition-all cursor-pointer border-l-[3px] ${activeTab === 'converted' ? 'bg-slate-50 dark:bg-[#34354e]/50 border-[#696cff] text-[#696cff]' : 'text-slate-700 dark:text-slate-300 border-transparent hover:bg-slate-50 dark:hover:bg-[#34354e]/30'}`}
                      >
                        Convertis
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* VIEW B: Bulk Actions */}
          <div className="nav-selection-view">
            <button
              className="action-bar-btn flex items-center gap-1.5"
              onClick={() => setSelectedDevisIds([])}
            >
              <span>{selectedDevisIds.length} sélectionné(s)</span>
              <span className="text-lg leading-none">&times;</span>
            </button>

            <div className="relative">
              <button
                onClick={() => setIsBulkDropdownOpen(!isBulkDropdownOpen)}
                className="action-bar-btn flex items-center gap-1.5"
              >
                <Settings size={15} strokeWidth={2.2} />
                <span>Action</span>
                <span className="text-[10px]">▼</span>
              </button>
              {isBulkDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setIsBulkDropdownOpen(false)}
                  />
                  <div className="absolute top-[110%] left-0 bg-white dark:bg-[#2b2c40] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] shadow-[0_4px_12px_rgba(67,89,113,0.12)] w-[170px] z-50 py-1.5 flex flex-col">
                    <button
                      onClick={() => {
                        handleBulkConvertToFacture();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#566a7f] dark:text-[#dbdade] hover:bg-[#f5f5f9] dark:hover:bg-[#323249] font-medium cursor-pointer"
                    >
                      Créer facture
                    </button>
                    <button
                      onClick={() => {
                        handleBulkConvertToCommande();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#566a7f] dark:text-[#dbdade] hover:bg-[#f5f5f9] dark:hover:bg-[#323249] font-medium cursor-pointer"
                    >
                      Créer commande
                    </button>
                    <button
                      onClick={() => {
                        handleBulkDuplicate();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#566a7f] dark:text-[#dbdade] hover:bg-[#f5f5f9] dark:hover:bg-[#323249] font-medium cursor-pointer"
                    >
                      Dupliquer
                    </button>
                    <hr className="border-[#eceef1] dark:border-[#434460]/40 my-1" />
                    <button
                      onClick={() => {
                        handleBulkDelete();
                        setIsBulkDropdownOpen(false);
                      }}
                      className="w-full text-left px-3.5 py-2.5 text-[13.5px] text-[#ff3e1d] hover:bg-[#ffe1e1] dark:hover:bg-[#4b2e2e]/50 font-semibold cursor-pointer"
                    >
                      Supprimer
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* List Table */}
        <AnimatePresence mode="wait">
          {filteredDevis.length === 0 ? (
            <motion.div key="empty" className="py-20 text-center bg-[#ffffff] dark:bg-[#2b2c40]">
              <FileText className="w-12 h-12 text-[#696cff]/30 mx-auto mb-3" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                Aucun devis disponible
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Commencez par générer une offre de devis client.
              </p>
            </motion.div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="sneat-table min-w-[900px]">
                  <thead>
                    <tr>
                      <th className="w-10 px-5 text-center">
                        <input
                          type="checkbox"
                          className="sneat-checkbox"
                          checked={isAllSelected}
                          ref={(input) => {
                            if (input) {
                              input.indeterminate = isSomeSelected;
                            }
                          }}
                          onChange={handleSelectAll}
                        />
                      </th>
                      <th
                        className="text-left cursor-pointer hover:text-[#696cff] transition-all select-none"
                        onClick={() => {
                          setSortBy((prev) => (prev === 'ref_asc' ? 'ref_desc' : 'ref_asc'));
                          setCurrentPage(1);
                        }}
                      >
                        <div className="flex items-center gap-1 leading-none">
                          <span>Référence No</span>
                          <span className="text-[10px] text-[#696cff] font-bold">
                            {sortBy === 'ref_asc' ? '▲' : sortBy === 'ref_desc' ? '▼' : '▲▼'}
                          </span>
                        </div>
                      </th>
                      <th className="text-left">Client</th>
                      <th
                        className="text-left cursor-pointer hover:text-[#696cff] transition-all select-none"
                        onClick={() => {
                          setSortBy((prev) => (prev === 'recent' ? 'oldest' : 'recent'));
                          setCurrentPage(1);
                        }}
                      >
                        <div className="flex items-center gap-1 leading-none">
                          <span>Date Émission</span>
                          <span className="text-[10px] text-[#696cff] font-bold">
                            {sortBy === 'recent' ? '▼' : sortBy === 'oldest' ? '▲' : '▲▼'}
                          </span>
                        </div>
                      </th>
                      <th className="text-left">Expiration</th>
                      <th
                        className="text-right cursor-pointer hover:text-[#696cff] transition-all select-none"
                        onClick={() => {
                          setSortBy((prev) => (prev === 'highest' ? 'lowest' : 'highest'));
                          setCurrentPage(1);
                        }}
                      >
                        <div className="flex items-center justify-end gap-1 leading-none">
                          <span>Montant Devis</span>
                          <span className="text-[10px] text-[#696cff] font-bold">
                            {sortBy === 'highest' ? '▼' : sortBy === 'lowest' ? '▲' : '▲▼'}
                          </span>
                        </div>
                      </th>
                      <th className="text-center font-semibold">Statut État</th>
                      <th className="text-center w-16">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDevis.map((dev, idx) => {
                      const clientName = clientsMap[dev.clientId] || 'Client Inconnu';
                      const total = Number(dev.total) || 0;
                      const avatar = getAvatarStyle(clientName);
                      const initials = clientName
                        ? clientName
                            .split(' ')
                            .slice(0, 2)
                            .map((n: string) => n[0])
                            .join('')
                        : '?';

                      const isConverted = dev.child_id && validConvertedIds.has(dev.child_id);
                      const expDate = dev.dueDate
                        ? dev.dueDate.toDate
                          ? dev.dueDate.toDate()
                          : new Date(dev.dueDate)
                        : null;
                      const limitDate =
                        expDate ||
                        (() => {
                          const baseDate = dev.date?.toDate
                            ? dev.date.toDate()
                            : dev.date
                              ? new Date(dev.date)
                              : new Date();
                          return new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);
                        })();

                      const today = new Date();
                      const todayZero = new Date(
                        today.getFullYear(),
                        today.getMonth(),
                        today.getDate()
                      );
                      const limitZero = new Date(
                        limitDate.getFullYear(),
                        limitDate.getMonth(),
                        limitDate.getDate()
                      );
                      const isExpired = !isConverted && limitZero < todayZero;

                      const isLastRows =
                        idx >= paginatedDevis.length - 2 && paginatedDevis.length > 3;

                      let stripeColor = 'bg-orange-400';
                      if (isConverted) {
                        stripeColor = 'bg-emerald-500';
                      } else if (isExpired) {
                        stripeColor = 'bg-rose-400 dark:bg-rose-500';
                      }

                      return (
                        <tr
                          key={dev.id + "_" + idx}
                          className={`border-b border-[#dbdade]/70 dark:border-[#434460]/40 transition-colors group cursor-pointer h-[72px] ${
                            isExpired
                              ? 'bg-rose-50/20 dark:bg-rose-500/5 hover:bg-rose-50/50 dark:hover:bg-rose-500/10'
                              : 'hover:bg-[#f5f5f9]/40 dark:hover:bg-[#232333]/30'
                          }`}
                          onClick={() => navigate(`/purchase/${dev.clientId}/${dev.id}`)}
                        >
                          <td
                            className="px-4 text-center w-12"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className="sneat-checkbox"
                              checked={selectedDevisIds.includes(dev.id)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (checked) {
                                  setSelectedDevisIds((prev) => [...prev, dev.id]);
                                } else {
                                  setSelectedDevisIds((prev) => prev.filter((id) => id !== dev.id));
                                }
                              }}
                            />
                          </td>
                          <td className="px-6">
                            <span className="font-mono font-bold text-sm text-[#696cff] dark:text-[#b1b4ff]">
                              {dev.refId}
                            </span>
                          </td>

                          <td className="px-6">
                            <div className="flex items-center gap-3">
                              {/* Color indicator stripe: green if converted, orange if pending, gray if expired */}
                              <div className={`w-[4px] h-8 rounded-full shrink-0 ${stripeColor}`} />
                              <div
                                className={`w-9 h-9 ${avatar.bg} ${avatar.text} ring-4 ${avatar.ring} rounded-full flex items-center justify-center font-extrabold text-[11px]`}
                              >
                                {initials}
                              </div>
                              <div className="flex flex-col">
                                <h4 className="font-bold text-[#222222] dark:text-[#dbdade] text-[14px]">
                                  {clientName.toUpperCase()}
                                </h4>
                                <span className="text-[10px] text-[#a1acb8] font-mono whitespace-nowrap truncate max-w-xs block">
                                  {dev.description || 'Aucune description'}
                                </span>
                              </div>
                            </div>
                          </td>

                          <td className="px-6 whitespace-nowrap">
                            <span className="text-[13px] text-[#435971] dark:text-[#dbdade] font-bold font-mono">
                              {dev.date?.toDate()?.toLocaleDateString('fr-FR', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              }) || '---'}
                            </span>
                          </td>

                          <td className="px-6 whitespace-nowrap border-l border-slate-100 dark:border-[#434460]/20">
                            <span className="text-[13px] text-[#435971] dark:text-[#dbdade] font-bold font-mono">
                              {dev.dueDate
                                ? dev.dueDate.toDate
                                  ? dev.dueDate.toDate().toLocaleDateString('fr-FR', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    })
                                  : new Date(dev.dueDate).toLocaleDateString('fr-FR', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    })
                                : (() => {
                                    const baseDate = dev.date?.toDate
                                      ? dev.date.toDate()
                                      : dev.date
                                        ? new Date(dev.date)
                                        : new Date();
                                    const expDate = new Date(
                                      baseDate.getTime() + 7 * 24 * 60 * 60 * 1000
                                    );
                                    return expDate.toLocaleDateString('fr-FR', {
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    });
                                  })()}
                            </span>
                          </td>

                          <td className="px-6 text-right whitespace-nowrap">
                            <span className="font-mono font-black text-[15px] text-[#435971] dark:text-[#dbdade]">
                              {total.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              <span className="text-[11px] font-sans font-extrabold ml-1">DH</span>
                            </span>
                          </td>

                          <td className="px-6 text-center">
                            {isConverted ? (
                              <span className="text-emerald-600 font-bold text-[10px] uppercase tracking-wider inline-flex items-center gap-1">
                                <CheckCircle2 size={12} /> Converti
                              </span>
                            ) : isExpired ? (
                              <span className="text-rose-500 font-bold text-[10px] uppercase tracking-wider inline-flex items-center gap-1">
                                <AlertCircle size={12} /> Expiré
                              </span>
                            ) : (
                              <span className="text-orange-400 font-bold text-[10px] uppercase tracking-wider inline-flex items-center gap-1">
                                <Clock size={12} /> En Attente
                              </span>
                            )}
                          </td>

                          <td className="px-4 text-center" onClick={(e) => e.stopPropagation()}>
                            <div className="relative inline-block text-left">
                              <button
                                onClick={() =>
                                  setOpenActionDropdownId(
                                    openActionDropdownId === dev.id ? null : dev.id
                                  )
                                }
                                className="p-1.5 hover:bg-slate-100 dark:hover:bg-[#323249] rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                              >
                                <MoreVertical size={16} />
                              </button>

                              {openActionDropdownId === dev.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setOpenActionDropdownId(null)}
                                  />
                                  <div
                                    className={`absolute right-full mr-2 ${isLastRows ? 'bottom-0' : 'top-0'} bg-white dark:bg-[#2c2d42] border border-[#d9dee3] dark:border-[#434460]/40 rounded-lg shadow-md min-w-[150px] z-50 py-1 flex flex-col font-sans text-left`}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        navigate(
                                          `/edit-purchase/${dev.clientId}/${dev.id}?type=devis`
                                        );
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                    >
                                      <Pencil size={14} />
                                      <span>Modifier</span>
                                    </button>

                                    {!isConverted && (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenActionDropdownId(null);
                                            handleConvert(dev, 'facture');
                                          }}
                                          className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                        >
                                          <FileText size={14} />
                                          <span>Créer Facture</span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setOpenActionDropdownId(null);
                                            handleConvert(dev, 'commande');
                                          }}
                                          className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                        >
                                          <ShoppingBag size={14} />
                                          <span>Créer Commande</span>
                                        </button>
                                      </>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        handlePrintSingle(dev);
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                    >
                                      <Printer size={14} />
                                      <span>Téléch. PDF</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        handleSendSingle(dev);
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-[#566a7f] dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-[#34354e]/30 flex items-center gap-2 cursor-pointer font-medium"
                                    >
                                      <Send size={14} />
                                      <span>Envoyer</span>
                                    </button>
                                    <hr className="border-[#eceef1] dark:border-[#434460]/40 my-1" />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setOpenActionDropdownId(null);
                                        handleDeleteSingle(dev);
                                      }}
                                      className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 flex items-center gap-2 cursor-pointer font-semibold"
                                    >
                                      <Trash2 size={14} />
                                      <span>Supprimer</span>
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile responsive cards view (under layout max-w) */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:hidden gap-4 mt-4">
                {paginatedDevis.map((dev, idx) => {
                  const clientName = clientsMap[dev.clientId] || 'Client Inconnu';
                  const total = Number(dev.total) || 0;
                  const avatar = getAvatarStyle(clientName);
                  const formattedInitials = clientName
                    ? clientName
                        .split(' ')
                        .slice(0, 2)
                        .map((n: string) => n[0])
                        .join('')
                    : '?';

                  return (
                    <div
                      key={dev.id + "_" + idx}
                      className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 p-5 rounded-lg flex flex-col justify-between gap-4 cursor-pointer"
                      onClick={() => navigate(`/purchase/${dev.clientId}/${dev.id}`)}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          {/* Color indicator stripe: green if converted, orange if pending */}
                          <div
                            className={`w-[4px] h-8 rounded-full shrink-0 ${
                              dev.child_id ? 'bg-emerald-500' : 'bg-orange-400'
                            }`}
                          />
                          <span className="font-mono font-bold text-xs text-[#696cff] dark:text-[#b1b4ff]">
                            {dev.refId}
                          </span>
                          <div>
                            <h4 className="font-bold text-slate-800 dark:text-white text-sm">
                              {clientName}
                            </h4>
                            <span className="text-[10px] text-slate-400 uppercase font-mono">
                              Emis: {dev.date?.toDate()?.toLocaleDateString('fr-FR')}
                            </span>
                            <span className="text-[10px] text-rose-500 uppercase font-mono ml-2">
                              • Exp:{' '}
                              {dev.dueDate
                                ? dev.dueDate.toDate
                                  ? dev.dueDate.toDate().toLocaleDateString('fr-FR')
                                  : new Date(dev.dueDate).toLocaleDateString('fr-FR')
                                : (() => {
                                    const baseDate = dev.date?.toDate
                                      ? dev.date.toDate()
                                      : dev.date
                                        ? new Date(dev.date)
                                        : new Date();
                                    const expDate = new Date(
                                      baseDate.getTime() + 7 * 24 * 60 * 60 * 1000
                                    );
                                    return expDate.toLocaleDateString('fr-FR');
                                  })()}
                            </span>
                          </div>
                        </div>
                        {dev.child_id ? (
                          <span className="text-emerald-600 font-bold text-[9px] uppercase">
                            Converti
                          </span>
                        ) : (
                          <span className="text-orange-400 font-bold text-[9px] uppercase">
                            Offre
                          </span>
                        )}
                      </div>

                      <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded flex justify-between items-center text-xs">
                        <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">
                          Total Devis
                        </span>
                        <span className="font-bold font-mono text-[#222222] dark:text-white">
                          {total.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* PAGINATION CONTROLS STUCK TO TABLE */}
              {filteredDevis.length > 0 && (
                <div className="sneat-pagination-bar">
                  <div className="flex items-center gap-2 whitespace-nowrap shrink-0 text-[#697a8d] dark:text-[#a3a4cc]">
                    <span>Afficher</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="bg-[#ffffff] dark:bg-[#232333] border border-[#d9dee3] dark:border-[#434460]/40 rounded-[6px] py-1 px-2.5 text-xs font-semibold text-[#435971] dark:text-[#dbdade] focus:border-[#696cff] cursor-pointer outline-none w-auto inline-block"
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                    <span>lignes par page</span>
                  </div>

                  <div className="whitespace-nowrap shrink-0 text-[#697a8d] dark:text-[#a3a4cc] text-xs font-medium">
                    Affichage de {entryStart}-{entryEnd} sur {totalEntries} devis
                  </div>

                  <div className="sneat-pagination-control">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="sneat-pag-btn"
                      title="Précédent"
                    >
                      <ChevronLeft size={16} />
                    </button>

                    <div className="flex gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                        if (
                          totalPages > 5 &&
                          page !== 1 &&
                          page !== totalPages &&
                          Math.abs(page - currentPage) > 1
                        ) {
                          if (page === 2 && currentPage > 3)
                            return (
                              <span key="dots1" className="px-1 text-[#a1acb8] dark:text-[#707194]">
                                ...
                              </span>
                            );
                          if (page === totalPages - 1 && currentPage < totalPages - 2)
                            return (
                              <span key="dots2" className="px-1 text-[#a1acb8] dark:text-[#707194]">
                                ...
                              </span>
                            );
                          return null;
                        }
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`sneat-pag-btn ${currentPage === page ? 'active' : ''}`}
                          >
                            {page}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="sneat-pag-btn"
                      title="Suivant"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </AnimatePresence>
      </div>

      {/* Dispatch Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-[#000000]/50 flex items-center justify-center p-4 z-50 animate-fade-in font-sans">
          <div className="bg-[#ffffff] dark:bg-[#2b2c40] rounded-xl border border-[#dbdade] dark:border-[#434460]/40 shadow-xl max-w-lg w-full overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-[#dbdade]/70 dark:border-[#434460]/40 flex items-center justify-between">
              <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Send size={18} className="text-[#696cff]" />
                <span>Envoyer le devis par email</span>
              </h3>
              <button
                onClick={() => {
                  setShowEmailModal(false);
                  setEmailingInvoice(null);
                }}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors p-1"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5">
                  Destinataire (Email)
                </label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder="client@entreprise.ma"
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-[#dbdade] dark:border-[#434460]/40 rounded-lg text-sm text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-[#696cff] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5">
                  Objet du message
                </label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  placeholder="Votre devis - S0000x"
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-[#dbdade] dark:border-[#434460]/40 rounded-lg text-sm text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-[#696cff] outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1.5">
                  Corps du message
                </label>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={6}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-[#1e1e2d] border border-[#dbdade] dark:border-[#434460]/40 rounded-lg text-sm text-slate-800 dark:text-slate-100 focus:ring-1 focus:ring-[#696cff] outline-none font-sans leading-relaxed resize-none"
                />
              </div>

              <div className="bg-blue-50/50 dark:bg-blue-900/10 p-3.5 rounded-lg border border-blue-100 dark:border-blue-900/30 flex items-start gap-2 text-xs text-blue-600 dark:text-blue-300">
                <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                <p className="leading-normal">
                  Le PDF du devis sera automatiquement généré et joint en pièce jointe lors de
                  l'envoi.
                </p>
              </div>
            </div>

            <div className="px-6 py-4 bg-slate-50 dark:bg-[#232333]/30 border-t border-[#dbdade]/70 dark:border-[#434460]/40 flex items-center justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setShowEmailModal(false);
                  setEmailingInvoice(null);
                }}
                className="px-4 py-2 border border-slate-200 dark:border-[#434460]/50 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-[#2c2d42] transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSendWhatsApp}
                disabled={sendingEmail || sendingWhatsApp}
                className="px-4 py-2 bg-[#25D366] text-white rounded-lg text-sm font-semibold hover:bg-[#22bf5b] transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                title="Envoyer directement via OpenWA"
              >
                {sendingWhatsApp ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Envoi WhatsApp...
                  </>
                ) : (
                  <>
                    <MessageSquare size={15} />
                    WhatsApp (OpenWA)
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleSendEmail}
                disabled={sendingEmail || sendingWhatsApp}
                className="px-5 py-2 bg-[#696cff] text-white rounded-lg text-sm font-semibold hover:bg-[#5f61e6] transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {sendingEmail ? 'Envoi en cours...' : 'Envoyer par Email'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Render hidden print content dynamically on selection */}
      <div className="hidden">
        <div
          className="fixed overflow-hidden opacity-0 pointer-events-none"
          style={{ left: '-10000px', top: '-10000px' }}
        >
          {(() => {
            if (printingQueue.length === 0 && !emailingInvoice) return null;

            const targets = emailingInvoice ? [emailingInvoice] : printingQueue;

            return (
              <div style={{ position: 'absolute', top: '-9999px', left: '-9999px', zIndex: -9999 }}>
                <div
                  id="hidden-pdf-content"
                  style={{ background: 'white', display: 'flex', flexDirection: 'column' }}
                >
                  {targets.map((dev, idx) => {
                    const client = clients.find((c) => c.id === dev.clientId);
                    const clientName = client
                      ? client.name
                      : clientsMap[dev.clientId] || 'Client Inconnu';
                    const safeClient = client || {
                      name: clientName,
                      addressLine1: '',
                      city: '',
                      city_ma: '',
                      phone: '',
                      ice: '',
                    };

                    const formattedInvoice = mapDocToInvoiceData(dev, safeClient);
                    return (
                      <div
                        key={dev.id + "_" + idx}
                        style={{
                          width: '210mm',
                          height: '297mm',
                          pageBreakAfter: idx < targets.length - 1 ? 'always' : 'auto',
                        }}
                      >
                        <InvoicePrint data={formattedInvoice} />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

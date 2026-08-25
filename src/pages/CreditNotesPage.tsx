import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../lib/firebase';
import { collectionGroup, query, where, onSnapshot, writeBatch, doc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { CreditNote } from '../types/creditNote';
import { Link, useNavigate } from 'react-router-dom';
import {
  FileText,
  Search,
  Plus,
  ArrowUpDown,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Eye,
  Trash2,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { creditNoteService } from '../services/creditNoteService';

export default function CreditNotesPage() {
  const { user } = useAuth();
  const { confirm, showToast } = useNotification();
  const navigate = useNavigate();
  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'date',
    direction: 'desc',
  });
  const [selectedNotes, setSelectedNotes] = useState<string[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    const q = query(collectionGroup(db, 'credit_notes'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const notes = snap.docs.map((doc) => {
          const data = doc.data();
          return {
            id: doc.id,
            clientId: doc.ref.parent.parent?.id || '',
            ...data,
            date: data.date?.toDate ? data.date.toDate() : new Date(data.date),
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          } as CreditNote;
        });
        setCreditNotes(notes);
        setLoading(false);
      },
      (error) => {
        console.error('CreditNotesPage snapshot error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleSort = (key: string) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const filteredAndSortedNotes = useMemo(() => {
    return creditNotes
      .filter((note) => {
        const matchesSearch =
          note.refId?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          note.invoiceRef?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          note.reason?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus = statusFilter === 'all' || note.status === statusFilter;
        return matchesSearch && matchesStatus;
      })
      .sort((a: any, b: any) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
  }, [creditNotes, searchQuery, statusFilter, sortConfig]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedNotes(filteredAndSortedNotes.map((n) => n.id));
    } else {
      setSelectedNotes([]);
    }
  };

  const handleSelectNote = (id: string) => {
    setSelectedNotes((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleDeleteSelected = async () => {
    confirm({
      title: 'Supprimer les avoirs',
      message: 'Voulez-vous vraiment supprimer les avoirs (Brouillon/Annulé) sélectionnés définitivement ?',
      onConfirm: async () => {
        setBulkActionLoading(true);
        try {
          const batch = writeBatch(db);
          let deleteCount = 0;
          
          selectedNotes.forEach((id) => {
            const note = creditNotes.find((n) => n.id === id);
            if (note && (note.status === 'Brouillon' || note.status === 'Annulé')) {
              batch.delete(doc(db, 'clients', note.clientId, 'credit_notes', id));
              deleteCount++;
            }
          });
          
          if (deleteCount > 0) {
            await batch.commit();
            showToast(`${deleteCount} avoir(s) supprimé(s)`, 'success');
          }
          setSelectedNotes([]);
        } catch (error) {
          console.error('Error deleting notes:', error);
          showToast('Erreur lors de la suppression.', 'error');
        } finally {
          setBulkActionLoading(false);
        }
      }
    });
  };

  const handleCancelSelected = async () => {
    confirm({
      title: 'Annuler les avoirs',
      message: 'Voulez-vous vraiment annuler les avoirs validés sélectionnés ?',
      onConfirm: async () => {
        setBulkActionLoading(true);
        try {
          for (const id of selectedNotes) {
            const note = creditNotes.find((n) => n.id === id);
            if (note && note.status === 'Validé') {
              await creditNoteService.cancelCreditNote(note.clientId, id);
            }
          }
          showToast('Avoirs annulés avec succès', 'success');
          setSelectedNotes([]);
        } catch (error) {
          console.error('Error canceling notes:', error);
          showToast('Erreur lors de l\'annulation: ' + (error as Error).message, 'error');
        } finally {
          setBulkActionLoading(false);
        }
      }
    });
  };

  const handleDeleteSingle = async (note: CreditNote) => {
    confirm({
      title: 'Supprimer l\'avoir',
      message: 'Voulez-vous vraiment supprimer cet avoir définitivement ?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'clients', note.clientId, 'credit_notes', note.id));
          showToast('Avoir supprimé avec succès', 'success');
        } catch (error) {
          console.error('Error deleting note:', error);
          showToast('Erreur lors de la suppression.', 'error');
        }
      }
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Brouillon':
        return 'bg-slate-100/50 text-slate-500';
      case 'Validé':
        return 'bg-emerald-50/70 text-emerald-600 border border-emerald-100';
      case 'Utilisé':
        return 'bg-blue-50/70 text-blue-600 border border-blue-100';
      case 'Annulé':
        return 'bg-rose-50/70 text-rose-400 border border-rose-100';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Avoirs Clients</h1>
          <p className="text-sm text-slate-500 mt-1">Gérez vos notes d'avoir et annulations.</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200/60 rounded-lg overflow-hidden">
        {selectedNotes.length > 0 && (
          <div className="bg-indigo-50 border-b border-indigo-100 p-4 flex items-center justify-between">
            <span className="text-sm font-medium text-indigo-700">
              {selectedNotes.length} avoir(s) sélectionné(s)
            </span>
            <div className="flex gap-2">
              {filteredAndSortedNotes.some(n => selectedNotes.includes(n.id) && n.status === 'Validé') && (
                <button
                  onClick={handleCancelSelected}
                  disabled={bulkActionLoading}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-100 rounded-md hover:bg-amber-200 transition-colors disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" />
                  Annuler Validés
                </button>
              )}
              {filteredAndSortedNotes.some(n => selectedNotes.includes(n.id) && (n.status === 'Brouillon' || n.status === 'Annulé')) && (
                <button
                  onClick={handleDeleteSelected}
                  disabled={bulkActionLoading}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-rose-700 bg-rose-100 rounded-md hover:bg-rose-200 transition-colors disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  Supprimer Sélection
                </button>
              )}
            </div>
          </div>
        )}
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative w-full sm:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Rechercher un avoir (numéro, motif...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:border-indigo-500"
            >
              <option value="all">Tous les statuts</option>
              <option value="Brouillon">Brouillon</option>
              <option value="Validé">Validé</option>
              <option value="Utilisé">Utilisé</option>
              <option value="Annulé">Annulé</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 text-left w-12">
                  <input
                    type="checkbox"
                    checked={selectedNotes.length === filteredAndSortedNotes.length && filteredAndSortedNotes.length > 0}
                    onChange={handleSelectAll}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                  />
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort('refId')}
                >
                  <div className="flex items-center gap-2">
                    Numéro
                    <ArrowUpDown className="w-4 h-4" />
                  </div>
                </th>
                <th
                  className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort('date')}
                >
                  <div className="flex items-center gap-2">
                    Date
                    <ArrowUpDown className="w-4 h-4" />
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Facture d'origine
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Motif
                </th>
                <th
                  className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100"
                  onClick={() => handleSort('total')}
                >
                  <div className="flex items-center justify-end gap-2">
                    Total TTC
                    <ArrowUpDown className="w-4 h-4" />
                  </div>
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Statut
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSortedNotes.map((note, idx) => (
                <tr key={note.id + "_" + idx} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={selectedNotes.includes(note.id)}
                      onChange={() => handleSelectNote(note.id)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-indigo-600">
                      {note.refId || 'Brouillon'}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-600">
                      {format(note.date, 'dd MMM yyyy', { locale: fr })}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-600">{note.invoiceRef}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-slate-600">{note.reason}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    <div className="text-sm font-medium text-slate-900">
                      {note.total.toLocaleString('fr-MA', {
                        style: 'currency',
                        currency: 'MAD',
                      })}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                        note.status
                      )}`}
                    >
                      {note.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex items-center justify-end gap-3">
                    <Link
                      to={`/credit-notes/${note.clientId}/${note.id}`}
                      className="text-indigo-600 hover:text-indigo-900 inline-flex items-center gap-1"
                    >
                      <Eye className="w-4 h-4" />
                      Voir
                    </Link>
                    {(note.status === 'Brouillon' || note.status === 'Annulé') && (
                      <button
                        onClick={() => handleDeleteSingle(note)}
                        className="text-red-500 hover:text-red-700 inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-4 h-4" />
                        Supprimer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredAndSortedNotes.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-slate-500">
                    Aucun avoir trouvé
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

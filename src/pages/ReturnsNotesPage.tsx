import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  orderBy,
  updateDoc,
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import {
  Plus,
  Trash2,
  Edit3,
  X,
  Check,
  Search,
  Calendar,
  HeartCrack,
  Package,
  DollarSign,
  ArrowLeftRight,
  Activity,
} from 'lucide-react';
import { useNotification } from '../context/NotificationContext';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';

interface ReturnNote {
  id: string;
  productName: string;
  source: 'Client' | 'Fournisseur';
  contactId?: string;
  contactName?: string;
  reason: string;
  amount: number;
  quantity: number;
  status: 'En attente' | 'Remboursé' | 'Remplacé' | 'Perte/Poubelle';
  date: string;
  ownerId: string;
  createdAt: any;
}

export default function ReturnsNotesPage() {
  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const navigate = useNavigate();
  const [notes, setNotes] = useState<ReturnNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    productName: '',
    source: 'Client' as 'Client' | 'Fournisseur',
    reason: '',
    amount: '',
    quantity: '1',
    status: 'En attente' as 'En attente' | 'Remboursé' | 'Remplacé' | 'Perte/Poubelle',
    date: new Date().toISOString().split('T')[0],
  });

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'returns_notes'),
      where('ownerId', '==', user.uid),
      orderBy('date', 'desc'),
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setNotes(snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ReturnNote));
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user]);

  const openAddModal = () => {
    setFormData({
      productName: '',
      source: 'Client',
      reason: '',
      amount: '',
      quantity: '1',
      status: 'En attente',
      date: new Date().toISOString().split('T')[0],
    });
    setEditingId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (note: ReturnNote) => {
    setFormData({
      productName: note.productName,
      source: note.source,
      reason: note.reason,
      amount: note.amount?.toString() || '',
      quantity: note.quantity?.toString() || '1',
      status: note.status,
      date: note.date,
    });
    setEditingId(note.id);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !formData.productName.trim()) return;

    try {
      const noteData = {
        productName: formData.productName.trim(),
        source: formData.source,
        reason: formData.reason.trim(),
        amount: parseFloat(formData.amount) || 0,
        quantity: parseInt(formData.quantity) || 1,
        status: formData.status,
        date: formData.date,
      };

      if (editingId) {
        await updateDoc(doc(db, 'returns_notes', editingId), noteData);
        showToast('Retour mis à jour', 'success');
      } else {
        await addDoc(collection(db, 'returns_notes'), {
          ...noteData,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });
        showToast('Retour ajouté', 'success');
      }
      setIsModalOpen(false);
    } catch (error) {
      console.error(error);
      showToast("Erreur lors de l'enregistrement", 'error');
    }
  };

  const handleDelete = async (id: string) => {
    confirm({
      title: 'Supprimer le retour ?',
      message: 'Êtes-vous sûr de vouloir supprimer cet historique de retour ?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'returns_notes', id));
          showToast('Retour supprimé', 'success');
        } catch (e) {
          console.error(e);
          showToast('Erreur de suppression', 'error');
        }
      },
    });
  };
  const filteredNotes = notes.filter(
    (n) =>
      n.productName?.toLowerCase().includes(search.toLowerCase()) ||
      n.reason?.toLowerCase().includes(search.toLowerCase()) ||
      n.source?.toLowerCase().includes(search.toLowerCase()) ||
      (n.contactName && n.contactName.toLowerCase().includes(search.toLowerCase()))
  );
  const pendingAmountSupplier = filteredNotes
    .filter((n) => n.status === 'En attente' && n.source === 'Fournisseur')
    .reduce((sum, n) => sum + (n.amount || 0) * (n.quantity || 1), 0);
  const pendingAmountClient = filteredNotes
    .filter((n) => n.status === 'En attente' && n.source === 'Client')
    .reduce((sum, n) => sum + (n.amount || 0) * (n.quantity || 1), 0);
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'En attente':
        return 'bg-transparent text-[#ffab00] dark:text-[#ffab00] dark:border-transparent';
      case 'Remboursé':
        return 'bg-transparent text-[#71dd37] dark:text-[#71dd37] dark:border-transparent';
      case 'Remplacé':
        return 'bg-transparent text-[#696cff] dark:text-[#b1b4ff] dark:border-transparent';
      case 'Perte/Poubelle':
        return 'bg-transparent text-[#ff3e1d] dark:text-[#ff3e1d] dark:border-transparent';
      default:
        return 'bg-slate-50 text-slate-600 -200';
    }
  };
  const getSourceColor = (source: string) => {
    return source === 'Client'
      ? 'bg-transparent text-[#696cff] dark:text-[#b1b4ff] dark:border-transparent'
      : 'bg-transparent text-fuchsia-600 -100/50';
  };
  if (loading) {
    return (
      <div className="p-8 flex justify-center">
        <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 overflow-y-auto py-4">
        <div className="w-full space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-6 shadow-xs flex items-center justify-between group hover:shadow-md transition-all">
              <div>
                <p className="text-[10px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest mb-1.5 flex items-center gap-1.5 font-mono">
                  <ArrowLeftRight size={14} /> Fournisseurs (En attente)
                </p>
                <h3 className="text-2xl font-semibold font-display text-fuchsia-600 dark:text-fuchsia-400 tracking-tight">
                  {pendingAmountSupplier.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  <span className="text-sm font-sans">DHS</span>
                </h3>
              </div>
              <div className="w-12 h-12 bg-fuchsia-50 dark:bg-fuchsia-950/20 flex items-center justify-center text-fuchsia-500 transition-transform group-hover:scale-110 rounded-lg">
                <Package size={24} />
              </div>
            </div>

            <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-6 shadow-xs flex items-center justify-between group hover:shadow-md transition-all">
              <div>
                <p className="text-[10px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest mb-1.5 flex items-center gap-1.5 font-mono">
                  <ArrowLeftRight size={14} /> Clients (En attente)
                </p>
                <h3 className="text-2xl font-semibold font-display text-[#696cff] dark:text-[#b1b4ff] tracking-tight">
                  {pendingAmountClient.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  <span className="text-sm font-sans">DHS</span>
                </h3>
              </div>
              <div className="w-12 h-12 bg-[#e7e7ff] dark:bg-[#393a59] flex items-center justify-center text-[#696cff] dark:text-[#b1b4ff] transition-transform group-hover:scale-110 rounded-lg">
                <Package size={24} />
              </div>
            </div>
          </div>

          <div className="bg-[#ffffff] dark:bg-[#2b2c40] rounded-lg border border-[#dbdade]/70 dark:border-[#434460]/40 shadow-xs overflow-hidden animate-fade-in text-left">
            <div className="px-5 py-4 border-b border-[#dbdade]/30 dark:border-[#434460]/20 bg-[#ffffff] dark:bg-[#2b2c40]">
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a1acb8] dark:text-[#707194]"
                  size={15}
                />
                <input
                  type="text"
                  placeholder="Rechercher un produit, une source, un motif..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 bg-transparent dark:bg-transparent font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none transition-all text-sm lg:w-96"
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#f5f5f9] dark:bg-[#232333]/50 border-b border-[#dbdade]/70 dark:border-[#434460]/40 text-[11px] uppercase tracking-widest font-black text-[#222222] dark:text-[#a3a4cc] select-none">
                    <th className="py-3 px-6 text-left">Date / Opération</th>
                    <th className="py-3 px-6 text-left">Activité / Bons de Saisie</th>
                    <th className="py-3 px-6 text-left">Motif / Origine</th>
                    <th className="py-3 px-6 text-center">Quantité Saisie</th>
                    <th className="py-3 px-6 text-center">État Réglementaire</th>
                    <th className="py-3 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredNotes.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-6 py-24 text-center grayscale opacity-50 bg-[#ffffff] dark:bg-[#2b2c40]"
                      >
                        <HeartCrack className="w-12 h-12 text-[#dbdade] dark:text-[#434460] mx-auto mb-3" />
                        <h3 className="text-[#435971] dark:text-[#dbdade] font-semibold uppercase text-[12px] tracking-widest">
                          Aucun retour enregistré
                        </h3>
                        <p className="text-[#a1acb8] dark:text-[#707194] text-[10px] uppercase font-bold mt-1">
                          Créez votre premier historique de retour.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filteredNotes.map((note, idx) => (
                      <tr
                        key={note.id + "_" + idx}
                        className="border-b border-[#dbdade]/70 dark:border-[#434460]/40 hover:bg-[#f5f5f9]/40 dark:hover:bg-[#232333]/30 transition-colors group h-[72px] cursor-pointer bg-[#ffffff] dark:bg-[#2b2c40]"
                      >
                        <td className="px-6">
                          <div className="flex items-center gap-3.5">
                            <div className="flex flex-col text-left">
                              <h4 className="font-semibold text-[#222222] dark:text-[#dbdade] text-[14px] tracking-tight group-hover:text-[#696cff] transition-colors uppercase">
                                {note.productName}
                              </h4>
                              <span className="text-[10px] text-[#697a8d] dark:text-[#a3a4cc] font-mono mt-0.5">
                                {new Date(note.date).toLocaleDateString('fr-FR')}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-6">
                          <div className="flex flex-col items-start gap-1">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-bold border uppercase tracking-wider ${getSourceColor(note.source)}`}
                            >
                              {note.source}
                            </span>
                            {note.contactName && (
                              <span className="text-[11px] font-semibold text-[#566a7f] dark:text-[#a3a4cc] uppercase">
                                {note.contactName}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6">
                          <span className="text-[12px] font-medium text-[#566a7f] dark:text-[#a3a4cc] italic truncate max-w-[200px] inline-block">
                            {note.reason}
                          </span>
                        </td>
                        <td className="px-6 text-center">
                          <div className="flex flex-col">
                            <span className="text-[14px] font-semibold text-[#222222] dark:text-[#dbdade]">
                              {note.quantity}x
                            </span>
                            {note.amount > 0 && (
                              <span className="text-[10px] font-mono font-bold text-[#697a8d] dark:text-[#a3a4cc] tracking-tighter uppercase">
                                {note.amount.toFixed(2)} DHS
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 text-center">
                          <span
                            className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${getStatusColor(note.status)}`}
                          >
                            {note.status}
                          </span>
                        </td>
                        <td className="px-6 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(note)}
                              className="p-1.5 text-[#697a8d] hover:text-[#696cff] dark:text-[#a3a4cc] dark:hover:text-[#b1b4ff] hover:bg-[#f5f5f9] dark:hover:bg-[#232333] rounded transition-colors"
                              title="Modifier"
                            >
                              <Edit3 size={15} strokeWidth={2.5} />
                            </button>
                            <button
                              onClick={() => handleDelete(note.id)}
                              className="p-1.5 text-[#697a8d] hover:text-[#ff3e1d] dark:text-[#a3a4cc] dark:hover:text-[#ff3e1d] hover:bg-rose-50/10 dark:hover:bg-rose-500/10 rounded transition-colors"
                              title="Supprimer"
                            >
                              <Trash2 size={15} strokeWidth={2.5} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#ffffff] dark:bg-[#2b2c40] rounded-xl shadow-xl w-full max-w-lg overflow-hidden text-left"
          >
            <div className="flex items-center justify-between px-6 py-5 border-b border-[#dbdade]/70 dark:border-[#434460]/40">
              <h3 className="text-lg font-semibold text-[#435971] dark:text-[#dbdade]">
                {editingId ? 'Modifier le retour' : 'Nouveau retour'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-[#a1acb8] hover:text-[#435971] dark:text-[#707194] dark:hover:text-[#dbdade] p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-5">
              <div className="space-y-2">
                <label className="text-xs font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest flex items-center gap-1.5">
                  <Package size={14} /> Article / Produit
                </label>
                <input
                  required
                  type="text"
                  value={formData.productName}
                  onChange={(e) => setFormData({ ...formData, productName: e.target.value })}
                  className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#696cff] transition-all"
                  placeholder="Ex: T-Shirt Nike rouge"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest flex items-center gap-1.5">
                    <ArrowLeftRight size={14} /> Source
                  </label>
                  <select
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value as any })}
                    className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#696cff] transition-all"
                  >
                    <option value="Client">Client</option>
                    <option value="Fournisseur">Fournisseur</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest flex items-center gap-1.5">
                    <Calendar size={14} /> Date
                  </label>
                  <input
                    required
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#696cff] transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest flex items-center gap-1.5">
                    Quantité
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#696cff] transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest flex items-center gap-1.5">
                    <DollarSign size={14} /> Montant (Facultatif)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#696cff] transition-all"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest flex items-center gap-1.5">
                  Motif / Raison
                </label>
                <input
                  required
                  type="text"
                  value={formData.reason}
                  onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                  className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#696cff] transition-all"
                  placeholder="Ex: Cassé, Défaut de fabrication..."
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-widest flex items-center gap-1.5">
                  <Activity size={14} /> Statut
                </label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#696cff] transition-all"
                >
                  <option value="En attente">En attente</option>
                  <option value="Remboursé">Remboursé</option>
                  <option value="Remplacé">Remplacé</option>
                  <option value="Perte/Poubelle">Perte / Poubelle</option>
                </select>
              </div>

              <div className="pt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-6 py-3 border border-[#dbdade]/70 dark:border-[#434460]/40 text-[#697a8d] dark:text-[#a3a4cc] font-semibold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="flex-1 px-6 py-3 bg-[#696cff] text-white font-semibold rounded-lg hover:bg-[#5f61e6] transition-colors shadow-xs flex items-center justify-center gap-2"
                >
                  <Check size={18} />
                  Enregistrer
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

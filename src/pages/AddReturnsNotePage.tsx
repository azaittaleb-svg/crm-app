import React, { useState, useEffect } from 'react';
import { db } from '../lib/firebase';
import { useNotification } from '../context/NotificationContext';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  HeartCrack,
  Package,
  DollarSign,
  ArrowLeftRight,
  Activity,
  Calendar,
  Plus,
  Trash2,
  User,
} from 'lucide-react';

export default function AddReturnsNotePage() {
  const [loading, setLoading] = useState(false);
  const { showToast } = useNotification();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [source, setSource] = useState<'Client' | 'Fournisseur'>('Fournisseur');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [contactId, setContactId] = useState('');
  const [contacts, setContacts] = useState<any[]>([]);

  const [items, setItems] = useState([
    {
      id: crypto.randomUUID(),
      productName: '',
      reason: '',
      amount: '',
      quantity: '1',
      status: 'En attente' as 'En attente' | 'Remboursé' | 'Remplacé' | 'Perte/Poubelle',
    },
  ]);

  useEffect(() => {
    if (!user) return;
    const fetchContacts = async () => {
      const colName = source === 'Client' ? 'clients' : 'suppliers';
      const q = query(collection(db, colName), where('ownerId', '==', user.uid));
      const snap = await getDocs(q);
      const loaded = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Sort alphabetically
      loaded.sort((a: any, b: any) =>
        (a.name || a.companyName || '').localeCompare(b.name || b.companyName || '')
      );

      setContacts(loaded);
      if (loaded.length > 0) {
        setContactId(loaded[0].id);
      } else {
        setContactId('');
      }
    };
    fetchContacts();
  }, [source, user]);

  const handleAddItem = () => {
    setItems([
      ...items,
      {
        id: crypto.randomUUID(),
        productName: '',
        reason: '',
        amount: '',
        quantity: '1',
        status: 'En attente',
      },
    ]);
  };

  const handleRemoveItem = (id: string) => {
    if (items.length > 1) {
      setItems(items.filter((item) => item.id !== id));
    }
  };

  const updateItem = (id: string, field: string, value: string) => {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const validItems = items.filter((i) => i.productName.trim() && i.reason.trim());
    if (validItems.length === 0) {
      showToast('Veuillez remplir au moins un article', 'error');
      return;
    }

    setLoading(true);
    try {
      const selectedContact = contacts.find((c) => c.id === contactId);
      const contactName = selectedContact
        ? selectedContact.name || selectedContact.companyName
        : '';

      for (const item of validItems) {
        await addDoc(collection(db, 'returns_notes'), {
          productName: item.productName.trim(),
          source: source,
          contactId: contactId || null,
          contactName: contactName,
          reason: item.reason.trim(),
          amount: parseFloat(item.amount) || 0,
          quantity: parseInt(item.quantity) || 1,
          status: item.status,
          date: date,
          ownerId: user.uid,
          createdAt: serverTimestamp(),
        });
      }

      showToast('Retours enregistrés avec succès', 'success');
      navigate('/returns-notes');
    } catch (error) {
      console.error(error);
      showToast("Erreur lors de l'enregistrement", 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 pb-20">
      {/* Header */}
      <div className="sticky top-0 z-20 pt-4 md:pt-6 px-4 md:px-6 mx-auto max-w-4xl w-full pointer-events-none transition-all">
        <header className="bg-white/90 backdrop-blur-xl border border-slate-200 shadow-sm shadow-slate-200/50 rounded-xl px-6 py-4 pointer-events-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="bg-white border border-slate-200 p-2.5 rounded-full hover:bg-slate-100 transition-colors shadow-sm"
            >
              <ArrowLeft size={20} className="text-slate-600" />
            </button>
            <div>
              <h2 className="text-lg font-bold font-display text-slate-900 tracking-tight flex items-center gap-2 uppercase">
                <HeartCrack className="text-[#ff3e1d] dark:text-[#ff3e1d]" size={20} />
                NOUVEAU RETOUR
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="bg-white border border-slate-200 text-slate-600 px-6 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-100 transition-all flex items-center gap-2"
            >
              Annuler
            </button>
            <button
              form="add-return-form"
              type="submit"
              disabled={loading || items.every((i) => !i.productName.trim() || !i.reason.trim())}
              className="bg-slate-900 text-white px-8 py-2.5 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2 shadow-xl shadow-slate-200 disabled:opacity-50"
            >
              <Check size={14} />
              {loading ? 'Création...' : 'Confirmer'}
            </button>
          </div>
        </header>
      </div>

      <main className="max-w-4xl mx-auto p-4 md:p-6 animate-fadeIn">
        <form id="add-return-form" onSubmit={handleSubmit} className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                    <ArrowLeftRight size={14} /> Type de Retour (Source)
                  </label>
                  <div className="flex p-1 bg-slate-100 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setSource('Client')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${source === 'Client' ? 'bg-white text-[#696cff] dark:text-[#b1b4ff] shadow-sm shadow-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      D'un Client
                    </button>
                    <button
                      type="button"
                      onClick={() => setSource('Fournisseur')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${source === 'Fournisseur' ? 'bg-white text-fuchsia-600 shadow-sm shadow-slate-200/50' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      Vers Fournisseur
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                    <User size={14} /> Sélectionner le {source}
                  </label>
                  <div className="relative">
                    <select
                      value={contactId}
                      onChange={(e) => setContactId(e.target.value)}
                      className="w-full px-4 py-3 pr-10 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-500 outline-none font-bold text-slate-900 bg-slate-50 transition-all appearance-none cursor-pointer"
                    >
                      <option value="">Sélectionnez un {source.toLowerCase()}...</option>
                      {contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name || c.companyName}
                        </option>
                      ))}
                    </select>
                    <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-slate-400">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-6 md:pl-8 md:border-l border-slate-100">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider flex items-center gap-1.5">
                    <Calendar size={14} /> Date du Retour
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-500 outline-none font-bold text-slate-900 bg-slate-50 transition-all cursor-pointer"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <Package size={16} className="text-slate-500" />
                Articles Retournés
              </h3>
              <button
                type="button"
                onClick={handleAddItem}
                className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-slate-800 transition-colors shadow-sm"
              >
                <Plus size={14} /> Ajouter un article
              </button>
            </div>

            {items.map((item, index) => (
              <div
                key={item.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative group"
              >
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    className="absolute -top-3 -right-3 bg-transparent dark:bg-transparent transition-colors z-10"
                    title="Supprimer cet article"
                  >
                    <Trash2 size={14} />
                  </button>
                )}

                <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
                  <div className="md:col-span-4 space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                      Article / Produit
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: T-Shirt Noir XL..."
                      value={item.productName}
                      onChange={(e) => updateItem(item.id, 'productName', e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-500 outline-none font-bold text-slate-900 bg-slate-50 transition-all"
                    />
                  </div>

                  <div className="md:col-span-4 space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                      Motif / Raison
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Défaut de fabrication..."
                      value={item.reason}
                      onChange={(e) => updateItem(item.id, 'reason', e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-500 outline-none font-bold text-slate-900 bg-slate-50 transition-all"
                    />
                  </div>

                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                      Qté
                    </label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={item.quantity}
                      onChange={(e) => updateItem(item.id, 'quantity', e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-500 outline-none font-bold text-slate-900 bg-slate-50 transition-all text-center"
                    />
                  </div>

                  <div className="md:col-span-2 space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                      Montant
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={item.amount}
                      onChange={(e) => updateItem(item.id, 'amount', e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-500 outline-none font-bold text-slate-900 bg-slate-50 transition-all"
                    />
                  </div>

                  <div className="md:col-span-12 space-y-1.5">
                    <label className="text-[10px] font-bold uppercase text-slate-500 tracking-wider">
                      Statut final
                    </label>
                    <select
                      value={item.status}
                      onChange={(e) => updateItem(item.id, 'status', e.target.value)}
                      className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-500/10 focus:border-slate-500 outline-none font-bold text-slate-900 bg-slate-50 transition-all"
                    >
                      <option value="En attente">En attente d'inspection</option>
                      <option value="Remboursé">Déjà Remboursé</option>
                      <option value="Remplacé">Déjà Remplacé</option>
                      <option value="Perte/Poubelle">Perte / Poubelle</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </form>
      </main>
    </div>
  );
}

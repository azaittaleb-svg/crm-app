import { useState, FormEvent } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { UserPlus, ArrowLeft, Phone, Mail, User, StickyNote } from 'lucide-react';
import { motion } from 'motion/react';
import { useNotification } from '../context/NotificationContext';

export default function AddClientPage() {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    ice: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast, confirm } = useNotification();

  const addClient = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name || !user) return;
    setLoading(true);
    try {
      // Check for duplicates with a timeout
      const q = query(
        collection(db, 'clients'),
        where('ownerId', '==', user.uid),
        where('name', '==', formData.name.trim())
      );

      const checkPromise = getDocs(q);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), 2000)
      );

      try {
        const querySnapshot = (await Promise.race([checkPromise, timeoutPromise])) as any;
        if (querySnapshot && !querySnapshot.empty) {
          showToast('Un client avec ce nom existe déjà', 'error');
          setLoading(false);
          return;
        }
      } catch (err) {
        console.warn('Duplicate check timed out or failed, proceeding', err);
      }

      confirm({
        title: "Confirmer l'ajout",
        message: `Voulez-vous ajouter le client "${formData.name.trim()}" ?`,
        onConfirm: async () => {
          try {
            setLoading(true);
            await addDoc(collection(db, 'clients'), {
              ownerId: user.uid,
              name: formData.name.trim(),
              phone: formData.phone || null,
              email: formData.email || null,
              addressLine1: formData.addressLine1 || null,
              addressLine2: formData.addressLine2 || null,
              city: formData.city || null,
              ice: formData.ice || null,
              notes: formData.notes || null,
              createdAt: serverTimestamp(),
            });
            showToast('Client ajouté avec succès', 'success');
            navigate('/clients');
          } catch (error) {
            console.error('Add client error:', error);
            showToast("Erreur lors de l'enregistrement", 'error');
            setLoading(false);
          }
        },
        onCancel: () => {
          setLoading(false);
        },
      });
    } catch (error) {
      console.error('Outer add client error:', error);
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-transparent overflow-y-auto">
      <main className="p-4 md:p-6 pb-20">
        <div className="max-w-2xl mx-auto">
          <motion.form
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={addClient}
            className="bg-white p-6 md:p-8 border border-slate-200 rounded-xl shadow-xs space-y-6"
          >
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-[#696cff]/10 flex items-center justify-center">
                <UserPlus className="text-[#696cff]" size={20} />
              </div>
              <div>
                <h1 className="text-xl font-bold font-display tracking-tight text-slate-900">
                  Nouveau Client
                </h1>
                <p className="text-[11px] font-bold uppercase text-[#566a7f] tracking-widest">
                  Enregistrement CRM
                </p>
              </div>
            </div>

            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-600 tracking-[0.2em] ml-3">
                    <User size={14} className="text-[#696cff] dark:text-[#b1b4ff]" />
                    Nom Complet ou STE
                  </label>
                  <input
                    required
                    autoFocus
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value.toUpperCase() })
                    }
                    className="w-full px-3.5 py-2.5 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px]"
                    placeholder="Nom ou Raison Sociale"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-widest ml-3">
                    <Mail size={14} className="text-[#566a7f]" />
                    Email (Envoi PDF)
                  </label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px]"
                    placeholder="contact@client.com"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-widest ml-4">
                    <StickyNote size={14} className="text-[#566a7f]" />
                    Adresse Ligne 1
                  </label>
                  <input
                    type="text"
                    value={formData.addressLine1}
                    onChange={(e) => setFormData({ ...formData, addressLine1: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px]"
                    placeholder="Numéro, Rue, Quartier..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-widest ml-4">
                    <Phone size={14} className="text-[#696cff]" />
                    Téléphone
                  </label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px]"
                    placeholder="06 ..."
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-widest ml-4">
                  <StickyNote size={14} className="text-[#566a7f]" />
                  Adresse Ligne 2
                </label>
                <input
                  type="text"
                  value={formData.addressLine2}
                  onChange={(e) => setFormData({ ...formData, addressLine2: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px]"
                  placeholder="Bâtiment, Étage, Appartement..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-widest ml-4">
                    <StickyNote size={14} className="text-[#566a7f]" />
                    Ville
                  </label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px]"
                    placeholder="Ville"
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-widest ml-4">
                    <StickyNote size={14} className="text-[#566a7f]" />
                    ICE (14 chiffres)
                  </label>
                  <input
                    type="text"
                    value={formData.ice}
                    onChange={(e) => setFormData({ ...formData, ice: e.target.value })}
                    maxLength={14}
                    className="w-full px-3.5 py-2.5 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px] font-mono"
                    placeholder="12345678901234"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-widest ml-4">
                  <StickyNote size={14} className="text-[#ffab00]" />
                  Note / Observation
                </label>
                <textarea
                  rows={3}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3.5 py-4 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px] resize-none h-32"
                  placeholder="Détails importants à retenir..."
                />
              </div>
            </div>

            <div className="pt-6 border-t border-slate-200">
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-lg font-sans font-semibold text-[13px] uppercase tracking-wider transition-all duration-300 cursor-pointer select-none bg-[#696cff] border border-[#696cff] text-white hover:bg-[#5f61e6] hover:border-[#5f61e6] shadow-sm shadow-[#696cff]/10 disabled:opacity-50"
              >
                <UserPlus size={18} />
                {loading ? 'Enregistrement...' : "Finaliser l'inscription"}
              </button>
            </div>
          </motion.form>

          <div className="mt-12 text-center space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-300">
              Sécurité & Confidentialité
            </p>
            <p className="text-sm text-slate-600 leading-relaxed max-w-sm mx-auto font-medium italic">
              "Les données clients sont chiffrées et ne sont accessibles que par les administrateurs
              du commerce."
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

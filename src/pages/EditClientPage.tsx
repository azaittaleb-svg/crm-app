import { useState, useEffect, FormEvent } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, ArrowLeft, Phone, Mail, User, StickyNote } from 'lucide-react';
import { motion } from 'motion/react';
import { useNotification } from '../context/NotificationContext';

export default function EditClientPage() {
  const { id } = useParams<{ id: string }>();
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
  const [fetching, setFetching] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast, confirm } = useNotification();

  useEffect(() => {
    if (!id || !user) return;

    const fetchClient = async () => {
      try {
        const clientSnap = await getDoc(doc(db, 'clients', id));
        if (clientSnap.exists()) {
          const data = clientSnap.data();
          if (data.ownerId === user.uid) {
            setFormData({
              name: data.name || '',
              phone: data.phone || '',
              email: data.email || '',
              addressLine1: data.addressLine1 || '',
              addressLine2: data.addressLine2 || '',
              city: data.city || '',
              ice: data.ice || '',
              notes: data.notes || '',
            });
          } else {
            showToast('Accès non autorisé', 'error');
            navigate('/clients');
          }
        } else {
          showToast('Client non trouvé', 'error');
          navigate('/clients');
        }
      } catch (err) {
        console.error('Error fetching client:', err);
        showToast('Erreur lors du chargement des informations', 'error');
      } finally {
        setFetching(false);
      }
    };

    fetchClient();
  }, [id, user, navigate, showToast]);

  const updateClient = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name || !user || !id) return;
    setLoading(true);

    confirm({
      title: 'Confirmer la modification',
      message: `Voulez-vous enregistrer les modifications pour "${formData.name.trim()}" ?`,
      onConfirm: async () => {
        try {
          setLoading(true);
          const clientRef = doc(db, 'clients', id);
          await updateDoc(clientRef, {
            name: formData.name.trim(),
            phone: formData.phone || null,
            email: formData.email || null,
            addressLine1: formData.addressLine1 || null,
            addressLine2: formData.addressLine2 || null,
            city: formData.city || null,
            ice: formData.ice || null,
            notes: formData.notes || null,
            updatedAt: serverTimestamp(),
          });
          showToast('Client mis à jour avec succès', 'success');
          navigate(`/client/${id}`);
        } catch (error) {
          console.error('Update client error:', error);
          showToast("Erreur lors de l'enregistrement", 'error');
          setLoading(false);
        }
      },
      onCancel: () => {
        setLoading(false);
      },
    });
  };

  if (fetching) {
    return (
      <div className="h-full flex items-center justify-center py-20">
        <div className="w-12 h-12 border-4 border-[#696cff] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full py-4 select-none">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Navigation back header */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="p-3 bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl hover:bg-slate-100 dark:hover:bg-[#232333] transition-all cursor-pointer"
          >
            <ArrowLeft size={16} className="text-[#697a8d] dark:text-[#a3a4cc]" />
          </button>
          <div>
            <span className="text-[11px] font-bold uppercase text-[#697a8d] dark:text-[#a3a4cc] tracking-widest leading-none">
              Retour
            </span>
            <h1 className="text-xl font-bold font-sans tracking-tight text-[#222222] dark:text-[#dbdade] mt-0.5">
              Modifier les informations
            </h1>
          </div>
        </div>

        <motion.form
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={updateClient}
          className="bg-white dark:bg-[#2b2c40] p-6 md:p-8 border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl space-y-6 shadow-[0_2px_12px_rgba(15,23,42,0.04)]"
        >
          <div className="flex items-center gap-3 mb-2 pb-4 border-b border-slate-100 dark:border-[#434460]/40">
            <div className="w-10 h-10 rounded-lg bg-[#696cff]/10 flex items-center justify-center shrink-0">
              <Pencil className="text-[#696cff] dark:text-[#b1b4ff]" size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-[#dbdade] leading-snug">
                Fiche d'identification
              </h2>
              <p className="text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-widest">
                Édition CRM
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-wider ml-1">
                  <User size={14} className="text-[#696cff] dark:text-[#b1b4ff]" />
                  Nom Complet ou STE
                </label>
                <input
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value.toUpperCase() })}
                  className="w-full px-3.5 py-2.5 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px]"
                  placeholder="Nom ou Raison Sociale"
                />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-wider ml-1">
                  <Mail size={14} className="text-[#566a7f] dark:text-[#a3a4cc]" />
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
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-wider ml-1">
                  <StickyNote size={14} className="text-[#566a7f] dark:text-[#a3a4cc]" />
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
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-wider ml-1">
                  <Phone size={14} className="text-[#696cff] dark:text-[#b1b4ff]" />
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

            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-wider ml-1">
                <StickyNote size={14} className="text-[#566a7f] dark:text-[#a3a4cc]" />
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
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-wider ml-1">
                  <StickyNote size={14} className="text-[#566a7f] dark:text-[#a3a4cc]" />
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
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-wider ml-1">
                  <StickyNote size={14} className="text-[#566a7f] dark:text-[#a3a4cc]" />
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
              <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-wider ml-1">
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

          <div className="pt-6 border-t border-slate-150 dark:border-[#434460]/45">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-lg font-sans font-semibold text-[13px] uppercase tracking-wider transition-all duration-300 cursor-pointer select-none bg-[#696cff] border border-[#696cff] text-white hover:bg-[#5f61e6] hover:border-[#5f61e6] shadow-sm shadow-[#696cff]/10 disabled:opacity-50"
            >
              <Pencil size={18} />
              {loading ? 'Enregistrement...' : 'Sauvegarder les modifications'}
            </button>
          </div>
        </motion.form>
      </div>
    </div>
  );
}

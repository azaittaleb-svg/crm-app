import { useState, useEffect, FormEvent } from 'react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useParams } from 'react-router-dom';
import { Pencil, ArrowLeft, Phone, Mail, User, StickyNote, Globe } from 'lucide-react';
import { motion } from 'motion/react';
import { useNotification } from '../context/NotificationContext';

export default function EditSupplierPage() {
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
    isInternational: false,
    excludeFromAccounting: false,
  });
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast, confirm } = useNotification();

  useEffect(() => {
    if (!id || !user) return;

    const fetchSupplier = async () => {
      try {
        const supplierSnap = await getDoc(doc(db, 'suppliers', id));
        if (supplierSnap.exists()) {
          const data = supplierSnap.data();
          if (data.ownerId === user.uid) {
            setFormData({
              name: data.name || '',
              phone: data.phone || '',
              email: data.email || '',
              addressLine1: data.addressLine1 || data.address || '',
              addressLine2: data.addressLine2 || '',
              city: data.city || '',
              ice: data.ice || '',
              notes: data.notes || '',
              isInternational: !!data.isInternational || (data.name ? data.name.toUpperCase().includes('MOTCHO') : false),
              excludeFromAccounting: !!data.excludeFromAccounting,
            });
          } else {
            showToast('Accès non autorisé', 'error');
            navigate('/suppliers');
          }
        } else {
          showToast('Fournisseur non trouvé', 'error');
          navigate('/suppliers');
        }
      } catch (err) {
        console.error('Error fetching supplier:', err);
        showToast('Erreur lors du chargement des informations', 'error');
      } finally {
        setFetching(false);
      }
    };

    fetchSupplier();
  }, [id, user, navigate, showToast]);

  const updateSupplier = async (e: FormEvent) => {
    e.preventDefault();
    if (!formData.name || !user || !id) return;
    setLoading(true);

    confirm({
      title: 'Confirmer la modification',
      message: `Voulez-vous enregistrer les modifications pour "${formData.name.trim()}" ?`,
      onConfirm: async () => {
        try {
          setLoading(true);
          const supplierRef = doc(db, 'suppliers', id);
          await updateDoc(supplierRef, {
            name: formData.name.trim(),
            phone: formData.phone || null,
            email: formData.email || null,
            address: formData.addressLine1 || null,
            addressLine1: formData.addressLine1 || null,
            addressLine2: formData.addressLine2 || null,
            city: formData.city || null,
            ice: formData.ice || null,
            notes: formData.notes || null,
            isInternational: !!formData.isInternational,
            excludeFromAccounting: !!formData.excludeFromAccounting,
            updatedAt: serverTimestamp(),
          });
          showToast('Fournisseur mis à jour avec succès', 'success');
          navigate(`/supplier/${id}`);
        } catch (error) {
          console.error('Update supplier error:', error);
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
          onSubmit={updateSupplier}
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
                Édition Fournisseur
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-[11px] font-bold uppercase text-[#566a7f] dark:text-[#a3a4cc] tracking-wider ml-1">
                  <User size={14} className="text-[#696cff] dark:text-[#b1b4ff]" />
                  Raison Sociale / Nom
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
                  Email du Fournisseur
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-[#ffffff] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg focus:ring-4 focus:ring-[#696cff]/10 focus:border-[#696cff] transition-all outline-hidden text-[#435971] dark:text-[#dbdade] placeholder:text-[#a1acb8] dark:placeholder:text-[#707194] shadow-none text-[14px]"
                  placeholder="contact@fournisseur.com"
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
                  ICE du Fournisseur (14 chiffres)
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

            {/* Format International / MOTCHO */}
            <div className="p-3.5 bg-indigo-50/60 dark:bg-[#232333] border border-indigo-100/80 dark:border-[#434460]/40 rounded-lg flex items-center justify-between gap-3 mt-3">
              <div className="flex items-center gap-2.5">
                <Globe size={18} className="text-[#696cff] shrink-0" />
                <div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 block">
                    Format International / MOTCHO
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                    Activer par défaut les calculs en USD, Douane (+36.5%), Transport & DIW
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={formData.isInternational}
                  onChange={(e) => setFormData({ ...formData, isInternational: e.target.checked })}
                />
                <div className="w-8 h-4 bg-slate-300 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#696cff]"></div>
              </label>
            </div>

            {/* Exclude from Accounting */}
            <div className="flex items-center pt-2">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={formData.excludeFromAccounting}
                  onChange={(e) => setFormData({ ...formData, excludeFromAccounting: e.target.checked })}
                />
                <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#ff3e1d]"></div>
                <span className="ms-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Exclure de la comptabilité
                </span>
              </label>
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

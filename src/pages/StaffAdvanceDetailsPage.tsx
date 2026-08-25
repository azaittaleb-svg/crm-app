import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  PlusCircle,
  Calendar,
  History,
  DollarSign,
  Wallet,
  Receipt,
  AlertCircle,
  X,
  Edit2,
  Trash2,
} from 'lucide-react';
import { staffAdvanceService, TemplateCharge, StaffAdvance } from '../services/staffAdvanceService';
import { useNotification } from '../context/NotificationContext';

export default function StaffAdvanceDetailsPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { showToast, confirm } = useNotification();

  const [template, setTemplate] = useState<TemplateCharge | null>(null);
  const [advances, setAdvances] = useState<StaffAdvance[]>([]);
  const [allAdvances, setAllAdvances] = useState<StaffAdvance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAdvance, setEditingAdvance] = useState<StaffAdvance | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [newAdvance, setNewAdvance] = useState({
    montant: 0,
    date: new Date().toISOString().split('T')[0],
    note: '',
    type: 'avance' as 'avance' | 'remboursement',
  });

  useEffect(() => {
    if (templateId) {
      fetchData();
    }
  }, [templateId]);

  const fetchData = async () => {
    if (!templateId) return;
    setLoading(true);
    try {
      const [templateData, allAdvancesData] = await Promise.all([
        staffAdvanceService.getTemplateById(templateId),
        staffAdvanceService.getAllAdvances(templateId),
      ]);

      if (templateData) {
        setTemplate(templateData);
        const sorted = (allAdvancesData || []).sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
        );
        setAdvances(sorted);
        setAllAdvances(sorted);
      } else {
        showToast('Modèle introuvable', 'error');
        navigate('/expenses/templates');
      }
    } catch (error) {
      showToast('Erreur lors du chargement des données', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId || newAdvance.montant <= 0) return;

    setSubmitting(true);
    try {
      await staffAdvanceService.addAdvance({
        chargeTemplateId: templateId,
        montant: Number(newAdvance.montant),
        date: newAdvance.date,
        moisConcerné: newAdvance.date.slice(0, 7),
        note: newAdvance.note,
        type: newAdvance.type,
      });

      showToast(
        newAdvance.type === 'remboursement'
          ? 'Remboursement enregistré'
          : 'Avance ajoutée avec succès',
        'success'
      );
      setShowAddModal(false);
      setNewAdvance({
        montant: 0,
        date: new Date().toISOString().split('T')[0],
        note: '',
        type: 'avance',
      });
      fetchData();
    } catch (error) {
      showToast("Erreur lors de l'enregistrement", 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAdvance = async (id: string) => {
    confirm({
      title: "Supprimer l'opération",
      message:
        'Êtes-vous sûr de vouloir supprimer cette opération ? Cette action est irréversible.',
      confirmText: 'Supprimer',
      cancelText: 'Annuler',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await staffAdvanceService.deleteAdvance(id);
          showToast('Suppression réussie', 'success');
          fetchData();
        } catch (error) {
          showToast('Erreur lors de la suppression', 'error');
        }
      },
    });
  };

  const handleEditAdvanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingAdvance || !editingAdvance.id || editingAdvance.montant <= 0) return;

    setSubmitting(true);
    try {
      await staffAdvanceService.updateAdvance(editingAdvance.id, {
        montant: Number(editingAdvance.montant),
        date: editingAdvance.date,
        note: editingAdvance.note,
        type: editingAdvance.type,
      });
      showToast('Modification enregistrée avec succès', 'success');
      setEditingAdvance(null);
      fetchData();
    } catch (error) {
      showToast('Erreur lors de la modification', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Global calculations (all time)
  const totalAvancesGlobal = allAdvances
    .filter((adv) => adv.type !== 'remboursement')
    .reduce((sum, adv) => sum + adv.montant, 0);

  const totalRemboursementsGlobal = allAdvances
    .filter((adv) => adv.type === 'remboursement')
    .reduce((sum, adv) => sum + adv.montant, 0);

  const detteEnCours = Math.max(0, totalAvancesGlobal - totalRemboursementsGlobal);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('fr-MA', {
      style: 'currency',
      currency: 'MAD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
      .format(amount)
      .replace('MAD', 'DH');
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('fr-MA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  if (loading && !template) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-12 h-12 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!template) return null;

  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/expenses/templates')}
            className="p-2 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-100"
          >
            <ArrowLeft className="w-6 h-6 text-slate-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{template.titre}</h1>
            <p className="text-slate-500 text-sm flex items-center gap-1.5 font-medium">
              <Wallet className="w-4 h-4 text-slate-400" />
              Compte d'avances de l'employé
            </p>
          </div>
        </div>
        <button
          onClick={() => {
            setNewAdvance({
              montant: 0,
              date: new Date().toISOString().split('T')[0],
              note: '',
              type: 'avance',
            });
            setShowAddModal(true);
          }}
          className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-850 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-sm hover:shadow-md active:scale-95 text-xs uppercase tracking-wider"
        >
          <PlusCircle className="w-5 h-5" />
          Ajouter opération
        </button>
      </div>

      {/* État Global du Compte d'Avances (Cumulative Across All Months) */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white p-6 rounded-xl border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/10">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-indigo-300">
              État de la Dette de l'Employé
            </h2>
            <p className="text-xs text-slate-300 mt-1">
              Les avances cumulées restent enregistrées d'un mois à l'autre sans impact forcé.
              L'employé peut rembourser petit à petit.
            </p>
          </div>
          <div className="bg-white/10 border border-white/10 px-4 py-2.5 rounded-2xl text-center md:text-right shrink-0">
            <span className="block text-[9px] uppercase font-bold text-slate-400 tracking-widest">
              Solde Actuel Restant à Rembourser
            </span>
            <span
              className={`text-xl font-bold tracking-tight ${detteEnCours > 0 ? 'text-[#ffab00] dark:text-[#ffab00]' : 'text-[#71dd37] dark:text-[#71dd37]'}`}
            >
              {formatCurrency(detteEnCours)}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white/5 border border-white/5 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Total Avances Reçues (Historique)
              </p>
              <p className="text-base font-bold text-white mt-1">
                {formatCurrency(totalAvancesGlobal)}
              </p>
            </div>
            <div className="w-8 h-8 bg-transparent dark:bg-transparent dark:bg-transparent/10 text-[#ffab00] dark:text-[#ffab00] flex items-center justify-center -500/20">
              <Receipt size={16} />
            </div>
          </div>
          <div className="bg-white/5 border border-white/5 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                Total Remboursé / Retenu
              </p>
              <p className="text-base font-bold text-[#71dd37] dark:text-[#71dd37] mt-1">
                {formatCurrency(totalRemboursementsGlobal)}
              </p>
            </div>
            <div className="w-8 h-8 bg-transparent dark:bg-transparent dark:bg-transparent/10 text-[#71dd37] dark:text-[#71dd37] flex items-center justify-center -500/20">
              <Wallet size={16} />
            </div>
          </div>
        </div>
      </div>

      {/* History */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4.5 border-b border-slate-100 bg-transparent flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-slate-450" />
            <h2 className="font-bold text-slate-950 text-sm uppercase tracking-wide">
              Détail des opérations
            </h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="px-6 py-12 flex justify-center">
              <div className="w-8 h-8 border-3 border-brand-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : advances.length > 0 ? (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-transparent">
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    Date
                  </th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    Type
                  </th>
                  <th className="px-6 py-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    Note
                  </th>
                  <th className="px-6 py-4 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                    Montant
                  </th>
                  <th className="px-6 py-4 text-right text-[10px] font-bold uppercase tracking-widest text-slate-400 border-b border-slate-100 w-28">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {advances.map((adv, idx) => {
                  const isRep = adv.type === 'remboursement';
                  return (
                    <tr key={adv.id + "_" + idx} className="hover:bg-transparent transition-colors">
                      <td className="px-6 py-4.5 text-xs font-extrabold text-slate-700">
                        {formatDate(adv.date)}
                      </td>
                      <td className="px-6 py-4.5">
                        <span
                          className={`text-[9px] font-bold uppercase ${isRep ? 'bg-transparent text-[#71dd37] dark:text-[#71dd37] -150' : 'bg-transparent dark:bg-transparent text-[#ffab00] dark:text-[#ffab00] -150'}`}
                        >
                          {isRep ? 'Remboursement' : 'Avance'}
                        </span>
                      </td>
                      <td
                        className="px-6 py-4.5 text-xs font-semibold text-slate-500 truncate max-w-[200px]"
                        title={adv.note}
                      >
                        {adv.note || '-'}
                      </td>
                      <td className="px-6 py-4.5 text-right font-bold text-xs">
                        <span
                          className={
                            isRep ? 'text-[#71dd37] dark:text-[#71dd37]' : 'text-slate-900'
                          }
                        >
                          {isRep ? '+' : '-'} {formatCurrency(adv.montant)}
                        </span>
                      </td>
                      <td className="px-6 py-4.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditingAdvance(adv)}
                            className="text-slate-400 hover:text-brand-600 hover:bg-slate-100 transition-colors p-2 rounded-xl"
                            title="Modifier"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => adv.id && handleDeleteAdvance(adv.id)}
                            className="text-slate-400 hover:text-[#ff3e1d] dark:text-[#ff3e1d] hover:bg-transparent dark:bg-transparent transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-12 text-center">
              <div className="w-12 h-12 bg-slate-50 text-slate-350 rounded-full flex items-center justify-center mx-auto mb-3">
                <Receipt className="w-6 h-6 text-slate-350" />
              </div>
              <p className="text-slate-500 text-xs font-extrabold uppercase tracking-wide text-center">
                Aucune opération enregistrée
              </p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Cliquez sur le bouton ci-dessus pour enregistrer des avances ou des
                remboursements/retenues pour cet employé.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-transparent backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                  Nouvelle Opération
                </h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-2 hover:bg-slate-50 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleAddAdvance} className="p-6 space-y-5">
                {/* Type Selection Tabs */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Type d'opération
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-150">
                    <button
                      type="button"
                      onClick={() => setNewAdvance({ ...newAdvance, type: 'avance' })}
                      className={`py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                        newAdvance.type === 'avance'
                          ? 'bg-white text-[#ffab00] dark:text-[#ffab00] shadow border border-transparent dark:border-transparent'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Avance
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewAdvance({ ...newAdvance, type: 'remboursement' })}
                      className={`py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                        newAdvance.type === 'remboursement'
                          ? 'bg-white text-[#71dd37] dark:text-[#71dd37] shadow border border-transparent dark:border-transparent'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Remboursement / Retenue
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 px-1 font-bold">
                    {newAdvance.type === 'remboursement'
                      ? "Retirera de l'argent de son salaire et diminuera son solde de dettes."
                      : "L'argent pris par l'employé pendant le mois en cours."}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Montant (DH)
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0.00"
                      className="w-full bg-transparent dark:bg-transparent pl-12 pr-4 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:-500 text-lg font-bold text-slate-900"
                      value={newAdvance.montant || ''}
                      onChange={(e) =>
                        setNewAdvance({ ...newAdvance, montant: parseFloat(e.target.value) })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                    <input
                      type="date"
                      required
                      className="w-full bg-transparent dark:bg-transparent pl-12 pr-4 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:-500 text-sm font-bold text-slate-900"
                      value={newAdvance.date}
                      onChange={(e) => setNewAdvance({ ...newAdvance, date: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Note (Optionnel)
                  </label>
                  <textarea
                    placeholder="Ex: Avance exceptionnelle ou Retenue salaire..."
                    className="w-full bg-transparent dark:bg-transparent focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:-500 text-sm font-medium text-slate-700"
                    rows={3}
                    value={newAdvance.note}
                    onChange={(e) => setNewAdvance({ ...newAdvance, note: e.target.value })}
                  />
                </div>

                {newAdvance.type === 'remboursement' && newAdvance.montant > 0 && (
                  <div className="bg-transparent dark:bg-transparent text-emerald-850 text-xs font-semibold dark: flex items-start gap-3">
                    <Wallet className="w-5 h-5 shrink-0 text-[#71dd37] dark:text-[#71dd37] mt-0.5" />
                    <p>
                      Ce remboursement réduira la dette globale restante à payer de{' '}
                      {formatCurrency(newAdvance.montant)}.
                    </p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting || newAdvance.montant <= 0}
                  className="w-full bg-brand-600 text-white font-bold uppercase tracking-widest py-5 rounded-2xl hover:bg-brand-700 transition-all shadow-lg shadow-brand-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                >
                  {submitting ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingAdvance && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingAdvance(null)}
              className="absolute inset-0 bg-transparent backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                  Modifier l'Opération
                </h2>
                <button
                  onClick={() => setEditingAdvance(null)}
                  className="p-2 hover:bg-slate-50 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleEditAdvanceSubmit} className="p-6 space-y-5">
                {/* Type Selection Tabs for Editing */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Type d'opération
                  </label>
                  <div className="grid grid-cols-2 gap-2 bg-slate-50 p-1.5 rounded-2xl border border-slate-150">
                    <button
                      type="button"
                      onClick={() => setEditingAdvance({ ...editingAdvance, type: 'avance' })}
                      className={`py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                        editingAdvance.type !== 'remboursement'
                          ? 'bg-white text-[#ffab00] dark:text-[#ffab00] shadow border border-transparent dark:border-transparent'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Avance
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingAdvance({ ...editingAdvance, type: 'remboursement' })
                      }
                      className={`py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                        editingAdvance.type === 'remboursement'
                          ? 'bg-white text-[#71dd37] dark:text-[#71dd37] shadow border border-transparent dark:border-transparent'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Remboursement
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Montant (DH)
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0.00"
                      className="w-full bg-transparent dark:bg-transparent pl-12 pr-4 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:-500 text-lg font-bold text-slate-900"
                      value={editingAdvance.montant || ''}
                      onChange={(e) =>
                        setEditingAdvance({
                          ...editingAdvance,
                          montant: parseFloat(e.target.value) || 0,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                    <input
                      type="date"
                      required
                      className="w-full bg-transparent dark:bg-transparent pl-12 pr-4 focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:-500 text-sm font-bold text-slate-900"
                      value={editingAdvance.date}
                      onChange={(e) =>
                        setEditingAdvance({ ...editingAdvance, date: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Note (Optionnel)
                  </label>
                  <textarea
                    placeholder="Ex: Avance exceptionnelle pour loyer..."
                    className="w-full bg-transparent dark:bg-transparent focus:outline-none focus:ring-4 focus:ring-brand-500/10 focus:-500 text-sm font-medium text-slate-700"
                    rows={3}
                    value={editingAdvance.note || ''}
                    onChange={(e) => setEditingAdvance({ ...editingAdvance, note: e.target.value })}
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || editingAdvance.montant <= 0}
                  className="w-full bg-brand-600 text-white font-bold uppercase tracking-widest py-5 rounded-2xl hover:bg-brand-700 transition-all shadow-lg shadow-brand-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
                >
                  {submitting ? 'Enregistrement...' : 'Enregistrer les modifications'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  PlusCircle,
  Calendar,
  History,
  DollarSign,
  Heart,
  Eye,
  EyeOff,
  Trash2,
  Edit2,
  X,
  Lock,
  Unlock,
  AlertCircle,
  Key,
  ShieldCheck,
  Settings,
} from 'lucide-react';
import { zakatService, ZakatPayout } from '../services/zakatService';
import { expenseService, ExpenseTemplate } from '../services/expenseService';
import { useNotification } from '../context/NotificationContext';

export default function ZakatDetailsPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const navigate = useNavigate();
  const { showToast, confirm } = useNotification();

  const [template, setTemplate] = useState<ExpenseTemplate | null>(null);
  const [payouts, setPayouts] = useState<ZakatPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPayout, setEditingPayout] = useState<ZakatPayout | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Master toggle for showing hidden transaction details
  const [showHiddenDetails, setShowHiddenDetails] = useState(false);

  // Form state for a new payout
  const [newPayout, setNewPayout] = useState({
    titre: '',
    montant: '',
    date: new Date().toISOString().split('T')[0],
    note: '',
    hide: false,
  });

  // Security password states

  // Challenge modal states for restricting actions

  // Create password form states

  // Password change states
  const [showChangeModal, setShowChangeModal] = useState(false);

  useEffect(() => {
    if (templateId) {
      checkSecurityAndFetch();
    }
  }, [templateId]);

  const checkSecurityAndFetch = async () => {
    setLoading(true);
    try {
      // 1. Fetch templates first to verify templateId exists
      const templates = await expenseService.getTemplates();
      const currentTemplate = templates.find((t) => t.id === templateId);

      if (!currentTemplate) {
        showToast('Modèle introuvable', 'error');
        navigate('/zakat');
        return;
      }
      setTemplate(currentTemplate);


      // Fetch Zakat payouts
      const data = await zakatService.getAllPayouts(templateId);
      setPayouts(data);
    } catch (error) {
      showToast('Erreur de chargement', 'error');
    } finally {
      setLoading(false);
    }
  };


  const handleAddPayoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateId || !newPayout.montant || parseFloat(newPayout.montant) <= 0) return;

    setSubmitting(true);
    try {
      await zakatService.addPayout({
        templateId,
        titre: newPayout.titre.trim() || 'Versement sans titre',
        montant: Number(newPayout.montant),
        date: newPayout.date,
        note: newPayout.note.trim() || 'Sortie sans note',
        hide: newPayout.hide,
      });

      showToast('Distribution de Zakat enregistrée avec succès', 'success');
      setShowAddModal(false);
      setNewPayout({
        titre: '',
        montant: '',
        date: new Date().toISOString().split('T')[0],
        note: '',
        hide: false,
      });
      // Refresh payouts list
      const data = await zakatService.getAllPayouts(templateId);
      setPayouts(data);
    } catch (error) {
      showToast("Erreur lors de l'enregistrement", 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditPayoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayout || !editingPayout.id || editingPayout.montant <= 0) return;

    setSubmitting(true);
    try {
      await zakatService.updatePayout(editingPayout.id, {
        titre: (editingPayout.titre || '').trim() || 'Versement sans titre',
        montant: Number(editingPayout.montant),
        date: editingPayout.date,
        note: editingPayout.note.trim() || 'Sortie sans note',
        hide: editingPayout.hide,
      });
      showToast('Modification enregistrée', 'success');
      setEditingPayout(null);
      // Refresh
      const data = await zakatService.getAllPayouts(templateId!);
      setPayouts(data);
    } catch (error) {
      showToast('Erreur lors de la modification', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePayout = async (id: string) => {
    confirm({
      title: "Supprimer l'opération",
      message: 'Êtes-vous sûr de vouloir supprimer cette sortie de Zakat ?',
      confirmText: 'Supprimer',
      cancelText: 'Annuler',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await zakatService.deletePayout(id);
          showToast('Suppression réussie', 'success');
          // Refresh
          const data = await zakatService.getAllPayouts(templateId!);
          setPayouts(data);
        } catch (error) {
          showToast('Erreur lors de la suppression', 'error');
        }
      },
    });
  };

  // Calculations
  const zakatDefinedSum = template ? template.amount : 0;
  const totalPaidOut = payouts.reduce((sum, p) => sum + p.montant, 0);
  const remainingZakatSum = Math.max(0, zakatDefinedSum - totalPaidOut);

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

  const formatDate = (dateStr: string | undefined, createdAt?: any) => {
    if (dateStr) {
      if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts.length === 3) {
          const year = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10) - 1;
          const day = parseInt(parts[2], 10);
          return new Date(year, month, day).toLocaleDateString('fr-MA', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          });
        }
      }
      return dateStr;
    }
    if (createdAt) {
      const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
      return d.toLocaleDateString('fr-MA', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    }
    return '-';
  };

  if (loading && !template) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!template) return null;

  // Render LOCK SCREEN if password is set but not unlocked yet
  

  // Render INITIAL PASSWORD SETUP if no password is set
  

  // Render UNLOCKED FULL PAGE CONTENT
  return (
    <div className="max-w-6xl mx-auto space-y-8 pb-12 text-left">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/zakat')}
            className="p-2 hover:bg-white rounded-lg transition-colors border border-transparent hover:border-slate-150"
          >
            <ArrowLeft className="w-6 h-6 text-slate-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{template.name}</h1>
            <p className="text-slate-500 text-sm flex items-center gap-1.5 font-medium">
              <Heart className="w-4 h-4 text-[#ff3e1d] dark:text-[#ff3e1d]" />
              Compte de versement de la Zakat
              <span className="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-600 border border-slate-200 rounded px-1.5 py-0.5 ml-2 font-bold uppercase">
                <Lock className="w-2.5 h-2.5" /> Sécurisé
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">

          <button
            onClick={() => {
              setNewPayout({
                montant: '',
                date: new Date().toISOString().split('T')[0],
                note: '',
                hide: false,
              });
              setShowAddModal(true);
            }}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-amber-600 to-amber-700 hover:brightness-105 hover:from-amber-700 hover:to-amber-800 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-md active:scale-95 text-xs uppercase tracking-wider"
          >
            <PlusCircle className="w-5 h-5" />
            Enregistrer un versement
          </button>
        </div>
      </div>

      {/* Hero Zakat Budget Status */}
      <div className="bg-gradient-to-br from-amber-800 to-amber-950 text-white p-6 rounded-xl border border-amber-700/50 shadow-xl space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/10 text-left">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-amber-200">
              Suivi du budget de Zakat
            </h2>
            <p className="text-xs text-amber-100/80 mt-1">
              Ce compte vous permet de distribuer et d'enregistrer chaque aumône de manière
              confidentielle et d'en suivre le solde restant.
            </p>
          </div>
          <div className="bg-white/10 border border-white/15 px-4 py-3 rounded-2xl text-center md:text-right shrink-0">
            <span className="block text-[9px] uppercase font-bold text-amber-200 tracking-widest leading-none mb-1">
              Restant à Verser (Solde)
            </span>
            <span className="text-2xl font-bold tracking-tight text-amber-300">
              {formatCurrency(remainingZakatSum)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white/5 border border-white/5 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-200/70">
                Zakat Définie au total
              </p>
              <p className="text-base font-bold text-white mt-1">
                {formatCurrency(zakatDefinedSum)}
              </p>
            </div>
            <div className="w-9 h-9 bg-transparent dark:bg-transparent dark:bg-transparent/10 text-amber-300 flex items-center justify-center -500/20">
              <span className="font-bold text-xs">SUM</span>
            </div>
          </div>

          <div className="bg-white/5 border border-white/5 p-4 rounded-xl flex items-center justify-between">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-200/70">
                Total Déjà Versé
              </p>
              <p className="text-base font-bold text-emerald-300 mt-1">
                {formatCurrency(totalPaidOut)}
              </p>
            </div>
            <div className="w-9 h-9 bg-transparent dark:bg-transparent dark:bg-transparent/10 text-emerald-300 flex items-center justify-center -500/20">
              <span className="font-bold text-xs">OUT</span>
            </div>
          </div>
        </div>
      </div>

      {/* History Area */}
      <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg overflow-hidden">
        <div className="px-5 py-3 border-b border-[#dbdade]/70 dark:border-[#434460]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#697a8d] dark:text-[#a3a4cc]" />
            <h2 className="font-semibold text-[#435971] dark:text-[#dbdade] text-sm">
              Détail des versements
            </h2>
          </div>
          {/* Confident Toggle */}
          <button
            onClick={() => setShowHiddenDetails(!showHiddenDetails)}
            className="flex items-center gap-2 text-xs font-semibold text-[#697a8d] hover:text-[#435971] dark:text-[#a3a4cc] dark:hover:text-[#dbdade] transition-colors"
          >
            {showHiddenDetails ? (
              <Eye className="w-3.5 h-3.5" />
            ) : (
              <EyeOff className="w-3.5 h-3.5" />
            )}
            <span>
              {showHiddenDetails ? 'Masquer éléments privés' : 'Afficher éléments privés'}
            </span>
          </button>
        </div>

        <div className="overflow-x-auto">
          {payouts.length > 0 ? (
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[#f5f5f9] dark:bg-[#232333]/50 border-b border-[#dbdade]/70 dark:border-[#434460]/40">
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[#697a8d] dark:text-[#a3a4cc]">
                    Date
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[#697a8d] dark:text-[#a3a4cc]">
                    Titre / Bénéficiaire
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[#697a8d] dark:text-[#a3a4cc]">
                    Note
                  </th>
                  <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-[#697a8d] dark:text-[#a3a4cc]">
                    Confidentialité
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#697a8d] dark:text-[#a3a4cc]">
                    Montant
                  </th>
                  <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[#697a8d] dark:text-[#a3a4cc] w-28">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dbdade]/70 dark:divide-[#434460]/40">
                {payouts.map((payout) => {
                  const isMaskedForUser = payout.hide && !showHiddenDetails;

                  return (
                    <tr
                      key={payout.id}
                      className="hover:bg-[#f5f5f9]/50 dark:hover:bg-[#232333]/30 transition-colors"
                    >
                      <td className="px-5 py-3 text-sm text-[#435971] dark:text-[#dbdade]">
                        {isMaskedForUser ? '••/••/••••' : formatDate(payout.date, payout.createdAt)}
                      </td>
                      <td className="px-5 py-3 text-sm font-semibold text-[#435971] dark:text-[#dbdade]">
                        {isMaskedForUser ? (
                          <span className="text-[#a1acb8] dark:text-[#707194]">••••••</span>
                        ) : (
                          payout.titre || payout.name || '-'
                        )}
                      </td>
                      <td
                        className="px-5 py-3 text-sm text-[#697a8d] dark:text-[#a3a4cc] max-w-[240px] truncate"
                        title={payout.note}
                      >
                        {isMaskedForUser ? (
                          <span className="inline-flex items-center gap-1.5 text-[#a1acb8] dark:text-[#707194] text-xs">
                            <Lock className="w-3 h-3" /> [Détail masqué par discrétion]
                          </span>
                        ) : (
                          payout.note || '-'
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded ${
                            payout.hide
                              ? 'bg-[#ffab00]/10 text-[#ffab00]'
                              : 'bg-[#71dd37]/10 text-[#71dd37]'
                          }`}
                        >
                          {payout.hide ? (
                            <>
                              <Lock className="w-2.5 h-2.5" /> Masqué
                            </>
                          ) : (
                            <>
                              <Unlock className="w-2.5 h-2.5" /> Public
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right font-mono font-semibold text-sm text-[#435971] dark:text-[#dbdade]">
                        {isMaskedForUser ? (
                          <span className="text-[#a1acb8] dark:text-[#707194]">••••• DH</span>
                        ) : (
                          formatCurrency(payout.montant)
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setEditingPayout(payout)}
                            className="p-1.5 text-[#697a8d] hover:text-[#696cff] dark:text-[#a3a4cc] dark:hover:text-[#b1b4ff] hover:bg-[#e7e7ff] dark:hover:bg-[#393a59] rounded transition-colors"
                            title="Modifier"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => {
                              if (payout.id && window.confirm('Voulez-vous vraiment supprimer ce versement ?')) {
                                handleDeletePayout(payout.id);
                              }
                            }}
                            className="p-1.5 text-[#697a8d] hover:text-[#ff3e1d] dark:text-[#a3a4cc] dark:hover:text-[#ff3e1d] hover:bg-[#ffe0db] dark:hover:bg-[#4b2e2e] rounded transition-colors"
                            title="Supprimer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="px-6 py-16 text-center">
              <div className="w-12 h-12 bg-transparent dark:bg-transparent text-[#ffab00] dark:text-[#ffab00] flex items-center justify-center mx-auto mb-3 dark:">
                <Heart className="w-6 h-6 text-[#ffab00] dark:text-[#ffab00]" />
              </div>
              <p className="text-slate-700 text-xs font-extrabold uppercase tracking-wide text-center">
                Aucune distribution enregistrée
              </p>
              <p className="text-xs text-slate-400 mt-1.5 max-w-sm mx-auto">
                Cliquez sur le bouton ci-dessus pour ajouter des versements effectués à partir de
                votre budget Zakat défini.
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
              className="relative w-full max-w-md bg-white rounded-xl shadow-2xl overflow-hidden text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="-100 flex items-center justify-between bg-transparent dark:bg-transparent dark:bg-transparent">
                <h2 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <Heart className="w-5 h-5 text-[#ffab00] dark:text-[#ffab00]" />
                  Nouveau versement de Zakat
                </h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="p-2 hover:bg-slate-50 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleAddPayoutSubmit} className="p-6 space-y-5">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Bénéficiaire / Titre (Obligatoire)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Famille nécessiteuse, Veuve..."
                    className="w-full bg-transparent dark:bg-transparent px-4 py-2 border-b-2 border-slate-200 focus:outline-none focus:border-amber-500 text-sm font-bold text-slate-900"
                    value={newPayout.titre}
                    onChange={(e) => setNewPayout({ ...newPayout, titre: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Montant versé (DH)
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-350" />
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0.00"
                      className="w-full bg-transparent dark:bg-transparent pl-12 pr-4 focus:outline-none focus:ring-4 focus:focus:ring-amber-500/10 focus:-500 text-lg font-bold text-slate-900"
                      value={newPayout.montant}
                      onChange={(e) => setNewPayout({ ...newPayout, montant: e.target.value })}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                      Date du versement
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-350" />
                      <input
                        type="date"
                        required
                        className="w-full bg-transparent dark:bg-transparent pl-11 pr-4 focus:outline-none focus:focus:ring-amber-500/10 focus:-500 text-sm font-bold text-slate-900"
                        value={newPayout.date}
                        onChange={(e) => setNewPayout({ ...newPayout, date: e.target.value })}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1">
                    Bénéficiaire / Description (Optionnel)
                  </label>
                  <textarea
                    placeholder="Ex: Famille nécessiteuse, canevas de bienfaisance..."
                    className="w-full bg-transparent dark:bg-transparent focus:outline-none focus:focus:ring-amber-500/10 focus:-500 text-sm font-medium text-slate-700"
                    rows={2.5}
                    value={newPayout.note}
                    onChange={(e) => setNewPayout({ ...newPayout, note: e.target.value })}
                  />
                </div>

                {/* Privacy / Hide Checkbox */}
                <div className="bg-transparent dark:bg-transparent dark: flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="hide-checkbox"
                    className="mt-1 rounded text-[#ffab00] dark:text-[#ffab00] focus:ring-amber-500 border-slate-300 w-4.5 h-4.5"
                    checked={newPayout.hide}
                    onChange={(e) => setNewPayout({ ...newPayout, hide: e.target.checked })}
                  />
                  <div className="space-y-1 text-left">
                    <label
                      htmlFor="hide-checkbox"
                      className="block text-xs font-bold text-amber-950 cursor-pointer"
                    >
                      Masquer cette transaction par discrétion
                    </label>
                    <p className="text-[10px] text-[#ffab00] dark:text-[#ffab00] leading-normal">
                      Cependant, le montant sera bien déduit de l'enveloppe totale mais les détails
                      (note/date/somme) seront masqués de la liste générale à moins d'activer le
                      mode "Afficher les éléments privés".
                    </p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !newPayout.montant || parseFloat(newPayout.montant) <= 0}
                  className="w-full bg-gradient-to-r from-amber-600 to-amber-700 text-white font-bold uppercase tracking-widest py-4.5 rounded-2xl hover:brightness-105 transition-all shadow-lg shadow-amber-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none text-center"
                >
                  {submitting ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      
    </div>
  );
}

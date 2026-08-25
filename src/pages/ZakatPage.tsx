import { useState, useEffect, FormEvent } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { ZakatXlsxModal } from '../components/ZakatXlsxModal';
import * as XLSX from 'xlsx';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { expenseService, ExpenseTemplate, ExpenseType } from '../services/expenseService';
import { zakatService, ZakatPayout } from '../services/zakatService';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  Heart,
  Plus,
  Trash2,
  Edit2,
  Lock,
  Unlock,
  Key,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Sparkles,
  ShieldCheck,
  Coins,
  Moon,
  Copy,
  Check,
} from 'lucide-react';
import {
  getIslamicDate,
  isZakatReminderActive,
  dismissZakatReminderForYear,
  detectZakatSimulation,
  ZakatSimulationInfo,
  IslamicDateInfo,
} from '../utils/hijriHelper';
import { PageHeader } from '../components/PageHeader';

export default function ZakatPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast, confirm } = useNotification();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const [templates, setTemplates] = useState<ExpenseTemplate[]>([]);
  const [payouts, setPayouts] = useState<ZakatPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  const [hijriDate, setHijriDate] = useState<IslamicDateInfo>(getIslamicDate());
  const [zakatReminderActive, setZakatReminderActive] = useState<boolean>(isZakatReminderActive());
  const [isSimDismissed, setIsSimDismissed] = useState<boolean>(
    () => localStorage.getItem(`zakat_sim_dismissed_year_${getIslamicDate().year}`) === 'true'
  );

  const handleExportToExcel = () => {
    try {
      if (templates.length === 0 && payouts.length === 0) {
        showToast('Aucune donnée de Zakat à exporter', 'info');
        return;
      }
      
      const workbook = XLSX.utils.book_new();

      // Sheet 1: Payouts (Versements) - FIRST SHEET SO IT'S VISIBLE IMMEDIATELY
      const payoutsData = payouts.map((p: any) => {
        const envelope = templates.find((t) => t.id === p.templateId);
        return {
          'Date du versement': p.date || '',
          'Bénéficiaire / Titre': p.titre || p.name || '',
          'Montant Distribué (DH)': p.montant || p.amount || 0,
          'Enveloppe Source': envelope ? envelope.name : p.templateName || 'Inconnue',
          'Notes explicatives': p.note || p.notes || '',
          'Confidentialité': p.hide ? 'Masqué' : 'Public',
        };
      });
      // If there are no payouts, add a dummy row so the sheet isn't completely empty and confusing
      if (payoutsData.length === 0) {
        payoutsData.push({
          'Date du versement': '-',
          'Bénéficiaire / Titre': 'Aucun versement enregistré',
          'Montant Distribué (DH)': 0,
          'Enveloppe Source': '-',
          'Notes explicatives': '-',
          'Confidentialité': '-',
        });
      }
      const payoutsWorksheet = XLSX.utils.json_to_sheet(payoutsData);
      XLSX.utils.book_append_sheet(workbook, payoutsWorksheet, 'Détail des Versements');

      // Sheet 2: Envelopes
      const envelopesData = templates.map((t) => ({
        'Nom de l\'Enveloppe': t.name,
        'Montant Budgétisé (DH)': t.amount,
        'Catégorie': t.category || 'Zakat',
        'Statut Actif': t.isActive ? 'Oui' : 'Non',
      }));
      if (envelopesData.length === 0) {
        envelopesData.push({
          'Nom de l\'Enveloppe': 'Aucune enveloppe',
          'Montant Budgétisé (DH)': 0,
          'Catégorie': '-',
          'Statut Actif': '-',
        });
      }
      const envelopesWorksheet = XLSX.utils.json_to_sheet(envelopesData);
      XLSX.utils.book_append_sheet(workbook, envelopesWorksheet, 'Enveloppes de Zakat');

      XLSX.writeFile(workbook, 'export_zakat_total.xlsx');
      showToast('Exportation Excel Zakat réussie !', 'success');
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de l'exportation", 'error');
    }
  };

  useEffect(() => {
    const handleImportEvent = () => setIsImportModalOpen(true);
    const handleExportEvent = () => handleExportToExcel();

    window.addEventListener('trigger-import-zakat', handleImportEvent);
    window.addEventListener('trigger-export-zakat', handleExportEvent);

    return () => {
      window.removeEventListener('trigger-import-zakat', handleImportEvent);
      window.removeEventListener('trigger-export-zakat', handleExportEvent);
    };
  }, [templates, payouts]);

  useEffect(() => {
    const handleUpdate = () => {
      setHijriDate(getIslamicDate());
      setZakatReminderActive(isZakatReminderActive());
      setIsSimDismissed(
        localStorage.getItem(`zakat_sim_dismissed_year_${getIslamicDate().year}`) === 'true'
      );
    };

    window.addEventListener('zakatSimulationChange', handleUpdate);
    return () => {
      window.removeEventListener('zakatSimulationChange', handleUpdate);
    };
  }, []);

  const location = useLocation();

  useEffect(() => {
    if (location.state && location.state.autoClone) {
      const { recommendedName, recommendedAmount } = location.state.autoClone;
      setNewName(recommendedName);
      setNewAmount(recommendedAmount.toString());
      setIsAdding(true);
      showToast("Simulation d'exercice : l'enveloppe a été pré-remplie", 'info');

      // Scroll to container
      setTimeout(() => {
        document
          .getElementById('zakat-form-container')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    }
  }, [location.state]);

  // New template form state (Always created as category "Zakat")
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [setupError, setSetupError] = useState('');
  const [showChangeModal, setShowChangeModal] = useState(false);

  // Challenge lock state for edit/delete actions
  const [actionChallenge, setActionChallenge] = useState<{
    type: 'edit' | 'delete';
    template: ExpenseTemplate;
  } | null>(null);
  const [challengeError, setChallengeError] = useState('');

  // Fetch security status, templates, and payouts
  useEffect(() => {
    if (!user) return;

    setLoading(true);



    // 2. Setup templates observer (Filter Zakat templates in real-time)
    const templatesQuery = query(
      collection(db, 'expense_templates'),
      where('ownerId', '==', user.uid)
    );

    const unsubscribeTemplates = onSnapshot(
      templatesQuery,
      (snapshot) => {
        const allTemplates = snapshot.docs.map((doc) => {
          const d = doc.data();
          return {
            id: doc.id,
            ownerId: d.ownerId,
            name: d.name || d.titre,
            type: d.type,
            amount: d.amount !== undefined ? d.amount : d.montant,
            category: d.category || d.categorie,
            isActive: d.isActive,
            dueDay: d.dueDay,
            createdAt: d.createdAt,
          } as ExpenseTemplate;
        });

        // Keep only templates matching "zakat" in name or category
        const filtered = allTemplates.filter((t) => {
          const nameLower = (t.name || '').toLowerCase();
          const catLower = (t.category || '').toLowerCase();
          return nameLower.includes('zakat') || catLower.includes('zakat');
        });

        setTemplates(filtered);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'expense_templates');
        setLoading(false);
      }
    );

    // 3. Setup payouts observer to sum historical payouts accurately
    const payoutsQuery = query(collection(db, 'zakat_payouts'), where('ownerId', '==', user.uid));

    const unsubscribePayouts = onSnapshot(
      payoutsQuery,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as ZakatPayout);
        setPayouts(data);
      },
      (error) => {
        console.error('Error reading zakat payouts:', error);
      }
    );

    return () => {
      unsubscribeTemplates();
      unsubscribePayouts();
    };
  }, [user]);

  // Handle access unlock

  // Handle password setup

  // Handle password change

  const [changeError, setChangeError] = useState('');

  // Handle save (create or update a envelope template)
  const handleSaveEnvelope = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const envelopeData: any = {
        name: newName,
        type: ExpenseType.FIXED, // Treated as Fixed monthly structural target
        amount: Number(newAmount),
        category: 'Zakat', // Strictly defined as Zakat
        isActive: true,
      };

      if (dueDay) envelopeData.dueDay = Number(dueDay);

      if (editingTemplateId) {
        await expenseService.updateTemplate(editingTemplateId, envelopeData);
        showToast('Enveloppe de Zakat mise à jour');
      } else {
        await expenseService.createTemplate(envelopeData);
        showToast('Enveloppe de Zakat créée avec succès');
      }
      handleCancelEdit();
    } catch (error) {
      console.error(error);
      showToast("Erreur d'enregistrement", 'error');
    }
  };

  const handleEditClick = async (template: ExpenseTemplate) => {
    startEditing(template);
  };

  const handleDeleteClick = async (template: ExpenseTemplate) => {
    requestDelete(template.id);
  };

  const startEditing = (template: ExpenseTemplate) => {
    setEditingTemplateId(template.id || null);
    setNewName(template.name);
    setNewAmount(template.amount.toString());
    setDueDay(template.dueDay ? template.dueDay.toString() : '');
    setIsAdding(true);

    setTimeout(() => {
      document
        .getElementById('zakat-form-container')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  const requestDelete = (id?: string) => {
    if (!id) return;
    confirm({
      title: 'Supprimer cette enveloppe ?',
      message:
        'Êtes-vous sûr de vouloir supprimer cette enveloppe de Zakat ? Les versements historiques associés ne seront pas supprimés.',
      confirmText: 'Oui, supprimer',
      cancelText: 'Annuler',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await expenseService.deleteTemplate(id);
          showToast('Enveloppe supprimée');
        } catch (error) {
          showToast('Erreur lors de la suppression', 'error');
        }
      },
    });
  };


  const handleCancelEdit = () => {
    setIsAdding(false);
    setEditingTemplateId(null);
    setNewName('');
    setNewAmount('');
    setDueDay('');
  };

  // Compute stats
  const totalAllocated = templates.reduce((sum, t) => sum + t.amount, 0);
  const totalDistributed = payouts.reduce((sum, p) => {
    // Only sum payouts linked to existing Zakat templates
    const isZakatPayout = templates.some((t) => t.id === p.templateId);
    return isZakatPayout ? sum + p.montant : sum;
  }, 0);
  const totalRemaining = Math.max(0, totalAllocated - totalDistributed);

  const getPayoutsForTemplate = (templateId: string) => {
    return payouts.filter((p) => p.templateId === templateId);
  };

  const formatCurrency = (amt: number) => {
    return (
      amt
        .toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
        .replace(/,/g, '.') + ' DH'
    );
  };

  // Return Loading Screen
  if (loading && templates.length === 0) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#f5f5f9] dark:bg-[#232333]">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="w-12 h-12 border-4 border-[#696cff] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-[#a1acb8] dark:text-[#707194] font-bold uppercase tracking-widest text-[10px]">
            Chargement des données Zakat...
          </p>
        </div>
      </div>
    );
  }

  // Lock screen
  

  // Setup screen (if hasn't defined a passcode)
  

  // Standard Page content if unlocked
  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-transparent custom-scrollbar text-left">
      <PageHeader
        title="Budgets & Enveloppes de la Zakat"
        icon={<Heart size={24} className="text-[#ffab00] dark:text-[#ffab00]" />}
        subtitle={
          <div className="flex items-center gap-2 mt-1">
            <span className="bg-transparent dark:bg-transparent dark: text-[#ff3e1d] dark:text-[#ff3e1d] text-[9px] font-bold uppercase tracking-widest flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5" /> Espace Caritatif
            </span>
            <span className="hidden sm:inline-block ml-1">
              Suivi discret et autonome de vos obligations religieuses et contributions solidaires à
              l'année.
            </span>
          </div>
        }
        actions={
          <div className="flex gap-2">
            

            <button
              onClick={() => setIsAdding(!isAdding)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[11px] uppercase tracking-wider transition-all shadow-sm shrink-0 ${
                isAdding
                  ? 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 hover:bg-slate-300'
                  : 'bg-[#ffab00] text-white hover:brightness-105'
              }`}
            >
              {isAdding ? 'Masquer le formulaire' : 'Créer une enveloppe'}
            </button>
          </div>
        }
      />

      <main className="flex-1 py-4 overflow-y-auto custom-scrollbar">
        <div className="w-full space-y-8">
          {/* Active Zakat Reminder Banner */}
          

          {/* Simulation / Auto-Clone Recommendation Banner */}
          {zakatReminderActive &&
            !isSimDismissed &&
            (() => {
              const simInfo = detectZakatSimulation(templates);
              if (!simInfo) return null;
              return (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#696cff] text-white rounded-lg p-6 shadow-xs relative overflow-hidden flex flex-col gap-5 text-left border border-[#696cff]/30"
                >
                  {/* Background design accents */}
                  <div className="absolute right-0 top-0 w-32 h-32 bg-white/5 rounded-bl-full pointer-events-none"></div>

                  <div className="flex items-start gap-4 w-full">
                    <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center border border-white/20 shrink-0">
                      <Sparkles className="w-6 h-6 text-amber-200 fill-amber-250/10" />
                    </div>
                    <div className="space-y-2 text-left flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="bg-white/15 text-white text-[10px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full flex items-center gap-1.5 border border-white/10 w-fit">
                          <Moon className="w-3 h-3 fill-white" /> Simulation Exercice Suivante (N+1)
                        </span>
                      </div>
                      <h3 className="font-bold text-white text-base tracking-tight pt-0.5">
                        Créer ou cloner votre enveloppe ?
                      </h3>
                      <p className="text-white/90 text-xs font-semibold leading-relaxed w-full">
                        Vous avez basculé sur le nouvel exercice ou l'enveloppe de Zakat pour
                        l'année n'est pas encore saisie. Clonez l'enveloppe précédente "
                        {simInfo.previousName}" avec une reconduction estimée de{' '}
                        <strong className="text-white underline">
                          {simInfo.previousAmount.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          DH
                        </strong>{' '}
                        ou saisissez-la manuellement.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2.5 justify-end items-center w-full border-t border-white/10 pt-4">
                    <button
                      onClick={() => {
                        setNewName(simInfo.recommendedName);
                        setNewAmount(simInfo.recommendedAmount.toString());
                        setIsAdding(true);
                        showToast(
                          "Enveloppe pré-remplie. Vous pouvez l'ajuster avant d'enregistrer.",
                          'info'
                        );
                        setTimeout(() => {
                          document
                            .getElementById('zakat-form-container')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 100);
                      }}
                      className="px-4 py-2.5 bg-white/20 hover:bg-white/30 text-white border border-white/10 rounded-xl font-bold text-xs uppercase tracking-wider transition-all active:scale-[0.98] flex items-center gap-1.5"
                    >
                      <Edit2 size={13} />
                      <span>Ajuster & Valider</span>
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          const envelopeData: any = {
                            name: simInfo.recommendedName,
                            type: ExpenseType.FIXED,
                            amount: simInfo.recommendedAmount,
                            category: 'Zakat',
                            isActive: true,
                          };
                          await expenseService.createTemplate(envelopeData);
                          showToast(
                            `L'enveloppe de Zakat "${simInfo.recommendedName}" a été reconduite avec succès !`,
                            'success'
                          );
                        } catch (err) {
                          showToast('Erreur lors de la reconduction', 'error');
                        }
                      }}
                      className="px-4 py-2.5 bg-white text-brand-700 hover:bg-slate-50 border border-transparent rounded-xl font-bold text-xs uppercase tracking-wider shadow-md transition-all active:scale-[0.98] flex items-center gap-1.5"
                    >
                      <Check size={13} />
                      <span>
                        Reconduire d'un clic (
                        {simInfo.previousAmount.toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        DH)
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        const currentYear = getIslamicDate().year;
                        localStorage.setItem(`zakat_sim_dismissed_year_${currentYear}`, 'true');
                        window.dispatchEvent(new Event('zakatSimulationChange'));
                        showToast('Le rappel de la simulation a été masqué.', 'success');
                      }}
                      className="bg-transparent dark:bg-transparent hover:bg-white/10 text-white hover: font-bold text-xs uppercase tracking-wider transition-all"
                    >
                      Masquer
                    </button>
                  </div>
                </motion.div>
              );
            })()}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 shadow-xs space-y-1.5 min-h-[90px] text-left">
              <p className="text-[10px] text-[#a1acb8] dark:text-[#707194] font-bold uppercase tracking-widest font-mono">
                Enveloppes Actives
              </p>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="text-xl font-bold text-[#435971] dark:text-[#dbdade] font-mono">
                  {templates.length}
                </span>
                <span className="text-[11px] text-[#697a8d] dark:text-[#a3a4cc] font-semibold ml-1 uppercase">
                  compte(s)
                </span>
              </div>
            </div>

            <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 shadow-xs space-y-1.5 min-h-[90px] text-left">
              <p className="text-[10px] text-[#696cff] dark:text-[#b1b4ff] font-bold uppercase tracking-widest font-mono">
                Total Alloué
              </p>
              <div className="text-xl font-bold text-[#435971] dark:text-[#dbdade] mt-1 font-mono">
                {formatCurrency(totalAllocated)}
              </div>
            </div>

            <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 shadow-xs space-y-1.5 min-h-[90px] text-left">
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 bg-[#ffab00] rounded-full"></div>
                <p className="text-[10px] text-[#ffab00] font-bold uppercase tracking-widest font-mono">
                  Total Distribué
                </p>
              </div>
              <div className="text-xl font-bold text-[#435971] dark:text-[#dbdade] mt-1 font-mono">
                {formatCurrency(totalDistributed)}
              </div>
            </div>

            <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 shadow-xs space-y-1.5 min-h-[90px] text-left">
              <p className="text-[10px] text-[#71dd37] font-bold uppercase tracking-widest font-mono">
                Solde Disponible
              </p>
              <div className="text-xl font-bold text-[#71dd37] mt-1 font-mono">
                {formatCurrency(totalRemaining)}
              </div>
            </div>
          </div>

          {/* Adding Form */}
          {isAdding && (
            <motion.div
              id="zakat-form-container"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl p-8 shadow-xs space-y-6 text-left"
            >
              <div className="flex items-center justify-between pb-4 border-b border-[#dbdade]/30 dark:border-[#434460]/20">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#435971] dark:text-[#dbdade]">
                  {editingTemplateId
                    ? `Modifier l'Enveloppe : ${newName}`
                    : 'Créer une nouvelle enveloppe de Zakat'}
                </h3>
                {editingTemplateId && (
                  <span className="bg-[#ffab00]/10 text-[#ffab00] px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest animate-pulse">
                    Mode Édition
                  </span>
                )}
              </div>

              <form onSubmit={handleSaveEnvelope} className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#a1acb8] dark:text-[#707194] ml-1">
                    Nom du compte / enveloppe
                  </label>
                  <input
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ex: Zakat Al-Maal 2026, Sadaqah..."
                    className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#ffab00] transition-all text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#a1acb8] dark:text-[#707194] ml-1">
                    Montant à distribuer / an (DH)
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={newAmount}
                    onChange={(e) => setNewAmount(e.target.value)}
                    placeholder="Ex: 50000"
                    className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#ffab00] transition-all text-sm font-mono"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-[#a1acb8] dark:text-[#707194] ml-1">
                    Jour de rappel (Optionnel)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    placeholder="Ex: 10 du mois"
                    className="w-full bg-[#f5f5f9] dark:bg-[#232333] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg px-4 py-2.5 font-medium text-[#435971] dark:text-[#dbdade] focus:outline-none focus:ring-1 focus:ring-[#ffab00] transition-all text-sm font-mono"
                  />
                </div>

                <div className="md:col-span-3 flex justify-end gap-3 pt-4 border-t border-[#dbdade]/30 dark:border-[#434460]/20">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-4 py-2 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-[#697a8d] dark:text-[#a3a4cc] font-semibold text-xs uppercase tracking-wider transition-colors"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-[#ffab00] hover:bg-[#e69a00] text-white rounded-lg font-semibold text-xs uppercase tracking-wider shadow-xs transition-colors flex items-center gap-2"
                  >
                    <Check size={16} />
                    {editingTemplateId ? 'Enregistrer les modifications' : "Créer l'enveloppe"}
                  </button>
                </div>
              </form>
            </motion.div>
          )}

          {/* Envelopes list rendering */}
          {templates.length === 0 ? (
            <div className="py-20 text-center bg-white border border-dashed border-slate-300 rounded-xl p-10">
              <Heart className="w-12 h-12 text-slate-200 mx-auto mb-5" />
              <h3 className="text-sm font-bold text-slate-800">
                Aucune enveloppe de Zakat trouvée
              </h3>
              <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto font-medium">
                Vous n'avez pas encore défini d'enveloppe caritative de Zakat pour l'année. Cliquez
                sur "Créer une enveloppe" pour commencer.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {templates.map((template) => {
                const templatePayouts = getPayoutsForTemplate(template.id || '');
                const distributedAmt = templatePayouts.reduce((sum, p) => sum + p.montant, 0);
                const remainingAmt = Math.max(0, template.amount - distributedAmt);
                const percentDistributed =
                  template.amount > 0 ? (distributedAmt / template.amount) * 100 : 0;

                return (
                  <motion.div
                    key={template.id}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl p-6 shadow-xs hover:shadow-md transition-all flex flex-col justify-between relative group overflow-hidden text-left"
                  >
                    <div className="space-y-6">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                          <div className="w-10 h-10 bg-[#ffab00]/10 text-[#ffab00] rounded-lg flex items-center justify-center shrink-0">
                            <Heart className="w-5 h-5 fill-current" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-[#435971] dark:text-[#dbdade] text-[15px] tracking-tight group-hover:text-[#696cff] transition-colors uppercase">
                              {template.name}
                            </h3>
                            {template.dueDay && (
                              <p className="text-[10px] text-[#a1acb8] dark:text-[#707194] font-bold uppercase tracking-widest mt-0.5 font-mono">
                                Rappel le {template.dueDay} du mois
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            onClick={() => handleEditClick(template)}
                            className="p-2 text-[#a1acb8] hover:text-[#696cff] hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteClick(template)}
                            className="p-2 text-[#a1acb8] hover:text-[#ff3e1d] dark:text-[#707194] dark:hover:text-[#ff3e1d] hover:bg-transparent transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Calculations Details */}
                      <div className="grid grid-cols-3 gap-4 bg-transparent px-1">
                        <div className="text-left">
                          <p className="text-[10px] text-[#a1acb8] dark:text-[#707194] font-bold uppercase tracking-widest font-mono">
                            Base Allouée
                          </p>
                          <p className="font-bold text-[#435971] dark:text-[#dbdade] text-[13px] mt-1 font-mono">
                            {formatCurrency(template.amount)}
                          </p>
                        </div>
                        <div className="text-left">
                          <p className="text-[10px] text-[#ffab00] font-bold uppercase tracking-widest font-mono">
                            Distribué
                          </p>
                          <p className="font-bold text-[#ffab00] text-[13px] mt-1 font-mono">
                            {formatCurrency(distributedAmt)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-[#71dd37] font-bold uppercase tracking-widest font-mono">
                            Reste
                          </p>
                          <p className="font-bold text-[#71dd37] text-[13px] mt-1 font-mono">
                            {formatCurrency(remainingAmt)}
                          </p>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="space-y-2.5">
                        <div className="flex justify-between items-center text-[10px] font-extrabold uppercase">
                          <span className="text-slate-400 tracking-widest">
                            État des distributions
                          </span>
                          <span className="text-slate-800 font-bold">
                            {percentDistributed.toFixed(0)}%
                          </span>
                        </div>
                        <div className="relative w-full h-2 bg-slate-100 rounded-full overflow-visible border border-slate-200/60">
                          <div
                            className="absolute left-0 top-0 h-full bg-transparent dark:bg-transparent dark:bg-transparent"
                            style={{ width: `${Math.min(100, Math.max(1, percentDistributed))}%` }}
                          >
                            <span className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-transparent dark:bg-transparent ring-2 ring-white shadow-sm pointer-events-none translate-x-1/2" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="pt-5 mt-5 border-t border-slate-100 flex justify-center">
                      <Link
                        to={`/zakat/${template.id}`}
                        className="w-full flex justify-between items-center px-5 py-3.5 bg-slate-800 text-white rounded-xl text-[11px] font-bold uppercase tracking-wider hover:bg-slate-900 transition-colors shadow-sm"
                      >
                        <span>Gérer les distributions</span>
                        <ChevronRight size={16} />
                      </Link>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

        </div>
      </main>

      <ZakatXlsxModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        ownerId={user?.uid || ''}
        existingTemplates={templates}
        showToast={showToast}
      />
    </div>
  );
}

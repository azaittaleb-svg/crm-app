import { useState, useEffect, FormEvent } from 'react';
import { expenseService, ExpenseTemplate, ExpenseType } from '../services/expenseService';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { collection, query, where, onSnapshot, doc, updateDoc, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  Plus,
  Trash2,
  CheckCircle2,
  Zap,
  Fuel,
  ArrowLeft,
  Settings,
  Circle,
  Edit2,
  Wallet,
  ChevronRight,
  Search,
  SlidersHorizontal,
  Layers,
  Calendar,
  X,
  Sparkles,
  DollarSign,
  FolderPlus,
} from 'lucide-react';

const PRESET_CATEGORIES = [
  'Salaires & Personnel',
  'Loyers & Locaux',
  'Télécom & Internet',
  'Abonnements & Logiciels',
  'Transport & Carburant',
  'Impôts & Taxes',
  'Services & Honoraires',
  'Fournitures & Équipement',
];

export default function ExpenseTemplatesPage() {
  const [templates, setTemplates] = useState<ExpenseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'ALL' | ExpenseType>('ALL');

  // Form state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<ExpenseType>(ExpenseType.FIXED);
  const [newAmount, setNewAmount] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [startMonth, setStartMonth] = useState('');
  const [endMonth, setEndMonth] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const { user } = useAuth();
  const { showToast, confirm } = useNotification();

  useEffect(() => {
    if (!user) return;

    setLoading(true);
    const q = query(collection(db, 'expense_templates'), where('ownerId', '==', user.uid));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((doc) => {
          const d = doc.data();
          return {
            id: doc.id,
            ownerId: d.ownerId,
            name: d.name || d.titre,
            type: d.type,
            amount: d.amount !== undefined ? Number(d.amount) : Number(d.montant),
            category: d.category || d.categorie,
            isActive: d.isActive !== false,
            dueDay: d.dueDay ? Number(d.dueDay) : undefined,
            startMonth: d.startMonth ? Number(d.startMonth) : undefined,
            endMonth: d.endMonth ? Number(d.endMonth) : undefined,
            createdAt: d.createdAt,
          } as ExpenseTemplate;
        });

        // Deduplicate templates on the fly to avoid twin entries
        const seen = new Map<string, string>();
        const uniqueTemplates: ExpenseTemplate[] = [];
        const duplicatesToDelete: { dupId: string; keptId: string; name: string }[] = [];

        data.forEach((tpl) => {
          const rawName = (tpl.name || '').trim();
          if (!rawName) return;
          const key = rawName
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();

          if (!seen.has(key)) {
            seen.set(key, tpl.id!);
            uniqueTemplates.push(tpl);
          } else {
            duplicatesToDelete.push({
              dupId: tpl.id!,
              keptId: seen.get(key)!,
              name: tpl.name,
            });
          }
        });

        setTemplates(uniqueTemplates);

        // Expand all categories by default on first load
        setExpandedCategories((prev) => {
          const next = { ...prev };
          uniqueTemplates.forEach((tpl) => {
            let cat = (tpl.category || '').trim() || 'Général';
            const lower = cat.toLowerCase();
            if (
              lower.includes('salaire') ||
              lower.includes('personnel') ||
              lower.includes('staff') ||
              lower.includes('employe')
            ) {
              cat = 'Salaires & Personnel';
            } else {
              cat = cat.charAt(0).toUpperCase() + cat.slice(1);
            }
            if (next[cat] === undefined) {
              next[cat] = true;
            }
          });
          return next;
        });

        setLoading(false);

        // Clean up duplicates in background database
        if (duplicatesToDelete.length > 0) {
          (async () => {
            for (const item of duplicatesToDelete) {
              try {
                await expenseService.deleteTemplate(item.dupId);
                const expensesQuery = query(
                  collection(db, 'expenses'),
                  where('templateId', '==', item.dupId),
                  where('ownerId', '==', user?.uid)
                );
                const expensesSnap = await getDocs(expensesQuery);
                for (const expDoc of expensesSnap.docs) {
                  await updateDoc(doc(db, 'expenses', expDoc.id), { templateId: item.keptId });
                }
              } catch (err) {
                console.error('Error auto-healing duplicate template:', err);
              }
            }
          })();
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'expense_templates');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const templateData: any = {
        name: newName.trim(),
        type: newType,
        amount: Number(newAmount),
        category: newCategory.trim() || 'Général',
        isActive: true,
      };

      if (dueDay) templateData.dueDay = Number(dueDay);
      if (startMonth) templateData.startMonth = Number(startMonth);
      if (endMonth) templateData.endMonth = Number(endMonth);

      if (editingTemplateId) {
        await expenseService.updateTemplate(editingTemplateId, templateData);
        showToast('Modèle mis à jour avec succès');
      } else {
        await expenseService.createTemplate(templateData);
        showToast('Modèle créé avec succès');
      }
      handleCancelEdit();
    } catch (error: any) {
      console.error('Error saving template:', error);
      showToast("Erreur lors de l'enregistrement", 'error');
    }
  };

  const handleEdit = (template: ExpenseTemplate) => {
    setEditingTemplateId(template.id || null);
    setNewName(template.name);
    setNewType(template.type);
    setNewAmount(template.amount.toString());
    setNewCategory(template.category || '');
    setDueDay(template.dueDay ? template.dueDay.toString() : '');
    setStartMonth(template.startMonth ? template.startMonth.toString() : '');
    setEndMonth(template.endMonth ? template.endMonth.toString() : '');
    setIsAdding(true);
  };

  const handleCancelEdit = () => {
    setIsAdding(false);
    setEditingTemplateId(null);
    setNewName('');
    setNewType(ExpenseType.FIXED);
    setNewAmount('');
    setNewCategory('');
    setDueDay('');
    setStartMonth('');
    setEndMonth('');
  };

  const handleDelete = (id?: string) => {
    if (!id) return;
    confirm({
      title: 'Supprimer le modèle ?',
      message:
        'Êtes-vous sûr de vouloir supprimer ce modèle de charge ? Les charges mensuelles déjà générées seront conservées.',
      onConfirm: async () => {
        try {
          await expenseService.deleteTemplate(id);
          showToast('Modèle supprimé avec succès');
        } catch (error) {
          showToast('Erreur lors de la suppression', 'error');
        }
      },
    });
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case ExpenseType.FIXED:
        return 'Fixe (Automatique)';
      case ExpenseType.VARIABLE:
        return 'Variable';
      case ExpenseType.CONSUMPTION:
        return 'Budget Consommation';
      default:
        return type;
    }
  };

  const getTypeGhostColor = (type: string) => {
    switch (type) {
      case ExpenseType.FIXED:
        return 'text-[#696cff] dark:text-[#b1b4ff]';
      case ExpenseType.VARIABLE:
        return 'text-[#ffab00] dark:text-[#ffab00]';
      case ExpenseType.CONSUMPTION:
        return 'text-sky-600 dark:text-sky-400';
      default:
        return 'text-slate-600 dark:text-slate-300';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case ExpenseType.FIXED:
        return <CheckCircle2 className="w-4 h-4 text-[#696cff] dark:text-[#b1b4ff]" />;
      case ExpenseType.VARIABLE:
        return <Zap className="w-4 h-4 text-[#ffab00]" />;
      case ExpenseType.CONSUMPTION:
        return <Fuel className="w-4 h-4 text-sky-500" />;
      default:
        return <Circle className="w-4 h-4 text-slate-400" />;
    }
  };

  const isZakatTemplate = (t: ExpenseTemplate) => {
    const nameLower = (t.name || '').toLowerCase();
    const catLower = (t.category || '').toLowerCase();
    return nameLower.includes('zakat') || catLower.includes('zakat');
  };

  // Filter non-zakat templates
  const validTemplates = templates.filter((t) => !isZakatTemplate(t));

  // Search & Type Filtering
  const filteredTemplates = validTemplates.filter((template) => {
    const name = (template.name || '').toLowerCase();
    const cat = (template.category || '').toLowerCase();
    const q = searchQuery.toLowerCase().trim();

    const matchesSearch = !q || name.includes(q) || cat.includes(q);
    const matchesType = selectedTypeFilter === 'ALL' || template.type === selectedTypeFilter;

    return matchesSearch && matchesType;
  });

  // Calculate KPIs
  const totalBudgetSum = filteredTemplates.reduce((sum, t) => sum + (t.amount || 0), 0);
  const fixedCount = filteredTemplates.filter((t) => t.type === ExpenseType.FIXED).length;
  const fixedSum = filteredTemplates
    .filter((t) => t.type === ExpenseType.FIXED)
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const variableCount = filteredTemplates.filter((t) => t.type === ExpenseType.VARIABLE).length;
  const variableSum = filteredTemplates
    .filter((t) => t.type === ExpenseType.VARIABLE)
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  // Grouping by Category
  const groupedTemplates = filteredTemplates.reduce(
    (acc, template) => {
      let categoryName = (template.category || '').trim() || 'Général';
      const lower = categoryName.toLowerCase();
      if (
        lower.includes('salaire') ||
        lower.includes('personnel') ||
        lower.includes('staff') ||
        lower.includes('employe')
      ) {
        categoryName = 'Salaires & Personnel';
      } else {
        categoryName = categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
      }

      if (!acc[categoryName]) {
        acc[categoryName] = [];
      }
      acc[categoryName].push(template);
      return acc;
    },
    {} as Record<string, ExpenseTemplate[]>
  );

  const toggleCategory = (categoryName: string) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [categoryName]: !prev[categoryName],
    }));
  };

  const toggleAllCategories = (expand: boolean) => {
    const next: Record<string, boolean> = {};
    Object.keys(groupedTemplates).forEach((cat) => {
      next[cat] = expand;
    });
    setExpandedCategories(next);
  };

  return (
    <div className="py-6 md:py-10 space-y-6 w-full" style={{ fontFamily: "'Public Sans', sans-serif" }}>
      {/* 1. KPI SUMMARY CARDS (Sneat Style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Models */}
        <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-slate-400 uppercase tracking-wider">
              Total Modèles
            </span>
            <div className="w-8 h-8 rounded-lg bg-[#696cff]/10 text-[#696cff] flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-extrabold text-slate-800 dark:text-slate-100">
              {filteredTemplates.length}
            </span>
            <span className="text-[11px] font-semibold text-slate-400">
              {Object.keys(groupedTemplates).length} catégories
            </span>
          </div>
        </div>

        {/* Budget Mensuel Prévu */}
        <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-slate-400 uppercase tracking-wider">
              Budget Mensuel Total
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-[#71dd37] flex items-center justify-center">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2">
            <span className="text-xl font-extrabold text-slate-800 dark:text-slate-100 font-mono">
              {totalBudgetSum.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}{' '}
              <span className="text-xs font-normal text-slate-400">DH</span>
            </span>
          </div>
        </div>

        {/* Charges Fixes (Auto) */}
        <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-slate-400 uppercase tracking-wider">
              Charges Fixes
            </span>
            <div className="w-8 h-8 rounded-lg bg-[#696cff]/10 text-[#696cff] flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-extrabold text-slate-800 dark:text-slate-100 font-mono">
              {fixedSum.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}{' '}
              <span className="text-xs font-normal text-slate-400">DH</span>
            </span>
            <span className="text-[11px] font-bold text-[#696cff]">
              {fixedCount} fixes
            </span>
          </div>
        </div>

        {/* Charges Variables & Budgets */}
        <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-bold text-slate-400 uppercase tracking-wider">
              Variables & Budgets
            </span>
            <div className="w-8 h-8 rounded-lg bg-[#ffab00]/10 text-[#ffab00] flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-extrabold text-slate-800 dark:text-slate-100 font-mono">
              {variableSum.toLocaleString('fr-FR', { minimumFractionDigits: 2 })}{' '}
              <span className="text-xs font-normal text-slate-400">DH</span>
            </span>
            <span className="text-[11px] font-bold text-[#ffab00]">
              {variableCount} variés
            </span>
          </div>
        </div>
      </div>

      {/* 2. MODAL / FORM DRAWER (Create or Edit Template) */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-2xs z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg shadow-xl max-w-xl w-full overflow-hidden"
            >
              <div className="p-5 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#696cff]/10 text-[#696cff] flex items-center justify-center">
                    <FolderPlus className="w-4 h-4" />
                  </div>
                  <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                    {editingTemplateId ? `Modifier le modèle : ${newName}` : 'Créer un nouveau modèle de charge'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSave} className="p-5 space-y-4 text-left">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Name */}
                  <div className="sm:col-span-2">
                    <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                      Intitulé du modèle <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="ex: Loyer Bureau, Abonnement Fibre, Salaire..."
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="w-full text-xs px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] text-slate-800 dark:text-slate-100"
                    />
                  </div>

                  {/* Type */}
                  <div>
                    <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                      Type de dépense
                    </label>
                    <select
                      value={newType}
                      onChange={(e) => setNewType(e.target.value as ExpenseType)}
                      className="w-full text-xs px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] text-slate-800 dark:text-slate-100"
                    >
                      <option value={ExpenseType.FIXED}>Fixe (Automatique)</option>
                      <option value={ExpenseType.VARIABLE}>Variable</option>
                      <option value={ExpenseType.CONSUMPTION}>Budget Consommation</option>
                    </select>
                  </div>

                  {/* Amount */}
                  <div>
                    <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                      Montant mensuel (DH) <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      placeholder="0.00"
                      value={newAmount}
                      onChange={(e) => setNewAmount(e.target.value)}
                      className="w-full text-xs px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] font-mono font-bold text-slate-800 dark:text-slate-100"
                    />
                  </div>

                  {/* Category */}
                  <div className="sm:col-span-2">
                    <label className="block text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                      Catégorie
                    </label>
                    <input
                      type="text"
                      placeholder="ex: Salaires & Personnel, Loyers & Locaux..."
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="w-full text-xs px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] text-slate-800 dark:text-slate-100"
                    />
                    {/* Category Presets */}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {PRESET_CATEGORIES.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setNewCategory(preset)}
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                            newCategory === preset
                              ? 'bg-[#696cff]/10 text-[#696cff] border-[#696cff]/30'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200/60 dark:border-slate-700/60 hover:text-slate-800'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Periodicity & Schedule */}
                  <div className="sm:col-span-2 pt-2 border-t border-slate-100 dark:border-slate-700/40 grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                        Jour du mois (1-31)
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        placeholder="ex: 5"
                        value={dueDay}
                        onChange={(e) => setDueDay(e.target.value)}
                        className="w-full text-xs px-2.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] font-mono text-slate-800 dark:text-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                        Mois Début
                      </label>
                      <select
                        value={startMonth}
                        onChange={(e) => setStartMonth(e.target.value)}
                        className="w-full text-xs px-2 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] text-slate-800 dark:text-slate-100"
                      >
                        <option value="">Tous les mois</option>
                        {[...Array(12)].map((_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {new Date(2000, i).toLocaleString('fr-FR', { month: 'short' })}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-1">
                        Mois Fin
                      </label>
                      <select
                        value={endMonth}
                        onChange={(e) => setEndMonth(e.target.value)}
                        className="w-full text-xs px-2 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] text-slate-800 dark:text-slate-100"
                      >
                        <option value="">Tous les mois</option>
                        {[...Array(12)].map((_, i) => (
                          <option key={i + 1} value={i + 1}>
                            {new Date(2000, i).toLocaleString('fr-FR', { month: 'short' })}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="pt-3 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-700/50">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 dark:text-slate-300 rounded-lg transition-colors cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#696cff] hover:bg-[#5f61e6] rounded-lg shadow-2xs transition-colors cursor-pointer"
                  >
                    {editingTemplateId ? 'Mettre à jour' : 'Enregistrer le modèle'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 3. UNIFIED TABLE CONTAINER (HEADER + LIST ATTACHED TOGETHER WITHOUT SPACE) */}
      <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-lg overflow-hidden shadow-2xs">
        {/* Table Header Toolbar */}
        <div className="p-3 bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-100 dark:border-slate-700/50 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search Input & Action Button */}
          <div className="flex items-center gap-2 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Rechercher par nom de charge ou catégorie..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-9 pr-8 py-2 bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#696cff] text-slate-800 dark:text-slate-100"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Nouveau Modèle Button placed directly next to search */}
            <button
              onClick={isAdding ? handleCancelEdit : () => setIsAdding(true)}
              className="px-3.5 py-2 bg-[#696cff] hover:bg-[#5f61e6] text-white text-xs font-semibold rounded-lg shadow-2xs transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              {isAdding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{isAdding ? 'Fermer' : 'Nouveau Modèle'}</span>
            </button>
          </div>

          {/* Type Filter Buttons */}
          <div className="flex items-center justify-between lg:justify-end gap-3 flex-wrap">
            <div className="flex items-center gap-1 overflow-x-auto">
              <button
                onClick={() => setSelectedTypeFilter('ALL')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  selectedTypeFilter === 'ALL'
                    ? 'bg-[#696cff] text-white border-[#696cff]'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-100'
                }`}
              >
                Tous ({validTemplates.length})
              </button>
              <button
                onClick={() => setSelectedTypeFilter(ExpenseType.FIXED)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  selectedTypeFilter === ExpenseType.FIXED
                    ? 'bg-[#696cff] text-white border-[#696cff]'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-100'
                }`}
              >
                Fixes (Auto)
              </button>
              <button
                onClick={() => setSelectedTypeFilter(ExpenseType.VARIABLE)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  selectedTypeFilter === ExpenseType.VARIABLE
                    ? 'bg-[#ffab00] text-white border-[#ffab00]'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-100'
                }`}
              >
                Variables
              </button>
              <button
                onClick={() => setSelectedTypeFilter(ExpenseType.CONSUMPTION)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                  selectedTypeFilter === ExpenseType.CONSUMPTION
                    ? 'bg-sky-600 text-white border-sky-600'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-100'
                }`}
              >
                Budgets
              </button>
            </div>

            {/* Accordion Expand/Collapse All */}
            <div className="flex items-center gap-1.5 shrink-0 text-xs">
              <button
                onClick={() => toggleAllCategories(true)}
                className="text-[11px] font-semibold text-slate-500 hover:text-[#696cff] transition-colors cursor-pointer"
              >
                Tout développer
              </button>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <button
                onClick={() => toggleAllCategories(false)}
                className="text-[11px] font-semibold text-slate-500 hover:text-[#696cff] transition-colors cursor-pointer"
              >
                Tout réduire
              </button>
            </div>
          </div>
        </div>

        {/* Table Content List (Attached directly inside container) */}
        <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
          {loading ? (
            <div className="p-12 text-center">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-[#696cff] rounded-full animate-spin mx-auto mb-3"></div>
              <p className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                Chargement des modèles...
              </p>
            </div>
          ) : Object.keys(groupedTemplates).length === 0 ? (
            <div className="p-12 text-center">
              <Circle className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-slate-700 dark:text-slate-200 font-bold text-sm">
                Aucun modèle trouvé
              </p>
              <p className="text-slate-400 text-xs mt-1">
                {searchQuery
                  ? 'Ajustez votre recherche ou réinitialisez les filtres'
                  : 'Cliquez sur "+ Nouveau Modèle" pour ajouter une dépense récurrente'}
              </p>
            </div>
          ) : (
            (Object.entries(groupedTemplates) as [string, ExpenseTemplate[]][]).map(
              ([categoryName, categoryTemplates]) => {
                const isExpanded = !!expandedCategories[categoryName];
                const categoryTotal = categoryTemplates.reduce((sum, t) => sum + (t.amount || 0), 0);
                const isStaffCategory =
                  categoryName.toLowerCase().includes('salaire') ||
                  categoryName.toLowerCase().includes('personnel');

                return (
                  <div key={categoryName} className="bg-white dark:bg-[#2b2c40]">
                    {/* Category Row Header */}
                    <button
                      type="button"
                      onClick={() => toggleCategory(categoryName)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors border-b border-slate-100 dark:border-slate-700/50 cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300 flex items-center justify-center shrink-0">
                          <ChevronRight
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${
                              isExpanded ? 'rotate-90 text-[#696cff]' : ''
                            }`}
                          />
                        </div>
                        <div className="flex items-center gap-2.5">
                          <h3 className="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">
                            {categoryName}
                          </h3>
                          <span className="text-[10px] font-bold text-[#696cff] bg-[#696cff]/10 px-2 py-0.5 rounded-md">
                            {categoryTemplates.length} {categoryTemplates.length === 1 ? 'modèle' : 'modèles'}
                          </span>
                        </div>
                      </div>

                      <div className="text-right flex items-center gap-3">
                        <div>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">
                            {categoryTotal.toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            <span className="text-[10px] font-normal text-slate-400">DH</span>
                          </span>
                          <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">
                            Budget mensuel
                          </p>
                        </div>
                      </div>
                    </button>

                    {/* Category Content Rows */}
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden bg-slate-50/30 dark:bg-slate-900/10"
                        >
                          <div className="divide-y divide-slate-100 dark:divide-slate-800/60 pl-2 sm:pl-4">
                            {categoryTemplates.map((template, idx) => {
                              const isStaff =
                                isStaffCategory ||
                                (template.name || '').toLowerCase().includes('salaire');

                              return (
                                <div
                                  key={template.id + "_" + idx}
                                  className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-100/50 dark:hover:bg-slate-800/40 transition-colors"
                                >
                                  {/* Left Info */}
                                  <div className="flex items-start gap-3">
                                    <div className="w-7 h-7 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
                                      {getTypeIcon(template.type)}
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">
                                          {template.name}
                                        </h4>

                                        {/* Ghost Badge for type */}
                                        <span
                                          className={`text-[10px] font-bold uppercase tracking-wider ${getTypeGhostColor(
                                            template.type
                                          )}`}
                                        >
                                          • {getTypeLabel(template.type)}
                                        </span>
                                      </div>

                                      <div className="flex items-center gap-3 text-[11px] text-slate-400 mt-0.5">
                                        {template.dueDay && (
                                          <span className="flex items-center gap-1">
                                            <Calendar className="w-3 h-3 text-slate-400" />
                                            Le {template.dueDay} du mois
                                          </span>
                                        )}
                                        {(template.startMonth || template.endMonth) && (
                                          <span>
                                            Période:{' '}
                                            {template.startMonth
                                              ? new Date(2000, template.startMonth - 1).toLocaleString(
                                                  'fr-FR',
                                                  { month: 'short' }
                                                )
                                              : 'Jan'}{' '}
                                            à{' '}
                                            {template.endMonth
                                              ? new Date(2000, template.endMonth - 1).toLocaleString(
                                                  'fr-FR',
                                                  { month: 'short' }
                                                )
                                              : 'Déc'}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Right Amount & Actions */}
                                  <div className="flex items-center justify-between sm:justify-end gap-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800/60">
                                    <div className="text-left sm:text-right">
                                      <span className="font-mono font-bold text-slate-800 dark:text-slate-100 text-xs sm:text-sm">
                                        {template.amount.toLocaleString('fr-FR', {
                                          minimumFractionDigits: 2,
                                          maximumFractionDigits: 2,
                                        })}{' '}
                                        <span className="text-[10px] font-normal text-slate-400">DH</span>
                                      </span>
                                      <p className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold">
                                        Montant prévu
                                      </p>
                                    </div>

                                    <div className="flex items-center gap-1">
                                      {isStaff && (
                                        <Link
                                          to={`/staff-advance/${template.id}`}
                                          className="text-[#71dd37] dark:text-[#71dd37] hover:underline font-semibold text-xs flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-950/20 transition-colors"
                                          title="Gérer les avances sur salaire"
                                        >
                                          <Wallet className="w-3.5 h-3.5" />
                                          <span>Avances</span>
                                        </Link>
                                      )}

                                      <button
                                        type="button"
                                        onClick={() => handleEdit(template)}
                                        className="p-1.5 text-slate-400 hover:text-[#696cff] hover:bg-white dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                        title="Modifier"
                                      >
                                        <Edit2 className="w-3.5 h-3.5" />
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => handleDelete(template.id)}
                                        className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg transition-colors cursor-pointer"
                                        title="Supprimer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              }
            )
          )}
        </div>
      </div>
    </div>
  );
}


import React, { useState, useEffect, FormEvent, useMemo } from 'react';
import {
  MonthlyExpense,
  ExpenseStatus,
  ExpenseType,
  ExpenseTemplate,
} from '../services/expenseService';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { motion, AnimatePresence } from 'motion/react';
import {
  Wallet,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings as SettingsIcon,
  Calendar,
  Zap,
  Fuel,
  Edit2,
  Trash2,
  Pencil,
  MoreHorizontal,
  User,
  Eye,
  LayoutTemplate,
  BarChart3,
  RefreshCw,
  Search,
  Filter,
  CheckCircle,
  TrendingUp,
  SlidersHorizontal,
  Clock,
  Sparkles,
  DollarSign,
  Undo2,
  Info,
  Banknote,
  PlusCircle,
  Trash,
  ChevronDown,
  X,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { expenseService } from '../services/expenseService';
import { ExpensesXlsxModal } from '../components/ExpensesXlsxModal';
import * as XLSX from 'xlsx';

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<MonthlyExpense[]>([]);
  const [templates, setTemplates] = useState<ExpenseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonthYear, setCurrentMonthYear] = useState(
    () =>
      localStorage.getItem('exp_filter_currentMonthYear') || new Date().toISOString().slice(0, 7)
  );
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');

  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', amount: '' });

  const [isSubmittingInstant, setIsSubmittingInstant] = useState(false);
  const [isInstantDrawerOpen, setIsInstantDrawerOpen] = useState(false);

  // Filters state
  const [searchQuery, setSearchQuery] = useState(
    () => localStorage.getItem('exp_filter_searchQuery') || ''
  );
  const [selectedType, setSelectedType] = useState<ExpenseType | 'all' | 'recurring' | 'instant'>(
    () => {
      const val = localStorage.getItem('exp_filter_selectedType');
      return (val as any) || 'all';
    }
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const val = localStorage.getItem('exp_filter_pageSize');
    return val ? Number(val) : 10;
  });
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<string[]>([]);

  // Persist filter states to localStorage
  useEffect(() => {
    localStorage.setItem('exp_filter_currentMonthYear', currentMonthYear);
  }, [currentMonthYear]);

  useEffect(() => {
    localStorage.setItem('exp_filter_searchQuery', searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    localStorage.setItem('exp_filter_selectedType', selectedType);
  }, [selectedType]);

  useEffect(() => {
    localStorage.setItem('exp_filter_pageSize', String(pageSize));
  }, [pageSize]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedType]);

  const { user } = useAuth();
  const { showToast, confirm } = useNotification();

  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const [recentInstantNames, setRecentInstantNames] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('recent_instant_expenses');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!user) return;
    expenseService
      .getTemplates()
      .then(setTemplates)
      .catch((err) => console.error('Error loading templates:', err));
  }, [user]);

  // Self-healing effect to restore the accidentally deleted Citroen diesel expense on the 2nd of June
  useEffect(() => {
    if (!user || loading || expenses.length === 0) return;

    const restoreDeletedExpense = async () => {
      try {
        const restoredFlag = localStorage.getItem('restored_citroen_02_june_v3');
        if (restoredFlag === 'true') return;

        // See if there's any active citation or existing fuel/diesel/citroen expense on June 2nd
        const citroenExists = expenses.some((e) => {
          const nameLower = (e.name || '').toLowerCase();
          const matchesName =
            nameLower.includes('citroen') ||
            nameLower.includes('diesel') ||
            nameLower.includes('diseal');
          const isDate02 = e.date === '2026-06-02' || (e.date && e.date.endsWith('-02'));
          return matchesName && isDate02;
        });

        if (citroenExists) {
          localStorage.setItem('restored_citroen_02_june_v3', 'true');
          return;
        }

        // Find standard recurring amount from templates
        let amount = 450; // default fallback
        const matchingTemplate = templates.find((t) => {
          const nameLower = (t.name || '').toLowerCase();
          return (
            nameLower.includes('citroen') ||
            nameLower.includes('diesel') ||
            nameLower.includes('diseal')
          );
        });

        if (matchingTemplate) {
          amount = matchingTemplate.amount;
        } else {
          // Check other meses in database if there's any template match or previous expense
          const history = await expenseService.getExpenseHistoryByName('Diesel Citroën 2023');
          if (history && history.length > 0) {
            amount = history[0].amount;
          }
        }

        // Create the missing expense on June 2nd
        await expenseService.addInstantExpense('Diesel Citroën 2023', amount, '2026-06-02');
        localStorage.setItem('restored_citroen_02_june_v3', 'true');
        showToast(
          `La dépense 'Diesel Citroën 2023' du 02/06 (${amount} DH) a été restaurée avec succès !`,
          'success'
        );
      } catch (err) {
        console.error('Error restoring deleted Citroen expense:', err);
      }
    };

    restoreDeletedExpense();
  }, [user, loading, expenses, templates]);

  useEffect(() => {
    if (!user) return;

    const initSync = async () => {
      try {
        // Sync the currently active selected month first so it is instant
        await expenseService.syncMonthlyExpenses(currentMonthYear);

        // Then pre-sync previous months (May, June) and current year's range in the background for complete data
        const today = new Date();
        const monthsToSync: string[] = [];
        for (let i = -4; i <= 1; i++) {
          const d = new Date(today.getFullYear(), today.getMonth() + i, 1);
          const mStr = d.toISOString().slice(0, 7);
          if (mStr !== currentMonthYear) {
            monthsToSync.push(mStr);
          }
        }
        await Promise.all(
          monthsToSync.map((m) => expenseService.syncMonthlyExpenses(m))
        );
      } catch (err) {
        console.error('Sync error:', err);
      }
    };
    initSync();

    const handleForceSync = () => {
      initSync();
    };
    window.addEventListener('trigger-expense-sync', handleForceSync);

    setLoading(true);
    const q = query(
      collection(db, 'expenses'),
      where('ownerId', '==', user.uid),
      where('monthYear', '==', currentMonthYear)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let data = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as MonthlyExpense);

        // Filter out any Zakat and soft-deleted expenses
        data = data.filter(
          (e) => !(e.name || '').toLowerCase().includes('zakat') && !(e as any).deleted
        );

        // Clean, simple visual grouping method without complex auto-merging:
        const nameGroups = new Map<string, MonthlyExpense[]>();

        for (const exp of data) {
          const nameKey =
            (exp.name || '')
              .trim()
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase() ||
            exp.templateId ||
            exp.id ||
            '';
          if (!nameGroups.has(nameKey)) {
            nameGroups.set(nameKey, []);
          }
          nameGroups.get(nameKey)!.push(exp);
        }

        const finalExpenses: MonthlyExpense[] = [];

        for (const list of nameGroups.values()) {
          const paid = list.filter((e) => e.status === ExpenseStatus.PAID);
          const pending = list.filter((e) => e.status !== ExpenseStatus.PAID);

          // Show all paid instances (actual actions)
          paid.forEach((p) => finalExpenses.push(p));

          // If there are no paid instances, show exactly one pending instance visually
          if (paid.length === 0 && pending.length > 0) {
            pending.sort((a, b) => {
              const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
              const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
              return tA - tB;
            });
            finalExpenses.push(pending[0]);
          }
        }

        data = finalExpenses;

        // Sort in memory to avoid needing composite indexes
        data.sort((a, b) => {
          const dateA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
          const dateB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
          return dateB - dateA;
        });
        setExpenses(data);
        setLoading(false);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'expenses');
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
      window.removeEventListener('trigger-expense-sync', handleForceSync);
    };
  }, [currentMonthYear, user]);

  // All recurring and instant expenses for this month are always visible
  // However, recurring expenses (PENDING) should only appear 2 days before their due date.
  const visibleExpenses = useMemo(() => {
    const today = new Date();
    const todayAtMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    return expenses.filter(expense => {
      // Always show paid expenses
      if (expense.status === ExpenseStatus.PAID) return true;
      
      // Hide pending recurring expenses if today is more than 2 days before the due date
      const isRecurring = expense.templateId && expense.templateId !== 'instant';
      if (isRecurring && expense.dueDay && expense.monthYear) {
        const monthYearStr = typeof expense.monthYear === 'string' ? expense.monthYear : String(expense.monthYear);
        if (monthYearStr.includes('-')) {
          const [year, month] = monthYearStr.split('-').map(Number);
          const visibilityDate = new Date(year, month - 1, expense.dueDay - 2);
          
          if (todayAtMidnight < visibilityDate) {
            return false;
          }
        }
      }
      return true;
    });
  }, [expenses]);

  // Aggregate stats calculations
  const totalValidated = useMemo(() => {
    return visibleExpenses
      .filter((e) => e.status === ExpenseStatus.PAID)
      .reduce((acc, curr) => acc + curr.amount, 0);
  }, [visibleExpenses]);

  const totalPending = useMemo(() => {
    return visibleExpenses
      .filter((e) => e.status === ExpenseStatus.PENDING)
      .reduce((acc, curr) => acc + curr.amount, 0);
  }, [visibleExpenses]);

  const totalBudget = useMemo(() => totalValidated + totalPending, [totalValidated, totalPending]);

  const pendingCount = useMemo(() => {
    return visibleExpenses.filter((e) => e.status === ExpenseStatus.PENDING).length;
  }, [visibleExpenses]);

  const totalInstantExpenses = useMemo(() => {
    return visibleExpenses
      .filter((e) => e.templateId === 'instant')
      .reduce((acc, curr) => acc + curr.amount, 0);
  }, [visibleExpenses]);

  const instantCount = useMemo(() => {
    return visibleExpenses.filter((e) => e.templateId === 'instant').length;
  }, [visibleExpenses]);

  const handleValidate = async (id: string, amount: number) => {
    setValidatingId(null);
    await expenseService.validateExpense(id, amount);
    showToast('Charge validée !');
  };

  const handleDelete = async (expense: MonthlyExpense) => {
    confirm({
      title: 'Supprimer la charge',
      message: `Êtes-vous sûr de vouloir supprimer cette charge "${expense.name}" ?`,
      confirmText: 'Supprimer',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await expenseService.deleteExpense(expense.id!);

          if (expense.templateId === 'instant') {
            const newRecents = recentInstantNames.filter((n) => n !== expense.name);
            setRecentInstantNames(newRecents);
            localStorage.setItem('recent_instant_expenses', JSON.stringify(newRecents));
          }

          showToast('Charge supprimée !');
        } catch {
          showToast('Erreur lors de la suppression', 'error');
        }
      },
    });
  };

  const handleUpdate = async (id: string) => {
    try {
      if (!editForm.name || !editForm.amount) return;
      await expenseService.updateExpense(id, {
        name: editForm.name,
        amount: Number(editForm.amount),
      });
      setEditingExpenseId(null);
      showToast('Charge modifiée !');
    } catch {
      showToast('Erreur lors de la modification', 'error');
    }
  };

  const getTypeIcon = (type: ExpenseType) => {
    switch (type) {
      case ExpenseType.FIXED:
        return <CheckCircle2 className="text-[#696cff] dark:text-[#b1b4ff]" size={16} />;
      case ExpenseType.VARIABLE:
        return <Zap className="text-[#ffab00] dark:text-[#ffab00]" size={16} />;
      case ExpenseType.CONSUMPTION:
        return <Fuel className="text-[#71dd37] dark:text-[#71dd37]" size={16} />;
    }
  };

  const getTypeLabel = (type: ExpenseType) => {
    switch (type) {
      case ExpenseType.FIXED:
        return 'Fixe';
      case ExpenseType.VARIABLE:
        return 'Variable';
      case ExpenseType.CONSUMPTION:
        return 'Consommation';
    }
  };

  const groupedInstantExpenses = useMemo(() => {
    const instantMap = new Map<string, number>();
    expenses
      .filter((e) => e.templateId === 'instant')
      .forEach((e) => {
        const n = e.name.trim();
        instantMap.set(n, (instantMap.get(n) || 0) + e.amount);
      });
    return Array.from(instantMap.entries()).sort((a, b) => b[1] - a[1]);
  }, [expenses]);

  const handleAddInstantExpense = async (e: FormEvent) => {
    e.preventDefault();
    if (isSubmittingInstant) return;

    const form = e.target as HTMLFormElement;
    const nameInput = form.elements.namedItem('name') as HTMLInputElement;
    const amountInput = form.elements.namedItem('amount') as HTMLInputElement;
    const dateInput = form.elements.namedItem('date') as HTMLInputElement;

    const name = nameInput.value.trim();
    if (!name || !amountInput.value) return;

    setIsSubmittingInstant(true);
    try {
      await expenseService.addInstantExpense(name, Number(amountInput.value), dateInput?.value);

      const newRecents = Array.from(new Set([name, ...recentInstantNames])).slice(0, 30);
      setRecentInstantNames(newRecents);
      localStorage.setItem('recent_instant_expenses', JSON.stringify(newRecents));

      form.reset();
      setIsInstantDrawerOpen(false);
      showToast('Dépense enregistrée');
    } catch (error) {
      showToast("Erreur lors de l'enregistrement", 'error');
    } finally {
      setIsSubmittingInstant(false);
    }
  };

  const handleBulkDelete = async () => {
    confirm({
      title: 'Supprimer les dépenses',
      message: `Êtes-vous sûr de vouloir supprimer les ${selectedExpenseIds.length} dépenses sélectionnées ?`,
      onConfirm: async () => {
        try {
          const expensesToDelete = visibleExpenses.filter((e) => selectedExpenseIds.includes(e.id!));
          await Promise.all(expensesToDelete.map((e) => expenseService.deleteExpense(e.id!)));
          showToast(`${selectedExpenseIds.length} dépense(s) supprimée(s) avec succès.`, 'success');
          setSelectedExpenseIds([]);
        } catch (err) {
          showToast('Erreur lors de la suppression groupée.', 'error');
        }
      }
    });
  };

  const handleBulkPay = async () => {
    confirm({
      title: 'Régler les dépenses',
      message: `Confirmer le règlement de ${selectedExpenseIds.length} dépenses ?`,
      onConfirm: async () => {
        try {
          const pendingExpenses = visibleExpenses.filter(
            (e) => selectedExpenseIds.includes(e.id!) && e.status !== ExpenseStatus.PAID
          );
          await Promise.all(
            pendingExpenses.map((expense) =>
              expenseService.updateExpenseStatus(expense.id!, ExpenseStatus.PAID)
            )
          );
          showToast(`${pendingExpenses.length} dépense(s) marquée(s) payée(s).`, 'success');
          setSelectedExpenseIds([]);
        } catch (err) {
          showToast('Erreur lors du paiement groupé.', 'error');
        }
      }
    });
  };

  // Filtered expenses based on search and selectedType
  const filteredExpenses = useMemo(() => {
    const today = new Date().getDate();

    const filtered = visibleExpenses.filter((e) => {
      const matchesSearch = e.name.toLowerCase().includes(searchQuery.toLowerCase().trim());

      const isInstant = e.templateId === 'instant';
      let matchesType = true;
      if (selectedType === 'recurring') {
        matchesType = !isInstant;
      } else if (selectedType === 'instant') {
        matchesType = isInstant;
      } else if (selectedType !== 'all') {
        matchesType = e.type === selectedType;
      }

      return matchesSearch && matchesType;
    });

    // Sort: Recurring expenses due within 2 days come first, then others
    return filtered.sort((a, b) => {
      const getUrgency = (e: any) => {
        const template = templates.find((t) => t.id === e.templateId);
        const dueDay = e.dueDay !== undefined && e.dueDay !== null ? e.dueDay : template?.dueDay;
        if (!dueDay || e.status === ExpenseStatus.PAID) return 999;
        return Number(dueDay) - today;
      };

      const uA = getUrgency(a);
      const uB = getUrgency(b);

      // If one is urgent (within 2 days) and the other is not
      if (uA <= 2 && uB > 2) return -1;
      if (uA > 2 && uB <= 2) return 1;

      // If both are urgent or both are not, sort by urgency value
      if (uA !== uB) return uA - uB;

      // Fallback: Default to createdAt sort
      const dateA = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
      const dateB = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
      return dateB - dateA;
    });
  }, [visibleExpenses, searchQuery, selectedType]);

  const handleExportToExcel = async () => {
    try {
      if (!user) return;
      showToast("Préparation de l'exportation (Génération historique)...", 'info');

      // 1. Force synchronous pre-sync of all 2026 months up to next month to guarantee complete historical data
      const currentYear = new Date().getFullYear();
      const endMonth = new Date().getMonth() + 1; // current month (1-indexed)
      const monthsToSync: string[] = [];
      for (let m = 1; m <= endMonth + 1; m++) {
        const mStr = `${currentYear}-${String(m).padStart(2, '0')}`;
        monthsToSync.push(mStr);
      }
      await Promise.all(
        monthsToSync.map((m) => expenseService.syncMonthlyExpenses(m, true))
      );

      // 2. Fetch latest templates from DB (never rely on potentially empty or stale state)
      const latestTemplates = await expenseService.getTemplates();

      // Helper to format Firestore dates safely
      const formatValDate = (val: any) => {
        if (!val) return '';
        if (typeof val.toDate === 'function') {
          return format(val.toDate(), 'yyyy-MM-dd HH:mm', { locale: fr });
        }
        if (val instanceof Date) {
          return format(val, 'yyyy-MM-dd HH:mm', { locale: fr });
        }
        if (val.seconds) {
          return format(new Date(val.seconds * 1000), 'yyyy-MM-dd HH:mm', { locale: fr });
        }
        if (typeof val === 'string') {
          return val.slice(0, 10);
        }
        return '';
      };

      // Helper to determine the due date / date of operation for an expense
      const getDueDate = (e: any) => {
        if (e.date) return e.date;
        if (e.dueDay && e.monthYear) {
          return `${e.monthYear}-${String(e.dueDay).padStart(2, '0')}`;
        }
        if (e.createdAt) {
          return formatValDate(e.createdAt).slice(0, 10);
        }
        return '';
      };

      // Helper to determine the payment/settlement date of an expense
      const getPaymentDate = (e: any) => {
        if (String(e.status).toUpperCase() !== 'PAID') return '';
        if (e.validatedAt) return formatValDate(e.validatedAt);
        if (e.templateId === 'instant') {
          return e.date || formatValDate(e.createdAt);
        }
        return formatValDate(e.createdAt);
      };

      // 2. Fetch ALL raw expenses from Firestore for historical sheet
      const allExpensesQuery = query(
        collection(db, 'expenses'),
        where('ownerId', '==', user.uid)
      );
      const allExpensesSnap = await getDocs(allExpensesQuery);
      let rawExpenses = allExpensesSnap.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as any
      );
      
      // Filter out deleted and Zakat
      rawExpenses = rawExpenses.filter(
        (e) => !e.deleted && !(e.name || '').toLowerCase().includes('zakat')
      );

      // Deduplicate raw expenses using the exact same layout logic as the UI list
      // Group expenses by month and name, hiding the pending placeholder if a paid record exists
      const deduplicateExpenses = (expensesList: any[]) => {
        const monthlyGroups = new Map<string, any[]>();
        for (const exp of expensesList) {
          const my = exp.monthYear || '';
          if (!monthlyGroups.has(my)) {
            monthlyGroups.set(my, []);
          }
          monthlyGroups.get(my)!.push(exp);
        }

        const finalResult: any[] = [];

        for (const [my, data] of monthlyGroups.entries()) {
          const nameGroups = new Map<string, any[]>();

          for (const exp of data) {
            const nameKey =
              (exp.name || '')
                .trim()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toLowerCase() ||
              exp.templateId ||
              exp.id ||
              '';
            if (!nameGroups.has(nameKey)) {
              nameGroups.set(nameKey, []);
            }
            nameGroups.get(nameKey)!.push(exp);
          }

          for (const list of nameGroups.values()) {
            const paid = list.filter((e) => String(e.status).toUpperCase() === 'PAID');
            const pending = list.filter((e) => String(e.status).toUpperCase() !== 'PAID');

            // Show all paid instances (actual actions)
            paid.forEach((p) => finalResult.push(p));

            // If there are no paid instances, show exactly one pending instance visually
            if (paid.length === 0 && pending.length > 0) {
              pending.sort((a, b) => {
                const tA = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : 0);
                const tB = b.createdAt?.toMillis ? b.createdAt.toMillis() : (b.createdAt?.seconds ? b.createdAt.seconds * 1000 : 0);
                return tA - tB;
              });
              finalResult.push(pending[0]);
            }
          }
        }

        return finalResult;
      };

      const allExpenses = deduplicateExpenses(rawExpenses);

      // Sort: MonthYear desc, then date/createdAt desc
      allExpenses.sort((a, b) => {
        const monthCompare = String(b.monthYear || '').localeCompare(String(a.monthYear || ''));
        if (monthCompare !== 0) return monthCompare;
        
        const dateA = getDueDate(a);
        const dateB = getDueDate(b);
        return String(dateB || '').localeCompare(String(dateA || ''));
      });

      const currentMonthExpenses = allExpenses.filter(e => e.monthYear === currentMonthYear);

      // 3. Fetch ALL worker advances (staff_advances)
      const advancesQuery = query(
        collection(db, 'staff_advances'),
        where('ownerId', '==', user.uid)
      );
      const advancesSnap = await getDocs(advancesQuery);
      const allAdvances = advancesSnap.docs.map(
        (doc) => ({ id: doc.id, ...doc.data() }) as any
      );

      // Sort advances: date desc
      allAdvances.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

      // Create a map for worker names from templates
      const workerTemplateMap = new Map<string, string>();
      const templateCategoryMap = new Map<string, string>();
      latestTemplates.forEach((t) => {
        workerTemplateMap.set(t.id!, t.name || (t as any).titre || 'Inconnu');
        templateCategoryMap.set(t.id!, t.category || (t as any).categorie || 'Général');
      });

      // Prepare sheet 1: Current Month Expenses (using the UI's filteredExpenses to match EXACTLY what they see)
      const sheet1Data = currentMonthExpenses.map((e) => {
        const isPaid = e.status === ExpenseStatus.PAID;
        return {
          'Désignation / Charge': e.name,
          'Montant (DH)': e.amount,
          'Date d\'Échéance / Création': getDueDate(e),
          'Période (Mois)': e.monthYear,
          'Statut': isPaid ? 'Payé' : 'À régler / En attente',
          'Date de Règlement': isPaid ? getPaymentDate(e) : '',
          'Catégorie / Nature': e.category || templateCategoryMap.get(e.templateId) || 'Général',
          'Origine': e.templateId === 'instant' ? 'Saisie Directe' : 'Modèle Récurrent',
        };
      });

      // Prepare sheet 2: All Historical Expenses
      const sheet2Data = allExpenses.map((e) => {
        const isPaid = String(e.status).toUpperCase() === 'PAID';
        return {
          'Désignation / Charge': e.name,
          'Montant (DH)': e.amount,
          'Date d\'Échéance / Création': getDueDate(e),
          'Période (Mois)': e.monthYear,
          'Statut': isPaid ? 'Payé' : 'À régler / En attente',
          'Date de Règlement': isPaid ? getPaymentDate(e) : '',
          'Catégorie / Nature': e.category || templateCategoryMap.get(e.templateId) || 'Général',
          'Origine': e.templateId === 'instant' ? 'Saisie Directe' : 'Modèle Récurrent',
        };
      });

      // Prepare sheet 3: Recurrent Models / Templates
      const sheet3Data = latestTemplates.map((t) => {
        return {
          'Nom du Modèle / Charge': t.name || (t as any).titre,
          'Montant par Défaut (DH)': t.amount || (t as any).montant,
          'Nature / Type': t.type,
          'Catégorie': t.category || (t as any).categorie || 'Général',
          'Jour d\'Échéance': t.dueDay || '',
          'Mois de Début': t.startMonth || 'Tous',
          'Mois de Fin': t.endMonth || 'Tous',
          'État d\'Activité': t.isActive ? 'Actif' : 'Inactif',
        };
      });

      // Prepare sheet 4: Worker Advances & Repayments
      const sheet4Data = allAdvances.map((adv) => {
        const workerName = workerTemplateMap.get(adv.chargeTemplateId) || 'Inconnu / Autre';
        return {
          'Date de l\'Opération': adv.date || '',
          'Mois Concerné': adv.moisConcerné || '',
          'Ouvrier / Personnel': workerName,
          'Type d\'Opération': adv.type === 'remboursement' ? 'Remboursement' : 'Avance',
          'Montant (DH)': adv.montant || 0,
          'Note / Commentaire': adv.note || '',
        };
      });

      // Create workbook
      const workbook = XLSX.utils.book_new();

      // Append sheets
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet1Data), `Mois_En_Cours_${currentMonthYear}`);
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet2Data), 'Historique_Toutes_Depenses');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet3Data), 'Modeles_Recurrents');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(sheet4Data), 'Avances_Ouvriers');

      // Write File
      XLSX.writeFile(workbook, `Finexy_Export_Depenses_${currentMonthYear}.xlsx`);
      showToast('Exportation multi-onglets (Historique + Modèles) réussie !', 'success');
    } catch (err) {
      console.error(err);
      showToast("Erreur lors de l'exportation des données", 'error');
    }
  };

  useEffect(() => {
    const handleImportEvent = () => setIsImportModalOpen(true);
    const handleExportEvent = () => handleExportToExcel();

    window.addEventListener('trigger-import-expenses', handleImportEvent);
    window.addEventListener('trigger-export-expenses', handleExportEvent);

    return () => {
      window.removeEventListener('trigger-import-expenses', handleImportEvent);
      window.removeEventListener('trigger-export-expenses', handleExportEvent);
    };
  }, [filteredExpenses, currentMonthYear]);

  const totalEntries = filteredExpenses.length;
  const totalPages = Math.ceil(totalEntries / pageSize) || 1;
  const paginatedExpenses = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredExpenses.slice(startIndex, startIndex + pageSize);
  }, [filteredExpenses, currentPage, pageSize]);

  const entryStart = totalEntries === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const entryEnd = Math.min(currentPage * pageSize, totalEntries);

  const isAllSelected =
    paginatedExpenses.length > 0 &&
    paginatedExpenses.every((s) => selectedExpenseIds.includes(s.id!));
  const isSomeSelected =
    paginatedExpenses.length > 0 &&
    paginatedExpenses.some((s) => selectedExpenseIds.includes(s.id!)) &&
    !isAllSelected;

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      const pageIds = paginatedExpenses.map((s) => s.id!).filter(Boolean);
      setSelectedExpenseIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    } else {
      const pageIds = paginatedExpenses.map((s) => s.id!).filter(Boolean);
      setSelectedExpenseIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    }
  };

  return (
    <div className="w-full py-4 space-y-6 select-none relative bg-transparent">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* ==========================================
           SNEAT STYLE - TABLE & PAGINATION
           ========================================== */
        .sneat-table-container {
            background: #ffffff;
            border: 1px solid #eceef1;
            border-radius: 8px;
            box-shadow: 0 2px 6px rgba(67, 89, 113, 0.12);
            overflow: hidden;
        }
        .dark .sneat-table-container {
            background: #2b2c40;
            border-color: rgba(67, 68, 96, 0.4);
            box-shadow: none;
        }
        .sneat-table {
            width: 100%;
            border-collapse: collapse;
            font-family: "Public Sans", -apple-system, sans-serif;
            text-align: left;
        }
        .sneat-table thead tr {
            background-color: #ffffff;
            border-bottom: 1px solid #d9dee3;
        }
        .dark .sneat-table thead tr {
            background-color: #2b2c40;
            border-bottom-color: rgba(67, 68, 96, 0.4);
        }
        .sneat-table thead th {
            font-size: 11.5px;
            font-weight: 600;
            text-transform: uppercase;
            color: #566a7f;
            padding: 14px 20px;
            letter-spacing: 0.8px;
        }
        .dark .sneat-table thead th {
            color: #a3afbb;
        }
        .sneat-table tbody tr {
            border-bottom: 1px solid #eceef1;
            background-color: #ffffff;
            transition: background-color 0.15s ease;
        }
        .dark .sneat-table tbody tr {
            border-bottom-color: rgba(67, 68, 96, 0.4);
            background-color: #2b2c40;
        }
        .sneat-table tbody tr:hover {
            background-color: #f5f5f9;
        }
        .dark .sneat-table tbody tr:hover {
            background-color: #323249;
        }
        .sneat-table tbody tr.selected {
            background-color: rgba(105, 108, 255, 0.08);
        }
        .dark .sneat-table tbody tr.selected:hover {
            background-color: rgba(105, 108, 255, 0.12);
        }
        .sneat-table tbody td {
            padding: 14px 20px;
            font-size: 14px;
            color: #566a7f;
            vertical-align: middle;
        }
        .dark .sneat-table tbody td {
            color: #dbdade;
        }
        .sneat-pagination-bar {
            display: flex;
            flex-wrap: wrap;
            justify-content: space-between;
            align-items: center;
            padding: 16px 24px;
            background-color: #ffffff;
            border-top: 1px solid #eceef1;
            margin-top: 0 !important;
        }
        .dark .sneat-pagination-bar {
            background-color: #2b2c40;
            border-top-color: rgba(67, 68, 96, 0.4);
        }
        .sneat-pagination-control {
            display: flex;
            gap: 6px;
            align-items: center;
        }
        .sneat-pag-btn {
            width: 32px;
            height: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: #f5f5f9;
            border: none;
            color: #697a8d;
            font-size: 13px;
            font-weight: 500;
            border-radius: 4px;
            cursor: pointer;
            transition: all 0.15s ease;
        }
        .dark .sneat-pag-btn {
            background-color: #323249;
            color: #a3a4cc;
        }
        .sneat-pag-btn:hover:not(:disabled) {
            background-color: #eceef1;
            color: #566a7f;
        }
        .dark .sneat-pag-btn:hover:not(:disabled) {
            background-color: #3c3d5a;
            color: #dbdade;
        }
        .sneat-pag-btn.active {
            background-color: #696cff;
            color: #ffffff;
            box-shadow: 0 0.125rem 0.25rem rgba(105, 108, 255, 0.4);
        }
        .sneat-pag-btn:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
      `,
        }}
      />

      {/* Core Analytics Banner - Sneat KPI Card Style */}
      <div className="w-full bg-[#ffffff] dark:bg-[#2b2c40] border border-[#eceef1] dark:border-[#434460]/60 rounded-xl shadow-[0_2px_12px_rgba(15,23,42,0.04)] dark:shadow-none overflow-hidden mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
          {/* Card 1: Budget Global / Total Expenses */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40]">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Budget Estimé Mensuel
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#222222] dark:text-[#dbdade]">
                  {totalBudget.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-[#222222] dark:text-[#eceeff]">
                  {expenses.length}
                </span>
                <span>Engagement{expenses.length > 1 ? 's' : ''}</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <Wallet size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 2: Validated / Versé */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t-0 md:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Versements Réalisés
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#4fb922] dark:text-[#71dd37]">
                  {totalValidated.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-[#4fb922] dark:text-[#71dd37]">
                  Total Cumulé Acquitté
                </span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <Banknote size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 3: Pending Total Amount */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Reste à Régler
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-2xl font-bold tracking-tight text-[#ff3e1d] dark:text-[#ff3e1d]">
                  {totalPending.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-[#ff3e1d]">{pendingCount}</span>
                <span>Charge{pendingCount > 1 ? 's' : ''} en attente</span>
              </div>
            </div>
            <div className="w-[42px] h-[42px] rounded-lg bg-slate-100 dark:bg-[#323450]/80 text-[#566a7f] dark:text-[#c4cbda] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40">
              <AlertCircle size={22} className="stroke-[2.2]" />
            </div>
          </div>

          {/* Card 4: Saisies Directes (Ce Mois) */}
          <div className="p-6 flex justify-between items-center bg-white dark:bg-[#2b2c40] border-t md:border-t border-t-[#eceef1] dark:border-t-[#434460]/50 lg:border-t-0 md:border-l lg:border-l border-[#eceef1] dark:border-[#434460]/50">
            <div className="space-y-1.5">
              <span className="text-[13px] font-semibold text-[#8592a3] dark:text-[#a3afbb] uppercase tracking-wider block font-sans">
                Saisies Directes (Ce Mois)
              </span>
              <div className="flex items-baseline gap-1 whitespace-nowrap">
                <span className="font-mono text-xl font-bold tracking-tight text-[#696cff] dark:text-[#b1b4ff]">
                  {totalInstantExpenses.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="text-xs font-bold text-[#8592a3] dark:text-[#707194] uppercase font-mono">
                  DH
                </span>
              </div>
              <div className="text-[12px] text-[#566a7f] dark:text-[#8e90b8] font-medium flex items-center gap-1.5">
                <span className="font-bold text-[#222222] dark:text-[#eceeff]">{instantCount}</span>
                <span>
                  Dépense{instantCount > 1 ? 's' : ''} direct{instantCount > 1 ? 's' : ''}
                </span>
              </div>
            </div>
            <div
              onClick={() => setIsInstantDrawerOpen(true)}
              className="w-[42px] h-[42px] rounded-lg bg-slate-100 hover:bg-slate-200 cursor-pointer dark:bg-[#323450]/80 dark:hover:bg-[#323450] text-[#696cff] dark:text-[#b1b4ff] flex items-center justify-center shrink-0 border border-slate-200/50 dark:border-slate-700/40 transition-colors"
              title="Nouvelle saisie directe"
            >
              <PlusCircle size={22} className="stroke-[2.2]" />
            </div>
          </div>
        </div>
      </div>

      {/* Ledger Control Center - MERGED CONTROLS & TABLE DIRECTORY */}
      <div className="sneat-table-container w-full overflow-visible mb-8">
        <style
          dangerouslySetInnerHTML={{
            __html: `
              /* ==========================================
                 SNEAT STYLE - TABLE NAV & BULK ACTIONS
                 ========================================== */
              .table-nav {
                  position: relative;
                  min-height: 56px;
                  border-bottom: 1px solid #eceef1;
                  background: #ffffff;
                  overflow: visible;
                  display: flex;
                  align-items: center;
              }
              .dark .table-nav {
                  border-bottom-color: rgba(67, 68, 96, 0.4);
                  background: #2b2c40;
              }

              .nav-default-view {
                  display: flex;
                  justify-content: space-between;
                  align-items: center;
                  width: 100%;
                  min-height: 56px;
                  transition: transform 0.2s ease, opacity 0.2s ease;
              }

              .nav-selection-view {
                  position: absolute;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  min-height: 56px;
                  background: #ffffff;
                  display: flex;
                  align-items: center;
                  gap: 12px;
                  padding: 8px 20px;
                  transform: translateY(-100%);
                  opacity: 0;
                  transition: transform 0.2s ease, opacity 0.2s ease;
                  pointer-events: none;
              }
              .dark .nav-selection-view {
                  background: #2b2c40;
              }

              .table-nav.has-selection .nav-default-view {
                  transform: translateY(100%);
                  opacity: 0;
                  pointer-events: none;
              }

              .table-nav.has-selection .nav-selection-view {
                  transform: translateY(0);
                  opacity: 1;
                  pointer-events: auto;
              }

              .action-bar-btn {
                  background-color: #eceef1;
                  border: none;
                  color: #435971;
                  padding: 8px 16px;
                  border-radius: 0.375rem;
                  font-size: 13.5px;
                  font-weight: 500;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  transition: all 0.2s ease;
              }
              .dark .action-bar-btn {
                  background-color: #323249;
                  color: #a3a4cc;
              }

              .action-bar-btn:hover {
                  background-color: #e1e4e8;
                  color: #233446;
              }
              .dark .action-bar-btn:hover {
                  background-color: #3c3d5a;
                  color: #dbdade;
              }

              .counter-badge {
                  background-color: #e8fadf;
                  border: 1px solid #71dd37;
                  color: #71dd37;
                  font-size: 13px;
                  font-weight: 600;
                  padding: 6px 14px;
                  border-radius: 0.375rem;
                  display: flex;
                  align-items: center;
                  gap: 10px;
              }
              .dark .counter-badge {
                  background-color: rgba(113, 221, 55, 0.12);
                  border-color: rgba(113, 221, 55, 0.2);
                  color: #71dd37;
              }
              .counter-close { 
                  cursor: pointer; 
                  font-weight: bold; 
              }
            `,
          }}
        />

        {/* Horizontal Filter Layout */}
        <div className={`table-nav ${selectedExpenseIds.length > 0 ? 'has-selection' : ''}`}>
          {/* VIEW A: Standard Filters */}
          <div className="nav-default-view px-6 py-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between w-full gap-4">
            {/* Left Side: Entries Selector + Buttons */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap overflow-x-auto whitespace-nowrap pb-2 sm:pb-0">
              <span className="text-sm font-medium text-[#8592a3] dark:text-[#a3afbb]">Show</span>
              <div className="relative shrink-0">
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="h-[38px] appearance-none pl-3 pr-8 py-1.5 border border-[#d9dee3] rounded-[6px] text-[#697a8d] text-sm bg-white focus:outline-none focus:border-[#696cff] dark:bg-[#2b2c40] dark:border-[#434460] dark:text-[#a3a4cc]"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
                <ChevronDown
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8592a3] pointer-events-none"
                  size={13}
                  strokeWidth={2.5}
                />
              </div>

              <input
                type="month"
                value={currentMonthYear}
                onChange={(e) =>
                  setCurrentMonthYear(e.target.value || new Date().toISOString().slice(0, 7))
                }
                className="shrink-0 bg-white dark:bg-[#2b2c40] border border-[#d9dee3] dark:border-[#434460] rounded-[6px] px-3 h-[38px] text-[13px] font-medium text-[#697a8d] dark:text-[#a3a4cc] outline-none focus:border-[#696cff] transition-all cursor-pointer ml-1"
              />

              {/* Create Modèles Button directly inline */}
              <Link
                to="/expenses/templates"
                className="shrink-0 bg-[#696cff] hover:bg-[#5f61e6] active:bg-[#5f61e6] text-white px-4 py-2 h-[38px] rounded-[6px] font-semibold flex items-center justify-center gap-1.5 transition-all text-sm shadow-[0_2px_4px_0_rgba(105,108,255,0.4)] hover:shadow-[0_4px_8px_0_rgba(105,108,255,0.4)] cursor-pointer whitespace-nowrap ml-1 sm:ml-2"
              >
                <Plus size={16} strokeWidth={2.5} />
                Modèles Récurrents
              </Link>

              <Link
                to="/expenses/analytics"
                className="shrink-0 bg-white dark:bg-[#2b2c40] border border-[#d9dee3] dark:border-[#434460] text-[#697a8d] dark:text-[#a3a4cc] hover:bg-slate-50 dark:hover:bg-[#323249] px-4 py-2 h-[38px] rounded-[6px] font-medium transition-all flex items-center justify-center gap-1.5 whitespace-nowrap text-sm cursor-pointer ml-1"
              >
                <BarChart3 size={15} className="text-[#a1acb8] dark:text-[#707194]" />
                <span>Tableau de Bord</span>
              </Link>
            </div>

            {/* Right Side: Search and Typologies Filter */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
              {/* Real time Search Box */}
              <div className="relative w-full sm:w-[220px]">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#a1acb8] dark:text-[#707194]">
                  <Search size={14} />
                </div>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrer par nom..."
                  className="bg-white dark:bg-[#232333] hover:bg-slate-50 dark:hover:bg-[#1a1b2a] border border-[#d9dee3] dark:border-[#434460] rounded-[6px] pl-[34px] pr-1.5 py-1 text-sm font-medium text-[#435971] dark:text-white outline-none focus:border-[#696cff] transition-all placeholder:text-[#a1acb8] w-full h-[38px]"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute inset-y-0 right-0 pr-2 flex items-center text-xs font-bold text-[#a1acb8] hover:text-[#ff3e1d] dark:text-[#ff3e1d]"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Typology Select Filter */}
              <div className="relative w-full sm:w-[150px]">
                <select
                  value={selectedType}
                  onChange={(e: any) => setSelectedType(e.target.value)}
                  className="h-[38px] appearance-none pl-3 pr-8 py-1.5 border border-[#d9dee3] rounded-[6px] text-[#697a8d] text-sm font-medium bg-white focus:outline-none focus:border-[#696cff] dark:bg-[#2b2c40] dark:border-[#434460] dark:text-[#a3a4cc] w-full cursor-pointer"
                >
                  <option value="all">Toutes natures</option>
                  <optgroup label="Origine">
                    <option value="recurring">Récurrents</option>
                    <option value="instant">Directes</option>
                  </optgroup>
                  <optgroup label="Nature">
                    <option value={ExpenseType.FIXED}>Fixes</option>
                    <option value={ExpenseType.VARIABLE}>Variables</option>
                    <option value={ExpenseType.CONSUMPTION}>Consommation</option>
                  </optgroup>
                </select>
                <ChevronDown
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8592a3] pointer-events-none"
                  size={13}
                  strokeWidth={2.5}
                />
              </div>
            </div>
          </div>

          {/* VIEW B: Bulk Actions */}
          <div className="nav-selection-view">
            <button
              className="action-bar-btn flex items-center gap-1.5"
              onClick={() => setSelectedExpenseIds([])}
            >
              <span>{selectedExpenseIds.length} sélectionné(s)</span>
              <span className="text-lg leading-none">&times;</span>
            </button>
            <button
              onClick={handleBulkPay}
              className="action-bar-btn flex items-center justify-center font-bold"
            >
              <DollarSign size={15} className="mr-1" /> Payer
            </button>
            <button
              onClick={handleBulkDelete}
              className="action-bar-btn text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center justify-center font-bold"
            >
              <Trash size={15} className="mr-1" /> Supprimer
            </button>
          </div>
        </div>

        {/* If filters are active, show active badge layout */}
        {(searchQuery || selectedType !== 'all') && (
          <div className="flex items-center flex-wrap gap-2 py-2 px-5 bg-slate-50/50 dark:bg-[#232333]/40 border-b border-slate-100 dark:border-slate-700/40 text-left">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#a1acb8] dark:text-[#707194]">
              Tris appliqués :
            </span>
            {searchQuery && (
              <span className="inline-flex items-center gap-1.5 bg-[#696cff]/10 text-[#696cff] dark:text-[#b1b4ff] px-2.5 py-1 rounded text-[11px] font-semibold">
                Mot-clé: "{searchQuery}"
                <button
                  onClick={() => setSearchQuery('')}
                  className="hover:text-[#ff3e1d] dark:text-[#ff3e1d] font-bold"
                >
                  ×
                </button>
              </span>
            )}
            {selectedType !== 'all' && (
              <span className="inline-flex items-center gap-1.5 bg-[#696cff]/10 text-[#696cff] dark:text-[#b1b4ff] px-2.5 py-1 rounded text-[11px] font-semibold">
                Type: {getTypeLabel(selectedType)}
                <button
                  onClick={() => setSelectedType('all')}
                  className="hover:text-[#ff3e1d] dark:text-[#ff3e1d] font-bold"
                >
                  ×
                </button>
              </span>
            )}
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedType('all');
              }}
              className="text-[11px] font-bold uppercase tracking-wider text-[#ff3e1d] dark:text-[#ff3e1d] hover:underline bg-transparent"
            >
              Effacer filtres
            </button>
          </div>
        )}

        {/* Transactions Ledger Panel List */}
        <div className="space-y-0">
          {loading ? (
            <div className="py-20 text-center space-y-4">
              <div className="w-10 h-10 border-4 border-[#696cff]/20 border-t-[#696cff] rounded-full animate-spin mx-auto"></div>
              <p className="text-[#a1acb8] dark:text-[#707194] text-xs font-semibold uppercase tracking-wider">
                Récupération du registre...
              </p>
            </div>
          ) : filteredExpenses.length === 0 ? (
            <div className="border-t border-dashed border-[#dbdade]/70 dark:border-[#434460]/40 p-16 text-center space-y-4">
              <div className="w-14 h-14 flex items-center justify-center mx-auto text-[#a1acb8] dark:text-[#707194]">
                <Wallet size={26} />
              </div>
              <div className="space-y-1.5 max-w-sm mx-auto">
                <p className="text-sm font-bold text-[#435971] dark:text-[#dbdade]">
                  Aucun engagement trouvé
                </p>
                <p className="text-xs text-[#697a8d] dark:text-[#a3a4cc] leading-relaxed">
                  Aucun poste de dépense ne correspond aux critères de tri. Essayez d'ajuster vos
                  filtres ci-dessus ou de faire une saisie directe.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="sneat-table">
                  <thead>
                    <tr>
                      <th className="w-10 px-5 text-center">
                        <input
                          type="checkbox"
                          className="sneat-checkbox"
                          checked={isAllSelected}
                          ref={(input) => {
                            if (input) {
                              input.indeterminate = isSomeSelected;
                            }
                          }}
                          onChange={handleSelectAll}
                        />
                      </th>
                      <th className="px-6 text-left">Désignation / Opération</th>
                      <th className="px-6 text-center">Catégorie</th>
                      <th className="px-6 text-center">Réglé le</th>
                      <th className="px-6 text-right">Montant (DH)</th>
                      <th className="px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedExpenses.map((expense, idx) => {
                      const isInstant = expense.templateId === 'instant';
                      const isPaid = expense.status === ExpenseStatus.PAID;
                      return (
                        <tr
                          key={expense.id + "_" + idx}
                          className={`cursor-pointer ${selectedExpenseIds.includes(expense.id!) ? 'selected' : ''}`}
                        >
                          <td className="w-10 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="sneat-checkbox"
                              checked={selectedExpenseIds.includes(expense.id!)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (checked) {
                                  setSelectedExpenseIds((prev) => [...prev, expense.id!]);
                                } else {
                                  setSelectedExpenseIds((prev) =>
                                    prev.filter((id) => id !== expense.id)
                                  );
                                }
                              }}
                            />
                          </td>

                          {/* Designation and Source details */}
                          <td className="px-6">
                            <div className="flex items-center gap-4">
                              {/* Left Status Bar Indicator */}
                              <div className="w-1 flex justify-center shrink-0">
                                <div
                                  className="w-[3px] h-[32px] rounded-full shrink-0 select-none bg-emerald-500 dark:bg-[#71dd37]"
                                  style={{ backgroundColor: isPaid ? undefined : '#ff3e1d' }}
                                />
                              </div>

                              {/* Source Rounded Box Icon */}
                              <div
                                className="flex items-center justify-center w-8.5 h-8.5 rounded-md shrink-0 select-none shadow-3xs"
                                style={{
                                  backgroundColor: isInstant
                                    ? 'rgba(255, 171, 0, 0.12)'
                                    : 'rgba(105, 108, 255, 0.12)',
                                }}
                              >
                                {isInstant ? (
                                  <Sparkles size={14} className="text-[#ffab00]" />
                                ) : (
                                  <RefreshCw
                                    size={13}
                                    className="text-[#696cff] dark:text-[#b1b4ff]"
                                  />
                                )}
                              </div>

                              <div className="min-w-0 flex-1 text-left">
                                {editingExpenseId === expense.id ? (
                                  <input
                                    type="text"
                                    value={editForm.name}
                                    onChange={(e) =>
                                      setEditForm({ ...editForm, name: e.target.value })
                                    }
                                    className="bg-white dark:bg-[#232333] border border-[#696cff] rounded px-3 py-1 text-xs text-[#233446] dark:text-white outline-none w-full shadow-xs"
                                    autoFocus
                                  />
                                ) : (
                                  <div className="flex flex-wrap items-center gap-1.5 leading-tight">
                                    <Link
                                      to={`/expenses/details/${encodeURIComponent(expense.name)}`}
                                      className="text-[15px] font-semibold text-[#435971] dark:text-[#dbdade] hover:text-[#696cff] dark:hover:text-[#b1b4ff] transition-colors"
                                    >
                                      {expense.name}
                                    </Link>
                                  </div>
                                )}

                                {/* Date & Metadata */}
                                <div className="text-[12.5px] text-[#8592a3] dark:text-[#707194] font-mono leading-none mt-1.5">
                                  {expense.date
                                    ? (() => {
                                        const dateStr = typeof expense.date === 'string' ? expense.date : String(expense.date);
                                        const parts = dateStr.includes('-') ? dateStr.split('-') : [];
                                        if (parts.length === 3) {
                                          const year = parseInt(parts[0], 10);
                                          const month = parseInt(parts[1], 10) - 1;
                                          const day = parseInt(parts[2], 10);
                                          return format(
                                            new Date(year, month, day),
                                            'dd MMMM yyyy',
                                            { locale: fr }
                                          );
                                        }
                                        return dateStr;
                                      })()
                                    : expense.createdAt
                                      ? format(
                                          expense.createdAt.toDate
                                            ? expense.createdAt.toDate()
                                            : new Date(expense.createdAt),
                                          'dd MMMM yyyy',
                                          { locale: fr }
                                        )
                                      : '-'}
                                  <span className="mx-1">•</span>
                                  {isInstant ? 'Saisie Directe' : 'Modèle Récurrent'}
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Type Categorization */}
                          <td className="px-6 text-center">
                            <span className="text-[12.5px] font-semibold text-[#566a7f] dark:text-[#dbdade]">
                              {getTypeLabel(expense.type)}
                            </span>
                          </td>

                          {/* Payment Date Badge */}
                          <td className="px-6 text-center">
                            <span
                              className={`text-[13px] whitespace-nowrap font-semibold px-2.5 py-1 ${
                                isPaid ? 'text-[#71dd37]' : 'text-[#ff3e1d]'
                              }`}
                            >
                              {!isPaid
                                ? 'À régler'
                                : (() => {
                                    if (expense.validatedAt) {
                                      return format(
                                        expense.validatedAt.toDate
                                          ? expense.validatedAt.toDate()
                                          : new Date(expense.validatedAt),
                                        'dd MMM yyyy',
                                        { locale: fr }
                                      );
                                    }
                                    if (expense.date) {
                                      const dateStr = typeof expense.date === 'string' ? expense.date : String(expense.date);
                                      const parts = dateStr.includes('-') ? dateStr.split('-') : [];
                                      if (parts.length === 3) {
                                        return format(
                                          new Date(
                                            parseInt(parts[0], 10),
                                            parseInt(parts[1], 10) - 1,
                                            parseInt(parts[2], 10)
                                          ),
                                          'dd MMM yyyy',
                                          { locale: fr }
                                        );
                                      }
                                      return dateStr;
                                    }
                                    if (expense.createdAt) {
                                      return format(
                                        expense.createdAt.toDate
                                          ? expense.createdAt.toDate()
                                          : new Date(expense.createdAt),
                                        'dd MMM yyyy',
                                        { locale: fr }
                                      );
                                    }
                                    return 'Payé';
                                  })()}
                            </span>
                          </td>

                          {/* Amount field with monospace typography alignment */}
                          <td className="px-6 text-right whitespace-nowrap">
                            {validatingId === expense.id ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <input
                                  autoFocus
                                  type="number"
                                  value={editAmount}
                                  onChange={(e) => setEditAmount(e.target.value)}
                                  className="w-20 bg-white dark:bg-[#232333] border border-[#696cff] rounded px-2 py-0.5 text-right text-xs font-semibold font-mono text-[#233446] dark:text-white outline-none shadow-xs"
                                />
                                <button
                                  onClick={() => handleValidate(expense.id!, Number(editAmount))}
                                  className="px-2 py-0.5 bg-[#696cff] text-white rounded text-[10px] font-bold transition-all"
                                >
                                  OK
                                </button>
                              </div>
                            ) : editingExpenseId === expense.id ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <input
                                  type="number"
                                  value={editForm.amount}
                                  onChange={(e) =>
                                    setEditForm({ ...editForm, amount: e.target.value })
                                  }
                                  className="w-20 bg-white dark:bg-[#232333] border border-[#696cff] rounded px-2 py-0.5 text-right text-xs font-semibold font-mono text-[#233446] dark:text-white outline-none shadow-xs"
                                />
                              </div>
                            ) : (
                              <p className="text-[14px] font-mono font-bold text-[#435971] dark:text-[#dbdade] tracking-tight">
                                {expense.amount.toLocaleString('fr-FR', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                                <span className="text-[11px] font-sans font-semibold text-[#a1acb8] ml-1">
                                  DH
                                </span>
                              </p>
                            )}
                          </td>

                          {/* Actions Group with compact buttons */}
                          <td className="px-6 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5 select-none text-right">
                              {editingExpenseId === expense.id ? (
                                <>
                                  <button
                                    onClick={() => handleUpdate(expense.id!)}
                                    className="p-1 text-[#71dd37] hover:bg-slate-50 dark:hover:bg-white/[0.04] rounded transition-colors"
                                    title="Valider"
                                  >
                                    <CheckCircle2 size={13} />
                                  </button>
                                  <button
                                    onClick={() => setEditingExpenseId(null)}
                                    className="p-1 text-[#ff3e1d] hover:bg-slate-50 dark:hover:bg-white/[0.04] rounded transition-colors"
                                    title="Annuler"
                                  >
                                    <Undo2 size={13} />
                                  </button>
                                </>
                              ) : (
                                <>
                                  {/* Solder Encaisser Trigger button */}
                                  {!isPaid && !validatingId && (
                                    <button
                                      onClick={() => {
                                        if (
                                          expense.type === ExpenseType.FIXED ||
                                          expense.type === ExpenseType.CONSUMPTION
                                        ) {
                                          handleValidate(expense.id!, expense.amount);
                                        } else {
                                          setValidatingId(expense.id!);
                                          setEditAmount(expense.amount.toString());
                                        }
                                      }}
                                      className="text-[12px] font-semibold uppercase tracking-wider text-[#696cff] dark:text-[#b1b4ff] hover:bg-[#696cff]/10 border border-[#696cff]/30 px-2.5 py-1 rounded transition-all shrink-0 cursor-pointer"
                                    >
                                      Solder
                                    </button>
                                  )}

                                  {/* Edit Trigger pencil button */}
                                  <button
                                    onClick={() => {
                                      setEditingExpenseId(expense.id!);
                                      setEditForm({
                                        name: expense.name,
                                        amount: expense.amount.toString(),
                                      });
                                    }}
                                    className="p-1.5 text-[#697a8d] hover:text-[#696cff] dark:text-[#a3a4cc] dark:hover:text-[#b1b4ff] hover:bg-[#696cff]/10 rounded transition-colors cursor-pointer"
                                    title="Modifier"
                                  >
                                    <Pencil size={16} strokeWidth={2.5} />
                                  </button>

                                  {/* Delete Trigger bin button */}
                                  <button
                                    onClick={() => handleDelete(expense)}
                                    className="p-1.5 text-[#697a8d] hover:text-[#ff3e1d] dark:text-[#a3a4cc] dark:hover:text-[#ff3e1d] hover:bg-[#ff3e1d]/10 rounded transition-colors cursor-pointer"
                                    title="Supprimer la charge"
                                  >
                                    <Trash2 size={16} strokeWidth={2.5} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* PAGINATION CONTROLS */}
              {filteredExpenses.length > 0 && (
                <div className="sneat-pagination-bar">
                  <div className="flex items-center gap-2 text-xs text-[#566a7f] dark:text-[#a3a4cc] whitespace-nowrap">
                    <span>Afficher</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="bg-white dark:bg-[#232333] border border-slate-200 dark:border-[#434460]/20 rounded py-1 px-2.5 text-xs font-semibold text-[#566a7f] dark:text-[#a3a4cc] focus:ring-1 focus:ring-[#696cff] cursor-pointer outline-none"
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                    <span>lignes</span>
                  </div>

                  <div className="text-xs font-medium text-[#566a7f] dark:text-[#a3a4cc]">
                    <span>
                      {entryStart} - {entryEnd} sur {totalEntries}
                    </span>
                  </div>

                  <div className="sneat-pagination-control">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="sneat-pag-btn"
                      title="Précédent"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => {
                      if (
                        totalPages > 5 &&
                        page !== 1 &&
                        page !== totalPages &&
                        Math.abs(page - currentPage) > 1
                      ) {
                        if (page === 2 && currentPage > 3)
                          return (
                            <span key="dots1" className="px-1 text-slate-400">
                              ...
                            </span>
                          );
                        if (page === totalPages - 1 && currentPage < totalPages - 2)
                          return (
                            <span key="dots2" className="px-1 text-slate-400">
                              ...
                            </span>
                          );
                        return null;
                      }
                      return (
                        <button
                          key={page}
                          onClick={() => setCurrentPage(page)}
                          className={`sneat-pag-btn ${currentPage === page ? 'active' : ''}`}
                        >
                          {page}
                        </button>
                      );
                    })}
                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="sneat-pag-btn"
                      title="Suivant"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Drawer for Add Instant Expense */}
      <AnimatePresence>
        {isInstantDrawerOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-[9998]"
              onClick={() => setIsInstantDrawerOpen(false)}
            />
            {/* Sliding Panel */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed top-0 right-0 h-screen w-full max-w-sm bg-white dark:bg-[#2b2c40] shadow-2xl z-[9999] flex flex-col"
            >
              <div className="flex items-center justify-between px-6 py-5 border-b border-slate-200 dark:border-[#434460]/40 bg-slate-50/50 dark:bg-[#232333]/40">
                <h3 className="font-bold text-[#435971] dark:text-white text-lg">
                  Saisie directe (Ce mois)
                </h3>
                <button
                  onClick={() => setIsInstantDrawerOpen(false)}
                  className="text-[#a1acb8] hover:text-[#ff3e1d] transition-colors rounded-full p-2 hover:bg-slate-100 dark:hover:bg-[#323450]"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 flex-1 overflow-y-auto">
                <form onSubmit={handleAddInstantExpense} className="flex flex-col gap-5">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-[#566a7f] dark:text-[#a3a4cc]">
                      Désignation
                    </label>
                    <div className="relative">
                      <input
                        name="name"
                        list="instant-names-list"
                        placeholder="Ex: Péage Autoroute, Café..."
                        disabled={isSubmittingInstant}
                        className="w-full bg-white dark:bg-[#232333] border border-slate-200 dark:border-slate-700/60 rounded px-3.5 py-2.5 text-sm font-medium text-[#435971] dark:text-white placeholder:text-[#a1acb8] focus:border-[#696cff] outline-none"
                        required
                        autoComplete="off"
                      />
                      {recentInstantNames.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            confirm({
                              title: "Effacer l'historique ?",
                              message:
                                "Voulez-vous effacer l'historique des suggestions de saisie ?",
                              onConfirm: async () => {
                                setRecentInstantNames([]);
                                localStorage.removeItem('recent_instant_expenses');
                              },
                            });
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a1acb8] hover:text-[#ff3e1d] p-1 rounded-md transition-colors"
                          title="Effacer l'historique de saisie"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <datalist id="instant-names-list">
                      {Array.from(
                        new Set([...recentInstantNames, ...groupedInstantExpenses.map(([n]) => n)])
                      ).map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-[#566a7f] dark:text-[#a3a4cc]">
                      Montant
                    </label>
                    <div className="flex items-center border border-slate-200 dark:border-slate-700/60 rounded bg-white dark:bg-[#232333] focus-within:border-[#696cff] pr-3 py-[3px]">
                      <input
                        name="amount"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        disabled={isSubmittingInstant}
                        className="w-full bg-transparent border-0 px-3.5 py-2 text-sm font-semibold text-[#435971] dark:text-white outline-none text-right"
                        required
                      />
                      <span className="text-xs font-bold text-[#a1acb8] dark:text-[#707194] pl-2 border-l border-slate-200 dark:border-slate-700/60 py-2">
                        DH
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-[#566a7f] dark:text-[#a3a4cc]">
                      Date de paiement
                    </label>
                    <div className="flex items-center border border-slate-200 dark:border-slate-700/60 rounded bg-white dark:bg-[#232333]">
                      <input
                        name="date"
                        type="date"
                        defaultValue={new Date().toISOString().split('T')[0]}
                        disabled={isSubmittingInstant}
                        className="w-full bg-transparent border-0 px-3.5 py-2.5 text-sm font-medium text-[#566a7f] dark:text-white outline-none cursor-pointer"
                        required
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-200 dark:border-[#434460]/40">
                    <button
                      type="submit"
                      disabled={isSubmittingInstant}
                      className="w-full bg-[#696cff] text-white hover:bg-[#5f61e6] px-5 py-3 rounded font-semibold uppercase tracking-wider text-[13px] shadow-2xs transition-all cursor-pointer flex justify-center items-center h-[48px]"
                    >
                      {isSubmittingInstant ? 'VALIDATION EN COURS...' : 'VALIDER ET AJOUTER'}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ExpensesXlsxModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        ownerId={user?.uid || ''}
        showToast={showToast}
        currentMonthYear={currentMonthYear}
      />
    </div>
  );
}

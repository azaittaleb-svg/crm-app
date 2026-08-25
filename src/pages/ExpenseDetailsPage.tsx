import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { expenseService, MonthlyExpense } from '../services/expenseService';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { PageHeader } from '../components/PageHeader';
import {
  ArrowLeft,
  Wallet,
  Calendar,
  Plus,
  Info,
  Trash2,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function ExpenseDetailsPage() {
  const { name } = useParams<{ name: string }>();
  const [expenses, setExpenses] = useState<MonthlyExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { confirm, showToast } = useNotification();

  const decodedName = name ? decodeURIComponent(name) : '';

  useEffect(() => {
    async function fetchExpenses() {
      if (!user || !decodedName) return;
      setLoading(true);
      try {
        const data = await expenseService.getExpenseHistoryByName(decodedName);
        setExpenses(data);
      } catch (error) {
        console.error('Error fetching generic expenses:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchExpenses();
  }, [user, decodedName]);

  const handleDelete = async (expense: MonthlyExpense) => {
    confirm({
      title: 'Supprimer la charge',
      message: `Êtes-vous sûr de vouloir supprimer cette charge "${decodedName}" de ${expense.amount} DH ?`,
      confirmText: 'Supprimer',
      variant: 'danger',
      onConfirm: async () => {
        if (!expense.id) return;
        try {
          await expenseService.deleteExpense(expense.id);
          setExpenses((prev) => prev.filter((e) => e.id !== expense.id));
          showToast('Charge supprimée avec succès !');
        } catch (error) {
          console.error('Error deleting expense:', error);
          showToast('Erreur lors de la suppression', 'error');
        }
      },
    });
  };

  const { total, monthlyBreakdown } = useMemo(() => {
    let total = 0;
    const monthlyMap = new Map<string, number>();

    expenses.forEach((e) => {
      total += e.amount;
      const monthKey = e.monthYear || 'Inconnu'; // e.g., "YYYY-MM"
      monthlyMap.set(monthKey, (monthlyMap.get(monthKey) || 0) + e.amount);
    });

    const monthlyBreakdown = Array.from(monthlyMap.entries()).sort((a, b) =>
      String(b[0] || '').localeCompare(String(a[0] || ''))
    );

    return { total, monthlyBreakdown };
  }, [expenses]);

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-transparent custom-scrollbar">
      <PageHeader
        title={`Détails : ${decodedName}`}
        subtitle="Historique de la dépense"
        icon={<Wallet size={24} className="text-brand-500" />}
        actions={
          <Link
            to="/expenses"
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 rounded-xl font-bold uppercase tracking-wider text-[11px] transition-all shadow-sm"
          >
            <ArrowLeft size={16} />
            Retour
          </Link>
        }
      />

      <main className="flex-1 p-6 lg:p-8 overflow-y-auto custom-scrollbar">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Summary Card */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(15,23,42,0.012)] border border-slate-200 flex items-center justify-between group hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-transparent dark:bg-transparent flex items-center justify-center text-slate-500 group-hover:scale-110 transition-transform">
                  <Wallet size={24} strokeWidth={2} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 font-mono">
                    Total Dépensé
                  </p>
                  <p className="text-2xl font-bold font-mono text-slate-900 tracking-tight">
                    {total.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    <span className="text-sm font-sans text-slate-400">DH</span>
                  </p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-xl p-6 shadow-[0_4px_24px_rgba(15,23,42,0.012)] border border-slate-200 flex items-center justify-between group hover:shadow-md transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-transparent dark:bg-transparent flex items-center justify-center text-slate-500 group-hover:scale-110 transition-transform">
                  <Plus size={24} strokeWidth={2} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 font-mono">
                    Nombre d'opérations
                  </p>
                  <p className="text-2xl font-bold font-mono text-slate-900 tracking-tight">
                    {expenses.length}
                  </p>
                </div>
              </div>
            </motion.div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Monthly Breakdown */}
            <div className="lg:col-span-1 space-y-4">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-2 font-mono">
                Répartition Mensuelle
              </h3>
              <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(15,23,42,0.012)] border border-slate-200 overflow-hidden animate-fade-in">
                {monthlyBreakdown.length > 0 ? (
                  <ul className="divide-y divide-slate-100">
                    {monthlyBreakdown.map(([month, amount]) => {
                      const monthStr = typeof month === 'string' ? month : String(month || '');
                      const parts = monthStr.includes('-') ? monthStr.split('-') : [];
                      let formattedDate = monthStr;
                      if (parts.length >= 2) {
                        const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1);
                        if (!isNaN(date.getTime())) {
                          formattedDate = format(date, 'MMMM yyyy', { locale: fr });
                        }
                      }
                      return (
                        <li
                          key={monthStr}
                          className="flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500">
                              <Calendar size={14} strokeWidth={2.5} />
                            </div>
                            <span className="font-bold text-slate-700 capitalize text-sm">
                              {formattedDate}
                            </span>
                          </div>
                          <span className="font-bold text-slate-900 text-sm">
                            {amount.toLocaleString('fr-FR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            <span className="text-[10px] text-slate-400 uppercase">DH</span>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <div className="p-8 text-center text-slate-400 text-sm font-medium">
                    Aucune donnée
                  </div>
                )}
              </div>
            </div>

            {/* Log History */}
            <div className="lg:col-span-2 space-y-4">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-widest px-2 font-mono">
                Historique des opérations
              </h3>
              <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(15,23,42,0.012)] border border-slate-200 overflow-hidden animate-fade-in">
                {loading ? (
                  <div className="p-12 flex justify-center">
                    <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : expenses.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 text-[10px] uppercase tracking-widest font-bold font-mono">
                          <th className="py-4 px-6 font-mono">Date</th>
                          <th className="py-4 px-6 font-mono">Montant</th>
                          <th className="py-4 px-6 text-center font-mono">Statut</th>
                          <th className="py-4 px-6 text-right font-mono">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {expenses.map((expense, idx) => (
                          <tr key={expense.id + "_" + idx} className="hover:bg-transparent transition-colors">
                            <td className="py-4 px-5 text-sm font-bold text-slate-600">
                              {expense.date
                                ? (() => {
                                    if (expense.date.includes('-')) {
                                      const parts = expense.date.split('-');
                                      if (parts.length === 3) {
                                        const year = parseInt(parts[0], 10);
                                        const month = parseInt(parts[1], 10) - 1;
                                        const day = parseInt(parts[2], 10);
                                        return format(new Date(year, month, day), 'dd MMM yyyy', {
                                          locale: fr,
                                        });
                                      }
                                    }
                                    return expense.date;
                                  })()
                                : expense.createdAt
                                  ? format(
                                      expense.createdAt.toDate
                                        ? expense.createdAt.toDate()
                                        : new Date(expense.createdAt),
                                      'dd MMM yyyy',
                                      { locale: fr }
                                    )
                                  : '-'}
                            </td>
                            <td className="py-4 px-5 text-sm font-bold text-slate-900">
                              {expense.amount.toLocaleString('fr-FR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}{' '}
                              <span className="text-[10px] text-slate-400 uppercase">DH</span>
                            </td>
                            <td className="py-4 px-5 text-center">
                              {expense.status === 'validated' ? (
                                <span className="inline-flex items-center gap-1 bg-brand-50 text-brand-600 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider">
                                  <CheckCircle2 size={12} />
                                  Validée
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 bg-transparent dark:bg-transparent text-[#ffab00] dark:text-[#ffab00] text-[10px] font-bold uppercase tracking-wider">
                                  <Circle size={12} />
                                  Standard
                                </span>
                              )}
                            </td>
                            <td className="py-4 px-5 text-right">
                              <button
                                onClick={() => handleDelete(expense)}
                                className="text-slate-400 hover:text-[#ff3e1d] dark:text-[#ff3e1d] hover:bg-transparent dark:bg-transparent transition-all hover: dark:"
                                title="Supprimer la charge"
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="py-24 flex flex-col items-center justify-center text-slate-400 space-y-4 bg-transparent">
                    <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center">
                      <Info size={24} className="text-slate-300" />
                    </div>
                    <p className="text-[11px] font-bold uppercase tracking-widest">
                      Aucune opération trouvée
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

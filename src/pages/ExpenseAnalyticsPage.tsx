import { useState, useEffect, useMemo } from 'react';
import { expenseService, MonthlyExpense } from '../services/expenseService';
import { useAuth } from '../context/AuthContext';
import { PageHeader } from '../components/PageHeader';
import {
  BarChart3,
  TrendingUp,
  Calendar as CalendarIcon,
  ArrowLeft,
  PieChart as PieChartIcon,
  Activity,
  Search,
  ArrowUpDown,
  Filter,
  SlidersHorizontal,
  Info,
  DollarSign,
  Percent,
  Calculator,
  ArrowRight,
  Flame,
} from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Link } from 'react-router-dom';
import {
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from 'recharts';
import { ExpenseType } from '../services/expenseService';

export default function ExpenseAnalyticsPage() {
  const [expenses, setExpenses] = useState<MonthlyExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();

  // Filters
  const [selectedMonth, setSelectedMonth] = useState<string>('all'); // 'all' or 'YYYY-MM'
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ExpenseType>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'template' | 'instant'>('all');

  // Sorting
  const [sortBy, setSortBy] = useState<'name' | 'count' | 'total'>('total');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    async function fetchExpenses() {
      if (!user) return;
      setLoading(true);
      try {
        const q = await expenseService.getAllExpensesForAnalytics();
        setExpenses(q);
      } catch (error) {
        console.error('Error fetching generic expenses:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchExpenses();
  }, [user]);

  // Aggregate stats
  const aggregateData = useMemo(() => {
    let filteredByMonth = expenses;
    if (selectedMonth !== 'all') {
      filteredByMonth = expenses.filter((e) => e.monthYear === selectedMonth);
    }

    let total = 0;
    const nameMap = new Map<
      string,
      { total: number; count: number; type: string; templateId?: string }
    >();
    const monthMap = new Map<string, number>();
    const typeMap = new Map<string, number>();

    filteredByMonth.forEach((e) => {
      total += e.amount;

      const n = e.name.trim();
      const current = nameMap.get(n) || {
        total: 0,
        count: 0,
        type: e.type,
        templateId: e.templateId,
      };
      nameMap.set(n, {
        total: current.total + e.amount,
        count: current.count + 1,
        type: current.type,
        templateId: e.templateId,
      });

      if (e.monthYear && typeof e.monthYear === 'string') {
        monthMap.set(e.monthYear, (monthMap.get(e.monthYear) || 0) + e.amount);
      }
      typeMap.set(e.type, (typeMap.get(e.type) || 0) + e.amount);
    });

    const expensesByNameRaw = Array.from(nameMap.entries());
    const expensesByMonth = Array.from(monthMap.entries()).sort((a, b) =>
      String(b[0] || '').localeCompare(String(a[0] || ''))
    );

    // Sort & Filter rubrics for listing table
    const cleanedSearch = searchQuery.toLowerCase().trim();
    const filteredRubrics = expensesByNameRaw.filter(([name, data]) => {
      const matchesSearch = String(name || '').toLowerCase().includes(cleanedSearch);
      const matchesType = typeFilter === 'all' || data.type === typeFilter;
      const isInstant = data.templateId === 'instant';
      const matchesSource =
        sourceFilter === 'all' ||
        (sourceFilter === 'instant' && isInstant) ||
        (sourceFilter === 'template' && !isInstant && data.templateId);

      return matchesSearch && matchesType && matchesSource;
    });

    // Apply sorting
    filteredRubrics.sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'name') {
        comparison = String(a[0] || '').localeCompare(String(b[0] || ''));
      } else if (sortBy === 'count') {
        comparison = a[1].count - b[1].count;
      } else if (sortBy === 'total') {
        comparison = a[1].total - b[1].total;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    // Format for charts
    const chartDataByMonth = expensesByMonth.map(([month, val]) => {
      if (!month || typeof month !== 'string' || !month.includes('-')) {
        return { monthKey: month || '', name: month || 'INCONNU', total: val };
      }
      const [year, mo] = month.split('-');
      const formattedLabel = format(new Date(parseInt(year), parseInt(mo) - 1), 'MMM yy', {
        locale: fr,
      });
      return {
        monthKey: month,
        name: formattedLabel.toUpperCase(),
        total: val,
      };
    });

    // Order chronologically for charts
    chartDataByMonth.sort((a, b) => String(a.monthKey || '').localeCompare(String(b.monthKey || '')));

    const chartDataByType = Array.from(typeMap.entries()).map(([name, value]) => ({
      name:
        name === ExpenseType.FIXED
          ? 'FIXE'
          : name === ExpenseType.VARIABLE
            ? 'VARIABLE'
            : 'CONSOMMATION',
      value,
      rawType: name,
    }));

    const availableMonths = (
      Array.from(
        new Set(expenses.map((e) => e.monthYear).filter((m) => typeof m === 'string'))
      ) as string[]
    ).sort((a, b) => b.localeCompare(a));

    // Stats calculations
    const uniqueRubricsCount = nameMap.size;
    const topRubricTuple = Array.from(nameMap.entries()).sort((a, b) => b[1].total - a[1].total)[0];
    const topRubric = topRubricTuple ? { name: topRubricTuple[0], ...topRubricTuple[1] } : null;

    const totalTransactionCount = filteredByMonth.length;
    const averagePerRubric = uniqueRubricsCount > 0 ? total / uniqueRubricsCount : 0;

    const fixedTotal = typeMap.get(ExpenseType.FIXED) || 0;
    const fixedPercent = total > 0 ? (fixedTotal / total) * 100 : 0;

    return {
      total,
      expensesByName: filteredRubrics,
      allExpensesByName: expensesByNameRaw,
      expensesByMonth,
      chartDataByMonth,
      chartDataByType,
      availableMonths,
      uniqueRubricsCount,
      topRubric,
      totalTransactionCount,
      averagePerRubric,
      fixedTotal,
      fixedPercent,
    };
  }, [expenses, selectedMonth, searchQuery, typeFilter, sourceFilter, sortBy, sortOrder]);

  const toggleSort = (field: 'name' | 'count' | 'total') => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  // Sneat Pastel / Professional Colors
  const colorsByType: Record<string, string> = {
    [ExpenseType.FIXED]: '#696cff', // Sneat Primary (Purple/Blue)
    [ExpenseType.VARIABLE]: '#ffab00', // Sneat Warning (Amber)
    [ExpenseType.CONSUMPTION]: '#03c3ec', // Sneat Info (Cyan)
  };

  const typeLabels: Record<string, string> = {
    [ExpenseType.FIXED]: 'Fixe',
    [ExpenseType.VARIABLE]: 'Variable',
    [ExpenseType.CONSUMPTION]: 'Consommation',
  };

  // Custom styling for Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-slate-200/60 rounded-lg p-3 shadow-sm text-left font-sans">
          <p className="text-xs font-semibold text-[#566a7f] mb-1">
            {label}
          </p>
          <p className="text-[14px] font-bold text-[#435971]">
            {payload[0].value.toLocaleString('fr-FR', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{' '}
            <span className="text-xs font-semibold text-[#a1acb8]">DH</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col h-full bg-transparent font-sans">
      <PageHeader
        title="Analytique"
        subtitle="Répartition des dépenses"
        icon={<PieChartIcon size={22} className="text-[#696cff]" />}
        actions={
          <Link
            to="/expenses"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200/60 text-[#566a7f] hover:bg-slate-50 rounded-lg font-semibold text-sm transition-all shadow-2xs"
          >
            <ArrowLeft size={15} />
            Retour
          </Link>
        }
      />

      <main className="flex-1 py-5 space-y-4">
        {/* Compact Top Bar: Filters & Mini-KPIs */}
        <div className="bg-white p-3 rounded-lg border border-slate-200/60 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 rounded-md text-sm font-semibold bg-slate-50 border border-slate-200/60 text-[#435971] focus:border-[#696cff] outline-none cursor-pointer"
            >
              <option value="all">Période: Globale</option>
              {aggregateData.availableMonths.map((m) => {
                const mStr = typeof m === 'string' ? m : String(m || '');
                if (!mStr.includes('-')) return <option key={mStr} value={mStr}>{mStr}</option>;
                const [year, mo] = mStr.split('-');
                const label = format(new Date(parseInt(year, 10), parseInt(mo, 10) - 1), 'MMMM yyyy', { locale: fr });
                return <option key={mStr} value={mStr}>{label.charAt(0).toUpperCase() + label.slice(1)}</option>;
              })}
            </select>

            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#a1acb8]" />
              <input
                type="text"
                placeholder="Rechercher..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-40 pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200/60 rounded-md text-sm focus:bg-white focus:border-[#696cff] outline-none placeholder:text-[#a1acb8] text-[#435971]"
              />
            </div>
            
            <select
              value={typeFilter}
              onChange={(e: any) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 rounded-md text-sm font-semibold bg-slate-50 border border-slate-200/60 text-[#566a7f] focus:border-[#696cff] outline-none cursor-pointer hidden md:block"
            >
              <option value="all">Tous types</option>
              <option value={ExpenseType.FIXED}>Fixe</option>
              <option value={ExpenseType.VARIABLE}>Variable</option>
              <option value={ExpenseType.CONSUMPTION}>Conso.</option>
            </select>
          </div>

          {/* Inline KPIs */}
          <div className="flex items-center gap-5 text-sm divide-x divide-slate-200/60">
            <div className="flex flex-col px-2">
              <span className="text-[11px] text-[#a1acb8] font-bold uppercase tracking-wider">Total Déboursé</span>
              <span className="font-mono font-bold text-[#435971] text-base">
                {aggregateData.total.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH
              </span>
            </div>
            <div className="flex flex-col pl-5 hidden sm:flex">
              <span className="text-[11px] text-[#a1acb8] font-bold uppercase tracking-wider">Top Charge</span>
              <span className="font-semibold text-[#435971] truncate max-w-[120px]">
                {aggregateData.topRubric?.name || '---'}
              </span>
            </div>
            <div className="flex flex-col pl-5 hidden sm:flex">
              <span className="text-[11px] text-[#a1acb8] font-bold uppercase tracking-wider">Charges Fixes</span>
              <span className="font-semibold text-[#696cff]">
                {aggregateData.fixedPercent.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* Main Content: Left Table, Right Donut */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          
          {/* Detailed Table (Col 1 & 2) */}
          <div className="lg:col-span-2 bg-white rounded-lg border border-slate-200/60 shadow-2xs overflow-hidden flex flex-col">
            {loading ? (
               <div className="p-8 flex justify-center">
                 <div className="w-6 h-6 border-2 border-[#696cff] border-t-transparent rounded-full animate-spin"></div>
               </div>
            ) : aggregateData.expensesByName.length === 0 ? (
               <div className="p-8 text-center text-[#a1acb8]">
                 <Search className="mx-auto mb-2 opacity-40" size={24} />
                 <p className="text-sm">Aucune donnée trouvée.</p>
               </div>
            ) : (
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 border-b border-slate-200/60 sticky top-0 z-10">
                    <tr>
                      <th
                        onClick={() => toggleSort('name')}
                        className="px-4 py-2.5 text-xs font-semibold text-[#566a7f] cursor-pointer hover:bg-slate-100 transition-colors w-1/2"
                      >
                        <div className="flex items-center gap-1.5">
                          Rubrique
                          <ArrowUpDown size={12} className={sortBy === 'name' ? 'text-[#696cff]' : 'text-[#a1acb8]'} />
                        </div>
                      </th>
                      <th
                        onClick={() => toggleSort('count')}
                        className="px-4 py-2.5 text-xs font-semibold text-[#566a7f] cursor-pointer hover:bg-slate-100 transition-colors text-center"
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          Qte
                          <ArrowUpDown size={12} className={sortBy === 'count' ? 'text-[#696cff]' : 'text-[#a1acb8]'} />
                        </div>
                      </th>
                      <th
                        onClick={() => toggleSort('total')}
                        className="px-4 py-2.5 text-xs font-semibold text-[#566a7f] cursor-pointer hover:bg-slate-100 transition-colors text-right"
                      >
                        <div className="flex items-center justify-end gap-1.5">
                          Montant
                          <ArrowUpDown size={12} className={sortBy === 'total' ? 'text-[#696cff]' : 'text-[#a1acb8]'} />
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {aggregateData.expensesByName.map(([name, data]) => {
                      const percent = aggregateData.total > 0 ? (data.total / aggregateData.total) * 100 : 0;
                      return (
                        <tr key={name} className="hover:bg-slate-50 transition-colors group">
                          <td className="px-4 py-2.5">
                            <Link
                              to={`/expenses/details/${encodeURIComponent(name)}`}
                              className="text-sm font-semibold text-[#435971] hover:text-[#696cff] flex items-center gap-1"
                            >
                              {name}
                            </Link>
                            <div className="mt-1 flex items-center gap-1.5">
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                style={{
                                  color: colorsByType[data.type] || '#566a7f',
                                  backgroundColor: `${colorsByType[data.type]}1A`,
                                }}
                              >
                                {typeLabels[data.type]}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-center text-sm font-semibold text-[#566a7f]">
                            {data.count}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="text-sm font-mono font-bold text-[#435971]">
                              {data.total.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} DH
                            </div>
                            <div className="text-[10px] text-[#a1acb8] font-semibold mt-0.5">
                              {percent.toFixed(1)}%
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Right Donut Chart */}
          <div className="bg-white border border-slate-200/60 rounded-lg p-4 shadow-2xs flex flex-col">
            <h3 className="text-sm font-semibold text-[#435971] mb-4">
              Structure des Charges
            </h3>

            {aggregateData.chartDataByType.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-[#a1acb8] text-xs font-semibold">
                Aucune donnée
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={aggregateData.chartDataByType}
                        innerRadius={50}
                        outerRadius={75}
                        paddingAngle={3}
                        dataKey="value"
                        nameKey="name"
                        stroke="none"
                      >
                        {aggregateData.chartDataByType.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={colorsByType[entry.rawType] || '#cbd5e1'} />
                        ))}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                  {Object.entries(typeLabels).map(([typeKey, label]) => {
                    const matched = aggregateData.chartDataByType.find((el) => el.rawType === typeKey);
                    const percent = aggregateData.total > 0 && matched ? (matched.value / aggregateData.total) * 100 : 0;
                    return (
                      <div key={typeKey} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colorsByType[typeKey] }} />
                          <span className="font-semibold text-[#566a7f]">{label}</span>
                        </div>
                        <span className="font-bold text-[#435971]">{percent.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}

import React, { useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  TrendingUp,
  Receipt,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  PieChart,
  Calendar,
  AlertTriangle,
} from 'lucide-react';
import { Link } from 'react-router-dom';

interface FinancialFlowMatrixProps {
  multiMonthStats: {
    incomeChartData: any[];
    profitChartData: any[];
    salesTrend: number;
    currentIncome: number;
    currentExpenses: number;
    currentProfit: number;
    expensesSplitChartData: any[];
    currentMonthName?: string;
    profitDiffFormatted: string;
    months?: any[];
  };
  totalExpenses: number;
  currentMonthPendingExpenses: number;
  pendingExpensesCount: number;
  estimatedLiquidCash: number;
}

export const FinancialFlowMatrix: React.FC<FinancialFlowMatrixProps> = ({
  multiMonthStats,
  totalExpenses,
  currentMonthPendingExpenses,
  pendingExpensesCount,
  estimatedLiquidCash,
}) => {
  const [viewMode, setViewMode] = useState<'cashflow' | 'margins'>('cashflow');

  const currentMonthName = multiMonthStats?.months?.[0]?.name || 'Mois en cours';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 2 Cols: Main Financial Flow Chart */}
      <div className="lg:col-span-2 bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 md:p-6 shadow-3xs text-left flex flex-col justify-between">
        <div>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100 dark:border-[#434460]/30">
            <div>
              <h3 className="text-base font-bold text-[#435971] dark:text-[#dbdade]">
                Flux Financier & Rentabilité Multi-Mois
              </h3>
              <p className="text-xs text-[#a1acb8] dark:text-[#707194]">
                Évolution comparée des revenus encaissés, charges d'exploitation et marges nettes
              </p>
            </div>

            {/* Mode switch */}
            <div className="flex items-center bg-slate-100 dark:bg-[#202134] p-1 rounded-lg self-start sm:self-center">
              <button
                onClick={() => setViewMode('cashflow')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border-0 ${
                  viewMode === 'cashflow'
                    ? 'bg-white dark:bg-[#2b2c40] text-[#696cff] dark:text-[#b1b4ff] shadow-3xs font-bold'
                    : 'text-[#566a7f] dark:text-[#a1acb8] hover:text-[#435971]'
                }`}
              >
                Revenus vs Dépenses
              </button>
              <button
                onClick={() => setViewMode('margins')}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border-0 ${
                  viewMode === 'margins'
                    ? 'bg-white dark:bg-[#2b2c40] text-emerald-600 dark:text-emerald-400 shadow-3xs font-bold'
                    : 'text-[#566a7f] dark:text-[#a1acb8] hover:text-[#435971]'
                }`}
              >
                Bénéfice Net
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar above Chart */}
          <div className="grid grid-cols-3 gap-3 mb-4 p-3 bg-slate-50 dark:bg-[#232333] rounded-lg border border-slate-100 dark:border-[#434460]/30">
            <div>
              <span className="text-[11px] font-semibold text-[#a1acb8] dark:text-[#707194] block uppercase">
                Revenus ({currentMonthName})
              </span>
              <span className="text-base font-mono font-bold text-[#435971] dark:text-[#dbdade]">
                {(multiMonthStats?.currentIncome || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH
              </span>
            </div>
            <div>
              <span className="text-[11px] font-semibold text-[#a1acb8] dark:text-[#707194] block uppercase">
                Charges ({currentMonthName})
              </span>
              <span className="text-base font-mono font-bold text-rose-500">
                {(multiMonthStats?.currentExpenses || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH
              </span>
            </div>
            <div>
              <span className="text-[11px] font-semibold text-[#a1acb8] dark:text-[#707194] block uppercase">
                Résultat Net
              </span>
              <span className="text-base font-mono font-bold text-emerald-600 dark:text-emerald-400">
                {(multiMonthStats?.currentProfit || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH
              </span>
            </div>
          </div>

          {/* Interactive Recharts Graph */}
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              {viewMode === 'cashflow' ? (
                <AreaChart
                  data={multiMonthStats.incomeChartData}
                  margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="incomeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#696cff" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#696cff" stopOpacity={0.0} />
                    </linearGradient>
                    <linearGradient id="expenseGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ff3e1d" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#ff3e1d" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                  <XAxis dataKey="name" stroke="#a1acb8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#a1acb8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#2b2c40',
                      borderRadius: '8px',
                      border: 'none',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    formatter={(val: any) => [`${Number(val).toLocaleString('fr-FR')} DH`]}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Area
                    type="monotone"
                    name="Revenus Encaissés"
                    dataKey="income"
                    stroke="#696cff"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#incomeGrad)"
                  />
                  <Area
                    type="monotone"
                    name="Dépenses d'Exploitation"
                    dataKey="expenses"
                    stroke="#ff3e1d"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#expenseGrad)"
                  />
                </AreaChart>
              ) : (
                <BarChart
                  data={multiMonthStats.profitChartData}
                  margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.6} />
                  <XAxis dataKey="label" stroke="#a1acb8" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="#a1acb8" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#2b2c40',
                      borderRadius: '8px',
                      border: 'none',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                    formatter={(val: any) => [`${Number(val).toLocaleString('fr-FR')} DH`]}
                  />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
                  <Bar
                    dataKey="profit"
                    name="Bénéfice Net"
                    fill="#71dd37"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 1 Col: Charges & Trésorerie Décomposition */}
      <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 md:p-6 shadow-3xs text-left flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-[#434460]/30">
            <div className="flex items-center gap-2">
              <Receipt size={18} className="text-rose-500" />
              <h3 className="text-base font-bold text-[#435971] dark:text-[#dbdade]">
                Charges du Mois
              </h3>
            </div>
            <Link
              to="/expenses"
              className="text-xs font-semibold text-[#696cff] hover:text-[#5f61e6]"
            >
              Gérer
            </Link>
          </div>

          <div className="space-y-3.5">
            {/* Total expense card */}
            <div className="p-3.5 bg-rose-50/60 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-800/30 rounded-lg">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 block">
                Total Engagé ce mois
              </span>
              <div className="text-2xl font-mono font-bold text-rose-600 dark:text-rose-400 mt-1">
                {totalExpenses.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                <span className="text-xs font-sans">DH</span>
              </div>
            </div>

            {/* Pending expense status */}
            <div className="p-3 bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#566a7f] dark:text-[#a1acb8] font-semibold flex items-center gap-1.5">
                  <AlertTriangle size={14} className="text-amber-500" />
                  Reste à régler :
                </span>
                <span className="font-mono font-bold text-rose-500">
                  {currentMonthPendingExpenses.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH
                </span>
              </div>
              <p className="text-[11px] text-[#a1acb8]">
                {pendingExpensesCount} charge{pendingExpensesCount > 1 ? 's' : ''} en attente d'imputation
              </p>
            </div>

            {/* Liquid Cash Estimation */}
            <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30 rounded-lg space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1.5">
                  <Wallet size={14} className="text-emerald-600" />
                  Cash Net Disponible :
                </span>
                <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                  {estimatedLiquidCash.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH
                </span>
              </div>
              <p className="text-[11px] text-emerald-600/80">
                Après déduction de toutes les charges payées
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#434460]/30 text-center">
          <Link
            to="/expenses"
            className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-[#323249] dark:hover:bg-[#3f405a] text-[#566a7f] dark:text-[#dbdade] text-xs font-bold rounded-md transition-colors"
          >
            <Receipt size={14} />
            Pointer les charges du mois
          </Link>
        </div>
      </div>
    </div>
  );
};

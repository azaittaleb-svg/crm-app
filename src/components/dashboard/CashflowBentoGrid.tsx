import React, { useState } from 'react';
import {
  Wallet,
  TrendingUp,
  CreditCard,
  Coins,
  MoreVertical,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';

interface CashflowBentoGridProps {
  totalAmount: number;
  estimatedLiquidCash: number;
  totalExpenses: number;
  expenseRatio: number;
  pendingExpensesCount: number;
  totalTransactionsCount: number;
  multiMonthStats: {
    salesTrend: string;
    txTrend: string;
    profitChartData: any[];
    incomeChartData: any[];
    currentIncome: number;
    currentExpenses: number;
    currentProfit: number;
    incomeDiffFormatted: string;
    expensesDiffFormatted: string;
    profitDiffFormatted: string;
  };
  recoveryRate: number;
  visibleWidgets?: Record<string, boolean | undefined>;
}

export const CashflowBentoGrid: React.FC<CashflowBentoGridProps> = ({
  totalAmount,
  estimatedLiquidCash,
  totalExpenses,
  expenseRatio,
  pendingExpensesCount,
  totalTransactionsCount,
  multiMonthStats,
  recoveryRate,
  visibleWidgets = {} as Record<string, boolean | undefined>,
}) => {
  const [chartTab, setChartTab] = useState<'all' | 'income' | 'expenses' | 'profit'>('all');

  const showSales = visibleWidgets.salesCard !== false;
  const showProfit = visibleWidgets.profitCard !== false;
  const showCharges = visibleWidgets.chargesCard !== false;
  const showChart = visibleWidgets.cashflowChart !== false;

  if (!showSales && !showProfit && !showCharges && !showChart) return null;

  return (
    <div className="flex flex-col xl:flex-row gap-4 xl:gap-[25px] w-full items-start justify-start">
      {/* Left Section: 4 small cards arranged in a 2x2 grid */}
      {(showSales || showProfit || showCharges) && (
        <div
          className={`grid grid-cols-1 min-[390px]:grid-cols-2 gap-4 sm:gap-[27px] w-full ${showChart ? 'xl:w-[32.55%]' : 'xl:w-full'}`}
        >
          {/* 1. Sales Card */}
          {showSales && (
            <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-4 shadow-3xs flex flex-col justify-between text-left select-none w-full sm:h-[215px] h-auto min-h-[185px] py-5 sm:py-4 hover:shadow-2xs transition-all duration-200">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 bg-[#e7e7ff] text-[#696cff] dark:bg-[#696cff]/20 dark:text-[#b1b4ff] flex items-center justify-center rounded-lg sm:p-2.5 shrink-0">
                  <Wallet size={18} strokeWidth={2.5} />
                </div>
                <span className="text-[#a1acb8] dark:text-[#707194] text-xs font-semibold">CA</span>
              </div>
              <div className="mt-2.5">
                <span className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] block font-sans">
                  Total Ventes
                </span>
                <div className="flex items-baseline mt-1 font-mono">
                  <span className="text-[24px] min-[400px]:text-[28px] md:text-[32px] xl:text-[20px] 2xl:text-[26px] font-bold text-[#222222] dark:text-[#dbdade] tracking-tight leading-none">
                    {totalAmount >= 1000000
                      ? `${(totalAmount / 1000000).toFixed(1)}M`
                      : totalAmount >= 1000
                        ? `${(totalAmount / 1000).toFixed(0)}k`
                        : totalAmount.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                  </span>
                  <span className="text-xs text-[#a1acb8] dark:text-[#707194] font-semibold ml-1.5 font-sans uppercase">
                    DH
                  </span>
                </div>
              </div>
              <div className="mt-1 flex items-center">
                <span className="text-[#4fb922] dark:text-[#71dd37] text-sm font-semibold flex items-center gap-1 font-sans">
                  <TrendingUp size={14} strokeWidth={2.5} /> {multiMonthStats.salesTrend || '+0%'}
                </span>
              </div>
            </div>
          )}

          {/* 2. Profit Card */}
          {showProfit && (
            <div className="bg-[#ffffff] border border-[#dbdade]/70 dark:bg-[#2b2c40] dark:border-[#434460]/40 rounded-lg p-4 shadow-3xs flex flex-col justify-between text-left select-none w-full sm:h-[215px] h-auto min-h-[185px] py-5 sm:py-4 hover:shadow-2xs transition-all duration-200">
              <div className="flex items-start justify-between">
                <div className="w-8.5 h-8.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center text-[#4fb922] dark:text-[#71dd37]">
                  <TrendingUp size={16} strokeWidth={2.5} />
                </div>
                <span className="text-[#a1acb8] dark:text-[#707194] text-xs font-semibold">Net</span>
              </div>
              <div className="mt-2.5">
                <span className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] block font-sans">
                  Profit / Marge
                </span>
                <span
                  className="text-[24px] min-[400px]:text-[28px] md:text-[32px] xl:text-[20px] 2xl:text-[26px] font-bold text-[#222222] dark:text-[#dbdade] tracking-tight leading-none mt-1 block font-mono"
                  title={`${estimatedLiquidCash.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`}
                >
                  {estimatedLiquidCash >= 1000000
                    ? `${(estimatedLiquidCash / 1000000).toFixed(1)}M`
                    : estimatedLiquidCash >= 1000
                      ? `${(estimatedLiquidCash / 1000).toFixed(0)}k`
                      : estimatedLiquidCash.toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                  <span className="text-xs font-semibold text-[#a1acb8] dark:text-[#707194] uppercase ml-1 font-sans">
                    DH
                  </span>
                </span>
              </div>

              {/* Horizontal mini bar chart representing months */}
              <div className="flex justify-between items-end gap-2 mt-3 w-full">
                {(multiMonthStats.profitChartData || []).map((item: any, idx: number) => (
                  <div
                    key={idx}
                    className="flex flex-col items-center flex-1 gap-1"
                    title={`${(item.profit || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`}
                  >
                    <div className="w-2.5 h-12 bg-slate-100 dark:bg-[#323249] relative overflow-hidden rounded-full">
                      <div
                        className="absolute bottom-0 left-0 right-0 bg-[#71dd37] rounded-full"
                        style={{ height: item.height || '30%' }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-[#a1acb8] dark:text-[#707194]">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. Expenses Card with radial gauge */}
          {showCharges && (
            <div className="bg-[#ffffff] border border-[#dbdade]/70 dark:bg-[#2b2c40] dark:border-[#434460]/40 rounded-lg p-4 shadow-3xs flex flex-col justify-between text-left select-none w-full sm:h-[199px] h-auto min-h-[175px] py-5 sm:py-4 hover:shadow-2xs transition-all duration-200">
              <div className="flex items-start justify-between">
                <span className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] block font-sans">
                  Charges & Dépenses
                </span>
                <span className="text-xs text-rose-500 font-bold font-mono">
                  {expenseRatio}%
                </span>
              </div>

              {/* SVG radial progress circle inside */}
              <div className="flex flex-row items-center justify-between gap-1.5 mt-2">
                <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9155"
                      className="text-slate-100 dark:text-[#435971]/50"
                      strokeWidth="3.5"
                      stroke="currentColor"
                      fill="none"
                    />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.9155"
                      className="text-[#696CFF] dark:text-[#b1b4ff]"
                      strokeDasharray={`${Math.min(100, expenseRatio || 0)}, 100`}
                      strokeWidth="3.5"
                      strokeLinecap="round"
                      stroke="currentColor"
                      fill="none"
                    />
                  </svg>
                  <span className="absolute text-[10.5px] font-black text-[#222222] dark:text-[#dbdade] font-mono">
                    {expenseRatio}%
                  </span>
                </div>
                <div className="flex flex-col text-left min-w-0">
                  <span
                    className="text-[22px] min-[400px]:text-[24px] md:text-[28px] xl:text-[18px] 2xl:text-[22px] font-bold text-[#222222] dark:text-[#dbdade] tracking-tight leading-none block font-mono truncate"
                    title={`${totalExpenses.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`}
                  >
                    {totalExpenses >= 1000000
                      ? `${(totalExpenses / 1000000).toFixed(1)}M`
                      : totalExpenses >= 1000
                        ? `${(totalExpenses / 1000).toFixed(0)}k`
                        : totalExpenses.toLocaleString('fr-FR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                    <span className="text-xs font-semibold text-[#a1acb8] dark:text-[#707194] font-sans ml-1">
                      DH
                    </span>
                  </span>
                  <span className="text-[12px] text-[#a1acb8] dark:text-[#707194] font-semibold tracking-tight block mt-1 font-sans">
                    Charges engagées
                  </span>
                </div>
              </div>

              <div className="mt-1 pb-0.5">
                <span className="text-[12px] font-normal text-[#a1acb8] dark:text-[#707194] leading-tight block truncate font-sans">
                  {pendingExpensesCount > 0
                    ? `${pendingExpensesCount} charges en attente`
                    : 'Aucune charge due'}
                </span>
              </div>
            </div>
          )}

          {/* 4. Transactions Card */}
          <div className="bg-[#ffffff] border border-[#dbdade]/70 dark:bg-[#2b2c40] dark:border-[#434460]/40 rounded-lg p-4 shadow-3xs flex flex-col justify-between text-left select-none w-full sm:h-[199px] h-auto min-h-[175px] py-5 sm:py-4 hover:shadow-2xs transition-all duration-200">
            <div className="flex items-start justify-between">
              <div className="w-10 h-10 bg-[#fff3e0] text-[#ff9f43] dark:bg-[#ff9f43]/20 dark:text-[#ff9f43] flex items-center justify-center rounded-lg shrink-0">
                <Coins size={18} strokeWidth={2.5} />
              </div>
              <span className="text-xs text-[#a1acb8] dark:text-[#707194] font-semibold">Total</span>
            </div>
            <div className="mt-2.5">
              <span className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] block font-sans">
                Transactions
              </span>
              <div className="flex items-baseline mt-1 font-mono">
                <span className="text-[24px] min-[400px]:text-[28px] md:text-[32px] xl:text-[20px] 2xl:text-[26px] font-bold text-[#222222] dark:text-[#dbdade] tracking-tight leading-none">
                  {totalTransactionsCount}
                </span>
                <span className="text-xs font-sans font-semibold text-[#a1acb8] dark:text-[#707194] uppercase ml-2 leading-none">
                  Écrits
                </span>
              </div>
            </div>
            <div className="mt-1 flex items-center">
              <span className="text-[#4fb922] dark:text-[#71dd37] text-sm font-semibold flex items-center gap-1 font-sans">
                <TrendingUp size={14} strokeWidth={2.5} /> {multiMonthStats.txTrend || '+0%'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Right Section: Large Bento Box (Total Income Line Chart + Report panel) */}
      {showChart && (
        <div
          className={`bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg shadow-xs overflow-hidden md:h-[438px] h-auto grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-[#dbdade]/70 dark:divide-[#434460]/30 text-left ${showSales || showProfit || showCharges ? 'w-full xl:w-[67.45%]' : 'w-full'}`}
        >
          {/* 12-Month Area Line Chart panel */}
          <div className="md:col-span-8 p-5 md:p-6 flex flex-col justify-between select-none">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="space-y-0.5">
                  <h3 className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] tracking-tight">
                    Flux de Trésorerie
                  </h3>
                  <p className="text-[12px] text-[#a1acb8] dark:text-[#707194] font-normal font-sans">
                    Encaissements (Ingrès) vs Décaissements (Dépenses)
                  </p>
                </div>
              </div>

              {/* Area Chart for Cash Flow */}
              <div className="w-full h-[280px] mt-4">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <AreaChart
                    data={multiMonthStats.incomeChartData || []}
                    margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="totalIncomeSneatGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#696CFF" stopOpacity="0.24" />
                        <stop offset="95%" stopColor="#696CFF" stopOpacity="0.005" />
                      </linearGradient>
                      <linearGradient id="expensesSneatGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#03C3EC" stopOpacity="0.24" />
                        <stop offset="95%" stopColor="#03C3EC" stopOpacity="0.005" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="5 5"
                      vertical={false}
                      stroke="currentColor"
                      className="text-[#eceef1]/60 dark:text-[#434460]/35"
                    />
                    <XAxis
                      dataKey="name"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#a1acb8', fontSize: 9.5, fontWeight: 600 }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#a1acb8', fontSize: 9.5, fontWeight: 600 }}
                      tickFormatter={(v) => `${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`}
                    />
                    <Tooltip
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #434460',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: '#2b2c40',
                        color: '#dbdade',
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      height={36}
                      iconType="circle"
                      wrapperStyle={{ fontSize: '12px', fontWeight: 500, color: '#a1acb8' }}
                      onClick={(e) => {
                        if (e.dataKey === 'expenses')
                          setChartTab(chartTab === 'expenses' ? 'all' : 'expenses');
                        if (e.dataKey === 'income')
                          setChartTab(chartTab === 'income' ? 'all' : 'income');
                        if (e.dataKey === 'profit')
                          setChartTab(chartTab === 'profit' ? 'all' : 'profit');
                      }}
                    />

                    {(chartTab === 'all' || chartTab === 'expenses') && (
                      <Area
                        name="Dépenses"
                        type="natural"
                        dataKey="expenses"
                        stroke="#03C3EC"
                        strokeWidth={3}
                        dot={false}
                        fillOpacity={1}
                        fill="url(#expensesSneatGrad)"
                      />
                    )}
                    {(chartTab === 'all' || chartTab === 'income') && (
                      <Area
                        name="Ingrès"
                        type="natural"
                        dataKey="income"
                        stroke="#696CFF"
                        strokeWidth={3}
                        dot={false}
                        fillOpacity={1}
                        fill="url(#totalIncomeSneatGrad)"
                      />
                    )}
                    {(chartTab === 'all' || chartTab === 'profit') && (
                      <Area
                        name="Profit"
                        type="natural"
                        dataKey="profit"
                        stroke="#39da8a"
                        strokeWidth={3}
                        dot={false}
                        fillOpacity={0.1}
                        fill="#39da8a"
                      />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Vertical split list: Report Panel */}
          <div className="md:col-span-4 p-5 md:p-6 flex flex-col justify-between select-none bg-[#fafafb] dark:bg-[#323249]">
            <div>
              <div className="flex items-center justify-between border-b border-[#dbdade]/70 dark:border-[#434460]/40 pb-3 mb-4">
                <div>
                  <h4 className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] tracking-tight">
                    Rapport
                  </h4>
                  <p className="text-[12px] text-[#a1acb8] dark:text-[#707194] font-normal font-sans mt-0.5">
                    Moyenne & Performance
                  </p>
                </div>
              </div>

              <div className="space-y-3.5">
                {/* Income Item */}
                <div
                  onClick={() => setChartTab(chartTab === 'income' ? 'all' : 'income')}
                  className={`flex items-center justify-between gap-2 min-w-0 p-2 -mx-2 rounded-lg cursor-pointer transition-colors ${chartTab === 'income' ? 'bg-[#696cff]/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 text-[#696cff] dark:text-[#b1b4ff] flex items-center justify-center shrink-0">
                      <Wallet size={14} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[12px] font-semibold text-[#a1acb8] dark:text-[#707194] block tracking-wide leading-none font-sans">
                        Revenus (Ingrès)
                      </span>
                      <span className="text-[20px] font-mono font-bold text-[#222222] dark:text-[#dbdade] mt-1 block leading-none truncate">
                        {(multiMonthStats.currentIncome || 0).toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        <span className="text-[11px] font-sans font-bold text-[#a1acb8] dark:text-[#707194] uppercase ml-0.5">
                          DH
                        </span>
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-[9.5px] font-bold font-mono shrink-0 ${multiMonthStats.incomeDiffFormatted?.startsWith('+') ? 'text-[#4fb922] dark:text-[#71dd37]' : 'text-[#ff3e1d]'}`}
                  >
                    {multiMonthStats.incomeDiffFormatted}
                  </span>
                </div>

                {/* Expense Item */}
                <div
                  onClick={() => setChartTab(chartTab === 'expenses' ? 'all' : 'expenses')}
                  className={`flex items-center justify-between gap-2 min-w-0 p-2 -mx-2 rounded-lg cursor-pointer transition-colors ${chartTab === 'expenses' ? 'bg-[#03c3ec]/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 text-[#ff3e1d] flex items-center justify-center shrink-0">
                      <CreditCard size={14} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[12px] font-semibold text-[#a1acb8] dark:text-[#707194] block tracking-wide leading-none font-sans">
                        Dépenses
                      </span>
                      <span className="text-[20px] font-mono font-bold text-[#222222] dark:text-[#dbdade] mt-1 block leading-none truncate">
                        {(multiMonthStats.currentExpenses || 0).toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        <span className="text-[11px] font-sans font-bold text-[#a1acb8] dark:text-[#707194] uppercase ml-0.5">
                          DH
                        </span>
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-[9.5px] font-bold font-mono shrink-0 ${multiMonthStats.expensesDiffFormatted?.startsWith('+') ? 'text-[#ff3e1d]' : 'text-[#4fb922] dark:text-[#71dd37]'}`}
                  >
                    {multiMonthStats.expensesDiffFormatted}
                  </span>
                </div>

                {/* Profit Item */}
                <div
                  onClick={() => setChartTab(chartTab === 'profit' ? 'all' : 'profit')}
                  className={`flex items-center justify-between gap-2 min-w-0 p-2 -mx-2 rounded-lg cursor-pointer transition-colors ${chartTab === 'profit' ? 'bg-[#39da8a]/10' : 'hover:bg-slate-100 dark:hover:bg-slate-800/50'}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 text-[#39da8a] flex items-center justify-center shrink-0">
                      <Coins size={14} />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[12px] font-semibold text-[#a1acb8] dark:text-[#707194] block tracking-wide leading-none font-sans">
                        Bénéfice Net
                      </span>
                      <span className="text-[20px] font-mono font-bold text-[#222222] dark:text-[#dbdade] mt-1 block leading-none truncate">
                        {(multiMonthStats.currentProfit || 0).toLocaleString('fr-FR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{' '}
                        <span className="text-[11px] font-sans font-bold text-[#a1acb8] dark:text-[#707194] uppercase ml-0.5">
                          DH
                        </span>
                      </span>
                    </div>
                  </div>
                  <span
                    className={`text-[9.5px] font-bold font-mono shrink-0 ${multiMonthStats.profitDiffFormatted?.startsWith('+') ? 'text-[#4fb922] dark:text-[#71dd37]' : 'text-[#ff3e1d]'}`}
                  >
                    {multiMonthStats.profitDiffFormatted}
                  </span>
                </div>
              </div>
            </div>

            {/* Underfoot indicator */}
            <div className="pt-3.5 border-t border-[#dbdade]/70 dark:border-[#434460]/40 flex items-center justify-between text-xs text-[#a1acb8] dark:text-[#707194] font-normal leading-none font-sans">
              <span>Performance Recouvrement</span>
              <span className="text-[#696cff] dark:text-[#b1b4ff] font-semibold">
                {(recoveryRate || 100).toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

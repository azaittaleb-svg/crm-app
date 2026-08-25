import React from 'react';
import {
  MoreVertical,
  Laptop,
  Wallet,
  DollarSign,
  ChevronRight,
  CreditCard,
  Building2,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { useNavigate } from 'react-router-dom';

interface FinancialHealthCockpitProps {
  totalPaid: number;
  totalPending: number;
  totalSupplierCredit: number;
  totalAmount: number;
  recoveryRate: number;
  purchasesCount: number;
  totalExpenses: number;
  visibleCurrentMonthExpensesCount: number;
  hijriDate: { monthLong: string; year: string };
  multiMonthStats: {
    expensesSplitChartData: any[];
  };
  balanceStats: {
    walletAmount: string;
    paypalAmount: string;
    chartData: any[];
    growthPercentage: string;
  };
  visibleWidgets?: Record<string, boolean | undefined>;
}

export const FinancialHealthCockpit: React.FC<FinancialHealthCockpitProps> = ({
  totalPaid,
  totalPending,
  totalSupplierCredit,
  totalAmount,
  recoveryRate,
  purchasesCount,
  totalExpenses,
  visibleCurrentMonthExpensesCount,
  hijriDate,
  multiMonthStats,
  balanceStats,
  visibleWidgets = {} as Record<string, boolean | undefined>,
}) => {
  const navigate = useNavigate();

  const showSituation = visibleWidgets.situationFinanciere !== false;
  const showCharges = visibleWidgets.stackedCharges !== false;
  const showBalance = visibleWidgets.balanceWidget !== false;

  return (
    <div className="flex flex-col xl:flex-row gap-4 xl:gap-[25px] w-full items-stretch justify-start">
      {/* Left Column: Situation Financière & Recouvrement */}
      {showSituation && (
        <div
          className={`bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 md:p-6 shadow-xs flex flex-col justify-between text-left select-none ${showCharges || showBalance ? 'xl:w-1/3' : 'w-full'}`}
        >
          <div>
            {/* Header */}
            <div className="flex items-start justify-between border-b border-[#dbdade]/70 dark:border-[#434460]/40 pb-3 mb-4">
              <div>
                <h3 className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] tracking-tight">
                  Situation Financière
                </h3>
                <p className="text-[12px] text-[#a1acb8] dark:text-[#707194] font-normal font-sans mt-0.5">
                  Recouvrement & Solde Engagé
                </p>
              </div>
            </div>

            {/* Total Balance Amount */}
            <div className="flex items-center gap-3 my-4">
              <div className="flex flex-col">
                <span className="text-[28px] font-bold text-[#222222] dark:text-[#dbdade] tracking-tight font-mono leading-none">
                  {totalPaid.toLocaleString('fr-FR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{' '}
                  <span className="text-xs font-sans font-semibold text-[#a1acb8] dark:text-[#707194]">
                    DH
                  </span>
                </span>
                <span className="text-[11.5px] text-[#a1acb8] dark:text-[#707194] font-medium mt-1 font-sans">
                  Total encaissé à ce jour
                </span>
              </div>
            </div>

            {/* 3 Metric Breakdown Bars */}
            <div className="space-y-4 pt-2">
              {/* 1. Trésorerie Encaissée */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center shrink-0">
                    <Wallet size={16} />
                  </div>
                  <div>
                    <span className="font-semibold text-[#566a7f] dark:text-[#dbdade] block">
                      Encaissé (Clients)
                    </span>
                    <span className="text-[11.5px] text-[#a1acb8] dark:text-[#707194] font-normal font-mono">
                      {totalPaid.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </span>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-[#4fb922] dark:text-[#71dd37] uppercase">
                  {recoveryRate.toFixed(0)}%
                </span>
              </div>

              {/* 2. Créances Clients Restantes */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-500 flex items-center justify-center shrink-0">
                    <CreditCard size={16} />
                  </div>
                  <div>
                    <span className="font-semibold text-[#566a7f] dark:text-[#dbdade] block">
                      Créances Restantes
                    </span>
                    <span className="text-[11.5px] text-[#a1acb8] dark:text-[#707194] font-normal font-mono">
                      {totalPending.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </span>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-orange-500 uppercase">
                  À encaisser
                </span>
              </div>

              {/* 3. Dettes Fournisseurs */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-500 flex items-center justify-center shrink-0">
                    <Building2 size={16} />
                  </div>
                  <div>
                    <span className="font-semibold text-[#566a7f] dark:text-[#dbdade] block">
                      Dettes Fournisseurs
                    </span>
                    <span className="text-[11.5px] text-[#a1acb8] dark:text-[#707194] font-normal font-mono">
                      {totalSupplierCredit.toLocaleString('fr-FR', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      DH
                    </span>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-[#ff3e1d] uppercase">
                  Dûs
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Middle Column: Volume Ventes + Factures + Charges & Dépenses */}
      {showCharges && (
        <div
          className={`flex flex-col gap-4 w-full ${showSituation && showBalance ? 'xl:w-1/3' : 'xl:w-1/2'} justify-between`}
        >
          {/* Top Row: Volume & Factures */}
          <div className="grid grid-cols-2 gap-4">
            {/* Ventes Volume */}
            <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-4 shadow-3xs flex flex-col justify-between text-left select-none hover:shadow-2xs transition-all duration-200">
              <div className="flex items-start justify-between">
                <div className="w-8 h-8 text-[#696cff] dark:text-[#b1b4ff] flex items-center justify-center shrink-0">
                  <Laptop size={16} strokeWidth={2.5} />
                </div>
                <span className="text-[10px] font-semibold text-[#4fb922] dark:text-[#71dd37] font-sans">
                  Live
                </span>
              </div>
              <div className="mt-2">
                <span className="text-xs font-semibold text-[#566a7f] dark:text-[#dbdade] block font-sans">
                  Ventes (Volume)
                </span>
                <div className="flex items-baseline gap-1 select-none whitespace-nowrap mt-1 leading-none">
                  <span className="text-lg font-bold text-[#222222] dark:text-[#dbdade] tracking-tight font-mono">
                    {totalAmount.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-xs font-sans font-semibold text-[#a1acb8] dark:text-[#707194]">
                    DH
                  </span>
                </div>
              </div>
            </div>

            {/* Factures Écrits */}
            <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-4 shadow-3xs flex flex-col justify-between text-left select-none hover:shadow-2xs transition-all duration-200">
              <div className="flex items-start justify-between">
                <span className="text-xs font-semibold text-[#566a7f] dark:text-[#dbdade] block font-sans">
                  Factures
                </span>
                <span className="text-[10px] font-semibold text-[#696cff] dark:text-[#b1b4ff] font-sans">
                  Tx
                </span>
              </div>
              <div className="mt-2">
                <span className="text-lg font-bold text-[#222222] dark:text-[#dbdade] tracking-tight leading-none block font-mono">
                  {purchasesCount} Écrits
                </span>
              </div>
              <div className="space-y-1 mt-2">
                <div className="flex items-center justify-between text-[10px] font-semibold text-[#a1acb8] dark:text-[#707194]">
                  <span>Recouvrement</span>
                  <span className="font-mono text-[#222222] dark:text-[#dbdade]">
                    {recoveryRate.toFixed(0)}%
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#696CFF] h-full rounded-full transition-all duration-500 ease-out"
                    style={{ width: `${recoveryRate || 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Card: Charges & Dépenses Stacked Bar */}
          <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 shadow-xs flex flex-col justify-between h-auto min-h-[160px] w-full text-left select-none">
            <div className="flex items-start justify-between border-b border-[#dbdade]/70 dark:border-[#434460]/40 pb-2">
              <h3 className="text-[15px] font-semibold text-[#566a7f] dark:text-[#dbdade] tracking-tight">
                Charges & Dépenses
              </h3>
              <span className="text-[10px] text-[#a1acb8] dark:text-[#707194] font-mono">
                {hijriDate.monthLong} {hijriDate.year} H
              </span>
            </div>

            <div className="flex items-center justify-between gap-4 mt-2">
              <div className="flex flex-col">
                <div className="flex items-baseline gap-1 select-none whitespace-nowrap leading-none">
                  <span className="text-[22px] font-bold text-[#222222] dark:text-[#dbdade] tracking-tight font-mono">
                    {totalExpenses.toLocaleString('fr-FR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                  <span className="text-xs font-sans font-semibold text-[#a1acb8] dark:text-[#707194]">
                    DH
                  </span>
                </div>
                <span className="text-xs text-[#a1acb8] dark:text-[#707194] font-medium mt-1 font-sans">
                  {visibleCurrentMonthExpensesCount} factures / charges du mois
                </span>
              </div>

              {/* Stacked bar simulation */}
              <div className="flex items-end justify-between gap-1.5 h-16 w-32 pt-1 select-none">
                {(multiMonthStats.expensesSplitChartData || []).map((item: any, index: number) => (
                  <div
                    key={index}
                    className="flex-1 flex flex-col justify-end gap-0.5 h-full group/bar relative"
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-[#2b2c40] text-white text-[9px] px-1 rounded opacity-0 group-hover/bar:opacity-100 pointer-events-none transition-opacity font-mono whitespace-nowrap z-30 shadow-xs">
                      {item.label}
                    </div>
                    <div
                      className="w-full bg-[#696CFF] rounded-t-xs transition-all duration-300 shrink-0"
                      style={{ height: `${item.upper || 50}%` }}
                    />
                    <div
                      className="w-full bg-[#ffab00] rounded-b-xs transition-all duration-300 shrink-0"
                      style={{ height: `${item.lower || 50}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right Column: Solde Trésorerie & Zakat */}
      {showBalance && (
        <div
          className={`bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 md:p-6 shadow-xs flex flex-col justify-between w-full ${showSituation && showCharges ? 'xl:w-1/3' : 'xl:w-1/2'} text-left select-none`}
        >
          <div>
            <div className="flex items-start justify-between border-b border-[#dbdade]/70 dark:border-[#434460]/40 pb-3 mb-4">
              <div>
                <h3 className="text-[16px] font-semibold text-[#566a7f] dark:text-[#dbdade] tracking-tight">
                  Solde Trésorerie & Zakat
                </h3>
              </div>
            </div>

            {/* Dual metric items */}
            <div className="grid grid-cols-2 gap-3 mb-4 select-none">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30">
                <div className="w-8 h-8 text-[#ffab00] flex items-center justify-center shrink-0">
                  <Wallet size={16} strokeWidth={2.5} />
                </div>
                <div className="truncate text-left font-sans">
                  <span className="text-base font-bold text-[#222222] dark:text-[#dbdade] tracking-tight font-mono leading-none block">
                    {balanceStats.walletAmount}
                  </span>
                  <span className="text-[11px] text-[#a1acb8] dark:text-[#707194] font-medium leading-none block mt-1">
                    Trésorerie
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-[#434460]/40">
                <div className="w-8 h-8 text-[#696cff] flex items-center justify-center shrink-0">
                  <DollarSign size={16} strokeWidth={2.5} />
                </div>
                <div className="truncate text-left font-sans">
                  <span className="text-base font-bold text-[#222222] dark:text-[#dbdade] tracking-tight font-mono leading-none block">
                    {balanceStats.paypalAmount}
                  </span>
                  <span className="text-[11px] text-[#a1acb8] dark:text-[#707194] font-medium leading-none block mt-1">
                    Fonds Zakat
                  </span>
                </div>
              </div>
            </div>

            {/* Curved wave graph area */}
            <div className="w-full h-[180px] relative">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                <AreaChart
                  data={balanceStats.chartData}
                  margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="balanceSneatGradCockpit" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ffab00" stopOpacity="0.25" />
                      <stop offset="95%" stopColor="#ffab00" stopOpacity="0.005" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="5 5"
                    stroke="#E7E7FF/50"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#A1ACB8', fontSize: 10, fontWeight: 600 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#A1ACB8', fontSize: 10, fontWeight: 600 }}
                    tickFormatter={(v) => `${v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v}`}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid #ffdbb2',
                      fontSize: '11px',
                      fontWeight: 600,
                      backgroundColor: '#ffffff',
                    }}
                    formatter={(v: any) => [
                      `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`,
                      'Solde',
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="#ffab00"
                    strokeWidth={3}
                    dot={{ r: 3, strokeWidth: 2, stroke: '#ffffff', fill: '#ffab00' }}
                    activeDot={{ r: 5, strokeWidth: 0, fill: '#ffab00' }}
                    fillOpacity={1}
                    fill="url(#balanceSneatGradCockpit)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Footer link to Zakat */}
          <div className="border-t border-[#dbdade]/70 dark:border-[#434460]/40 pt-3 mt-2 flex items-center justify-between gap-3 select-none">
            <div className="text-left font-sans">
              <p className="text-[12px] text-[#a1acb8] dark:text-[#707194] font-normal leading-tight">
                Mise à jour Trésorerie en temps réel
              </p>
            </div>
            <button
              onClick={() => navigate('/zakat')}
              className="inline-flex items-center gap-1 text-xs font-semibold text-[#ffab00] hover:text-[#e09700] transition-colors cursor-pointer"
            >
              Calculateur Zakat <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

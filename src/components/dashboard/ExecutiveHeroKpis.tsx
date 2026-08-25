import React from 'react';
import {
  TrendingUp,
  Wallet,
  CreditCard,
  Building2,
  DollarSign,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Sparkles,
} from 'lucide-react';

interface ExecutiveHeroKpisProps {
  timeframe: 'today' | 'week' | 'month' | 'all';
  setTimeframe: (t: 'today' | 'week' | 'month' | 'all') => void;
  totalSales: number;
  localSales: number;
  wooSales: number;
  netProfit: number;
  totalPaid: number;
  recoveryRate: number;
  clientDebt: number;
  supplierDebt: number;
}

export const ExecutiveHeroKpis: React.FC<ExecutiveHeroKpisProps> = ({
  timeframe,
  setTimeframe,
  totalSales,
  localSales,
  wooSales,
  netProfit,
  totalPaid,
  recoveryRate,
  clientDebt,
  supplierDebt,
}) => {
  return (
    <div className="w-full space-y-3.5">
      {/* Top Filter Bar with Timeframe Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-3.5 px-4 md:px-5 shadow-3xs">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#696cff]/10 text-[#696cff] flex items-center justify-center font-bold">
            <Layers size={17} />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-[#435971] dark:text-[#dbdade] leading-none">
              Cockpit d'Exploitation & Trésorerie
            </h2>
            <p className="text-[11.5px] text-[#a1acb8] dark:text-[#707194] mt-1 font-normal">
              Aperçu consolidé des opérations physiques et e-commerce
            </p>
          </div>
        </div>

        {/* Timeframe selector tabs */}
        <div className="flex items-center bg-slate-100 dark:bg-[#202134] p-1 rounded-lg self-start sm:self-center">
          {[
            { id: 'today', label: "Aujourd'hui" },
            { id: 'week', label: '7 Jours' },
            { id: 'month', label: 'Ce Mois' },
            { id: 'all', label: 'Global' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTimeframe(tab.id as any)}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border-0 ${
                timeframe === tab.id
                  ? 'bg-white dark:bg-[#2b2c40] text-[#696cff] dark:text-[#b1b4ff] shadow-3xs font-bold'
                  : 'text-[#566a7f] dark:text-[#a1acb8] hover:text-[#435971]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4 Hero KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 md:gap-4">
        {/* KPI 1: Chiffre d'Affaires Consolidé */}
        <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 shadow-3xs flex flex-col justify-between text-left hover:shadow-2xs transition-all">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#a1acb8]">
                Chiffre d'Affaires
              </span>
              <div className="w-8 h-8 rounded-lg bg-[#696cff]/10 text-[#696cff] dark:text-[#b1b4ff] flex items-center justify-center">
                <DollarSign size={16} strokeWidth={2.5} />
              </div>
            </div>
            <div className="text-[26px] font-mono font-bold text-[#222222] dark:text-[#dbdade] tracking-tight leading-none">
              {totalSales.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-sans font-semibold text-[#a1acb8] dark:text-[#707194] ml-1.5">
                DH
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#434460]/30 flex items-center justify-between text-[11px] text-[#a1acb8] dark:text-[#707194]">
            <span>Magasin: <strong className="font-mono text-[#566a7f] dark:text-slate-300">{localSales.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH</strong></span>
            <span>Woo: <strong className="font-mono text-purple-600 dark:text-purple-400">{wooSales.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH</strong></span>
          </div>
        </div>

        {/* KPI 2: Bénéfice Net Réel */}
        <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 shadow-3xs flex flex-col justify-between text-left hover:shadow-2xs transition-all">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Bénéfice Net Estimé
              </span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <TrendingUp size={16} strokeWidth={2.5} />
              </div>
            </div>
            <div className="text-[26px] font-mono font-bold text-emerald-600 dark:text-emerald-400 tracking-tight leading-none">
              {netProfit >= 0 ? '+' : ''}
              {netProfit.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-sans font-semibold text-emerald-600/70 ml-1.5">
                DH
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#434460]/30 flex items-center justify-between text-[11px] text-emerald-700/80 dark:text-emerald-400/80">
            <span>Marge calculée</span>
            <span className="font-semibold inline-flex items-center gap-0.5">
              <ArrowUpRight size={13} /> Actif
            </span>
          </div>
        </div>

        {/* KPI 3: Trésorerie Encaissée */}
        <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 shadow-3xs flex flex-col justify-between text-left hover:shadow-2xs transition-all">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#a1acb8]">
                Trésorerie Collectée
              </span>
              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Wallet size={16} strokeWidth={2.5} />
              </div>
            </div>
            <div className="text-[26px] font-mono font-bold text-[#222222] dark:text-[#dbdade] tracking-tight leading-none">
              {totalPaid.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-sans font-semibold text-[#a1acb8] dark:text-[#707194] ml-1.5">
                DH
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#434460]/30 flex items-center justify-between text-[11px] text-[#a1acb8] dark:text-[#707194]">
            <span>Taux d'encaissement:</span>
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
              {recoveryRate.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* KPI 4: Créances & Dettes */}
        <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 shadow-3xs flex flex-col justify-between text-left hover:shadow-2xs transition-all">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                Créances Clients
              </span>
              <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 flex items-center justify-center">
                <CreditCard size={16} strokeWidth={2.5} />
              </div>
            </div>
            <div className="text-[26px] font-mono font-bold text-orange-500 tracking-tight leading-none">
              {clientDebt.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-sans font-semibold text-orange-400 ml-1.5">
                DH
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-[#434460]/30 flex items-center justify-between text-[11px]">
            <span className="text-[#a1acb8] dark:text-[#707194]">Dettes Fournisseurs:</span>
            <span className="font-mono font-bold text-rose-500">
              {supplierDebt.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

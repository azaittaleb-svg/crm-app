import React from 'react';
import { ShoppingCart, TrendingUp, Calendar, Wallet, ShoppingBag, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

interface WooProfitStats {
  todayProfit: number;
  monthProfit: number;
  todaySales: number;
  monthSales: number;
  todayCompletedCount: number;
  monthCompletedCount: number;
}

interface WooCommerceOverviewCardProps {
  stats: WooProfitStats;
}

export const WooCommerceOverviewCard: React.FC<WooCommerceOverviewCardProps> = ({ stats }) => {
  const safeStats = stats || {
    todayProfit: 0,
    monthProfit: 0,
    todaySales: 0,
    monthSales: 0,
    todayCompletedCount: 0,
    monthCompletedCount: 0,
  };

  return (
    <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 md:p-6 shadow-3xs text-left w-full transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-slate-100 dark:border-[#434460]/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <ShoppingCart size={20} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#435971] dark:text-[#dbdade] flex items-center gap-2">
              Rendement & Bénéfices WooCommerce
              <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300 border border-purple-100 dark:border-purple-800/50">
                Commandes Terminées
              </span>
            </h3>
            <p className="text-xs text-[#a1acb8] dark:text-[#707194]">
              Calcul automatique du bénéfice basé sur le prix de vente et prix d'achat VitPOS
            </p>
          </div>
        </div>
        <Link
          to="/woocommerce"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#696cff] hover:text-[#5f61e6] transition-colors self-start sm:self-center"
        >
          Voir les commandes <ChevronRight size={14} />
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Bénéfice Journée */}
        <div className="bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              Bénéfice Journée
            </span>
            <span className="p-1.5 bg-emerald-100 dark:bg-emerald-800/40 text-emerald-600 dark:text-emerald-300 rounded-md">
              <TrendingUp size={14} />
            </span>
          </div>
          <div>
            <div className="text-2xl font-mono font-extrabold text-emerald-700 dark:text-emerald-300">
              +{(safeStats.todayProfit || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <span className="text-xs font-sans">MAD</span>
            </div>
            <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-1">
              {safeStats.todayCompletedCount || 0} commande{(safeStats.todayCompletedCount || 0) > 1 ? 's' : ''} terminée{(safeStats.todayCompletedCount || 0) > 1 ? 's' : ''} aujourd'hui
            </p>
          </div>
        </div>

        {/* Card 2: Ventes Journée */}
        <div className="bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#a1acb8]">
              Ventes Journée
            </span>
            <span className="p-1.5 bg-slate-200/60 dark:bg-[#323249] text-[#566a7f] dark:text-[#a1acb8] rounded-md">
              <Calendar size={14} />
            </span>
          </div>
          <div>
            <div className="text-xl font-mono font-bold text-[#435971] dark:text-[#dbdade]">
              {(safeStats.todaySales || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <span className="text-xs font-sans">MAD</span>
            </div>
            <p className="text-[11px] text-[#a1acb8] mt-1">
              Chiffre d'affaires réalisé aujourd'hui
            </p>
          </div>
        </div>

        {/* Card 3: Bénéfice du Mois */}
        <div className="bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-800/30 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
              Bénéfice du Mois
            </span>
            <span className="p-1.5 bg-purple-100 dark:bg-purple-800/40 text-purple-600 dark:text-purple-300 rounded-md">
              <Wallet size={14} />
            </span>
          </div>
          <div>
            <div className="text-2xl font-mono font-extrabold text-purple-700 dark:text-purple-300">
              +{(safeStats.monthProfit || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <span className="text-xs font-sans">MAD</span>
            </div>
            <p className="text-[11px] text-purple-600/80 dark:text-purple-400/80 mt-1">
              {safeStats.monthCompletedCount || 0} commande{(safeStats.monthCompletedCount || 0) > 1 ? 's' : ''} terminée{(safeStats.monthCompletedCount || 0) > 1 ? 's' : ''} ce mois
            </p>
          </div>
        </div>

        {/* Card 4: Ventes du Mois */}
        <div className="bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#a1acb8]">
              Ventes du Mois
            </span>
            <span className="p-1.5 bg-slate-200/60 dark:bg-[#323249] text-[#566a7f] dark:text-[#a1acb8] rounded-md">
              <ShoppingBag size={14} />
            </span>
          </div>
          <div>
            <div className="text-xl font-mono font-bold text-[#435971] dark:text-[#dbdade]">
              {(safeStats.monthSales || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <span className="text-xs font-sans">MAD</span>
            </div>
            <p className="text-[11px] text-[#a1acb8] mt-1">
              Total réalisé ce mois-ci
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { ShoppingCart, AlertCircle, CheckCircle2, Clock, Truck, ChevronRight, TrendingUp, Package } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

interface WooCommercePulseCardProps {
  wooOrders: any[];
  isWooLoading: boolean;
  wooProfitStats: {
    todayProfit: number;
    monthProfit: number;
    todaySales: number;
    monthSales: number;
    todayCompletedCount: number;
    monthCompletedCount: number;
  };
}

export const WooCommercePulseCard: React.FC<WooCommercePulseCardProps> = ({
  wooOrders = [],
  isWooLoading,
  wooProfitStats = {
    todayProfit: 0,
    monthProfit: 0,
    todaySales: 0,
    monthSales: 0,
    todayCompletedCount: 0,
    monthCompletedCount: 0
  },
}) => {
  const navigate = useNavigate();

  // Compute status counts & overdue orders (+2 days)
  const completedOrders = wooOrders.filter((o) => o.status === 'completed');
  const processingOrders = wooOrders.filter((o) => o.status === 'processing');
  const pendingOrders = wooOrders.filter((o) => o.status === 'pending' || o.status === 'on-hold');

  const now = new Date();
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  const overdueOrders = wooOrders.filter((o) => {
    if (o.status === 'completed' || o.status === 'cancelled' || o.status === 'refunded' || o.status === 'failed') {
      return false;
    }
    const orderDate = new Date(o.date_created || o.date_created_gmt);
    return now.getTime() - orderDate.getTime() > twoDaysMs;
  });

  const avgOrderValue =
    completedOrders.length > 0
      ? completedOrders.reduce((acc, o) => acc + (parseFloat(o.total) || 0), 0) / completedOrders.length
      : 0;

  return (
    <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 md:p-6 shadow-3xs text-left w-full transition-all">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-100 dark:border-[#434460]/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 flex items-center justify-center shrink-0">
            <ShoppingCart size={20} strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-[#435971] dark:text-[#dbdade]">
                Hub WooCommerce & E-Commerce
              </h3>
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500"></span>
              </span>
            </div>
            <p className="text-xs text-[#a1acb8] dark:text-[#707194]">
              Synchronisation continue et rentabilité des commandes en ligne
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          {overdueOrders.length > 0 && (
            <button
              onClick={() => navigate('/woocommerce-orders')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40 rounded-md text-xs font-bold transition-all cursor-pointer hover:bg-rose-100"
            >
              <AlertCircle size={14} className="animate-pulse text-rose-500" />
              <span>{overdueOrders.length} en retard (+2j)</span>
            </button>
          )}
          <Link
            to="/woocommerce-orders"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[#696cff] hover:text-[#5f61e6] transition-colors"
          >
            Toutes les commandes <ChevronRight size={14} />
          </Link>
        </div>
      </div>

      {/* Main Grid: Status Pills & Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Metric 1: Commandes Terminées */}
        <div
          onClick={() => navigate('/woocommerce-orders')}
          className="bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30 rounded-lg p-4 cursor-pointer hover:border-emerald-300 transition-all flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              Livrées & Terminées
            </span>
            <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2.5">
            <div className="text-2xl font-mono font-bold text-emerald-700 dark:text-emerald-300">
              {completedOrders.length}
            </div>
            <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-1">
              Bénéfice net: <strong className="font-mono">+{(wooProfitStats.monthProfit || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} DH</strong>
            </p>
          </div>
        </div>

        {/* Metric 2: En cours de traitement */}
        <div
          onClick={() => navigate('/woocommerce-orders')}
          className="bg-purple-50/60 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-800/30 rounded-lg p-4 cursor-pointer hover:border-purple-300 transition-all flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-700 dark:text-purple-300">
              En Préparation
            </span>
            <Truck size={16} className="text-purple-600 dark:text-purple-400" />
          </div>
          <div className="mt-2.5">
            <div className="text-2xl font-mono font-bold text-purple-700 dark:text-purple-300">
              {processingOrders.length}
            </div>
            <p className="text-[11px] text-purple-600/80 dark:text-purple-400/80 mt-1">
              À expédier par coursier
            </p>
          </div>
        </div>

        {/* Metric 3: En attente / On-hold */}
        <div
          onClick={() => navigate('/woocommerce-orders')}
          className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-800/30 rounded-lg p-4 cursor-pointer hover:border-amber-300 transition-all flex flex-col justify-between"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              En Attente / Paiement
            </span>
            <Clock size={16} className="text-amber-600 dark:text-amber-400" />
          </div>
          <div className="mt-2.5">
            <div className="text-2xl font-mono font-bold text-amber-700 dark:text-amber-300">
              {pendingOrders.length}
            </div>
            <p className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-1">
              Validation ou paiement requis
            </p>
          </div>
        </div>

        {/* Metric 4: Panier Moyen */}
        <div className="bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg p-4 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#a1acb8]">
              Panier Moyen (AOV)
            </span>
            <Package size={16} className="text-[#566a7f] dark:text-[#a1acb8]" />
          </div>
          <div className="mt-2.5">
            <div className="text-2xl font-mono font-bold text-[#435971] dark:text-[#dbdade]">
              {avgOrderValue.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}{' '}
              <span className="text-xs font-sans font-semibold text-[#a1acb8]">DH</span>
            </div>
            <p className="text-[11px] text-[#a1acb8] mt-1">
              Sur {completedOrders.length} commandes livrées
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

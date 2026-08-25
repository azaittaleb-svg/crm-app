import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useDashboardData } from '../hooks/useDashboardData';
import { ExecutiveHeroKpis } from '../components/dashboard/ExecutiveHeroKpis';
import { WooCommercePulseCard } from '../components/dashboard/WooCommercePulseCard';
import { FinancialFlowMatrix } from '../components/dashboard/FinancialFlowMatrix';
import { OperationsActionDeck } from '../components/dashboard/OperationsActionDeck';
import { calculatePurchaseBalance } from '../utils/balanceUtils';
import { motion } from 'motion/react';
import { Moon } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  getIslamicDate,
  isZakatReminderActive,
  dismissZakatReminderForYear,
  IslamicDateInfo,
} from '../utils/hijriHelper';

export default function HomePage() {
  const { user } = useAuth();
  const [timeframe, setTimeframe] = useState<'today' | 'week' | 'month' | 'all'>('month');

  const {
    clientsMap,
    purchases,
    supplierPurchases,
    creditNotes,
    isLoadingData,
    visibleCurrentMonthExpenses,
    currentMonthPendingExpenses,
    totalAmount,
    totalPaid,
    totalCredit,
    totalSupplierCredit,
    totalExpenses,
    pendingExpensesCount,
    recoveryRate,
    estimatedLiquidCash,
    multiMonthStats,
    recentPurchases,
    creditNotesStats,
    wooOrders,
    isWooLoading,
    wooProfitStats,
  } = useDashboardData() as any;

  const [hijriDate, setHijriDate] = useState<IslamicDateInfo>(getIslamicDate());
  const [zakatReminderActive, setZakatReminderActive] = useState<boolean>(isZakatReminderActive());

  useEffect(() => {
    const handleUpdate = () => {
      setHijriDate(getIslamicDate());
      setZakatReminderActive(isZakatReminderActive());
    };

    window.addEventListener('zakatSimulationChange', handleUpdate);
    return () => {
      window.removeEventListener('zakatSimulationChange', handleUpdate);
    };
  }, []);

  // Filter calculations based on active timeframe
  const timeframeMetrics = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const validPurchases = (purchases || []).filter(
      (p: any) => p.type !== 'devis' && p.status !== 'Annulée' && p.status !== 'Brouillon'
    );

    let filteredPurchases = validPurchases;
    let localSales = 0;
    let localPaid = 0;
    let wooSales = 0;
    let wooProfit = 0;

    if (timeframe === 'today') {
      filteredPurchases = validPurchases.filter((p: any) => {
        const d = p.date?.toDate ? p.date.toDate() : new Date(p.date || 0);
        return d >= startOfToday;
      });
      wooSales = wooProfitStats?.todaySales || 0;
      wooProfit = wooProfitStats?.todayProfit || 0;
    } else if (timeframe === 'week') {
      filteredPurchases = validPurchases.filter((p: any) => {
        const d = p.date?.toDate ? p.date.toDate() : new Date(p.date || 0);
        return d >= sevenDaysAgo;
      });
      wooSales = (wooProfitStats?.monthSales || 0) * 0.35; // Approximation for 7 days
      wooProfit = (wooProfitStats?.monthProfit || 0) * 0.35;
    } else if (timeframe === 'month') {
      filteredPurchases = validPurchases.filter((p: any) => {
        const d = p.date?.toDate ? p.date.toDate() : new Date(p.date || 0);
        return d >= startOfMonth;
      });
      wooSales = wooProfitStats?.monthSales || 0;
      wooProfit = wooProfitStats?.monthProfit || 0;
    } else {
      filteredPurchases = validPurchases;
      wooSales = wooProfitStats?.monthSales || 0;
      wooProfit = wooProfitStats?.monthProfit || 0;
    }

    localSales = filteredPurchases.reduce((acc: number, curr: any) => acc + (Number(curr.total) || 0), 0);
    localPaid = filteredPurchases.reduce((acc: number, curr: any) => {
      const { paid } = calculatePurchaseBalance(curr);
      return acc + paid;
    }, 0);

    const totalSalesConsolidated = localSales + wooSales;
    const computedRecovery = localSales > 0 ? Math.min(100, (localPaid / localSales) * 100) : 100;

    // Approximate margin: 25% gross margin on local sales + exact woo profit - monthly expenses
    const localEstimatedMargin = localSales * 0.22;
    const computedNetProfit = localEstimatedMargin + wooProfit - (timeframe === 'today' ? totalExpenses / 30 : totalExpenses);

    return {
      totalSales: totalSalesConsolidated > 0 ? totalSalesConsolidated : totalAmount,
      localSales: localSales > 0 ? localSales : totalAmount,
      wooSales: wooSales,
      netProfit: computedNetProfit,
      totalPaid: localPaid > 0 ? localPaid : totalPaid,
      recoveryRate: computedRecovery,
    };
  }, [timeframe, purchases, totalAmount, totalPaid, totalExpenses, wooProfitStats]);

  if (isLoadingData) {
    return (
      <div className="flex flex-col min-h-[500px] items-center justify-center space-y-4">
        <div className="w-10 h-10 border-3 border-[#696CFF] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm font-semibold text-[#566a7f] dark:text-[#dbdade]">
          Chargement du cockpit d'exploitation...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 pt-1.5 pb-6 md:pt-2 md:pb-10 font-sans focus:outline-none space-y-4 md:space-y-5">
        {/* Zakat Hijri Annual Reminder Banner */}
        {zakatReminderActive && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200/70 dark:border-amber-900/40 p-4 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-4 text-left shadow-3xs"
          >
            <div className="flex items-start gap-3">
              <div className="text-[#ffab00] shrink-0 mt-0.5">
                <Moon
                  size={18}
                  className="animate-spin text-[#ffab00]"
                  style={{ animationDuration: '8s' }}
                />
              </div>
              <div>
                <h4 className="text-[13px] font-bold text-[#435971] dark:text-[#dbdade]">
                  Rappel Annuel de la Zakat — Enveloppes Actives ({hijriDate.formatted})
                </h4>
                <p className="text-[11.5px] text-[#697a8d] dark:text-[#a3a4cc] leading-normal mt-0.5">
                  Le solde annuel de vos enveloppes d'aide nécessite une révision conformément au
                  20 Mouharram historique.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
              <button
                onClick={() => dismissZakatReminderForYear()}
                className="px-3 py-1.5 text-[10.5px] font-bold text-[#697a8d] dark:text-[#a3a4cc] hover:text-[#435971] dark:text-[#dbdade] transition-colors cursor-pointer border-0 bg-transparent"
              >
                Masquer
              </button>
              <Link
                to="/zakat"
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-extrabold uppercase tracking-wide rounded-md shadow-xs transition-colors"
              >
                Piloter ma Zakat
              </Link>
            </div>
          </motion.div>
        )}

        {/* 1. Executive Hero KPIs & Timeframe Filter */}
        <ExecutiveHeroKpis
          timeframe={timeframe}
          setTimeframe={setTimeframe}
          totalSales={timeframeMetrics.totalSales}
          localSales={timeframeMetrics.localSales}
          wooSales={timeframeMetrics.wooSales}
          netProfit={timeframeMetrics.netProfit}
          totalPaid={timeframeMetrics.totalPaid}
          recoveryRate={timeframeMetrics.recoveryRate}
          clientDebt={totalCredit}
          supplierDebt={totalSupplierCredit}
        />

        {/* 2. Live WooCommerce Hub & Status Pulse */}
        <WooCommercePulseCard
          wooOrders={wooOrders}
          isWooLoading={isWooLoading}
          wooProfitStats={wooProfitStats}
        />

        {/* 3. Consolidated Multi-Month Financial Flow & Expense Matrix */}
        <FinancialFlowMatrix
          multiMonthStats={multiMonthStats}
          totalExpenses={totalExpenses}
          currentMonthPendingExpenses={currentMonthPendingExpenses}
          pendingExpensesCount={pendingExpensesCount}
          estimatedLiquidCash={estimatedLiquidCash}
        />

        {/* 4. Operations Action Deck (Debtor clients, Recent Sales, Credit Notes) */}
        <OperationsActionDeck
          recentPurchases={recentPurchases}
          clientsMap={clientsMap}
          validPurchases={purchases || []}
          creditNotes={creditNotes || []}
          creditNotesStats={creditNotesStats}
        />
      </div>
    </div>
  );
}

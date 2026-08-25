import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sliders } from 'lucide-react';

interface CustomizationPanelProps {
  showConfig: boolean;
  setShowConfig: (show: boolean) => void;
  visibleWidgets: Record<string, boolean>;
  toggleWidget: (key: string) => void;
  widgetOrder: string[];
  moveWidgetUp: (idx: number) => void;
  moveWidgetDown: (idx: number) => void;
}

export function CustomizationPanel({
  showConfig,
  setShowConfig,
  visibleWidgets,
  toggleWidget,
  widgetOrder,
  moveWidgetUp,
  moveWidgetDown,
}: CustomizationPanelProps) {
  const sectionLabels: Record<string, string> = {
    woo_overview: 'Bannière WooCommerce (Bénéfices & Commandes)',
    top_row: 'Ligne 1 : Performance Ventes, Achats Fournisseurs & Retours',
    cashflow_bento: 'Ligne 2 : Grille Bento & Flux de Trésorerie',
    financial_health: 'Ligne 3 : Cockpit Santé Financière, Dépenses & Zakat',
    recent_activity: 'Ligne 4 : Dernières Ventes & Avoirs Récents',
    bottom_row_product_balance: 'Ligne 4 : Dernières Ventes & Avoirs Récents',
  };

  const widgetLabels = [
    { key: 'wooOverview', label: 'Bannière WooCommerce & Bénéfices' },
    { key: 'trophy', label: 'Trophée de Performance Ventes' },
    { key: 'supplierPurchases', label: 'Achats Fournisseurs' },
    { key: 'returnsNotes', label: 'Retours & Avoirs' },
    { key: 'salesCard', label: 'Indicateur Total Ventes' },
    { key: 'profitCard', label: 'Indicateur Marge / Profit' },
    { key: 'chargesCard', label: 'Charges & Dépenses (Jauge)' },
    { key: 'cashflowChart', label: 'Flux de Trésorerie (Graphique)' },
    { key: 'situationFinanciere', label: 'Situation Financière & Créances' },
    { key: 'stackedCharges', label: 'Charges & Factures (Empilé)' },
    { key: 'balanceWidget', label: 'Solde Trésorerie & Zakat' },
    { key: 'recentActivity', label: 'Dernières Ventes & Avoirs' },
  ];

  return (
    <div className="w-full">
      <div className="flex items-center justify-between bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 p-4 rounded-lg shadow-2xs mb-4">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[#696CFF]" />
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 font-sans">
            Personnalisation du Tableau de Bord
          </span>
        </div>
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="px-3 py-1.5 bg-[#696CFF]/10 text-[#696CFF] hover:bg-[#696CFF]/20 text-[11px] font-bold rounded-md transition-colors cursor-pointer border-0"
        >
          {showConfig ? "Fermer l'éditeur" : 'Personnaliser les widgets'}
        </button>
      </div>

      <AnimatePresence>
        {showConfig && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-slate-50 dark:bg-[#202134] border border-slate-200/60 dark:border-slate-700/60 rounded-lg p-5 mb-4 text-left overflow-hidden shadow-2xs"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <h4 className="text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Widgets Visibles
                </h4>
                <div className="space-y-2">
                  {widgetLabels.map((w) => (
                    <label
                      key={w.key}
                      className="flex items-center gap-3 cursor-pointer text-[13px] text-slate-700 dark:text-slate-300 select-none font-sans"
                    >
                      <input
                        type="checkbox"
                        checked={visibleWidgets[w.key] ?? true}
                        onChange={() => toggleWidget(w.key)}
                        className="w-4 h-4 rounded border-slate-300 text-[#696CFF] focus:ring-[#696CFF]"
                      />
                      {w.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2">
                <h4 className="text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                  Ordre des Sections
                </h4>
                <div className="space-y-2">
                  {widgetOrder.map((section, idx) => (
                    <div
                      key={section}
                      className="flex items-center justify-between p-3 bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-slate-700/60 rounded-md shadow-3xs"
                    >
                      <span className="text-[13px] font-semibold text-slate-700 dark:text-[#dbdade] font-sans">
                        {sectionLabels[section] || section}
                      </span>
                      <div className="flex items-center gap-1.5 font-sans">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveWidgetUp(idx)}
                          className="p-1 text-slate-400 hover:text-[#696CFF] disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer text-xs font-bold border-0 bg-transparent"
                        >
                          ↑ Monter
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          disabled={idx === widgetOrder.length - 1}
                          onClick={() => moveWidgetDown(idx)}
                          className="p-1 text-slate-400 hover:text-[#696CFF] disabled:opacity-30 disabled:hover:text-slate-400 cursor-pointer text-xs font-bold border-0 bg-transparent"
                        >
                          ↓ Descendre
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-3 italic font-sans">
                  La réorganisation et l'activation des widgets sont automatiquement enregistrées pour votre prochaine session.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

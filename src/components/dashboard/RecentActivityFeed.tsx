import React from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart, FileText, ChevronRight, User, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface RecentActivityFeedProps {
  recentPurchases: any[];
  clientsMap: Record<string, string>;
  recentCreditNotes: any[];
  creditNotesStats: {
    totalAvoirs: number;
    totalUtilises: number;
    totalDisponibles: number;
  };
}

export const RecentActivityFeed: React.FC<RecentActivityFeedProps> = ({
  recentPurchases,
  clientsMap,
  recentCreditNotes,
  creditNotesStats,
}) => {
  return (
    <div className="flex flex-col xl:flex-row gap-4 xl:gap-[25px] w-full items-stretch justify-start">
      {/* 1. Dernières Ventes / Factures Récentes */}
      <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 md:p-6 shadow-xs flex flex-col justify-between text-left select-none w-full xl:w-7/12">
        <div>
          <div className="flex items-center justify-between border-b border-[#dbdade]/70 dark:border-[#434460]/40 pb-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                <ShoppingCart size={16} />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#566a7f] dark:text-[#dbdade]">
                  Dernières Ventes & Commandes
                </h3>
                <p className="text-[11px] text-[#a1acb8] dark:text-[#707194]">
                  Flux des opérations comptables récentes
                </p>
              </div>
            </div>
            <Link
              to="/clients"
              className="text-xs font-semibold text-[#696cff] hover:text-[#5f61e6] inline-flex items-center gap-1"
            >
              Voir les clients <ChevronRight size={13} />
            </Link>
          </div>

          {recentPurchases && recentPurchases.length > 0 ? (
            <div className="space-y-2.5">
              {recentPurchases.slice(0, 5).map((purchase, idx) => {
                const clientName = clientsMap[purchase.clientId] || 'Client';
                const dateStr = purchase.date
                  ? format(purchase.date.toDate ? purchase.date.toDate() : new Date(purchase.date), 'dd MMM yyyy', { locale: fr })
                  : 'Date inconnue';
                const total = Number(purchase.totalAmount || purchase.total || 0);
                const paid = Number(purchase.paidAmount || 0);
                const isFullPaid = paid >= total && total > 0;
                const isPartiallyPaid = paid > 0 && paid < total;

                return (
                  <div
                    key={(purchase.id || "p") + "_" + idx}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-50/70 dark:bg-[#232333]/50 border border-slate-100 dark:border-[#434460]/20 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-slate-200/70 dark:bg-slate-700 text-[#566a7f] dark:text-[#dbdade] flex items-center justify-center shrink-0 font-bold text-xs">
                        {clientName.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <span className="font-semibold text-[13px] text-[#566a7f] dark:text-[#dbdade] truncate block">
                          {clientName}
                        </span>
                        <span className="text-[11px] text-[#a1acb8] dark:text-[#707194] flex items-center gap-1 mt-0.5">
                          <Calendar size={11} /> {dateStr}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="block font-mono font-bold text-[13.5px] text-[#222222] dark:text-[#dbdade]">
                        {total.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          isFullPaid
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : isPartiallyPaid
                            ? 'text-orange-500'
                            : 'text-rose-500'
                        }`}
                      >
                        {isFullPaid ? 'Payé' : isPartiallyPaid ? 'Partiel' : 'Non payé'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-[#a1acb8]">
              Aucune vente récente enregistrée.
            </div>
          )}
        </div>
      </div>

      {/* 2. Derniers Avoirs & Notes de Crédit */}
      <div className="bg-[#ffffff] dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg p-5 md:p-6 shadow-xs flex flex-col justify-between text-left select-none w-full xl:w-5/12">
        <div>
          <div className="flex items-center justify-between border-b border-[#dbdade]/70 dark:border-[#434460]/40 pb-3 mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <FileText size={16} />
              </div>
              <div>
                <h3 className="text-[15px] font-semibold text-[#566a7f] dark:text-[#dbdade]">
                  Avoirs & Notes de Crédit
                </h3>
                <p className="text-[11px] text-[#a1acb8] dark:text-[#707194]">
                  Solde disponible: <strong className="font-mono text-emerald-600">{(creditNotesStats.totalDisponibles || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH</strong>
                </p>
              </div>
            </div>
            <Link
              to="/credit-notes"
              className="text-xs font-semibold text-[#696cff] hover:text-[#5f61e6] inline-flex items-center gap-1"
            >
              Tous les avoirs <ChevronRight size={13} />
            </Link>
          </div>

          {recentCreditNotes && recentCreditNotes.length > 0 ? (
            <div className="space-y-2.5">
              {recentCreditNotes.slice(0, 5).map((cn, idx) => (
                <div
                  key={(cn.id || "c") + "_" + idx}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-50/70 dark:bg-[#232333]/50 border border-slate-100 dark:border-[#434460]/20"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-[#566a7f] dark:text-[#dbdade]">
                        {cn.refId || 'Avoir'}
                      </span>
                      <span
                        className={`text-[9.5px] px-1.5 py-0.2 rounded font-bold uppercase ${
                          cn.status === 'Validé'
                            ? 'bg-emerald-100/60 text-emerald-700'
                            : cn.status === 'Utilisé'
                            ? 'bg-slate-200 text-slate-700'
                            : 'bg-orange-100/60 text-orange-700'
                        }`}
                      >
                        {cn.status}
                      </span>
                    </div>
                    <span className="text-[11px] text-[#a1acb8] dark:text-[#707194] mt-0.5 block truncate max-w-[180px]">
                      {cn.reason || 'Retour article / ajustement'}
                    </span>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="block font-mono font-bold text-xs text-[#222222] dark:text-[#dbdade]">
                      {(cn.total || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
                    </span>
                    <span className="block text-[10px] text-[#a1acb8] dark:text-[#707194] font-mono">
                      Reste: {((cn.total || 0) - (cn.amountUsed || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-[#a1acb8]">
              Aucun avoir émis pour le moment.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

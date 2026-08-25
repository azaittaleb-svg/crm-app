import React, { useState } from 'react';
import {
  Users,
  CreditCard,
  Receipt,
  ArrowRight,
  ExternalLink,
  Phone,
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  TrendingDown,
  ShoppingBag,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

interface OperationsActionDeckProps {
  recentPurchases: any[];
  clientsMap: Record<string, string>;
  validPurchases: any[];
  creditNotes: any[];
  creditNotesStats: {
    count: number;
    totalAvoirs: number;
    totalUtilises: number;
    totalDisponibles: number;
  };
}

export const OperationsActionDeck: React.FC<OperationsActionDeckProps> = ({
  recentPurchases = [],
  clientsMap = {},
  validPurchases = [],
  creditNotes = [],
  creditNotesStats = {
    count: 0,
    totalAvoirs: 0,
    totalUtilises: 0,
    totalDisponibles: 0
  },
}) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'debtors' | 'sales' | 'creditNotes'>('debtors');

  // Find top debtor clients
  const debtorClients = React.useMemo(() => {
    const clientDebts: Record<string, { name: string; debt: number; purchasesCount: number }> = {};

    validPurchases.forEach((p) => {
      const clientId = p.clientId || 'unknown';
      const clientName = clientsMap[clientId] || p.clientName || 'Client Inconnu';
      const total = Number(p.total) || 0;
      const paid = Number(p.paid) || 0;
      const debt = Math.max(0, total - paid);

      if (debt > 0) {
        if (!clientDebts[clientId]) {
          clientDebts[clientId] = { name: clientName, debt: 0, purchasesCount: 0 };
        }
        clientDebts[clientId].debt += debt;
        clientDebts[clientId].purchasesCount += 1;
      }
    });

    return Object.entries(clientDebts)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 5);
  }, [validPurchases, clientsMap]);

  return (
    <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg shadow-3xs overflow-hidden text-left w-full">
      {/* Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 md:px-6 border-b border-slate-100 dark:border-[#434460]/30 bg-slate-50/50 dark:bg-[#232333]/50">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-[#696cff]/10 text-[#696cff] dark:text-[#b1b4ff] flex items-center justify-center font-bold">
            <Users size={16} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="text-base font-bold text-[#435971] dark:text-[#dbdade]">
              Centre d'Opérations & Comptes
            </h3>
            <p className="text-xs text-[#a1acb8] dark:text-[#707194]">
              Suivi des créances clients, transactions récentes et avoirs en circulation
            </p>
          </div>
        </div>

        {/* Tab buttons */}
        <div className="flex items-center bg-slate-200/70 dark:bg-[#202134] p-1 rounded-lg self-start sm:self-center">
          <button
            onClick={() => setActiveTab('debtors')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border-0 ${
              activeTab === 'debtors'
                ? 'bg-white dark:bg-[#2b2c40] text-orange-600 dark:text-orange-400 shadow-3xs font-bold'
                : 'text-[#566a7f] dark:text-[#a1acb8] hover:text-[#435971]'
            }`}
          >
            Créances à Recouvrer ({debtorClients.length})
          </button>
          <button
            onClick={() => setActiveTab('sales')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border-0 ${
              activeTab === 'sales'
                ? 'bg-white dark:bg-[#2b2c40] text-[#696cff] dark:text-[#b1b4ff] shadow-3xs font-bold'
                : 'text-[#566a7f] dark:text-[#a1acb8] hover:text-[#435971]'
            }`}
          >
            Dernières Ventes
          </button>
          <button
            onClick={() => setActiveTab('creditNotes')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all cursor-pointer border-0 ${
              activeTab === 'creditNotes'
                ? 'bg-white dark:bg-[#2b2c40] text-purple-600 dark:text-purple-400 shadow-3xs font-bold'
                : 'text-[#566a7f] dark:text-[#a1acb8] hover:text-[#435971]'
            }`}
          >
            Avoirs ({creditNotesStats.count})
          </button>
        </div>
      </div>

      {/* Tab 1: Debtors */}
      {activeTab === 'debtors' && (
        <div className="p-0 overflow-x-auto">
          {debtorClients.length === 0 ? (
            <div className="py-10 text-center text-slate-400">
              <CheckCircle2 size={32} className="mx-auto mb-2 text-emerald-500 opacity-60" />
              <p className="text-sm font-semibold">Toutes les créances clients sont recouvrées !</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-[#434460]/30 bg-slate-100/60 dark:bg-[#232333] text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider">
                  <th className="px-5 py-3">Client</th>
                  <th className="px-5 py-3">Factures en suspens</th>
                  <th className="px-5 py-3 text-right">Montant Dû</th>
                  <th className="px-5 py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#434460]/20 text-xs">
                {debtorClients.map((client, idx) => (
                  <tr key={client.id + "_" + idx} className="hover:bg-slate-50/80 dark:hover:bg-[#323249]/40 transition-colors">
                    <td className="px-5 py-3.5 font-bold text-[#435971] dark:text-[#dbdade]">
                      {client.name}
                    </td>
                    <td className="px-5 py-3.5 text-[#697a8d] dark:text-[#a3a4cc]">
                      {client.purchasesCount} transaction{client.purchasesCount > 1 ? 's' : ''} non soldée{client.purchasesCount > 1 ? 's' : ''}
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono font-bold text-orange-500">
                      {client.debt.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                    </td>
                    <td className="px-5 py-3.5 text-center">
                      <button
                        onClick={() => navigate(`/client/${client.id}`)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-[#696cff] hover:bg-[#696cff]/10 rounded-md transition-colors cursor-pointer border-0 bg-transparent"
                      >
                        Consulter <ArrowRight size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 2: Recent Sales */}
      {activeTab === 'sales' && (
        <div className="p-0 overflow-x-auto">
          {recentPurchases.length === 0 ? (
            <div className="py-10 text-center text-slate-400">
              <ShoppingBag size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm font-semibold">Aucune vente enregistrée récemment</p>
            </div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-[#434460]/30 bg-slate-100/60 dark:bg-[#232333] text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider">
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Client</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3 text-right">Encaissé</th>
                  <th className="px-5 py-3 text-center">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#434460]/20 text-xs">
                {recentPurchases.slice(0, 5).map((p, idx) => {
                  const clientName = clientsMap[p.clientId] || p.clientName || 'Comptoir';
                  const isPaid = (p.paid || 0) >= (p.total || 0);
                  const isPartial = (p.paid || 0) > 0 && !isPaid;

                  return (
                    <tr key={p.id + "_" + idx} className="hover:bg-slate-50/80 dark:hover:bg-[#323249]/40 transition-colors">
                      <td className="px-5 py-3.5 text-[#a1acb8] dark:text-[#707194]">
                        {p.date?.toDate
                          ? p.date.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
                          : new Date(p.date || Date.now()).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-5 py-3.5 font-bold text-[#435971] dark:text-[#dbdade]">
                        {clientName}
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono font-bold text-[#435971] dark:text-[#dbdade]">
                        {Number(p.total || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono text-emerald-600 dark:text-emerald-400">
                        {Number(p.paid || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
                      </td>
                      <td className="px-5 py-3.5 text-center font-bold">
                        {isPaid ? (
                          <span className="text-emerald-600 dark:text-emerald-400">Régularisé</span>
                        ) : isPartial ? (
                          <span className="text-orange-500">Partiel</span>
                        ) : (
                          <span className="text-rose-500">Non payé</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tab 3: Credit Notes */}
      {activeTab === 'creditNotes' && (
        <div className="p-5 md:p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3.5 bg-slate-50 dark:bg-[#232333] border border-slate-200/60 dark:border-[#434460]/40 rounded-lg">
              <span className="text-[11px] font-bold text-[#a1acb8] uppercase block">Total Avoirs Émis</span>
              <span className="text-xl font-mono font-bold text-[#435971] dark:text-[#dbdade] mt-1 block">
                {creditNotesStats.totalAvoirs.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
              </span>
            </div>
            <div className="p-3.5 bg-purple-50/60 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-800/30 rounded-lg">
              <span className="text-[11px] font-bold text-purple-600 uppercase block">Avoirs Utilisés</span>
              <span className="text-xl font-mono font-bold text-purple-700 dark:text-purple-300 mt-1 block">
                {creditNotesStats.totalUtilises.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
              </span>
            </div>
            <div className="p-3.5 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-800/30 rounded-lg">
              <span className="text-[11px] font-bold text-emerald-600 uppercase block">Solde Disponible</span>
              <span className="text-xl font-mono font-bold text-emerald-700 dark:text-emerald-300 mt-1 block">
                {creditNotesStats.totalDisponibles.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} DH
              </span>
            </div>
          </div>

          <div className="text-right">
            <Link
              to="/credit-notes"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#696cff] hover:text-[#5f61e6]"
            >
              Accéder au module des Avoirs <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
};

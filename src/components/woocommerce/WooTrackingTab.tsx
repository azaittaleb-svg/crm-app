import React from 'react';
import {
  Truck,
  CheckCircle2,
  MapPin,
  Clock,
  RefreshCw,
  Building2,
  MessageSquare,
  Scale,
  Package,
  ShieldCheck,
  Navigation,
  ChevronUp,
  Plus,
  AlertTriangle,
  ExternalLink,
  FileText,
} from 'lucide-react';
import { analyzeTrackingEvents } from '../../utils/tracking';
import { NotificationTemplateType } from '../../pages/WooCommerceOrdersPage';

interface WooTrackingTabProps {
  trackingLoading: boolean;
  trackingError: string | null;
  trackingData: any[] | null;
  trackingSummary: any | null;
  trackingStep: number;
  trackingDirectUrl: string | null;
  trackingMeta: {
    isFinished?: boolean;
    lastUpdated?: string;
    fromCache?: boolean;
    cacheStatus?: string;
    nextUpdateInMinutes?: number | null;
  } | null;
  customTrackingInput: string;
  showAllTrackingRows: boolean;
  setShowAllTrackingRows: React.Dispatch<React.SetStateAction<boolean>>;
  showRawPaste: boolean;
  setShowRawPaste: React.Dispatch<React.SetStateAction<boolean>>;
  rawPasteText: string;
  setRawPasteText: React.Dispatch<React.SetStateAction<string>>;
  fetchTrackingData: (explicitCode?: string, forceRefresh?: boolean) => Promise<void>;
  handleParseRawTrackingText: () => Promise<void>;
  handleSelectTemplateType: (type: NotificationTemplateType, overrideExtra?: string) => void;
  setModalTab: (tab: 'details' | 'email_avance' | 'tracking') => void;
}

export const WooTrackingTab: React.FC<WooTrackingTabProps> = ({
  trackingLoading,
  trackingError,
  trackingData,
  trackingSummary,
  trackingStep,
  trackingDirectUrl,
  trackingMeta,
  customTrackingInput,
  showAllTrackingRows,
  setShowAllTrackingRows,
  showRawPaste,
  setShowRawPaste,
  rawPasteText,
  setRawPasteText,
  fetchTrackingData,
  handleParseRawTrackingText,
  handleSelectTemplateType,
  setModalTab,
}) => {
  return (
    <div className="flex-1 min-h-0 p-6 overflow-y-auto space-y-4">
      {/* Loading State */}
      {trackingLoading && (
        <div className="p-8 text-center space-y-3 bg-white dark:bg-[#2b2c40] rounded-xl border border-slate-200/60 dark:border-[#434460]/40 shadow-xs">
          <RefreshCw size={28} className="animate-spin text-[#696cff] mx-auto" />
          <p className="text-xs font-semibold text-[#566a7f] dark:text-[#dbdade]">
            Interrogation des serveurs Barid Al-Maghrib en cours...
          </p>
        </div>
      )}

      {/* Error State */}
      {!trackingLoading && trackingError && (
        <div className="p-5 rounded-xl bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200/90 dark:border-amber-800/50 space-y-3 shadow-xs">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-xs">
            <AlertTriangle size={16} className="text-amber-600 shrink-0" />
            <span>Statut du suivi Barid Al-Maghrib</span>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed font-medium">
            {trackingError}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {trackingDirectUrl && (
              <a
                href={trackingDirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 flex-1 min-w-[200px] py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-sm transition-all text-center cursor-pointer"
              >
                <ExternalLink size={15} />
                Ouvrir sur le site Barid.ma
              </a>
            )}
            <button
              type="button"
              onClick={() => setShowRawPaste((prev) => !prev)}
              className="inline-flex items-center justify-center gap-1.5 py-2.5 px-4 rounded-lg bg-white dark:bg-[#2b2c40] hover:bg-slate-50 dark:hover:bg-[#323249] text-[#566a7f] dark:text-[#dbdade] border border-amber-300 dark:border-amber-700/60 font-bold text-xs shadow-2xs transition-all cursor-pointer"
            >
              <FileText size={15} className="text-amber-600" />
              <span>{showRawPaste ? 'Masquer la saisie' : 'Coller le texte du suivi'}</span>
            </button>
          </div>

          {showRawPaste && (
            <div className="pt-2 border-t border-amber-200/70 dark:border-amber-800/40 space-y-2">
              <label className="text-[11px] font-bold text-amber-900 dark:text-amber-200 block">
                Copiez le texte ou le tableau depuis le site Barid et collez-le ici :
              </label>
              <textarea
                value={rawPasteText}
                onChange={(e) => setRawPasteText(e.target.value)}
                placeholder="Exemple: 15/08/2026 14:30 Centre Courrier Casablanca Envoi en cours d'acheminement..."
                rows={3}
                className="w-full p-2.5 text-xs font-mono rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-[#232333] text-[#222222] dark:text-white focus:outline-none focus:border-[#696cff]"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleParseRawTrackingText}
                  disabled={!rawPasteText.trim()}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-[#696cff] hover:bg-[#5f61e6] disabled:opacity-50 text-white transition-colors cursor-pointer shadow-2xs"
                >
                  Analyser & Enregistrer le suivi
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tracking Results - Timeline & Summary */}
      {!trackingLoading && trackingData && trackingData.length > 0 && (
        <div className="space-y-4">
          {/* Current Latest Status Header Card */}
          {(() => {
            const latest = trackingData[0] || {};
            const title = latest.details || latest.libelleEvenement || 'Événement de suivi';
            const location = latest.localisation || latest.evenementLocalisation || '-';
            const dateStr = latest.date || latest.dateEvenement || '-';
            const timeStr = latest.heure || latest.heureEvenement || '';
            const analysis = analyzeTrackingEvents(trackingData || []);
            const isDelivered = analysis.isDelivered;
            const isAgencyPickup = analysis.isAgencyPickup;

            return (
              <>
                <div
                  className={`px-3.5 py-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-3 transition-all ${
                    isDelivered
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/40'
                      : isAgencyPickup
                      ? 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/40'
                      : 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-100 dark:border-indigo-900/40'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isDelivered
                          ? 'bg-emerald-500 text-white'
                          : isAgencyPickup
                          ? 'bg-amber-500 text-white'
                          : 'bg-[#696cff] text-white'
                      }`}
                    >
                      {isDelivered ? (
                        <CheckCircle2 size={16} />
                      ) : isAgencyPickup ? (
                        <MapPin size={16} />
                      ) : (
                        <Truck size={16} />
                      )}
                    </div>
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#a1acb8]">
                          Dernier statut enregistré
                        </span>
                      </div>
                      <h4 className="text-[13px] font-bold text-[#222222] dark:text-white truncate leading-tight">
                        {title}
                      </h4>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#566a7f] dark:text-[#a1acb8]">
                        <span className="inline-flex items-center gap-1 font-medium">
                          <MapPin size={11} className="text-slate-400" />
                          {location}
                        </span>
                        <span className="text-slate-300 dark:text-slate-600">•</span>
                        <span className="inline-flex items-center gap-1 font-mono font-medium">
                          <Clock size={11} className="text-slate-400" />
                          {dateStr} {timeStr ? `à ${timeStr}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap ${
                        isDelivered || trackingMeta?.isFinished
                          ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-100/60 dark:bg-emerald-900/30 border border-emerald-200/60'
                          : isAgencyPickup
                          ? 'text-amber-700 dark:text-amber-300 bg-amber-100/60 dark:bg-amber-900/30 border border-amber-200/60'
                          : 'text-[#696cff] dark:text-indigo-300 bg-[#696cff]/10 dark:bg-indigo-900/30 border border-[#696cff]/20'
                      }`}
                    >
                      {isDelivered || trackingMeta?.isFinished
                        ? '✓ Colis Livré (Terminé)'
                        : isAgencyPickup
                        ? '📍 À récupérer en agence'
                        : 'En cours (Auto 2h)'}
                    </span>

                    <button
                      type="button"
                      onClick={() => fetchTrackingData(undefined, true)}
                      disabled={trackingLoading}
                      title="Actualiser les données depuis les serveurs Barid.ma"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-white dark:bg-[#323249] text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-[#434460] hover:border-[#696cff] dark:hover:border-[#696cff] hover:text-[#696cff] transition-all cursor-pointer shadow-2xs disabled:opacity-50"
                    >
                      <RefreshCw size={11} className={trackingLoading ? 'animate-spin' : ''} />
                      <span>{trackingLoading ? 'Actualisation...' : 'Actualiser'}</span>
                    </button>
                  </div>
                </div>

                {/* Quick 1-Click Agency Notification Banner */}
                {isAgencyPickup && (
                  <div className="p-3 bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-1.5 rounded-md bg-amber-500 text-white shrink-0">
                        <Building2 size={16} />
                      </div>
                      <div className="text-xs text-amber-900 dark:text-amber-200 min-w-0">
                        <span className="font-bold block">Colis en instance à l'agence</span>
                        <span className="text-[11px] text-amber-800/90 dark:text-amber-300/80 truncate block">
                          {location && location !== '-'
                            ? `Agence : ${location}`
                            : 'Prêt pour retrait client'}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleSelectTemplateType(
                          'recuperer_agence',
                          location !== '-' ? location : ''
                        );
                        setModalTab('email_avance');
                      }}
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-2xs transition-colors cursor-pointer shrink-0"
                    >
                      <MessageSquare size={13} />
                      <span>Préparer Notification Client (WhatsApp / E-mail)</span>
                    </button>
                  </div>
                )}
              </>
            );
          })()}

          {/* Summary Cards Grid (Poids, Produit, CRBT, Départ, Arrivée) */}
          {trackingSummary && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="p-2.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-[#434460]/40 flex items-center gap-2.5 shadow-2xs">
                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-[#232333] text-[#566a7f] dark:text-[#dbdade] flex items-center justify-center shrink-0">
                  <Scale size={15} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#a1acb8] block">
                    Poids
                  </span>
                  <span className="text-xs font-bold text-[#222222] dark:text-white font-mono">
                    {trackingSummary.poids || '-'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-[#434460]/40 flex items-center gap-2.5 shadow-2xs">
                <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-[#232333] text-[#566a7f] dark:text-[#dbdade] flex items-center justify-center shrink-0">
                  <Package size={15} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#a1acb8] block">
                    Produit
                  </span>
                  <span className="text-xs font-bold text-[#222222] dark:text-white font-mono">
                    {trackingSummary.produit || '-'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-[#434460]/40 flex items-center gap-2.5 shadow-2xs">
                <div className="w-8 h-8 rounded-lg bg-orange-50 dark:bg-orange-950/40 text-orange-400 flex items-center justify-center shrink-0">
                  <ShieldCheck size={15} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#a1acb8] block">
                    CRBT
                  </span>
                  <span className="text-xs font-bold text-orange-500 font-mono">
                    {trackingSummary.crbt || 'Sans'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-[#434460]/40 flex items-center gap-2.5 shadow-2xs">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-[#696cff] flex items-center justify-center shrink-0">
                  <MapPin size={15} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#a1acb8] block">
                    Départ
                  </span>
                  <span className="text-xs font-bold text-[#222222] dark:text-white truncate block">
                    {trackingSummary.depart || '-'}
                  </span>
                </div>
              </div>

              <div className="p-2.5 bg-white dark:bg-[#2b2c40] rounded-lg border border-slate-200/60 dark:border-[#434460]/40 flex items-center gap-2.5 shadow-2xs">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                  <Navigation size={15} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#a1acb8] block">
                    Arrivée
                  </span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 truncate block">
                    {trackingSummary.arrivee || '-'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* History Timeline */}
          {(() => {
            const hasMoreThan7 = trackingData.length > 7;
            const displayedRows = showAllTrackingRows ? trackingData : trackingData.slice(0, 7);

            return (
              <div className="bg-white dark:bg-[#2b2c40] rounded-xl border border-slate-200/60 dark:border-[#434460]/40 p-4 shadow-2xs space-y-3">
                <div className="relative pl-6 space-y-2.5 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200/70 dark:before:bg-[#434460]/70">
                  {displayedRows.map((item: any, idx: number) => {
                    const isLatest = idx === 0;
                    const title = item.details || item.libelleEvenement || '-';
                    const location = item.localisation || item.evenementLocalisation || '-';
                    const dateStr = item.date || item.dateEvenement || '-';
                    const timeStr = item.heure || item.heureEvenement || '';
                    const isDeliveredStep = /livr[eé]|remis/i.test(title);

                    return (
                      <div key={idx} className="relative group">
                        <div
                          className={`absolute -left-[23px] top-1 w-3.5 h-3.5 rounded-full border-2 transition-all ${
                            isLatest
                              ? isDeliveredStep
                                ? 'bg-emerald-500 border-white ring-3 ring-emerald-500/20'
                                : 'bg-[#696cff] border-white ring-3 ring-[#696cff]/20'
                              : 'bg-white dark:bg-[#323249] border-slate-300 dark:border-[#434460]'
                          }`}
                        />
                        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                          <div className="space-y-0.5">
                            <span
                              className={`text-xs font-semibold block leading-snug ${
                                isLatest
                                  ? 'text-[#222222] dark:text-white font-bold'
                                  : 'text-[#566a7f] dark:text-[#dbdade]'
                              }`}
                            >
                              {title}
                            </span>
                            {location && location !== '-' && (
                              <span className="text-[11px] text-[#a1acb8] flex items-center gap-1 font-medium">
                                <MapPin size={10} className="shrink-0 text-slate-400" />
                                {location}
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] font-mono font-medium text-[#566a7f] dark:text-[#a1acb8] shrink-0">
                            {dateStr} {timeStr ? `à ${timeStr}` : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* View More / View Less Toggle Button */}
                {hasMoreThan7 && (
                  <div className="pt-2 flex justify-center border-t border-slate-100 dark:border-[#383952]">
                    <button
                      type="button"
                      onClick={() => setShowAllTrackingRows((prev) => !prev)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-[#696cff] dark:text-indigo-300 bg-[#696cff]/10 hover:bg-[#696cff]/20 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 border border-[#696cff]/20 transition-all cursor-pointer shadow-2xs"
                    >
                      {showAllTrackingRows ? (
                        <>
                          <ChevronUp size={14} />
                          <span>Réduire l'historique (7 derniers)</span>
                        </>
                      ) : (
                        <>
                          <Plus size={14} />
                          <span>
                            Afficher tout l'historique (+{trackingData.length - 7} événements)
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Empty / Uninitialized state if trackingData is null or empty array */}
      {!trackingLoading && !trackingError && (!trackingData || trackingData.length === 0) && (
        <div className="p-8 text-center space-y-3 bg-white dark:bg-[#2b2c40] rounded-xl border border-slate-200/60 dark:border-[#434460]/40 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-[#696cff]/10 text-[#696cff] flex items-center justify-center mx-auto">
            <Truck size={24} />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-[#222222] dark:text-white">
              Suivi de Colis Barid Al-Maghrib / Amana
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              {customTrackingInput
                ? `Recherche en cours pour le code ${customTrackingInput}...`
                : "Entrez un numéro d'envoi Amana ou Barid (ex: QB230944826MA) ci-dessus pour suivre l'acheminement en direct."}
            </p>
          </div>
          {customTrackingInput && (
            <button
              type="button"
              onClick={() => fetchTrackingData(customTrackingInput, true)}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-[#696cff] hover:bg-[#5f61e6] text-white shadow-sm transition-all cursor-pointer inline-flex items-center gap-2"
            >
              <RefreshCw size={14} />
              <span>Lancer la recherche</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default WooTrackingTab;

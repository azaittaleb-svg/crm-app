import React from 'react';
import {
  Bell,
  History,
  CheckCheck,
  Building2,
  XCircle,
  Truck,
  MessageSquare,
  Mail,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
} from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  NotificationTemplateType,
  hasOrderAvance,
  getOrderFullTotal,
  getReminderSentInfo,
  deleteReminderSent,
  getManualVirementConfirmationInfo,
} from '../../utils/wooProfit';

interface WooNotificationsTabProps {
  activeModalOrder: any;
  emailTemplateType: NotificationTemplateType;
  extraDetailInput: string;
  emailSubjectInput: string;
  emailBodyInput: string;
  emailAvanceAmount: string;
  copiedSubject: boolean;
  copiedBody: boolean;
  copiedRib: boolean;
  sendingDirectEmail: boolean;
  showTemplateText: boolean;
  showSendHistory: boolean;
  setShowSendHistory: React.Dispatch<React.SetStateAction<boolean>>;
  setShowTemplateText: React.Dispatch<React.SetStateAction<boolean>>;
  setEmailSubjectInput: (val: string) => void;
  setEmailBodyInput: (val: string) => void;
  handleSelectTemplateType: (type: NotificationTemplateType, overrideExtra?: string) => void;
  handleExtraDetailChange: (val: string) => void;
  handleChangeAvanceAmount: (val: string) => void;
  handleOpenWhatsApp: () => void;
  handleSendDirectEmail: () => Promise<void>;
  handleCopySubject: () => void;
  handleCopyBody: () => void;
  handleCopyRib: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
  setOrders: React.Dispatch<React.SetStateAction<any[]>>;
}

const channelLabels: Record<string, string> = {
  direct_email: 'E-mail direct (Serveur)',
  mailto: 'Client E-mail local',
  whatsapp: 'WhatsApp Web / App',
};

export const WooNotificationsTab: React.FC<WooNotificationsTabProps> = ({
  activeModalOrder,
  emailTemplateType,
  extraDetailInput,
  emailSubjectInput,
  emailBodyInput,
  emailAvanceAmount,
  copiedSubject,
  copiedBody,
  copiedRib,
  sendingDirectEmail,
  showTemplateText,
  showSendHistory,
  setShowSendHistory,
  setShowTemplateText,
  setEmailSubjectInput,
  setEmailBodyInput,
  handleSelectTemplateType,
  handleExtraDetailChange,
  handleChangeAvanceAmount,
  handleOpenWhatsApp,
  handleSendDirectEmail,
  handleCopySubject,
  handleCopyBody,
  handleCopyRib,
  showToast,
  setOrders,
}) => {
  if (!activeModalOrder) return null;

  const manualInfo = getManualVirementConfirmationInfo(activeModalOrder.id);
  const isConfirmed = !!(manualInfo && manualInfo.isConfirmed);
  const avanceInfo = hasOrderAvance(activeModalOrder);
  const fullTotalInfo = getOrderFullTotal(activeModalOrder);
  const totalOrder =
    fullTotalInfo.fullTotal > 0 ? fullTotalInfo.fullTotal : parseFloat(activeModalOrder.total || '0');
  const reminderInfo = getReminderSentInfo(activeModalOrder.id);
  const emailHistory = reminderInfo?.history || [];

  return (
    <div className="flex-1 min-h-0 p-6 overflow-y-auto space-y-4">
      {/* Card 1: Reminder Status & History */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#232333] border border-slate-200/80 dark:border-[#434460]/60 space-y-2 text-xs">
        {reminderInfo ? (
          <div className="space-y-1.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold">
                <CheckCheck size={16} className="text-emerald-600 shrink-0" />
                <span>
                  Notification déjà transmise :{' '}
                  <span className="font-mono">
                    {format(new Date(reminderInfo.sentAt), 'dd/MM/yyyy à HH:mm', { locale: fr })}
                  </span>{' '}
                  ({channelLabels[reminderInfo.channel] || reminderInfo.channel})
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowSendHistory(!showSendHistory)}
                  className="text-[11px] font-bold text-[#696cff] hover:text-[#5f61e6] hover:underline cursor-pointer flex items-center gap-1"
                >
                  <History size={12} />
                  <span>{showSendHistory ? 'Masquer historique' : 'Voir historique'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteReminderSent(activeModalOrder.id);
                    showToast("Historique d'envoi e-mail réinitialisé", 'info');
                    setOrders((prev) => [...prev]);
                  }}
                  className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 hover:underline cursor-pointer"
                >
                  Réinitialiser
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Bell size={15} className="text-[#696cff]" />
              <span>Aucun envoi par e-mail ou WhatsApp enregistré pour cette commande.</span>
            </div>
          </div>
        )}

        {/* Expandable History Drawer */}
        {showSendHistory && emailHistory.length > 0 && (
          <div className="p-2.5 rounded-lg bg-white dark:bg-[#2b2c40] border border-slate-200/80 dark:border-[#434460]/60 text-xs space-y-1.5 animate-fadeIn mt-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#a1acb8] pb-1 border-b border-slate-100 dark:border-[#434460]/40 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <History size={13} className="text-[#696cff]" />
                Historique des envois e-mail
              </span>
              <span className="font-mono">{emailHistory.length} envoi(s)</span>
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
              {emailHistory
                .slice()
                .reverse()
                .map((item: any, idx: number) => (
                  <div
                    key={item.id || idx}
                    className="flex items-center justify-between p-1.5 rounded bg-slate-50 dark:bg-[#232333] text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          item.templateType === 'confirmation_virement'
                            ? 'bg-emerald-500'
                            : 'bg-purple-500'
                        }`}
                      />
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        {item.templateType === 'confirmation_virement'
                          ? 'Confirmation virement'
                          : "Demande d'avance"}
                      </span>
                      <span className="text-[#a1acb8]">
                        ({channelLabels[item.channel] || item.channel})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="font-bold text-[#696cff] dark:text-[#71dd37]">
                        {item.avanceAmount || '0'} MAD
                      </span>
                      <span className="text-[#a1acb8] text-[10px]">
                        {format(new Date(item.sentAt), 'dd/MM/yyyy HH:mm', { locale: fr })}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>

      {/* Card 2: Template Selection & Dynamic Fields */}
      <div className="p-4 rounded-xl bg-slate-50 dark:bg-[#232333] border border-slate-200/80 dark:border-[#434460]/60 space-y-4">
        {/* Banner if manually confirmed */}
        {isConfirmed && manualInfo && (
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 flex items-center justify-between gap-2 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <span className="text-lg">✅</span>
              <div>
                <span className="font-bold">Virement / Acompte Reçu manuellement : </span>
                <span className="font-mono font-extrabold text-emerald-700 dark:text-emerald-300 text-sm">
                  {manualInfo.amount} MAD
                </span>
                {manualInfo.confirmedAt && (
                  <span className="ml-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                    (le {format(new Date(manualInfo.confirmedAt), 'dd/MM/yyyy à HH:mm', { locale: fr })})
                  </span>
                )}
              </div>
            </div>
            <span className="px-2.5 py-1 text-[10px] font-extrabold uppercase bg-emerald-600 text-white rounded shrink-0">
              CONFIRMÉ
            </span>
          </div>
        )}

        {/* Template Dropdown Selector */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="text-xs font-bold uppercase tracking-wider text-[#566a7f] dark:text-[#a1acb8] flex items-center gap-1.5">
            <Bell size={14} className="text-[#696cff]" />
            <span>Modèle de notification à envoyer</span>
          </label>
          <div className="w-full sm:w-80">
            <select
              value={emailTemplateType}
              onChange={(e) =>
                handleSelectTemplateType(e.target.value as NotificationTemplateType)
              }
              className="w-full px-3 py-2 bg-white dark:bg-[#2b2c40] border border-slate-300 dark:border-[#434460] rounded-lg text-xs font-bold text-[#566a7f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#696cff]/40 cursor-pointer shadow-2xs"
            >
              <option value="demande_avance">📩 1. Demande d'avance / Acompte</option>
              <option value="confirmation_virement">✅ 2. Confirmation de virement reçu</option>
              <option value="commande_expediee">🚚 3. Commande expédiée</option>
              <option value="recuperer_agence">🏪 4. À récupérer à l'agence</option>
              <option value="commande_annulee">❌ 5. Commande annulée</option>
            </select>
          </div>
        </div>

        {/* Dynamic Fields Depending on Selected Template */}
        {(emailTemplateType === 'demande_avance' ||
          emailTemplateType === 'confirmation_virement') && (
          <div className="pt-3 border-t border-slate-200/60 dark:border-[#434460]/40 space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
              {/* Amount Input */}
              <div className="flex items-center gap-2">
                <label className="font-bold text-[#222222] dark:text-[#dbdade] whitespace-nowrap">
                  Montant (MAD) :
                </label>
                <input
                  type="number"
                  step="0.01"
                  disabled={isConfirmed}
                  value={emailAvanceAmount}
                  onChange={(e) => handleChangeAvanceAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-28 px-2.5 py-1 font-mono font-bold border border-slate-300 dark:border-[#434460] rounded-lg bg-white dark:bg-[#2b2c40] text-[#696cff] dark:text-[#71dd37] focus:outline-none focus:ring-2 focus:ring-[#696cff]/40 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {/* Quick Presets */}
                <div className="flex items-center gap-1">
                  {avanceInfo.amount > 0 && (
                    <button
                      type="button"
                      disabled={isConfirmed}
                      onClick={() => handleChangeAvanceAmount(String(avanceInfo.amount))}
                      className={`px-2 py-1 rounded text-[11px] font-mono font-bold border transition-colors ${
                        isConfirmed
                          ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-[#202130] text-slate-400'
                          : parseFloat(emailAvanceAmount) === avanceInfo.amount
                          ? 'bg-purple-600 text-white border-purple-600 cursor-pointer'
                          : 'bg-white text-purple-700 border-purple-300 dark:bg-[#2b2c40] dark:text-purple-300 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/40 cursor-pointer'
                      }`}
                    >
                      Acompte ({avanceInfo.amount.toFixed(2)})
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={isConfirmed}
                    onClick={() => handleChangeAvanceAmount(String(totalOrder))}
                    className={`px-2 py-1 rounded text-[11px] font-mono font-bold border transition-colors ${
                      isConfirmed
                        ? 'opacity-50 cursor-not-allowed bg-slate-100 dark:bg-[#202130] text-slate-400'
                        : parseFloat(emailAvanceAmount) === totalOrder
                        ? 'bg-blue-600 text-white border-blue-600 cursor-pointer'
                        : 'bg-white text-blue-700 border-blue-300 dark:bg-[#2b2c40] dark:text-blue-300 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer'
                    }`}
                  >
                    Total ({totalOrder.toFixed(2)})
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {emailTemplateType === 'commande_expediee' && (
          <div className="pt-3 border-t border-slate-200/60 dark:border-[#434460]/40 space-y-1.5">
            <label className="text-xs font-bold text-[#566a7f] dark:text-[#dbdade] flex items-center gap-1.5">
              <Truck size={14} className="text-blue-600" />
              <span>Nº de suivi ou Nom du transporteur (Facultatif)</span>
            </label>
            <input
              type="text"
              value={extraDetailInput}
              onChange={(e) => handleExtraDetailChange(e.target.value)}
              placeholder="Ex: Cathedis #12345678, Amana, Colis Privé..."
              className="w-full px-3 py-1.5 text-xs border border-slate-300 dark:border-[#434460] rounded-lg bg-white dark:bg-[#2b2c40] text-[#566a7f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#696cff]/40 font-medium"
            />
          </div>
        )}

        {emailTemplateType === 'recuperer_agence' && (
          <div className="pt-3 border-t border-slate-200/60 dark:border-[#434460]/40 space-y-1.5">
            <label className="text-xs font-bold text-[#566a7f] dark:text-[#dbdade] flex items-center gap-1.5">
              <Building2 size={14} className="text-amber-600" />
              <span>Agence / Adresse de retrait (Facultatif)</span>
            </label>
            <input
              type="text"
              value={extraDetailInput}
              onChange={(e) => handleExtraDetailChange(e.target.value)}
              placeholder="Ex: Agence Agdal - Ave Fal Ould Oumeir, Colis #882..."
              className="w-full px-3 py-1.5 text-xs border border-slate-300 dark:border-[#434460] rounded-lg bg-white dark:bg-[#2b2c40] text-[#566a7f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#696cff]/40 font-medium"
            />
          </div>
        )}

        {emailTemplateType === 'commande_annulee' && (
          <div className="pt-3 border-t border-slate-200/60 dark:border-[#434460]/40 space-y-1.5">
            <label className="text-xs font-bold text-[#566a7f] dark:text-[#dbdade] flex items-center gap-1.5">
              <XCircle size={14} className="text-rose-600" />
              <span>Motif d'annulation (Facultatif)</span>
            </label>
            <input
              type="text"
              value={extraDetailInput}
              onChange={(e) => handleExtraDetailChange(e.target.value)}
              placeholder="Ex: Rupture de stock, Demande d'annulation client..."
              className="w-full px-3 py-1.5 text-xs border border-slate-300 dark:border-[#434460] rounded-lg bg-white dark:bg-[#2b2c40] text-[#566a7f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#696cff]/40 font-medium"
            />
          </div>
        )}
      </div>

      {/* Card 3: Direct Actions & Message Preview */}
      <div className="p-4 rounded-xl bg-white dark:bg-[#2b2c40] border border-slate-200/80 dark:border-[#434460]/60 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <span className="text-xs font-bold text-[#566a7f] dark:text-[#a1acb8]">
            2. Actions d'envoi & mise à jour du reçu :
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleOpenWhatsApp}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-colors cursor-pointer"
            >
              <MessageSquare size={14} />
              WhatsApp
            </button>
            <button
              type="button"
              onClick={handleSendDirectEmail}
              disabled={sendingDirectEmail}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold bg-[#696cff] hover:bg-[#5f61e6] disabled:opacity-50 text-white shadow-2xs transition-colors cursor-pointer"
            >
              <Mail size={14} />
              {sendingDirectEmail ? 'Envoi...' : 'Envoyer en direct'}
            </button>
          </div>
        </div>

        {/* Toggle to show/hide template text */}
        <div className="pt-2 border-t border-slate-100 dark:border-[#434460]/40 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowTemplateText(!showTemplateText)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#696cff] hover:text-[#5f61e6] transition-colors cursor-pointer py-1"
          >
            {showTemplateText ? <EyeOff size={14} /> : <Eye size={14} />}
            <span>
              {showTemplateText
                ? 'Masquer le texte du message'
                : 'Voir / Editer le texte du message'}
            </span>
            {showTemplateText ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <span className="text-[11px] text-[#a1acb8]">
            {showTemplateText ? 'Éditable ci-dessous' : 'Prêt pour envoi automatique'}
          </span>
        </div>

        {/* Collapsible Subject & Body Editor */}
        {showTemplateText && (
          <div className="pt-3 space-y-3 border-t border-slate-100 dark:border-[#434460]/40 animate-fadeIn">
            {/* Sujet */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#566a7f] dark:text-[#dbdade]">
                  Objet du message
                </label>
                <button
                  type="button"
                  onClick={handleCopySubject}
                  className="text-[11px] font-semibold text-[#696cff] hover:underline cursor-pointer inline-flex items-center gap-1"
                >
                  {copiedSubject ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copiedSubject ? 'Copié !' : 'Copier l\'objet'}</span>
                </button>
              </div>
              <input
                type="text"
                value={emailSubjectInput}
                onChange={(e) => setEmailSubjectInput(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-[#434460] rounded-lg bg-slate-50/50 dark:bg-[#232333] text-[#566a7f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#696cff]/40 font-medium"
              />
            </div>

            {/* Corps */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#566a7f] dark:text-[#dbdade]">
                  Corps du message
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleCopyRib}
                    className="text-[11px] font-semibold text-[#696cff] hover:underline cursor-pointer inline-flex items-center gap-1"
                  >
                    {copiedRib ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedRib ? 'RIB Copié !' : 'Copier RIB'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyBody}
                    className="text-[11px] font-semibold text-[#696cff] hover:underline cursor-pointer inline-flex items-center gap-1"
                  >
                    {copiedBody ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedBody ? 'Copié !' : 'Copier tout le texte'}</span>
                  </button>
                </div>
              </div>
              <textarea
                rows={6}
                value={emailBodyInput}
                onChange={(e) => setEmailBodyInput(e.target.value)}
                className="w-full p-3 text-xs border border-slate-200 dark:border-[#434460] rounded-lg bg-slate-50/50 dark:bg-[#232333] text-[#566a7f] dark:text-white focus:outline-none focus:ring-2 focus:ring-[#696cff]/40 font-mono leading-relaxed resize-y"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WooNotificationsTab;

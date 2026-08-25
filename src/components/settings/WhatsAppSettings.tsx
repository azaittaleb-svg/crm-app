import React, { useState, useEffect } from 'react';
import { useOpenWA } from '../../hooks/useOpenWA';
import { useNotification } from '../../context/NotificationContext';
import { 
  Server, 
  CheckCircle2, 
  RefreshCw, 
  Copy, 
  LogOut, 
  Send, 
  Loader2, 
  QrCode, 
  MessageSquare,
  Power,
  Key,
  Save,
  Eye,
  EyeOff,
  Check,
  Smartphone,
  Play,
  Square,
  RotateCw,
  AlertCircle,
  Link2,
  Unlink
} from 'lucide-react';

export function WhatsAppSettings() {
  const { 
    config, 
    apiKey,
    isSavingKey,
    saveApiKey,
    isOnline, 
    sessionState, 
    qrCode, 
    loading, 
    error, 
    lastSyncTime, 
    refresh, 
    startSession,
    stopSession,
    restartSession, 
    logoutSession, 
    sendTestMessage 
  } = useOpenWA();

  const { showToast } = useNotification();
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('Bonjour ! Ceci est un test depuis le serveur WhatsApp OpenWA.');
  const [isSending, setIsSending] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [localApiKey, setLocalApiKey] = useState('');

  useEffect(() => {
    setLocalApiKey(apiKey);
  }, [apiKey]);

  const handleCopy = (text: string, fieldName: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    showToast('Copié dans le presse-papier !', 'success');
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleSaveApiKey = async () => {
    const success = await saveApiKey(localApiKey);
    if (success) {
      showToast('Clé API enregistrée avec succès !', 'success');
      refresh();
    } else {
      showToast('Erreur lors de la sauvegarde.', 'error');
    }
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone || !testMessage) {
      showToast('Veuillez renseigner le numéro et le message du test.', 'error');
      return;
    }
    
    setIsSending(true);
    try {
      await sendTestMessage(testPhone, testMessage);
      showToast('Message de test envoyé avec succès !', 'success');
      setTestPhone('');
    } catch (err: any) {
      showToast(`Erreur d'envoi: ${err.message}`, 'error');
    } finally {
      setIsSending(false);
    }
  };

  const handleAction = async (action: 'start' | 'stop' | 'restart' | 'logout' | 'refresh_qr') => {
    setIsActionLoading(action);
    try {
      let success = false;
      if (action === 'start') {
        success = await startSession();
      } else if (action === 'stop') {
        success = await stopSession();
      } else if (action === 'restart') {
        success = await restartSession();
      } else if (action === 'logout') {
        success = await logoutSession();
      } else if (action === 'refresh_qr') {
        await refresh();
        success = true;
      }

      if (success) {
        const msgs: Record<string, string> = {
          start: 'Demande de démarrage de la session envoyée.',
          stop: 'Session arrêtée.',
          restart: 'Session redémarrée avec succès.',
          logout: 'Session déconnectée.',
          refresh_qr: 'QR code et statut actualisés.'
        };
        showToast(msgs[action] || 'Action exécutée avec succès.', 'success');
      } else {
        showToast(`Échec de l'action (${action}). Vérifiez votre instance.`, 'error');
      }
    } catch (err: any) {
      showToast(`Erreur: ${err.message}`, 'error');
    } finally {
      setIsActionLoading(null);
    }
  };

  const isConnected = isOnline && (sessionState === 'CONNECTED' || sessionState === 'WORKING');
  const isAwaitingQr = isOnline && (sessionState === 'SCAN_QR_CODE' || sessionState === 'UNPAIRED');

  // Status visual mapping adhering to Sneat rules
  const getStatusBadge = () => {
    if (loading) {
      return { 
        label: 'Recherche...', 
        textColor: 'text-slate-500 dark:text-slate-400',
        dotColor: 'bg-slate-400',
        ping: false 
      };
    }
    if (!isOnline) {
      return { 
        label: 'HORS LIGNE', 
        textColor: 'text-rose-500 dark:text-rose-400',
        dotColor: 'bg-rose-500',
        ping: false 
      };
    }
    
    switch (sessionState) {
      case 'CONNECTED':
      case 'WORKING':
        return { 
          label: 'CONNECTÉ', 
          textColor: 'text-[#4fb922] dark:text-[#71dd37]',
          dotColor: 'bg-[#71dd37]',
          ping: true 
        };
      case 'UNAUTHORIZED':
        return { 
          label: 'CLÉ API REQUISE (401)', 
          textColor: 'text-amber-500 dark:text-amber-400',
          dotColor: 'bg-amber-500',
          ping: false 
        };
      case 'SCAN_QR_CODE':
      case 'UNPAIRED':
        return { 
          label: 'ATTENTE QR CODE', 
          textColor: 'text-amber-500 dark:text-amber-400',
          dotColor: 'bg-amber-500',
          ping: true 
        };
      case 'STARTING':
        return { 
          label: 'DÉMARRAGE', 
          textColor: 'text-[#696cff] dark:text-[#b1b4ff]',
          dotColor: 'bg-[#696cff]',
          ping: true 
        };
      default:
        return { 
          label: sessionState, 
          textColor: 'text-slate-600 dark:text-slate-400',
          dotColor: 'bg-slate-400',
          ping: false 
        };
    }
  };

  const badge = getStatusBadge();

  return (
    <div className="space-y-6">
      {/* Top Main Card */}
      <section className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg shadow-2xs overflow-hidden">
        {/* Card Header */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-[#434460]/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800/30 flex items-center justify-center text-emerald-600 dark:text-[#71dd37] shrink-0">
              <MessageSquare size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-[15px] font-semibold text-[#435971] dark:text-[#dbdade]">
                  Passerelle WhatsApp (OpenWA / WAHA)
                </h2>
                {/* Ghost Badge without background per Sneat rules */}
                <div className={`inline-flex items-center gap-1.5 text-xs font-bold ${badge.textColor}`}>
                  <span className="relative flex h-2 w-2">
                    {badge.ping && (
                      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${badge.dotColor} opacity-75`} />
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${badge.dotColor}`} />
                  </span>
                  <span>{badge.label}</span>
                </div>
              </div>
              <p className="text-xs text-[#a1acb8] dark:text-[#707194] mt-0.5 font-sans">
                Dernière vérification : <span className="font-mono text-slate-700 dark:text-slate-300">{lastSyncTime ? lastSyncTime.toLocaleTimeString('fr-FR') : 'Jamais'}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={refresh}
              disabled={loading}
              className="px-3.5 py-2 bg-slate-50 dark:bg-[#32344d] hover:bg-slate-100 dark:hover:bg-[#3a3c5a] text-[#566a7f] dark:text-[#dbdade] font-medium rounded-lg transition-colors flex items-center gap-2 text-xs border border-slate-200/60 dark:border-[#434460]/60 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-[#696cff]' : ''} />
              <span>{loading ? 'Actualisation...' : 'Actualiser le statut'}</span>
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="mx-6 mt-4 p-3.5 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-100 dark:border-rose-900/30 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-medium flex items-center gap-2.5">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Content Split */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Block: Connection State & QR Code (7 cols) */}
          <div className="lg:col-span-7 flex flex-col justify-between border border-slate-100 dark:border-[#434460]/50 rounded-lg p-5 bg-slate-50/40 dark:bg-[#32344d]/20">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#434460]/30 pb-3 mb-4">
              <span className="text-xs font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider">
                État de l'instance
              </span>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                Session : default
              </span>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
              {loading ? (
                <div className="flex flex-col items-center gap-3 py-8">
                  <Loader2 className="animate-spin text-[#696cff] dark:text-[#b1b4ff]" size={32} />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Interrogation du serveur et du tunnel Cloudflare...
                  </p>
                </div>
              ) : !isOnline ? (
                <div className="flex flex-col items-center gap-3 py-6 max-w-md">
                  <div className="w-12 h-12 rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/30 flex items-center justify-center text-rose-500">
                    <Server size={24} />
                  </div>
                  <h4 className="text-sm font-semibold text-[#435971] dark:text-[#dbdade]">
                    Serveur Local Injoignable
                  </h4>
                  <p className="text-xs text-[#a1acb8] dark:text-[#707194] leading-relaxed">
                    Vérifiez que votre instance OpenWA / WAHA est lancée sur votre machine locale et que le tunnel Cloudflare est actif avec la bonne clé API.
                  </p>
                </div>
              ) : isConnected ? (
                <div className="flex flex-col items-center gap-3 py-4 w-full">
                  <div className="w-14 h-14 rounded-full bg-emerald-50/80 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-800/40 flex items-center justify-center text-[#4fb922] dark:text-[#71dd37]">
                    <CheckCircle2 size={30} />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-[#435971] dark:text-[#dbdade]">
                      WhatsApp Connecté & Opérationnel
                    </h4>
                    <p className="text-xs text-[#a1acb8] dark:text-[#707194] mt-0.5 max-w-sm">
                      La passerelle est prête à distribuer vos devis, factures et relances automatiques.
                    </p>
                  </div>
                </div>
              ) : sessionState === 'UNAUTHORIZED' ? (
                <div className="flex flex-col items-center gap-3 py-6 max-w-md">
                  <div className="w-12 h-12 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/30 flex items-center justify-center text-amber-500">
                    <Key size={24} />
                  </div>
                  <h4 className="text-sm font-semibold text-[#435971] dark:text-[#dbdade]">
                    Authentification Requise (401)
                  </h4>
                  <p className="text-xs text-[#a1acb8] dark:text-[#707194] leading-relaxed">
                    Le serveur est joignable mais exige une clé API secrète. Renseignez votre clé API dans le champ ci-contre.
                  </p>
                </div>
              ) : isAwaitingQr ? (
                <div className="flex flex-col items-center gap-3 w-full py-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-[#435971] dark:text-[#dbdade]">
                    <Smartphone size={15} className="text-[#696cff]" />
                    <span>Scannez ce QR Code avec l'application WhatsApp</span>
                  </div>
                  <p className="text-[11px] text-[#a1acb8] dark:text-[#707194]">
                    Menu WhatsApp &gt; Appareils connectés &gt; Connecter un appareil
                  </p>
                  
                  <div className="p-3 bg-white dark:bg-white rounded-lg border border-slate-200/80 shadow-xs">
                    {qrCode ? (
                      qrCode.startsWith('data:image') ? (
                        <img src={qrCode} alt="WhatsApp QR Code" className="w-[180px] h-[180px] rounded-sm" />
                      ) : (
                        <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrCode)}`} alt="QR Code" className="w-[180px] h-[180px]" />
                      )
                    ) : (
                      <div className="w-[180px] h-[180px] flex flex-col items-center justify-center bg-slate-50 text-slate-400 gap-2">
                        <Loader2 className="animate-spin text-[#696cff]" size={22} />
                        <span className="text-[10px] font-mono uppercase tracking-wider">Génération du code...</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 py-6">
                  <QrCode className="text-slate-400" size={36} />
                  <h4 className="text-sm font-semibold text-[#435971] dark:text-[#dbdade]">
                    Statut : {sessionState}
                  </h4>
                  <p className="text-xs text-[#a1acb8] dark:text-[#707194]">En attente d'une action sur la session...</p>
                </div>
              )}
            </div>

            {/* Comprehensive Session Control Action Bar */}
            <div className="pt-4 mt-2 border-t border-slate-100 dark:border-[#434460]/40">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                {/* 1. Bouton Démarrer / Connecter */}
                <button
                  type="button"
                  onClick={() => handleAction('start')}
                  disabled={isActionLoading !== null}
                  className="px-3.5 py-2 bg-[#696cff] hover:bg-[#5f61e6] text-white rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
                  title="Démarrer ou initialiser la session WhatsApp"
                >
                  {isActionLoading === 'start' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
                  <span>{isConnected ? 'Relancer Session' : 'Démarrer / Connecter'}</span>
                </button>

                {/* 2. Bouton Redémarrer */}
                <button
                  type="button"
                  onClick={() => handleAction('restart')}
                  disabled={isActionLoading !== null}
                  className="px-3.5 py-2 bg-white dark:bg-[#2b2c40] hover:bg-slate-50 dark:hover:bg-[#383a54] text-[#566a7f] dark:text-[#dbdade] border border-slate-200/60 dark:border-[#434460] rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs"
                  title="Redémarrer le processus de session"
                >
                  {isActionLoading === 'restart' ? <Loader2 size={13} className="animate-spin text-[#696cff]" /> : <RotateCw size={13} />}
                  <span>Redémarrer</span>
                </button>

                {/* 3. Bouton Régénérer QR Code (si en attente QR ou déconnecté) */}
                {isAwaitingQr && (
                  <button
                    type="button"
                    onClick={() => handleAction('refresh_qr')}
                    disabled={isActionLoading !== null}
                    className="px-3.5 py-2 bg-amber-50/80 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/40 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    title="Forcer la mise à jour du QR Code"
                  >
                    {isActionLoading === 'refresh_qr' ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />}
                    <span>Nouveau QR Code</span>
                  </button>
                )}

                {/* 4. Bouton Déconnecter (Dissocier le compte) */}
                <button
                  type="button"
                  onClick={() => handleAction('logout')}
                  disabled={isActionLoading !== null}
                  className="px-3.5 py-2 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Déconnecter le compte WhatsApp associé"
                >
                  {isActionLoading === 'logout' ? <Loader2 size={13} className="animate-spin" /> : <LogOut size={13} />}
                  <span>Déconnecter</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Block: API Key & Endpoints (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            {/* Clé API */}
            <div className="border border-slate-200/60 dark:border-[#434460] rounded-lg p-4 bg-white dark:bg-[#2b2c40]">
              <div className="flex items-center justify-between mb-2.5">
                <label className="text-xs font-bold text-[#435971] dark:text-[#dbdade] flex items-center gap-1.5">
                  <Key size={14} className="text-amber-500" />
                  <span>Clé API Secrète (X-Api-Key)</span>
                </label>
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="text-xs text-[#a1acb8] hover:text-[#696cff] dark:hover:text-[#b1b4ff] transition-colors flex items-center gap-1 cursor-pointer"
                >
                  {showApiKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  <span>{showApiKey ? 'Masquer' : 'Afficher'}</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={localApiKey}
                  onChange={(e) => setLocalApiKey(e.target.value)}
                  placeholder="Ex: secret_token_xyz"
                  className="flex-1 px-3 py-2 bg-slate-50/70 dark:bg-[#32344d]/50 border border-slate-200/60 dark:border-[#434460] rounded-lg text-xs font-mono text-[#435971] dark:text-[#dbdade] focus:bg-white dark:focus:bg-[#2b2c40] focus:border-[#696cff] dark:focus:border-[#b1b4ff] outline-none transition-all"
                />
                <button
                  onClick={handleSaveApiKey}
                  disabled={isSavingKey}
                  className="px-3.5 py-2 bg-[#696cff] hover:bg-[#5f61e6] text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {isSavingKey ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  <span>Enregistrer</span>
                </button>
              </div>
              <p className="text-[11px] text-[#a1acb8] dark:text-[#707194] mt-2">
                Permet de sécuriser les requêtes HTTP entre ce cockpit et votre passerelle OpenWA.
              </p>
            </div>

            {/* Diagnostics Endpoints */}
            <div className="border border-slate-200/60 dark:border-[#434460] rounded-lg p-4 bg-slate-50/40 dark:bg-[#32344d]/20 space-y-3">
              <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                URLs de Connexion
              </span>

              <div>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                  Tunnel Cloudflare
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg px-2.5 py-1.5 text-[11px] text-[#435971] dark:text-[#dbdade] font-mono truncate select-all">
                    {config?.url || 'Non configuré'}
                  </div>
                  <button
                    onClick={() => handleCopy(config?.url || '', 'url')}
                    disabled={!config?.url}
                    className="p-2 text-slate-400 hover:text-[#696cff] dark:hover:text-[#b1b4ff] bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg transition-colors cursor-pointer disabled:opacity-40 shrink-0"
                    title="Copier l'URL"
                  >
                    {copiedField === 'url' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>

              <div>
                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                  API Base Path
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg px-2.5 py-1.5 text-[11px] text-[#435971] dark:text-[#dbdade] font-mono truncate select-all">
                    {config?.apiBase || 'Non disponible'}
                  </div>
                  <button
                    onClick={() => handleCopy(config?.apiBase || '', 'apiBase')}
                    disabled={!config?.apiBase}
                    className="p-2 text-slate-400 hover:text-[#696cff] dark:hover:text-[#b1b4ff] bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg transition-colors cursor-pointer disabled:opacity-40 shrink-0"
                    title="Copier l'API Base"
                  >
                    {copiedField === 'apiBase' ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Test Message Card */}
      <section className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg shadow-2xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-[#434460]/40 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Send size={16} className="text-[#696cff] dark:text-[#b1b4ff]" />
            <h3 className="text-sm font-semibold text-[#435971] dark:text-[#dbdade]">
              Test d'envoi direct WhatsApp
            </h3>
          </div>
          <span className="text-xs text-[#a1acb8] dark:text-[#707194]">
            Vérification de l'acheminement du message
          </span>
        </div>

        <form onSubmit={handleSendTest} className="p-6 grid grid-cols-1 md:grid-cols-12 gap-5 items-end">
          <div className="md:col-span-4">
            <label className="text-xs font-semibold text-[#435971] dark:text-[#dbdade] mb-1.5 block">
              Numéro de téléphone mobile
            </label>
            <input
              type="text"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="Ex: 0612345678 ou 212612345678"
              disabled={!isConnected}
              className="w-full px-3 py-2 bg-slate-50/70 dark:bg-[#32344d]/50 border border-slate-200/60 dark:border-[#434460] rounded-lg text-xs font-mono text-[#435971] dark:text-[#dbdade] focus:bg-white dark:focus:bg-[#2b2c40] focus:border-[#696cff] dark:focus:border-[#b1b4ff] outline-none transition-all disabled:opacity-50"
            />
          </div>

          <div className="md:col-span-6">
            <label className="text-xs font-semibold text-[#435971] dark:text-[#dbdade] mb-1.5 block">
              Contenu du message
            </label>
            <input
              type="text"
              value={testMessage}
              onChange={(e) => setTestMessage(e.target.value)}
              placeholder="Message de test..."
              disabled={!isConnected}
              className="w-full px-3 py-2 bg-slate-50/70 dark:bg-[#32344d]/50 border border-slate-200/60 dark:border-[#434460] rounded-lg text-xs text-[#435971] dark:text-[#dbdade] focus:bg-white dark:focus:bg-[#2b2c40] focus:border-[#696cff] dark:focus:border-[#b1b4ff] outline-none transition-all disabled:opacity-50"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={!isConnected || isSending || !testPhone}
              className="w-full py-2 bg-[#696cff] hover:bg-[#5f61e6] text-white rounded-lg font-medium text-xs transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed shadow-xs cursor-pointer h-[38px]"
            >
              {isSending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              <span>{isSending ? 'Envoi...' : 'Envoyer'}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

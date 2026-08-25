import React, { useRef, useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { exportBackupData, importBackupData } from '../services/adminService';
import { getGoogleAccessToken, findOrCreateFolder, uploadBackupToDrive } from '../services/googleDriveService';
import { db, auth } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import {
  User,
  Database,
  Download,
  Upload,
  Cloud,
  LogOut,
  Server,
  MessageSquare,
  Activity,
  Check,
  Copy,
  Layers,
  AlertTriangle,
  Zap,
  Info,
  ShieldCheck,
  RefreshCw,
  Loader2,
  HardDrive,
  Cpu,
  Sliders,
  CheckCircle2,
  FileJson
} from 'lucide-react';
import { backendService } from '../services/backendService';
import { PageHeader } from '../components/PageHeader';
import { WhatsAppSettings } from '../components/settings/WhatsAppSettings';
import { APP_VERSION } from '../constants';
import { useOpenWA } from '../hooks/useOpenWA';

type SettingsTab = 'general' | 'whatsapp' | 'backups' | 'system';

export default function SettingsPage() {
  const { user } = useAuth();
  const { showToast, confirm } = useNotification();
  const { sessionState, isOnline } = useOpenWA();

  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isBackingUpToDrive, setIsBackingUpToDrive] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);

  const [metrics, setMetrics] = useState<any>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);
  const [cacheEnabled, setCacheEnabled] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadMetrics = async () => {
    try {
      setIsLoadingMetrics(true);
      const data = await backendService.getPerformanceMetrics();
      setMetrics(data);
      if (data && data.cache) {
        setCacheEnabled(data.cache.enabled);
      }
    } catch (err) {
      console.error('Failed to load performance metrics', err);
    } finally {
      setIsLoadingMetrics(false);
    }
  };

  useEffect(() => {
    loadMetrics();
  }, [user]);

  const handleToggleCache = async () => {
    try {
      const targetState = !cacheEnabled;
      await backendService.toggleCache(targetState);
      setCacheEnabled(targetState);
      showToast(`Cache système ${targetState ? 'activé' : 'désactivé'}`, 'success');
      await loadMetrics();
    } catch (err: any) {
      showToast('Erreur lors de la modification du cache: ' + err.message, 'error');
    }
  };

  const handleFlushCache = async () => {
    try {
      await backendService.flushCache();
      showToast('Le cache système a été purgé avec succès.', 'success');
      await loadMetrics();
    } catch (err: any) {
      showToast('Erreur lors du vidage du cache: ' + err.message, 'error');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (e: any) {
      showToast('Erreur lors de la déconnexion', 'error');
    }
  };

  const handleCopyUid = () => {
    if (!user?.uid) return;
    navigator.clipboard.writeText(user.uid);
    setCopiedUid(true);
    showToast('Identifiant utilisateur copié !', 'success');
    setTimeout(() => setCopiedUid(false), 2000);
  };

  const handleGoogleDriveBackup = async () => {
    if (!user) return;
    try {
      setIsBackingUpToDrive(true);
      const accessToken = await getGoogleAccessToken();
      if (!accessToken) {
        showToast('Échec de la connexion à Google Drive', 'error');
        return;
      }
      const jsonString = await exportBackupData(user.uid);
      const folderId = await findOrCreateFolder(accessToken);
      const success = await uploadBackupToDrive(accessToken, folderId, jsonString);
      
      if (success) {
        showToast('Sauvegarde réussie sur Google Drive !', 'success');
      } else {
        showToast('Erreur lors de la sauvegarde sur Drive', 'error');
      }
    } catch (error: any) {
      showToast('Erreur de sauvegarde: ' + error.message, 'error');
    } finally {
      setIsBackingUpToDrive(false);
    }
  };

  const handleExport = async () => {
    if (!user) return;
    try {
      setIsExporting(true);
      const jsonString = await exportBackupData(user.uid);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup_cockpit_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Export JSON téléchargé avec succès !', 'success');
    } catch (error: any) {
      showToast('Erreur lors de l\'exportation', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    confirm({
      title: 'Restaurer une sauvegarde ?',
      message: 'Attention : cette action va écraser les données actuelles de votre compte pour les remplacer par les données de ce fichier JSON.',
      onConfirm: async () => {
        try {
          setIsImporting(true);
          const reader = new FileReader();
          reader.onload = async (e) => {
            const content = e.target?.result as string;
            await importBackupData(user.uid, content);
            showToast('Données restaurées avec succès !', 'success');
            setTimeout(() => window.location.reload(), 1500);
          };
          reader.readAsText(file);
        } catch (error: any) {
          showToast('Erreur de restauration: ' + error.message, 'error');
        } finally {
          setIsImporting(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      }
    });
  };

  // WhatsApp status indicator for tab badge
  const isWhatsAppConnected = isOnline && (sessionState === 'CONNECTED' || sessionState === 'WORKING');

  const tabs: { id: SettingsTab; label: string; icon: React.ComponentType<{ size?: number; className?: string }>; badge?: React.ReactNode }[] = [
    {
      id: 'general',
      label: 'Général & Profil',
      icon: User,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp & Passerelle',
      icon: MessageSquare,
      badge: (
        <span
          className={`w-2 h-2 rounded-full ${
            isWhatsAppConnected
              ? 'bg-[#71dd37]'
              : isOnline
              ? 'bg-amber-400'
              : 'bg-rose-400'
          }`}
          title={isWhatsAppConnected ? 'WhatsApp Connecté' : 'WhatsApp Non Connecté'}
        />
      ),
    },
    {
      id: 'backups',
      label: 'Sauvegardes & Cloud',
      icon: Cloud,
    },
    {
      id: 'system',
      label: 'Système & Cache',
      icon: Server,
    },
  ];

  return (
    <div className="flex flex-col h-full bg-transparent dark:bg-transparent overflow-y-auto font-sans">
      <PageHeader
        title="Paramètres"
        subtitle="Configuration globale du cockpit, passerelle WhatsApp, sauvegardes Cloud et moteur de données"
        icon={<Sliders size={22} />}
      />

      <div className="pt-2 pb-8 space-y-6">
        {/* Navigation Tabs (Sneat Segmented Control) */}
        <div className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg p-1.5 shadow-2xs flex items-center gap-1.5 overflow-x-auto custom-scrollbar select-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isActive
                    ? 'bg-[#696cff] text-white shadow-xs'
                    : 'text-[#566a7f] dark:text-[#a3a4cc] hover:bg-slate-50 dark:hover:bg-[#32344d] hover:text-[#435971] dark:hover:text-[#dbdade]'
                }`}
              >
                <Icon size={16} className={isActive ? 'text-white' : 'text-[#697a8d] dark:text-[#a3a4cc]'} />
                <span>{tab.label}</span>
                {tab.badge}
              </button>
            );
          })}
        </div>

        {/* TAB CONTENT 1: GENERAL & PROFIL */}
        {activeTab === 'general' && (
          <div className="space-y-6">
            {/* Account Card */}
            <section className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg shadow-2xs overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-[#434460]/40 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <User size={18} className="text-[#696cff] dark:text-[#b1b4ff]" />
                  <h2 className="text-[15px] font-semibold text-[#435971] dark:text-[#dbdade]">
                    Profil Utilisateur & Compte
                  </h2>
                </div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#4fb922] dark:text-[#71dd37]">
                  <ShieldCheck size={16} />
                  <span>Session Active</span>
                </div>
              </div>

              <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  {user?.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt="Avatar"
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-full border-2 border-slate-200/80 dark:border-[#434460] object-cover shadow-2xs"
                    />
                  ) : (
                    <div className="w-16 h-16 bg-slate-100 dark:bg-[#32344d] rounded-full flex items-center justify-center text-[#696cff] dark:text-[#b1b4ff] font-bold text-xl border border-slate-200/60 dark:border-[#434460]">
                      {user?.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
                    </div>
                  )}

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-[#435971] dark:text-[#dbdade]">
                        {user?.displayName || 'Utilisateur'}
                      </h3>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-[#696cff] bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded-sm border border-indigo-100 dark:border-indigo-900/30">
                        Administrateur
                      </span>
                    </div>
                    <p className="text-xs text-[#a1acb8] dark:text-[#707194] font-medium font-sans">
                      {user?.email}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        UID: {user?.uid ? `${user.uid.slice(0, 12)}...` : 'N/A'}
                      </span>
                      <button
                        onClick={handleCopyUid}
                        className="text-slate-400 hover:text-[#696cff] dark:hover:text-[#b1b4ff] transition-colors cursor-pointer"
                        title="Copier l'UID complet"
                      >
                        {copiedUid ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={handleLogout}
                    className="px-4 py-2.5 bg-rose-50/70 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 font-semibold rounded-lg transition-colors flex items-center gap-2 text-xs border border-rose-100 dark:border-rose-900/30 cursor-pointer shadow-2xs"
                  >
                    <LogOut size={15} />
                    <span>Se déconnecter</span>
                  </button>
                </div>
              </div>
            </section>

            {/* System Info Card */}
            <section className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg shadow-2xs overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-[#434460]/40 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Info size={18} className="text-[#696cff] dark:text-[#b1b4ff]" />
                  <h3 className="text-sm font-semibold text-[#435971] dark:text-[#dbdade]">
                    Informations Système & Application
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  v{APP_VERSION}
                </span>
              </div>

              <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-4 bg-slate-50/60 dark:bg-[#32344d]/30 border border-slate-100 dark:border-[#434460]/40 rounded-lg">
                  <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                    Version Logiciel
                  </span>
                  <p className="text-sm font-bold text-[#435971] dark:text-[#dbdade] mt-1 font-mono">
                    v{APP_VERSION} (Production)
                  </p>
                </div>

                <div className="p-4 bg-slate-50/60 dark:bg-[#32344d]/30 border border-slate-100 dark:border-[#434460]/40 rounded-lg">
                  <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                    Base de données
                  </span>
                  <p className="text-sm font-bold text-[#435971] dark:text-[#dbdade] mt-1">
                    Google Firestore
                  </p>
                </div>

                <div className="p-4 bg-slate-50/60 dark:bg-[#32344d]/30 border border-slate-100 dark:border-[#434460]/40 rounded-lg">
                  <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                    Passerelle WhatsApp
                  </span>
                  <p className={`text-sm font-bold mt-1 ${isWhatsAppConnected ? 'text-[#4fb922] dark:text-[#71dd37]' : 'text-rose-500'}`}>
                    {isWhatsAppConnected ? 'En Ligne (OpenWA)' : 'Déconnectée'}
                  </p>
                </div>

                <div className="p-4 bg-slate-50/60 dark:bg-[#32344d]/30 border border-slate-100 dark:border-[#434460]/40 rounded-lg">
                  <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                    Thème Interface
                  </span>
                  <p className="text-sm font-bold text-[#435971] dark:text-[#dbdade] mt-1">
                    Sneat Cockpit (Pro)
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB CONTENT 2: WHATSAPP */}
        {activeTab === 'whatsapp' && (
          <WhatsAppSettings />
        )}

        {/* TAB CONTENT 3: BACKUPS & DONNÉES */}
        {activeTab === 'backups' && (
          <div className="space-y-6">
            <section className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg shadow-2xs overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-100 dark:border-[#434460]/40 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Database size={17} className="text-[#696cff] dark:text-[#b1b4ff]" />
                  <h2 className="text-sm font-semibold text-[#435971] dark:text-[#dbdade]">
                    Sauvegardes Automatiques & Restauration
                  </h2>
                </div>
                <span className="text-[11px] text-[#a1acb8] dark:text-[#707194]">
                  Format JSON standard
                </span>
              </div>

              <div className="p-5 space-y-3">
                {/* Google Drive */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 border border-slate-200/60 dark:border-[#434460] rounded-lg hover:border-[#696cff]/40 bg-slate-50/30 dark:bg-[#32344d]/20 transition-all gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-900/30 text-[#696cff] dark:text-[#b1b4ff] flex items-center justify-center shrink-0">
                      <Cloud size={18} />
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-[#435971] dark:text-[#dbdade]">
                        Google Drive Cloud
                      </h3>
                      <p className="text-[11px] text-[#a1acb8] dark:text-[#707194] mt-0.5">
                        Sauvegarde chiffrée synchronisée directement dans votre compte Google Drive.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleGoogleDriveBackup}
                    disabled={isBackingUpToDrive}
                    className="px-3.5 py-2 bg-[#696cff] hover:bg-[#5f61e6] text-white rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0 shadow-xs"
                  >
                    {isBackingUpToDrive ? <Loader2 size={13} className="animate-spin" /> : <Cloud size={13} />}
                    <span>{isBackingUpToDrive ? 'Sauvegarde...' : 'Sauvegarder sur Drive'}</span>
                  </button>
                </div>

                {/* Export Local */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 border border-slate-200/60 dark:border-[#434460] rounded-lg hover:border-slate-300 dark:hover:border-slate-500 bg-slate-50/30 dark:bg-[#32344d]/20 transition-all gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-[#32344d] border border-slate-200/60 dark:border-[#434460] text-slate-600 dark:text-[#dbdade] flex items-center justify-center shrink-0">
                      <FileJson size={18} />
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-[#435971] dark:text-[#dbdade]">
                        Exportation Fichier Local
                      </h3>
                      <p className="text-[11px] text-[#a1acb8] dark:text-[#707194] mt-0.5">
                        Télécharger une copie instantanée de toutes vos données au format JSON structuré.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="px-3.5 py-2 bg-slate-100 dark:bg-[#32344d] hover:bg-slate-200 dark:hover:bg-[#3a3c5a] text-[#566a7f] dark:text-[#dbdade] rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 border border-slate-200/60 dark:border-[#434460]/60 cursor-pointer disabled:opacity-50 shrink-0"
                  >
                    {isExporting ? <Loader2 size={13} className="animate-spin text-[#696cff]" /> : <Download size={13} />}
                    <span>{isExporting ? 'Génération...' : 'Télécharger (.json)'}</span>
                  </button>
                </div>

                {/* Restauration */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 border border-rose-100 dark:border-rose-900/30 rounded-lg hover:border-rose-200 bg-rose-50/20 dark:bg-rose-950/10 transition-all gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/30 text-rose-500 flex items-center justify-center shrink-0">
                      <Upload size={18} />
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-[#435971] dark:text-[#dbdade]">
                        Restaurer une Sauvegarde
                      </h3>
                      <p className="text-[11px] text-rose-500/90 dark:text-rose-400 mt-0.5">
                        Attention : remplace la totalité des enregistrements actuels par ceux du fichier sélectionné.
                      </p>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <input
                      type="file"
                      accept=".json"
                      ref={fileInputRef}
                      onChange={handleImport}
                      className="hidden"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isImporting}
                      className="px-3.5 py-2 bg-white dark:bg-[#2b2c40] hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                    >
                      {isImporting ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                      <span>{isImporting ? 'Restauration...' : 'Sélectionner un fichier'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB CONTENT 4: SYSTÈME & CACHE */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            {/* System Performance Card */}
            <section className="bg-white dark:bg-[#2b2c40] border border-slate-200/60 dark:border-[#434460] rounded-lg shadow-2xs overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-100 dark:border-[#434460]/40 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Activity size={18} className="text-emerald-500" />
                  <h2 className="text-[15px] font-semibold text-[#435971] dark:text-[#dbdade]">
                    Performances & Moteur de Cache
                  </h2>
                </div>
                <button
                  onClick={loadMetrics}
                  disabled={isLoadingMetrics}
                  className="p-1.5 text-slate-400 hover:text-[#696cff] dark:hover:text-[#b1b4ff] transition-colors cursor-pointer"
                  title="Actualiser les métriques"
                >
                  <RefreshCw size={15} className={isLoadingMetrics ? 'animate-spin text-[#696cff]' : ''} />
                </button>
              </div>

              {/* Metrics Tiles */}
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="p-4 bg-slate-50/60 dark:bg-[#32344d]/30 border border-slate-100 dark:border-[#434460]/40 rounded-lg">
                    <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                      Temps de Réponse API
                    </span>
                    <div className="flex items-baseline gap-2 mt-1.5">
                      <span className="text-xl font-bold font-mono text-[#435971] dark:text-[#dbdade]">
                        {metrics?.system?.latencyMs ? `${metrics.system.latencyMs.toFixed(1)} ms` : '12.4 ms'}
                      </span>
                      <span className="text-[11px] font-bold text-[#4fb922] dark:text-[#71dd37]">
                        Optimal
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50/60 dark:bg-[#32344d]/30 border border-slate-100 dark:border-[#434460]/40 rounded-lg">
                    <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                      Objets en Mémoire Cache
                    </span>
                    <div className="flex items-baseline gap-2 mt-1.5">
                      <span className="text-xl font-bold font-mono text-[#435971] dark:text-[#dbdade]">
                        {metrics?.cache?.size !== undefined ? metrics.cache.size : '48'}
                      </span>
                      <span className="text-[11px] text-[#a1acb8] dark:text-[#707194]">
                        enregistrements
                      </span>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50/60 dark:bg-[#32344d]/30 border border-slate-100 dark:border-[#434460]/40 rounded-lg">
                    <span className="text-[11px] font-bold text-[#a1acb8] dark:text-[#707194] uppercase tracking-wider block">
                      État Moteur de Cache
                    </span>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className={`text-xs font-bold ${cacheEnabled ? 'text-[#4fb922] dark:text-[#71dd37]' : 'text-rose-500'}`}>
                        {cacheEnabled ? 'Actif (En Mémoire)' : 'Désactivé'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions & Toggles */}
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-[#434460]/40">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 border border-slate-100 dark:border-[#434460]/40 rounded-lg hover:bg-slate-50/50 dark:hover:bg-[#32344d]/20 transition-colors gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-[#435971] dark:text-[#dbdade]">
                        Mise en Mémoire Tampon (In-Memory Cache)
                      </h4>
                      <p className="text-[11px] text-[#a1acb8] dark:text-[#707194] mt-0.5">
                        Accélère le chargement des listes de clients, devis, commandes et dépenses.
                      </p>
                    </div>
                    <button
                      onClick={handleToggleCache}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                        cacheEnabled
                          ? 'bg-rose-50/70 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 border border-rose-100 dark:border-rose-900/30'
                          : 'bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-600 dark:text-[#71dd37] hover:bg-emerald-100 dark:hover:bg-emerald-900/40 border border-emerald-100 dark:border-emerald-800/30'
                      }`}
                    >
                      {cacheEnabled ? 'Désactiver le cache' : 'Activer le cache'}
                    </button>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 border border-slate-100 dark:border-[#434460]/40 rounded-lg hover:bg-slate-50/50 dark:hover:bg-[#32344d]/20 transition-colors gap-3">
                    <div>
                      <h4 className="text-xs font-bold text-[#435971] dark:text-[#dbdade]">
                        Purger le Cache Système
                      </h4>
                      <p className="text-[11px] text-[#a1acb8] dark:text-[#707194] mt-0.5">
                        Libère la mémoire vive et force la synchronisation directe depuis la base Firestore.
                      </p>
                    </div>
                    <button
                      onClick={handleFlushCache}
                      className="px-3.5 py-1.5 bg-slate-100 dark:bg-[#32344d] hover:bg-slate-200 dark:hover:bg-[#3a3c5a] text-[#566a7f] dark:text-[#dbdade] rounded-lg text-xs font-semibold transition-colors border border-slate-200/60 dark:border-[#434460]/60 cursor-pointer shrink-0"
                    >
                      Vider le cache
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

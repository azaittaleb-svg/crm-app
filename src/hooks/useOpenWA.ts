import { useState, useEffect, useCallback, useRef } from 'react';
import * as openwaService from '../services/openwaService';
import { useAuth } from '../context/AuthContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

export function useOpenWA() {
  const { user } = useAuth();
  const [config, setConfig] = useState<openwaService.OpenWaConfig | null>(null);
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('openwa_api_key') || '';
    } catch {
      return '';
    }
  });
  const [isSavingKey, setIsSavingKey] = useState<boolean>(false);
  const [isOnline, setIsOnline] = useState<boolean>(false);
  const [sessionState, setSessionState] = useState<string>('UNKNOWN');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Load API Key from Firestore on mount
  useEffect(() => {
    const loadApiKey = async () => {
      if (!user) return;
      try {
        const docRef = doc(db, 'userSettings', user.uid);
        const snap = await getDoc(docRef);
        if (snap.exists() && snap.data().openWaKey) {
          const key = snap.data().openWaKey;
          setApiKey(key);
          try { localStorage.setItem('openwa_api_key', key); } catch {}
        }
      } catch (err) {
        console.error("Erreur chargement clé API:", err);
      }
    };
    loadApiKey();
  }, [user]);

  const saveApiKey = async (newKey: string) => {
    setIsSavingKey(true);
    try {
      try { localStorage.setItem('openwa_api_key', newKey); } catch {}
      if (user) {
        const docRef = doc(db, 'userSettings', user.uid);
        await setDoc(docRef, { openWaKey: newKey }, { merge: true });
      }
      setApiKey(newKey);
      return true;
    } catch (err) {
      console.error("Erreur sauvegarde clé API:", err);
      return false;
    } finally {
      setIsSavingKey(false);
    }
  };

  const fetchStatus = useCallback(async (currentConfig: openwaService.OpenWaConfig, currentApiKey: string) => {
    try {
      // 1. Check if server is reachable
      const isUp = await openwaService.checkServerHealth(currentConfig.apiBase, currentApiKey);
      setIsOnline(isUp);

      if (!isUp) {
        setSessionState('DISCONNECTED');
        setQrCode(null);
        return;
      }

      // 2. Get session status
      const statusRes = await openwaService.getSessionStatus(currentConfig.apiBase, currentApiKey);
      const state = statusRes?.status || 'UNKNOWN';
      setSessionState(state);

      // 3. Get QR Code if waiting for scan
      if (state === 'SCAN_QR_CODE' || state === 'UNPAIRED' || state === 'STARTING') {
        const qr = await openwaService.getQrCode(currentConfig.apiBase, currentApiKey);
        setQrCode(qr);
      } else {
        setQrCode(null);
      }
    } catch (err: any) {
      setIsOnline(false);
      setSessionState('ERROR');
      setQrCode(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const newConfig = await openwaService.getDynamicBaseUrl();
      if (newConfig) {
        setConfig(newConfig);
        setLastSyncTime(new Date(newConfig.updatedAt));
        await fetchStatus(newConfig, apiKey);
      } else {
        setError("Impossible de récupérer l\'URL dynamique depuis JSONBin.");
        setIsOnline(false);
      }
    } catch (err: any) {
      setError(err.message || 'Erreur de synchronisation');
      setIsOnline(false);
    } finally {
      setLoading(false);
    }
  }, [fetchStatus, apiKey]);

  // Initial load once apiKey is loaded (or user is determined)
  useEffect(() => {
    if (user !== undefined) {
      refresh();
    }
  }, [refresh, user]);

  // Polling mechanism
  useEffect(() => {
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
    }

    // Only poll frequently if we are online and waiting for QR scan
    const needsPolling = isOnline && (sessionState === 'SCAN_QR_CODE' || sessionState === 'STARTING');
    
    if (needsPolling && config) {
      pollingTimerRef.current = setInterval(() => {
        fetchStatus(config, apiKey);
      }, 5000); // 5 seconds polling
    }

    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, [isOnline, sessionState, config, fetchStatus, apiKey]);

  const startSession = async () => {
    if (!config) return false;
    const success = await openwaService.startSession(config.apiBase, apiKey);
    if (success) setTimeout(() => refresh(), 2000);
    return success;
  };

  const stopSession = async () => {
    if (!config) return false;
    const success = await openwaService.stopSession(config.apiBase, apiKey);
    if (success) setTimeout(() => refresh(), 2000);
    return success;
  };

  const restartSession = async () => {
    if (!config) return false;
    const success = await openwaService.restartSession(config.apiBase, apiKey);
    if (success) setTimeout(() => refresh(), 2000);
    return success;
  };

  const logoutSession = async () => {
    if (!config) return false;
    const success = await openwaService.logoutSession(config.apiBase, apiKey);
    if (success) setTimeout(() => refresh(), 2000);
    return success;
  };

  const sendTestMessage = async (phone: string, message: string) => {
    if (!config) throw new Error("API non configurée");
    return openwaService.sendTestMessage(config.apiBase, apiKey, phone, message);
  };

  return {
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
  };
}

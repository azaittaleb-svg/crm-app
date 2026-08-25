import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

const TRACKING_MAP_COLLECTION = 'woo_tracking_map';
const TRACKING_RESULTS_COLLECTION = 'woo_tracking_results';
const LOCAL_STORAGE_MAP_KEY = 'wc_order_tracking_map';

export interface TrackingCacheEntry {
  code: string;
  summary: any;
  results: any[];
  currentStep: number;
  isFinished: boolean;
  lastUpdated: string;
  updatedAtMs: number;
}

/**
 * Subscribe in real-time to all order tracking numbers in Firestore
 */
export function subscribeToTrackingMap(
  onUpdate: (map: Record<string, string>) => void,
  onError?: (err: any) => void
) {
  try {
    const colRef = collection(db, TRACKING_MAP_COLLECTION);
    const q = query(colRef);

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const map: Record<string, string> = {};
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          if (data && data.code) {
            map[String(docSnap.id)] = String(data.code).trim().toUpperCase();
          }
        });

        // Update local cache
        try {
          const currentLocal = localStorage.getItem(LOCAL_STORAGE_MAP_KEY);
          const parsed = currentLocal ? JSON.parse(currentLocal) : {};
          const merged = { ...parsed, ...map };
          localStorage.setItem(LOCAL_STORAGE_MAP_KEY, JSON.stringify(merged));
        } catch {}

        onUpdate(map);
      },
      (error) => {
        console.warn('Firestore tracking map subscription warning:', error);
        if (onError) onError(error);
      }
    );

    return unsubscribe;
  } catch (err) {
    console.warn('Could not initialize tracking map subscription:', err);
    return () => {};
  }
}

/**
 * Save tracking number for an order in Firestore + localStorage + server file
 */
export async function saveOrderTracking(orderId: number | string, code: string): Promise<void> {
  const cleanCode = (code || '').trim().toUpperCase();
  const idStr = String(orderId);

  // 1. Update localStorage instantly
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_MAP_KEY);
    const map = raw ? JSON.parse(raw) : {};
    if (cleanCode) {
      map[idStr] = cleanCode;
    } else {
      delete map[idStr];
    }
    localStorage.setItem(LOCAL_STORAGE_MAP_KEY, JSON.stringify(map));
  } catch {}

  // 2. Save in Firestore DB (Real-time sync between Preview and Local)
  try {
    const docRef = doc(db, TRACKING_MAP_COLLECTION, idStr);
    if (cleanCode) {
      await setDoc(
        docRef,
        {
          orderId: idStr,
          code: cleanCode,
          updatedAt: new Date().toISOString(),
          updatedAtMs: Date.now(),
        },
        { merge: true }
      );
    } else {
      await deleteDoc(docRef);
    }
  } catch (err) {
    console.warn('Could not save tracking number to Firestore:', err);
  }

  // 3. Sync to server file fallback
  try {
    await fetch('/api/tracking/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: idStr, code: cleanCode }),
    });
  } catch (err) {
    console.warn('Could not sync tracking to backend API:', err);
  }
}

/**
 * Save tracking details / results (events, current step, summary) to Firestore
 */
export async function saveTrackingResultToDb(code: string, entry: TrackingCacheEntry): Promise<void> {
  if (!code) return;
  const cleanCode = code.trim().toUpperCase();

  // LocalStorage cache
  try {
    localStorage.setItem(`wc_track_${cleanCode}`, JSON.stringify(entry));
  } catch {}

  // Firestore DB persistence
  try {
    const docRef = doc(db, TRACKING_RESULTS_COLLECTION, cleanCode);
    await setDoc(
      docRef,
      {
        ...entry,
        code: cleanCode,
        updatedAtMs: entry.updatedAtMs || Date.now(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('Could not save tracking result to Firestore:', err);
  }
}

/**
 * Retrieve cached tracking results from Firestore DB
 */
export async function getTrackingResultFromDb(code: string): Promise<TrackingCacheEntry | null> {
  if (!code) return null;
  const cleanCode = code.trim().toUpperCase();

  try {
    const docRef = doc(db, TRACKING_RESULTS_COLLECTION, cleanCode);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return snap.data() as TrackingCacheEntry;
    }
  } catch (err) {
    console.warn('Could not fetch tracking result from Firestore:', err);
  }
  return null;
}

const INITIAL_KNOWN_MAP: Record<string, string> = {
  '115684': 'QB230944874MA',
  '115803': 'QB230944945MA',
  '115804': 'QB230944931MA',
  '115807': 'QB230944931MA',
  '115814': 'QB230944959MA',
  '115816': 'QB230944962MA',
  '115817': 'QB230944976MA',
  '115818': 'QB236428998MA',
  '115824': 'QB230944993MA',
  '115830': 'QB236428984MA',
  '115841': 'QB230942330MA',
  '115843': 'QB230942391MA',
  '115855': 'QB230942480MA',
  '115856': 'QB230942502MA',
  '115883': 'QB231919774MA',
  '115892': 'QB236425197MA',
  '115897': 'QB231919859MA',
  '116338': 'QB230909869MA',
  '116436': 'QB235304382MA',
  '116437': 'QB235304379MA',
  '116440': 'QB247139294MA',
  '116441': 'QB247139285MA',
};

/**
 * Migrate existing numbers from backend API to Firestore if not present yet
 */
export async function syncExistingTrackingToFirestore(): Promise<void> {
  try {
    let serverMap: Record<string, string> = { ...INITIAL_KNOWN_MAP };
    try {
      const res = await fetch('/api/tracking/map');
      if (res.ok) {
        const json = await res.json();
        if (json && typeof json === 'object') {
          serverMap = { ...serverMap, ...json };
        }
      }
    } catch {}

    const snap = await getDocs(collection(db, TRACKING_MAP_COLLECTION));
    const existingInDb = new Set<string>();
    snap.forEach((d) => existingInDb.add(d.id));

    const promises: Promise<any>[] = [];
    for (const [orderId, code] of Object.entries(serverMap)) {
      if (code && typeof code === 'string' && !existingInDb.has(orderId)) {
        promises.push(
          setDoc(
            doc(db, TRACKING_MAP_COLLECTION, String(orderId)),
            {
              orderId: String(orderId),
              code: code.trim().toUpperCase(),
              updatedAt: new Date().toISOString(),
              updatedAtMs: Date.now(),
            },
            { merge: true }
          )
        );
      }
    }
    if (promises.length > 0) {
      await Promise.all(promises);
      console.log(`Synced ${promises.length} tracking numbers into Firestore DB.`);
    }
  } catch (err) {
    console.warn('Initial tracking sync to Firestore warning:', err);
  }
}

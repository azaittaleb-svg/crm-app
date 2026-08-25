import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import { Loader2, Download, AlertCircle, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';

export default function DownloadAttachmentPage() {
  const { type, clientId, purchaseId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!user || !type || !clientId || !purchaseId) return;

    const fetchAndDownload = async () => {
      try {
        const collectionName = type === 'achat' ? 'suppliers' : 'clients';
        const docRef = doc(db, collectionName, clientId, 'purchases', purchaseId);
        const snap = await getDoc(docRef);

        if (!snap.exists()) {
          setStatus('error');
          setErrorMsg('Document introuvable.');
          return;
        }

        const data = snap.data();

        // Security check
        if (data.ownerId !== user.uid) {
          setStatus('error');
          setErrorMsg('Accès non autorisé.');
          return;
        }

        if (!data.attachmentUrl) {
          setStatus('error');
          setErrorMsg('Aucune pièce jointe trouvée pour cette opération.');
          return;
        }

        // Trigger download
        const link = document.createElement('a');
        link.href = data.attachmentUrl;
        link.download = data.attachmentName || `piece_jointe_${purchaseId}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setStatus('success');
      } catch (err) {
        console.error('Error downloading attachment:', err);
        setStatus('error');
        setErrorMsg('Une erreur est survenue lors du téléchargement.');
      }
    };

    fetchAndDownload();
  }, [user, type, clientId, purchaseId]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#232333] flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-[#2b2c40] p-8 rounded-xl shadow-lg border border-slate-200/60 dark:border-[#434460]/40 max-w-md w-full text-center"
      >
        {status === 'loading' && (
          <div className="flex flex-col items-center">
            <Loader2 size={48} className="text-[#696cff] animate-spin mb-4" />
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">
              Préparation du téléchargement...
            </h2>
            <p className="text-slate-500 dark:text-[#a1acb8]">
              Veuillez patienter pendant la récupération sécurisée de votre document.
            </p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-full flex items-center justify-center mb-4">
              <Download size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">
              Téléchargement lancé !
            </h2>
            <p className="text-slate-500 dark:text-[#a1acb8] mb-6">
              Si le téléchargement ne démarre pas automatiquement, vérifiez les paramètres de votre
              navigateur.
            </p>
            <button
              onClick={() => {
                // Return to the previous page or dashboard
                window.close(); // Try to close tab if it was opened from Excel
                navigate(-1);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-[#dbdade] rounded-lg transition-colors font-semibold"
            >
              <ArrowLeft size={16} />
              Fermer cet onglet
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center">
            <div className="w-16 h-16 bg-rose-100 dark:bg-rose-900/30 text-rose-600 rounded-full flex items-center justify-center mb-4">
              <AlertCircle size={32} />
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-2">Erreur</h2>
            <p className="text-rose-500 mb-6">{errorMsg}</p>
            <button
              onClick={() => {
                window.close();
                navigate(-1);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-[#dbdade] rounded-lg transition-colors font-semibold"
            >
              <ArrowLeft size={16} />
              Fermer cet onglet
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}

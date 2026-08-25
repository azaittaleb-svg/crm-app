import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import { doc, getDoc, deleteDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { creditNoteService } from '../services/creditNoteService';
import { backendService } from '../services/backendService';
import { generatePDF, getPDFBase64 } from '../utils/pdfGenerator';
import { CreditNote } from '../types/creditNote';
import { ArrowLeft, Printer, CheckCircle2, XCircle, Mail, X, FileText, AlertCircle, Trash2, FileX } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { COMPANY_INFO } from '../constants';
import { convertNumberToFrenchWords } from '../utils/numberToWords';

export default function CreditNoteDetailsPage() {
  const { clientId, creditNoteId } = useParams<{ clientId: string; creditNoteId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast, confirm } = useNotification();

  const [creditNote, setCreditNote] = useState<CreditNote | null>(null);
  const [client, setClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [validating, setValidating] = useState(false);

  // Email modal state
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    async function fetchNote() {
      if (!clientId || !creditNoteId) return;
      try {
        const docRef = doc(db, 'clients', clientId, 'credit_notes', creditNoteId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          setCreditNote({
            id: snap.id,
            ...data,
            date: data.date?.toDate ? data.date.toDate() : new Date(data.date),
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : new Date(),
          } as CreditNote);
        }

        const clientRef = doc(db, 'clients', clientId);
        const clientSnap = await getDoc(clientRef);
        if (clientSnap.exists()) {
          setClient({ id: clientSnap.id, ...clientSnap.data() });
        }
      } catch (e) {
        console.error(e);
        showToast('Erreur lors du chargement', 'error');
      } finally {
        setLoading(false);
      }
    }
    fetchNote();
  }, [clientId, creditNoteId]);

  const handleValidate = async () => {
    if (!clientId || !creditNoteId) return;
    confirm({
      title: 'Valider l\'avoir',
      message: 'Voulez-vous vraiment valider cet avoir ? Cette action est irréversible.',
      onConfirm: async () => {
        try {
          setValidating(true);
          await creditNoteService.validateCreditNote(clientId, creditNoteId);
          showToast('Avoir validé avec succès', 'success');
          // Reload
          const docRef = doc(db, 'clients', clientId, 'credit_notes', creditNoteId);
          const snap = await getDoc(docRef);
          if (snap.exists()) {
            const data = snap.data();
            setCreditNote(prev => prev ? {
              ...prev,
              status: data.status,
              refId: data.refId,
            } : null);
          }
        } catch (e: any) {
          console.error(e);
          showToast(e.message || 'Erreur lors de la validation', 'error');
        } finally {
          setValidating(false);
        }
      }
    });
  };

  const handleCancel = async () => {
    if (!clientId || !creditNoteId) return;
    confirm({
      title: 'Annuler l\'avoir',
      message: 'Voulez-vous annuler cet avoir ?',
      onConfirm: async () => {
        try {
          await creditNoteService.cancelCreditNote(clientId, creditNoteId);
          showToast('Avoir annulé', 'success');
          setCreditNote(prev => prev ? { ...prev, status: 'Annulé' } : null);
        } catch (e: any) {
          console.error(e);
          showToast(e.message || 'Erreur', 'error');
        }
      }
    });
  };

  const handleDelete = async () => {
    if (!clientId || !creditNoteId) return;
    confirm({
      title: 'Supprimer l\'avoir',
      message: 'Voulez-vous vraiment supprimer cet avoir définitivement ?',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'clients', clientId, 'credit_notes', creditNoteId));
          showToast('Avoir supprimé avec succès', 'success');
          navigate('/credit-notes');
        } catch (error) {
          console.error('Error deleting credit note:', error);
          showToast('Erreur lors de la suppression', 'error');
        }
      }
    });
  };

  const handleExportPDF = () => {
    const targetId = 'pdf-export-hidden';
    const element = document.getElementById(targetId);
    if (!element) return;

    generatePDF(element, {
      filename: `Avoir_${creditNote?.refId || 'Brouillon'}.pdf`,
    });
  };

  const handleOpenEmailModal = () => {
    setEmailTo(client?.email || '');
    setEmailSubject(`Votre Note d'Avoir - ${creditNote?.refId}`);
    
    const totalFormatted = Number(creditNote?.total || 0).toLocaleString('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    
    setEmailBody(`Bonjour ${client?.name || 'Client'},\n\nVeuillez trouver ci-joint votre note d'avoir ${creditNote?.refId} d'un montant de ${totalFormatted} DH.\n\nCordialement,\nL'équipe ${COMPANY_INFO.name}`);
    setShowEmailModal(true);
  };

  const handleSendEmail = async () => {
    if (!emailTo) {
      showToast('Veuillez saisir une adresse email.', 'error');
      return;
    }
    setSendingEmail(true);

    try {
      const targetId = 'pdf-export-hidden';
      const element = document.getElementById(targetId);
      if (!element) {
        throw new Error("L'élément est introuvable.");
      }

      const pdfBase64 = await getPDFBase64(element, {
        filename: `Avoir_${creditNote?.refId || 'Brouillon'}.pdf`,
      });

      await backendService.sendEmail({
        to: emailTo,
        subject: emailSubject,
        body: emailBody.replace(/\n/g, '<br>'),
        attachmentName: `Avoir_${creditNote?.refId || 'Brouillon'}.pdf`,
        pdfBase64: pdfBase64.split(',')[1],
      });

      showToast('Email envoyé avec succès', 'success');
      setShowEmailModal(false);
    } catch (error) {
      console.error('Erreur lors de l\'envoi:', error);
      showToast("Échec de l'envoi de l'email", 'error');
    } finally {
      setSendingEmail(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Chargement...</div>;
  if (!creditNote) return <div className="p-8 text-center text-slate-500">Avoir introuvable</div>;

  return (
    <div className="w-full">
      <main className="w-full flex flex-col lg:flex-row gap-6 items-start py-4 animate-in fade-in duration-500">
        
        {/* Left Side: Document Preview */}
        <div
          className="flex-1 w-full bg-white dark:bg-[#2b2c40] p-8 md:p-12 shadow-xs rounded-xl border border-[#dbdade]/70 dark:border-[#434460]/40 overflow-hidden min-h-[500px] print:min-h-[1123px] flex flex-col relative"
          id="pdf-content-visual"
        >
          {/* Header Note Avoir */}
          <div className="flex justify-between items-start border-b border-[#dbdade]/40 dark:border-[#434460]/40 pb-6 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-[#566a7f] dark:text-[#a1acb8] tracking-tight uppercase">
                NOTE D'AVOIR
              </h1>
              <div className="text-[15px] font-medium text-[#696cff] dark:text-[#b1b4ff] mt-1 mb-4 flex items-center gap-2">
                <span className="text-[#a1acb8] dark:text-[#707194]">#</span>
                {creditNote.refId || 'Brouillon'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[13px] text-[#566a7f] dark:text-[#a1acb8] mt-1 space-y-1">
                <div className="flex justify-end gap-2">
                  <span className="font-semibold">Date d'émission :</span>
                  <span>
                    {creditNote.date ? format(creditNote.date, 'dd/MM/yyyy') : '-'}
                  </span>
                </div>
                <div className="flex justify-end gap-2">
                  <span className="font-semibold">Statut :</span>
                  <span className={
                    creditNote.status === 'Validé' ? 'text-emerald-500 font-bold' :
                    creditNote.status === 'Annulé' ? 'text-rose-500 font-bold' :
                    'text-orange-500 font-bold'
                  }>
                    {creditNote.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Client & Origin Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8 text-[13px]">
            <div>
              <p className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-widest mb-2">
                Informations Client
              </p>
              <div className="text-[#566a7f] dark:text-[#a1acb8] space-y-1">
                <p className="font-semibold text-[14px] text-[#566a7f] dark:text-[#dbdade]">
                  {client?.name || 'Client inconnu'}
                </p>
                {client?.addressLine1 && <p>{client.addressLine1}</p>}
                {client?.addressLine2 && <p>{client.addressLine2}</p>}
                {client?.ice && <p className="mt-2"><span className="font-semibold">ICE:</span> {client.ice}</p>}
              </div>
            </div>
            <div className="text-right md:text-left">
              <p className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-widest mb-2">
                Rattachement
              </p>
              <div className="text-[#566a7f] dark:text-[#a1acb8] space-y-1">
                <p><span className="font-semibold">Facture d'origine :</span> {creditNote.invoiceRef}</p>
                <p><span className="font-semibold">Motif :</span> {creditNote.reason}</p>
                {creditNote.notes && <p className="mt-2 italic">"{creditNote.notes}"</p>}
              </div>
            </div>
          </div>

          {/* Items Table */}
          <div className="border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-lg overflow-hidden mb-6">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[#dbdade]/70 dark:border-[#434460]/40 text-[#a1acb8] dark:text-[#707194] bg-[#f8f7fa] dark:bg-[#232333]">
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-12 text-center">#</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px]">Description</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-20 text-center">Qté</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-32 text-right">P.U (DH)</th>
                  <th className="py-3 px-4 font-bold uppercase tracking-wider text-[11px] w-32 text-right">Total (DH)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dbdade]/40 dark:divide-[#434460]/20">
                {creditNote.items.map((item: any, idx: number) => (
                  <tr key={idx} className="text-[#566a7f] dark:text-[#a1acb8] hover:bg-[#f8f7fa]/60 dark:hover:bg-[#232333]/40 transition-colors">
                    <td className="py-3 px-4 text-center font-medium">{idx + 1}</td>
                    <td className="py-3 px-4 font-semibold text-[#566a7f] dark:text-[#dbdade] whitespace-pre-wrap">
                      {item.description}
                    </td>
                    <td className="py-3 px-4 text-center">{item.quantity}</td>
                    <td className="py-3 px-4 text-right font-mono text-[12px]">
                      {Number(item.unitPrice || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-[#566a7f] dark:text-[#dbdade] text-[12px]">
                      {Number(item.subtotal || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
            <div className="text-[13px] text-[#566a7f] dark:text-[#a1acb8] space-y-4">
              <div className="mb-8 bg-[#fffbeb] dark:bg-[#4b3e2e]/30 border-l-[3px] border-[#ffab00] p-3 rounded-r-md">
                <p className="text-[12px] font-medium leading-relaxed text-[#566a7f] dark:text-[#a1acb8]">
                  Arrêté le présent avoir au montant de : <br />
                  <strong className="text-[#566a7f] dark:text-[#dbdade] mt-1 block uppercase">
                    {convertNumberToFrenchWords(Number(creditNote.total || 0))}
                  </strong>
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <div className="w-full max-w-[280px]">
                <div className="flex justify-between py-2 text-[13px] font-medium text-[#566a7f] dark:text-[#a1acb8]">
                  <span>Total HT</span>
                  <span className="font-mono text-[13px]">
                    {Number(creditNote.subtotal || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
                  </span>
                </div>
                <div className="flex justify-between py-2 text-[13px] font-medium text-[#566a7f] dark:text-[#a1acb8]">
                  <span>Total TVA</span>
                  <span className="font-mono text-[13px]">
                    {Number(creditNote.taxAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
                  </span>
                </div>
                <div className="flex justify-between py-3 mt-2 border-t border-[#dbdade]/70 dark:border-[#434460]/40">
                  <span className="font-bold text-[#566a7f] dark:text-[#dbdade] text-[14px] uppercase tracking-wide">
                    Total TTC
                  </span>
                  <span className="font-mono font-bold text-[#696cff] dark:text-[#b1b4ff] text-[16px]">
                    {Number(creditNote.total || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Actions du Cockpit */}
        <div className="w-full lg:w-[320px] flex flex-col gap-6 shrink-0 print:hidden lg:sticky lg:top-[90px] self-start">
          <div className="bg-white dark:bg-[#2b2c40] p-5 shadow-xs rounded-xl border border-[#dbdade]/70 dark:border-[#434460]/40">
            <span className="text-[11px] font-bold text-[#a1acb8] uppercase tracking-wider block mb-3">
              Actions du Cockpit
            </span>

            <div className="grid grid-cols-3 gap-2.5">
              {creditNote.status === 'Brouillon' && (
                <button
                  onClick={handleValidate}
                  disabled={validating}
                  title="Valider l'Avoir"
                  className="h-11 md:h-12 w-full bg-[#71dd37] hover:bg-[#66c732] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(113,221,55,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs disabled:opacity-50"
                >
                  <CheckCircle2 size={20} />
                </button>
              )}

              {creditNote.status === 'Validé' && (
                <button
                  onClick={handleCancel}
                  title="Annuler l'Avoir"
                  className="h-11 md:h-12 w-full bg-[#ff3e1d] hover:bg-[#e6381a] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(255,62,29,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
                >
                  <FileX size={20} />
                </button>
              )}

              <button
                onClick={handleExportPDF}
                title="Télécharger PDF"
                className="h-11 md:h-12 w-full bg-[#03c3ec] hover:bg-[#02afd4] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(3,195,236,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
              >
                <Printer size={20} />
              </button>

              <button
                onClick={handleOpenEmailModal}
                title="Envoyer par Email"
                className="h-11 md:h-12 w-full bg-[#696cff] hover:bg-[#5f61e6] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(105,108,255,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
              >
                <Mail size={20} />
              </button>

              {(creditNote.status === 'Brouillon' || creditNote.status === 'Annulé') && (
                <button
                  onClick={handleDelete}
                  title="Supprimer la note d'avoir"
                  className="h-11 md:h-12 w-full bg-[#ff3e1d] hover:bg-[#e6381a] hover:-translate-y-[1px] hover:shadow-[0_0.25rem_0.5rem_0_rgba(255,62,29,0.4)] rounded-xl flex items-center justify-center cursor-pointer transition-all text-white shadow-xs"
                >
                  <Trash2 size={20} />
                </button>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Hidden layout for PDF Export */}
      <div
        style={{
          position: 'absolute',
          top: '-9999px',
          left: '-9999px',
          zIndex: -9999,
        }}
      >
        <div
          id="pdf-export-hidden"
          style={{
            background: 'white',
            display: 'flex',
            flexDirection: 'column',
            width: '210mm',
            minHeight: '297mm',
            padding: '20mm',
            fontFamily: 'sans-serif',
            color: '#000',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '40px' }}>
            <div>
              <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: 0 }}>NOTE D'AVOIR</h1>
              <p style={{ margin: '5px 0', color: '#555' }}>Référence : {creditNote.refId || 'Brouillon'}</p>
              <p style={{ margin: '5px 0', color: '#555' }}>Date : {creditNote.date ? format(creditNote.date, 'dd/MM/yyyy') : '-'}</p>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>{COMPANY_INFO.name}</h2>
              <p style={{ margin: '5px 0', color: '#555' }}>Tel: {COMPANY_INFO.phone}</p>
              <p style={{ margin: '5px 0', color: '#555' }}>ICE: {COMPANY_INFO.ice}</p>
            </div>
          </div>

          <div style={{ marginBottom: '40px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '10px' }}>Client :</h3>
            <p style={{ margin: '2px 0' }}>{client?.name}</p>
            <p style={{ margin: '2px 0', color: '#555' }}>{client?.addressLine1}</p>
            {client?.ice && <p style={{ margin: '2px 0', color: '#555' }}>ICE: {client.ice}</p>}
          </div>

          <div style={{ marginBottom: '20px' }}>
            <p><strong>Facture d'origine :</strong> {creditNote.invoiceRef}</p>
            <p><strong>Motif de l'avoir :</strong> {creditNote.reason}</p>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '40px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #000' }}>
                <th style={{ padding: '10px', textAlign: 'left' }}>Description</th>
                <th style={{ padding: '10px', textAlign: 'center' }}>Qté</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>PU HT</th>
                <th style={{ padding: '10px', textAlign: 'right' }}>Total HT</th>
              </tr>
            </thead>
            <tbody>
              {creditNote.items.map((item: any, idx: number) => (
                <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '10px' }}>{item.description}</td>
                  <td style={{ padding: '10px', textAlign: 'center' }}>{item.quantity}</td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    {Number(item.unitPrice || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    {Number(item.subtotal || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ alignSelf: 'flex-end', width: '300px' }}>
            <div style={{ display: 'flex', justifySelf: 'flex-end', width: '100%' }}>
              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
                  <span>Total HT</span>
                  <span>{Number(creditNote.subtotal || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}>
                  <span>TVA</span>
                  <span>{Number(creditNote.taxAmount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', fontWeight: 'bold', fontSize: '18px', borderTop: '2px solid #000', marginTop: '10px' }}>
                  <span>Total TTC</span>
                  <span>{Number(creditNote.total || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Email Modal */}
      {showEmailModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white dark:bg-[#2b2c40] border border-[#dbdade]/70 dark:border-[#434460]/40 rounded-xl shadow-lg w-full max-w-lg flex flex-col">
            <div className="px-6 py-4 border-b border-[#f4f3f6] dark:border-[#434460]/20 flex items-center justify-between bg-[#f5f5f9] dark:bg-[#232333] rounded-t-xl">
              <div className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-[#696cff]" />
                <h3 className="font-semibold text-[#566a7f] dark:text-[#dbdade]">Envoyer l'avoir</h3>
              </div>
              <button onClick={() => setShowEmailModal(false)} className="text-[#a1acb8] hover:text-[#566a7f]">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-[13px] font-semibold text-[#566a7f] dark:text-[#dbdade] mb-1">Destinataire</label>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  className="w-full bg-transparent border border-[#dbdade] dark:border-[#434460] rounded-md px-3 py-2 text-[13px] text-[#566a7f] dark:text-[#dbdade] focus:outline-none focus:border-[#696cff] transition-colors"
                  placeholder="email@client.com"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-[#566a7f] dark:text-[#dbdade] mb-1">Sujet</label>
                <input
                  type="text"
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  className="w-full bg-transparent border border-[#dbdade] dark:border-[#434460] rounded-md px-3 py-2 text-[13px] text-[#566a7f] dark:text-[#dbdade] focus:outline-none focus:border-[#696cff] transition-colors"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-[#566a7f] dark:text-[#dbdade] mb-1">Message</label>
                <textarea
                  rows={5}
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  className="w-full bg-transparent border border-[#dbdade] dark:border-[#434460] rounded-md px-3 py-2 text-[13px] text-[#566a7f] dark:text-[#dbdade] focus:outline-none focus:border-[#696cff] transition-colors"
                />
              </div>
            </div>

            <div className="px-6 py-4 border-t border-[#f4f3f6] dark:border-[#434460]/20 bg-white dark:bg-[#2b2c40] rounded-b-xl flex justify-end gap-3">
              <button
                onClick={() => setShowEmailModal(false)}
                className="px-4 py-2 text-[#697a8d] hover:bg-[#f8f7fa] dark:hover:bg-[#323249] rounded-lg text-[13px] font-semibold transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleSendEmail}
                disabled={sendingEmail}
                className="px-5 py-2 bg-[#696cff] text-white rounded-lg text-[13px] font-bold tracking-wide hover:bg-[#5f61e6] hover:shadow-[0_0.25rem_0.5rem_0_rgba(105,108,255,0.4)] disabled:opacity-50 transition-all flex items-center gap-2 uppercase"
              >
                {sendingEmail ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Envoi...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    Envoyer
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

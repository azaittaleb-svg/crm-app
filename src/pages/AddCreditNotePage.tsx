import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useNotification } from '../context/NotificationContext';
import { creditNoteService } from '../services/creditNoteService';
import { CreditNoteReasonSchema, CreditNoteReason } from '../types/creditNote';
import { ArrowLeft, Save } from 'lucide-react';

export default function AddCreditNotePage() {
  const { clientId, invoiceId } = useParams<{ clientId: string; invoiceId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useNotification();
  
  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [reason, setReason] = useState<CreditNoteReason>('Annulation totale');
  const [notes, setNotes] = useState('');
  
  // By default, we select all items. For partial credit notes, user can uncheck or change quantity.
  const [items, setItems] = useState<any[]>([]);

  const [remainingCreditable, setRemainingCreditable] = useState<number | null>(null);

  useEffect(() => {
    async function fetchInvoice() {
      if (!clientId || !invoiceId) return;
      try {
        // Fetch all non-canceled credit notes for this invoice
        const qCreditNotes = query(
          collection(db, 'clients', clientId, 'credit_notes'),
          where('invoiceId', '==', invoiceId),
          where('ownerId', '==', user?.uid)
        );
        const creditNotesSnap = await getDocs(qCreditNotes);
        
        let sumCredited = 0;
        creditNotesSnap.docs.forEach(d => {
          const cData = d.data();
          if (cData.status !== 'Annulé') {
            sumCredited += (cData.total || 0);
          }
        });

        const docRef = doc(db, 'clients', clientId, 'purchases', invoiceId);
        const snap = await getDoc(docRef);
        if (snap.exists()) {
          const data = snap.data();
          
          const remaining = (data.total || 0) - sumCredited;
          
          if (remaining <= 0) {
            showToast('Cette facture est déjà entièrement créditée par un ou plusieurs avoirs.', 'error');
            navigate(`/client/${clientId}`);
            return;
          }

          setInvoice({ id: snap.id, ...data });
          setRemainingCreditable(remaining);

          // Pre-fill items
          if (data.items) {
            setItems(data.items.map((item: any) => ({
              ...item,
              selected: true,
              creditQuantity: item.quantity,
            })));
          }
        }
      } catch (e) {
        console.error(e);
        showToast('Erreur lors du chargement de la facture', 'error');
      } finally {
        setLoading(false);
      }
    }
    fetchInvoice();
  }, [clientId, invoiceId]);

  const handleItemToggle = (index: number) => {
    const newItems = [...items];
    newItems[index].selected = !newItems[index].selected;
    setItems(newItems);
  };

  const handleQuantityChange = (index: number, val: number) => {
    const newItems = [...items];
    newItems[index].creditQuantity = Math.min(Math.max(0, val), newItems[index].quantity);
    setItems(newItems);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !clientId || !invoice) return;

    try {
      setSaving(true);
      
      const selectedItems = items.filter(i => i.selected && i.creditQuantity > 0).map(i => ({
        id: i.id || crypto.randomUUID(),
        description: i.description,
        quantity: i.creditQuantity,
        unitPrice: i.price !== undefined ? i.price : i.unitPrice,
        taxRate: i.taxRate || invoice.taxRate || 0,
        subtotal: i.creditQuantity * (i.price !== undefined ? i.price : i.unitPrice),
        taxAmount: i.creditQuantity * (i.price !== undefined ? i.price : i.unitPrice) * (i.taxRate || invoice.taxRate || 0),
        total: i.creditQuantity * (i.price !== undefined ? i.price : i.unitPrice) * (1 + (i.taxRate || invoice.taxRate || 0))
      }));

      if (selectedItems.length === 0) {
        showToast('Veuillez sélectionner au moins un article', 'error');
        setSaving(false);
        return;
      }

      const newCreditNoteTotal = selectedItems.reduce((acc, curr) => acc + curr.total, 0);

      if (remainingCreditable !== null && newCreditNoteTotal > remainingCreditable + 0.01) {
        showToast(`Montant invalide : le total de cet avoir (${newCreditNoteTotal.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH) dépasse le reste à créditer de la facture (${remainingCreditable.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH).`, 'error');
        setSaving(false);
        return;
      }

      const creditNoteId = await creditNoteService.createCreditNote({
        clientId,
        invoiceId: invoice.id,
        invoiceRef: invoice.refId || 'Facture sans référence',
        date: new Date(),
        reason,
        notes,
        items: selectedItems,
      });

      showToast('Avoir créé avec succès en brouillon', 'success');
      navigate(`/credit-notes/${clientId}/${creditNoteId}`);
    } catch (e: any) {
      console.error(e);
      showToast(e.message || 'Erreur lors de la création', 'error');
      setSaving(false);
    }
  };

  if (loading) return <div>Chargement...</div>;
  if (!invoice) return <div>Facture introuvable</div>;

  const isPartial = reason === 'Annulation partielle' || reason === 'Retour de marchandise' || reason === 'Remise commerciale';

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          className="p-2 hover:bg-slate-100 rounded-full transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Créer un Avoir</h1>
          <p className="text-sm text-slate-500">Pour la facture {invoice.refId}</p>
        </div>
        {remainingCreditable !== null && (
          <div className="ml-auto text-right">
            <span className="text-xs text-slate-500 block uppercase tracking-wider font-semibold">Montant restant créditable</span>
            <span className="text-lg font-mono font-bold text-indigo-600">
              {remainingCreditable.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH
            </span>
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-slate-200/60 p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Motif de l'avoir</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as CreditNoteReason)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            >
              {CreditNoteReasonSchema.options.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Notes (Optionnel)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Détails supplémentaires..."
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-slate-700 mb-3">Articles à créditer</h3>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 w-12">
                    {/* Checkbox all could go here */}
                  </th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Prix Unitaire</th>
                  <th className="px-4 py-3 text-right">Qté Max</th>
                  <th className="px-4 py-3 text-right w-32">Qté à Créditer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item, idx) => (
                  <tr key={idx} className={!item.selected ? 'bg-slate-50 opacity-50' : ''}>
                    <td className="px-4 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => handleItemToggle(idx)}
                        disabled={!isPartial}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{item.description}</td>
                    <td className="px-4 py-3 text-right">
                      {(item.price !== undefined ? item.price : item.unitPrice).toLocaleString('fr-MA', { style: 'currency', currency: 'MAD' })}
                    </td>
                    <td className="px-4 py-3 text-right">{item.quantity}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        max={item.quantity}
                        step="0.01"
                        value={item.creditQuantity}
                        onChange={(e) => handleQuantityChange(idx, parseFloat(e.target.value) || 0)}
                        disabled={!item.selected || !isPartial}
                        className="w-full px-2 py-1 text-right border border-slate-200 rounded focus:outline-none focus:border-indigo-500"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!isPartial && (
            <p className="text-xs text-slate-500 mt-2">
              L'annulation totale sélectionne automatiquement tous les articles avec leur quantité maximale.
            </p>
          )}
        </div>

        <div className="flex justify-end pt-4 border-t border-slate-100">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            Créer le brouillon
          </button>
        </div>
      </form>
    </div>
  );
}

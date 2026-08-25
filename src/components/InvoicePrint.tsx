import React, { useEffect } from 'react';
import { InvoiceData } from '../types';
import { convertNumberToFrenchWords } from '../utils/numberToWords';

interface Props {
  data: InvoiceData;
}

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
};

export const InvoicePrint: React.FC<Props> = ({ data }) => {
  // Add standard Inter font stylesheet link if not present
  useEffect(() => {
    if (!document.getElementById('invoice-print-public-sans-font')) {
      const link = document.createElement('link');
      link.id = 'invoice-print-public-sans-font';
      link.rel = 'stylesheet';
      link.href =
        'https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800;900&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const subtotal =
    data.subtotal !== undefined
      ? data.subtotal
      : data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxAmount = subtotal * data.taxRate;
  const totalValue = data.total !== undefined ? data.total : subtotal + taxAmount;

  // Payment status & advance details calculation
  const isPaidStatus =
    data.paymentStatus === 'paid' ||
    data.paymentStatus === 'Payé' ||
    data.paymentStatus === 'paye' ||
    data.paymentStatus === 'Régularisé';

  let paidAmount = 0;
  if (data.amountPaid !== undefined && data.amountPaid !== null && !isNaN(Number(data.amountPaid))) {
    paidAmount = Math.max(0, Number(data.amountPaid));
  } else if (isPaidStatus) {
    paidAmount = totalValue;
  }

  const remainingAmount = Math.max(0, totalValue - paidAmount);
  const showPaymentDetails = data.type !== 'DEVIS' || paidAmount > 0;

  const docTypeLabel =
    data.type === 'DEVIS' ? 'Devis' : data.type === 'COMMANDE' ? 'Reçu' : 'Facture';

  return (
    <>
      <style>{`
        .a4-sheet {
          width: 210mm;
          min-height: 297mm;
          background: #ffffff;
          padding: 45px 35px;
          position: relative;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          font-family: 'Public Sans', 'Inter', -apple-system, sans-serif;
          color: #0f172a;
          overflow: visible;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        .a4-sheet::before {
          content: "";
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 6px;
          background: linear-gradient(90deg, #ffb703 0%, #fb8500 100%);
        }

        /* En-tête avec touche de couleur */
        .pdf-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-top: 10px;
          padding-bottom: 12px;
          border-bottom: 2px solid #f1f5f9;
          margin-bottom: 20px;
        }
        
        .pdf-brand-container {
          display: flex;
          flex-direction: column;
        }

        .pdf-logo-main {
          font-size: 30px;
          font-weight: 800;
          letter-spacing: -0.5px;
          line-height: 1;
        }

        .pdf-logo-advanced {
          color: #1e293b;
          text-transform: uppercase;
          font-weight: 800;
        }

        .pdf-logo-it {
          color: #ffb703;
          font-weight: 800;
        }

        .pdf-logo-sub {
          font-size: 11.5px;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 3.5px;
          margin-top: 4px;
        }

        .pdf-brand-details {
          font-size: 10px;
          color: #64748b;
          line-height: 1.5;
          margin-top: 8px;
        }

        .pdf-invoice-title-clean { 
          text-align: right;
        }
        .pdf-invoice-title-clean h2 { 
          font-size: 24px; 
          font-weight: 900; 
          color: #ffb703; /* Le jaune/orange de image_3d3978.png */
          letter-spacing: -0.5px;
          margin-bottom: 4px;
          text-transform: uppercase;
        }
        .pdf-invoice-ref { 
          font-size: 11.5px; 
          font-weight: 700; 
          color: #475569; 
          letter-spacing: 0.5px;
        }

        /* Infos Client & Meta */
        .pdf-info-section {
          display: flex;
          justify-content: space-between;
          margin-bottom: 20px;
          font-size: 12px;
          line-height: 1.5;
        }
        .pdf-info-title { 
          font-size: 9.5px; 
          font-weight: 700; 
          color: #64748b; 
          text-transform: uppercase; 
          margin-bottom: 6px; 
          letter-spacing: 1px;
          border-bottom: 1px solid #f1f5f9;
          padding-bottom: 4px; 
        }
        .pdf-info-block {
          width: 48%;
        }

        /* --- TABLEAU DES ARTICLES --- */
        .pdf-invoice-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        .pdf-invoice-table th {
          background-color: #f8fafc;
          border-bottom: 2px solid #0f172a;
          padding: 8px 10px;
          font-size: 10px;
          font-weight: 700;
          color: #0f172a;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .pdf-invoice-table td {
          padding: 8px 10px;
          border-bottom: 1px solid #f1f5f9;
          font-size: 11.5px;
          color: #334155;
          line-height: 1.4;
        }
        .pdf-invoice-table tbody tr:nth-child(even) {
          background-color: #fafbfc;
        }
        .pdf-invoice-table tr {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        .pdf-invoice-table td.right, .pdf-invoice-table th.right { 
          text-align: right; 
        }
        .pdf-invoice-table td.center, .pdf-invoice-table th.center { 
          text-align: center; 
        }

        /* Totaux et Notes encadrées de couleur */
        .pdf-summary-section {
          display: flex;
          justify-content: space-between;
          margin-bottom: 15px;
          page-break-inside: avoid;
        }
        .pdf-notes { 
          width: 55%; 
          font-size: 10px; 
          color: #475569; 
          line-height: 1.4; 
        }
        .pdf-amount-words-box {
          background-color: #fdfdfd;
          border: 1px solid #e2e8f0;
          border-left: 4px solid #ffb703;
          padding: 8px 10px;
          border-radius: 6px;
          margin-top: 6px;
          margin-bottom: 6px;
        }
        .pdf-amount-words { 
          color: #0f172a; 
          font-size: 10.5px; 
          line-height: 1.4; 
        }
        .pdf-amount-words strong { 
          color: #343a40; 
        }
        .pdf-order-ref { 
          font-size: 10px; 
          color: #64748b; 
          padding-left: 4px; 
          margin-top: 4px;
        }

        .pdf-totals { 
          width: 42%; 
        }
        .pdf-totals-table { 
          width: 100%; 
          border-collapse: collapse; 
          font-size: 12px; 
        }
        .pdf-totals-table td { 
          padding: 5px 4px; 
          text-align: right; 
          color: #334155; 
        }
        .pdf-totals-table td.label { 
          text-align: left; 
          color: #64748b; 
          font-weight: 500; 
        }
        
        .pdf-totals-table .total-row td {
          border-top: 2px solid #0f172a;
          padding-top: 8px;
          padding-bottom: 6px;
          font-size: 15px;
          font-weight: 800;
          color: #0f172a;
        }

        .pdf-totals-table .payment-row-paid td {
          padding-top: 5px;
          font-size: 12px;
          font-weight: 600;
          color: #16a34a;
        }

        .pdf-totals-table .payment-row-remaining td {
          padding-top: 5px;
          padding-bottom: 5px;
          border-top: 1px dashed #cbd5e1;
          font-size: 13px;
          font-weight: 800;
        }

        /* --- PIED DE PAGE LÉGAL ET SIGNATURE --- */
        .pdf-footer {
          position: absolute; 
          bottom: 40px;
          left: 35px;
          right: 35px;
          display: flex; 
          justify-content: space-between; 
          align-items: flex-end;
        }
        
        .pdf-legal-info {
          font-size: 9.5px; 
          color: #64748b; 
          line-height: 1.6; 
          width: 70%;
        }
        .pdf-legal-info span { 
          font-weight: 700; 
          color: #0f172a; 
        }
        
        .pdf-signature-box {
          width: 230px; 
        }
        .pdf-signature-line {
          border-bottom: 1px solid #0f172a;
          margin-bottom: 6px;
        }
        .pdf-signature-text {
          text-align: right; 
          font-size: 9.5px; 
          font-weight: 700; 
          color: #1e293b;
          letter-spacing: 0.5px;
        }

        @media print {
          @page { 
            size: A4; 
            margin: 0; 
          }
          html, body { 
            width: 210mm; 
            background: #ffffff !important; 
            padding: 0 !important; 
            margin: 0 !important; 
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .a4-sheet { 
            box-shadow: none; 
            border-radius: 0; 
            width: 210mm; 
            min-height: 297mm;
            padding: 45px 35px; 
            overflow: visible;
          }
        }
      `}</style>

      <div className="a4-sheet">
        {/* HEADER */}
        <div className="pdf-header">
          <div className="pdf-brand-container">
            <div className="pdf-logo-main">
              <span className="pdf-logo-advanced">Advanced</span>{' '}
              <span className="pdf-logo-it">iT</span>
            </div>
            <div className="pdf-logo-sub">By Workstation</div>
            <div className="pdf-brand-details">
              contact@workstation.ma
              <br />
              +212 808 501 756
            </div>
          </div>
          <div className="pdf-invoice-title-clean">
            <h2>{docTypeLabel}</h2>
            <div className="pdf-invoice-ref">
              N° {data.number}
              {data.type === 'COMMANDE' && (
                <span className="text-[10px] text-gray-400 font-normal block mt-0.5 lowercase">
                  (commande n°: {data.number})
                </span>
              )}
            </div>
          </div>
        </div>

        {/* INFOS CLIENT */}
        <div className="pdf-info-section">
          <div className="pdf-info-block">
            <div className="pdf-info-title">
              {data.type === 'DEVIS'
                ? 'Devis pour'
                : data.type === 'COMMANDE'
                  ? 'Reçu pour'
                  : 'Facturé à'}
            </div>
            <div
              style={{ fontWeight: 800, fontSize: '13px', marginBottom: '4px', color: '#0f172a' }}
            >
              {data.client.name}
            </div>
            <div style={{ color: '#475569' }}>
              {data.client.addressLine1 || '—'}
              <br />
              {[data.client.city, data.client.phone ? `Tél: ${data.client.phone}` : '']
                .filter(Boolean)
                .join(' | ')}
            </div>
            {data.client.ice && (
              <div style={{ marginTop: '6px', fontWeight: 700, color: '#0f172a' }}>
                ICE: {data.client.ice}
              </div>
            )}
          </div>

          <div className="pdf-info-block" style={{ textAlign: 'right' }}>
            <div className="pdf-info-title" style={{ textAlign: 'right' }}>
              Détails
            </div>
            <table style={{ marginLeft: 'auto', borderCollapse: 'collapse', fontSize: '11.5px' }}>
              <tbody>
                <tr>
                  <td style={{ color: '#64748b', padding: '2px 8px 2px 0', textAlign: 'right' }}>
                    Date d'émission :
                  </td>
                  <td style={{ fontWeight: 600, padding: '2px 0', textAlign: 'right' }}>
                    {data.date}
                  </td>
                </tr>
                {data.validity && (
                  <tr>
                    <td style={{ color: '#64748b', padding: '2px 8px 2px 0', textAlign: 'right' }}>
                      {data.type === 'DEVIS' ? 'Validité :' : 'Date de règlement :'}
                    </td>
                    <td style={{ fontWeight: 600, padding: '2px 0', textAlign: 'right' }}>
                      {data.validity}
                    </td>
                  </tr>
                )}
                {(data.conditionsPaiement || data.paymentTerms) && (
                  <tr>
                    <td style={{ color: '#64748b', padding: '2px 8px 2px 0', textAlign: 'right' }}>
                      Conditions :
                    </td>
                    <td style={{ fontWeight: 600, padding: '2px 0', textAlign: 'right' }}>
                      {data.conditionsPaiement || data.paymentTerms}
                    </td>
                  </tr>
                )}
                {data.modeReglement && (
                  <tr>
                    <td style={{ color: '#64748b', padding: '2px 8px 2px 0', textAlign: 'right' }}>
                      Mode :
                    </td>
                    <td style={{ fontWeight: 600, padding: '2px 0', textAlign: 'right' }}>
                      {data.modeReglement.replace(/💵 |🏦 |⏳ |📄 /g, '')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* TABLEAU DES ARTICLES */}
        <table className="pdf-invoice-table">
          <thead>
            <tr>
              <th style={{ width: '5%', textAlign: 'center' }}>#</th>
              <th style={{ width: '55%', textAlign: 'left' }}>Description</th>
              <th style={{ width: '10%', textAlign: 'center' }}>Qté</th>
              <th style={{ width: '15%' }} className="right">
                P.U (DH)
              </th>
              <th style={{ width: '15%' }} className="right">
                Montant (DH)
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, idx) => {
              if (item.type === 'section') {
                return (
                  <tr key={item.id} className="section-row">
                    <td></td>
                    <td
                      colSpan={4}
                      style={{
                        fontWeight: 'bold',
                        paddingTop: '10px',
                        paddingBottom: '4px',
                        borderBottom: '1px solid #eee',
                      }}
                    >
                      {item.description}
                    </td>
                  </tr>
                );
              }

              if (item.type === 'note') {
                return (
                  <tr key={item.id} className="note-row">
                    <td></td>
                    <td
                      colSpan={4}
                      style={{
                        fontStyle: 'italic',
                        color: '#64748b',
                        fontSize: '11px',
                        paddingTop: '4px',
                        paddingBottom: '4px',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {item.description}
                    </td>
                  </tr>
                );
              }

              const descLines = (item.description || '').split('\n');
              const titleLine = descLines[0];
              const specsLines = descLines.slice(1).join('\n');

              return (
                <tr key={item.id}>
                  <td className="center">{idx + 1}</td>
                  <td>
                    <div style={{ fontWeight: 600, color: '#0f172a', fontSize: '13px' }}>
                      {titleLine}
                    </div>
                    {specsLines && (
                      <div
                        style={{
                          fontSize: '11px',
                          color: '#64748b',
                          fontWeight: 400,
                          marginTop: '4px',
                          lineHeight: '1.4',
                        }}
                      >
                        {specsLines}
                      </div>
                    )}
                  </td>
                  <td className="center">{item.quantity}</td>
                  <td className="right">{formatCurrency(item.unitPrice)}</td>
                  <td className="right">{formatCurrency(item.quantity * item.unitPrice)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* REMARQUES ET TOTAUX */}
        <div className="pdf-summary-section">
          <div className="pdf-notes">
            {data.notes && (
              <>
                <div
                  style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: '#64748b',
                    letterSpacing: '0.5px',
                    marginBottom: '4px',
                  }}
                >
                  Observations / Notes
                </div>
                <div style={{ marginBottom: '8px', fontStyle: 'italic' }}>{data.notes}</div>
              </>
            )}

            {/* "Arrêtée la présente..." block is strictly reserved for Factures */}
            {(data.type === 'FACTURE' || data.type === 'FACTURATION') && (
              <div className="pdf-amount-words-box">
                <div className="pdf-amount-words">
                  Arrêtée la présente facture au montant de :<br />
                  <strong>{convertNumberToFrenchWords(totalValue)}</strong>
                  {showPaymentDetails && (
                    <div style={{ marginTop: '5px', fontSize: '10px', color: '#475569', fontWeight: 600 }}>
                      {paidAmount > 0 && remainingAmount > 0.05 ? (
                        <>
                          (Avance versée : <span style={{ color: '#16a34a', fontWeight: 700 }}>{formatCurrency(paidAmount)} DH</span> — Reste à régler : <span style={{ color: '#e11d48', fontWeight: 700 }}>{formatCurrency(remainingAmount)} DH</span>)
                        </>
                      ) : remainingAmount <= 0.05 ? (
                        <span style={{ color: '#16a34a', fontWeight: 700 }}>(Montant intégralement réglé)</span>
                      ) : (
                        <span style={{ color: '#e11d48', fontWeight: 700 }}>(Montant non encore réglé — Reste : {formatCurrency(remainingAmount)} DH)</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="pdf-totals">
            <table className="pdf-totals-table">
              <tbody>
                {data.taxRate > 0 ? (
                  <>
                    <tr>
                      <td className="label">Sous-Total (HT) :</td>
                      <td style={{ fontWeight: 600 }}>{formatCurrency(subtotal)} DH</td>
                    </tr>
                    <tr>
                      <td className="label">TVA ({(data.taxRate * 100).toFixed(0)}%) :</td>
                      <td style={{ fontWeight: 600 }}>{formatCurrency(taxAmount)} DH</td>
                    </tr>
                    <tr className="total-row">
                      <td className="label" style={{ color: '#0f172a', fontWeight: '800' }}>
                        Total TTC :
                      </td>
                      <td style={{ color: '#0f172a', fontWeight: '800' }}>{formatCurrency(totalValue)} DH</td>
                    </tr>
                  </>
                ) : (
                  <tr className="total-row">
                    <td className="label" style={{ color: '#0f172a', fontWeight: '800' }}>
                      Total :
                    </td>
                    <td style={{ color: '#0f172a', fontWeight: '800' }}>{formatCurrency(totalValue)} DH</td>
                  </tr>
                )}

                {showPaymentDetails && (
                  <>
                    <tr className="payment-row-paid">
                      <td className="label" style={{ color: '#16a34a', fontWeight: '600' }}>
                        {paidAmount < totalValue && paidAmount > 0 ? 'Avance (Acompte) :' : 'Montant Payé :'}
                      </td>
                      <td style={{ color: '#16a34a', fontWeight: '700' }}>
                        {formatCurrency(paidAmount)} DH
                      </td>
                    </tr>
                    <tr className="payment-row-remaining">
                      <td className="label" style={{ color: remainingAmount > 0.05 ? '#e11d48' : '#0284c7', fontWeight: '700' }}>
                        Reste à payer :
                      </td>
                      <td style={{ color: remainingAmount > 0.05 ? '#e11d48' : '#0284c7', fontWeight: '800' }}>
                        {remainingAmount <= 0.05 ? '0,00 DH (Réglé)' : `${formatCurrency(remainingAmount)} DH`}
                      </td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 5. Footer Légal et Signature */}
        <div className="pdf-footer">
          <div className="pdf-legal-info">
            Advanced IT - RIB : <span>360810000003431546001739 OMNIA BANK</span>
            <br />
            RC : <span>180841</span> - Taxe pro : <span>26308144</span> - IF : <span>66093257</span>
            <br />
            ICE : <span>003591901000049</span> - Tél : <span>+212 808 501 756</span> - Email :{' '}
            <span>contact@workstation.ma</span>
          </div>
          <div className="pdf-signature-box">
            <div className="pdf-signature-line"></div>
            <div className="pdf-signature-text">SIGNATURE & CACHET</div>
          </div>
        </div>
      </div>
    </>
  );
};

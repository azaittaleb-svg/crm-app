import React from 'react';
import { InvoiceData } from '../types';

interface Props {
  data: InvoiceData;
}

const formatWithSpaces = (num: number) => {
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
  return formatted.replace(/,/g, ' ');
};

// Reusable function to trigger clean direct window printing using a hidden iframe
export const printTicket = (data: InvoiceData) => {
  // 1. Assemble data
  const emitterName = data.emitter
    ? `${data.emitter.nameFirstPart || ''} ${data.emitter.nameSecondPart || ''}`.trim()
    : 'ADVANCED IT';
  const tagline = data.emitter?.tagline || 'Matériel Informatique & High-Tech';
  const footerLine1 =
    data.emitter?.footerLine1 || 'RC : 180841 - Taxe pro : 26308144 - IF : 66093257';
  const footerLine2 = data.emitter?.footerLine2 || 'ICE : 003591901000049';

  let refLabel = data.number || '000000';

  const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxRate = data.taxRate || 0;
  const taxAmount = subtotal * taxRate;
  const total = data.total !== undefined ? data.total : subtotal + taxAmount;

  const formattedDate = data.date || new Date().toLocaleDateString('fr-FR');
  const clientName = data.client?.name ? data.client.name.toUpperCase() : 'CLIENT OCCASIONNEL';

  const amountPaid =
    data.amountPaid !== undefined ? data.amountPaid : data.paymentStatus === 'paid' ? total : 0;
  const modeReglement = data.modeReglement?.replace(/💵 |🏦 |⏳ |📄 /g, '') || 'Espèces';

  let paymentText = '';
  if (amountPaid >= total && total > 0) {
    paymentText = `Réglé (${modeReglement})`;
  } else if (amountPaid === 0) {
    paymentText = 'Crédit';
  } else {
    paymentText = `Avance: ${formatWithSpaces(amountPaid)} (Reste: ${formatWithSpaces(total - amountPaid)})`;
  }

  const itemsHtml = data.items
    .map(
      (item) => `
      <div class="item-block">
        <div class="item-name">${item.quantity}x ${item.description}</div>
        <div class="item-price">${formatWithSpaces(item.quantity * item.unitPrice)}</div>
      </div>
  `
    )
    .join('');

  const taxRowHtml =
    taxRate > 0
      ? `
      <div class="row"><span>TVA (${(taxRate * 100).toFixed(0)}%):</span> <span>${formatWithSpaces(taxAmount)}</span></div>
  `
      : '';

  const notesHtml = data.notes && data.notes.trim() !== ''
    ? `<div class="note-box"><span class="note-title">NOTE :</span> ${data.notes.trim().replace(/\n/g, '<br>')}</div>`
    : ``;

  // 2. Create iframe
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    console.error('Failed to get iframe document for printing');
    return;
  }

  // 3. Write exact HTML and CSS to iframe
  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <title>Ticket de Caisse 80mm</title>
      <style>
        /* --- Design Browser (الشاشة) --- */
        body { background: #fff; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 0; padding: 0; }
        
        .ticket { 
          width: 80mm; 
          background: white; 
          padding: 5mm; 
          color: #000; 
          font-size: 12px; 
          line-height: 1.4; 
          box-sizing: border-box;
        }

        .header, .footer { text-align: center; }
        .logo-text { font-size: 22px; margin: 0; font-weight: 900; letter-spacing: 1px; }
        .subtitle { font-size: 11px; margin: 2px 0 8px 0; border-bottom: 1px solid #000; padding-bottom: 5px; display: inline-block;}
        .header p { margin: 1px 0; font-size: 11px; font-weight: bold; }
        
        .legal-info { font-size: 10px; margin-top: 5px; }
        
        .solid-divider { border-bottom: 1px solid #000; margin: 10px 0; }
        .double-divider { border-bottom: 3px double #000; margin: 10px 0; }
        
        .row { display: flex; justify-content: space-between; }
        .bold { font-weight: bold; }
        
        .items-header { font-size: 11px; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 6px; }
        .item-block { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; font-size: 11px; }
        .item-name { font-weight: bold; font-size: 11px; flex: 1; padding-right: 8px; margin: 0; }
        .item-price { font-weight: bold; font-size: 11px; white-space: nowrap; }

        .totals .row { margin-bottom: 4px; }
        
        .net-pay-box { font-size: 15px; font-weight: 900; background: #000; color: #fff; padding: 6px; margin-top: 5px; border-radius: 3px; align-items: center; }
        .net-pay-box span { color: #fff; }

        .note-box { margin-top: 6px; border: 1.5px solid #000; padding: 5px 6px; font-size: 11px; text-align: left; border-radius: 3px; line-height: 1.35; word-break: break-word; }
        .note-title { font-weight: 900; margin-right: 4px; text-transform: uppercase; }

        .footer p { margin: 4px 0; font-size: 10px; }
        .qr-placeholder { border: 1px dashed #000; width: 80px; height: 80px; margin: 15px auto 0; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; }

        /* --- Print CSS Magique (سحر الطباعة) --- */
        @media print {
          @page { margin: 0; }
          body { background: white; margin: 0; padding: 0; }
          
          .ticket { position: absolute; left: 0; top: 0; width: 80mm; padding: 2mm; box-shadow: none; margin: 0; }
          
          .ticket * { 
            color: black !important; 
            font-weight: bold !important; 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important; 
          }
          
          .net-pay-box { 
            background: transparent !important; 
            color: black !important; 
            border: 2px solid black !important; 
            padding: 4px !important;
          }
          .net-pay-box span { 
            color: black !important; 
          }
        }
      </style>
    </head>
    <body>
      <div class="ticket">
        
        <div class="header">
          <h1 class="logo-text">${emitterName || 'ADVANCED IT'}</h1>
          <p class="subtitle">${tagline}</p>
          
          <div class="legal-info">
            <p>${footerLine1}</p>
            <p>${footerLine2}</p>
          </div>
        </div>

        <div class="solid-divider"></div>

        <div class="info">
          <div class="row"><span>Commande N°:</span> <span class="bold">${refLabel}</span></div>
          <div class="row"><span>Date:</span> <span>${formattedDate}</span></div>
          <div class="row"><span>Client:</span> <span>${clientName}</span></div>
          <div class="row"><span>Paiement:</span> <span>${paymentText}</span></div>
        </div>

        <div class="solid-divider"></div>

        <div class="items">
          <div class="row bold items-header">
            <span>QTE x DESIGNATION</span>
            <span>MONTANT</span>
          </div>
          ${itemsHtml}
        </div>

        <div class="double-divider"></div>

        <div class="totals">
          <div class="row"><span>Total:</span> <span>${formatWithSpaces(subtotal)}</span></div>
          ${taxRowHtml}
          
          <div class="row net-pay-box">
            <span>NET À PAYER:</span> 
            <span>${formatWithSpaces(total)} DH</span>
          </div>
          ${notesHtml}
        </div>

        <div class="solid-divider"></div>

        <div class="footer">
          <p class="bold">Merci de votre confiance</p>
          <div class="qr-placeholder">
            [ QR CODE ]
          </div>
        </div>

      </div>
    </body>
    </html>
  `);
  doc.close();

  // 4. Trigger native browser print
  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();

    // 5. Cleanup
    setTimeout(() => {
      iframe.remove();
    }, 1000);
  }, 250);
};

export const TicketPrint: React.FC<Props> = ({ data }) => {
  const emitterName = data.emitter
    ? `${data.emitter.nameFirstPart || ''} ${data.emitter.nameSecondPart || ''}`.trim()
    : 'ADVANCED IT';
  const tagline = data.emitter?.tagline || 'Matériel Informatique & High-Tech';
  const footerLine1 =
    data.emitter?.footerLine1 || 'RC : 180841 - Taxe pro : 26308144 - IF : 66093257';
  const footerLine2 = data.emitter?.footerLine2 || 'ICE : 003591901000049';

  let refLabel = data.number || '000000';

  const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxRate = data.taxRate || 0;
  const taxAmount = subtotal * taxRate;
  const total = data.total !== undefined ? data.total : subtotal + taxAmount;

  const formattedDate = data.date || new Date().toLocaleDateString('fr-FR');
  const clientName = data.client?.name ? data.client.name.toUpperCase() : 'CLIENT OCCASIONNEL';
  const paymentMethod = data.modeReglement || 'Espèces';

  return (
    <div style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
      {/* Note: In standard rendering, this is a placeholder. Real printing happens via printTicket function */}
      <div style={{ textAlign: 'center', padding: '20px' }}>
        Previewing TicketPrint as React Component is not styled. Use printTicket() directly.
      </div>
    </div>
  );
};

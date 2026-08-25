import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { COMPANY_INFO } from '../constants';

export interface DeliveryNoteData {
  blNumber?: string;
  internalOrder?: string;
  clientBcNumber?: string;
  shippingDate?: string;
  transportMode?: string;
  client: {
    name: string;
    attn?: string;
    phone?: string;
    addressLine1?: string;
    city?: string;
  };
  items: Array<{
    id?: string | number;
    description: string;
    quantity: number;
    deliveredQuantity?: number;
    sn?: string;
    type?: 'product' | 'section' | 'note';
  }>;
}

interface Props {
  data: DeliveryNoteData;
}

export const DeliveryNotePrint: React.FC<Props> = ({ data }) => {
  const barcodeRef = useRef<SVGSVGElement>(null);

  const blRef =
    data.blNumber ||
    (data.internalOrder?.startsWith('WH/') || data.internalOrder?.startsWith('BL-')
      ? data.internalOrder
      : `WH/OUT/${data.internalOrder || '00001'}`);

  useEffect(() => {
    if (barcodeRef.current && blRef) {
      try {
        JsBarcode(barcodeRef.current, blRef, {
          format: 'CODE128',
          width: 1.1,
          height: 32,
          displayValue: true,
          fontSize: 9,
          margin: 4,
        });
      } catch (err) {
        console.error('Barcode error:', err);
      }
    }
  }, [blRef]);

  return (
    <div className="bl-print-root">
      <style>{`
        @page { size: A4; margin: 0; }
        .bl-print-root * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
        .bl-print-root { margin: 0; padding: 0; background-color: #ffffff; color: #2b2b2b; }
        .bl-page {
          width: 210mm;
          min-height: 297mm;
          background: #fff;
          margin: 0 auto;
          position: relative;
          padding: 40px 40px 90px 40px;
          display: flex;
          flex-direction: column;
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .bl-wave-top { position: absolute; top: 0; left: 0; width: 100%; height: 160px; pointer-events: none; z-index: 1; }
        .bl-wave-bottom { position: absolute; bottom: 0; left: 0; width: 100%; height: 110px; pointer-events: none; z-index: 1; }
        .bl-content { position: relative; z-index: 2; flex-grow: 1; }
        .bl-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; }
        .bl-logo-box h1 { margin: 0; font-size: 26px; font-weight: 700; color: #1a1a1a; letter-spacing: -0.5px; }
        .bl-logo-box h1 span { color: #f39c12; font-weight: 300; }
        .bl-logo-box .sub-logo { margin: 1px 0 0 35px; font-size: 9px; color: #888; letter-spacing: 2px; text-transform: uppercase; }
        .bl-company-info { text-align: right; font-size: 13px; line-height: 1.35; color: #333; }
        .bl-address-section { display: flex; justify-content: flex-end; margin-bottom: 25px; font-size: 13px; line-height: 1.45; }
        .bl-address-box { width: 260px; text-align: left; }
        .bl-title-barcode-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
        .bl-doc-title { margin: 0; display: flex; flex-direction: column; gap: 4px; }
        .bl-doc-label { font-size: 24px; font-weight: 500; color: #111; }
        .bl-doc-number { font-size: 20px; font-weight: 700; color: #333; }
        .bl-details-box { background-color: #f8f9fa; border-radius: 10px; padding: 15px 20px; display: flex; gap: 40px; margin-bottom: 30px; }
        .bl-details-item label { display: block; font-size: 11px; color: #888; margin-bottom: 3px; text-transform: uppercase; font-weight: 600; }
        .bl-details-item span { font-size: 13px; color: #111; font-weight: 600; }
        .bl-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 30px; }
        .bl-table th { border-bottom: 1px solid #111; padding: 10px 8px; font-weight: 600; color: #000; text-transform: uppercase; font-size: 12px; }
        .bl-table td { padding: 12px 8px; vertical-align: top; }
        .bl-sn-text { font-size: 11px; color: #666; margin-top: 4px; font-family: monospace; }
        .bl-table-row-grey { background-color: #f8f9fa; }
        .bl-text-left { text-align: left; }
        .bl-text-right { text-align: right; }
        .bl-signatures-section { margin-top: 40px; display: flex; justify-content: space-between; }
        .bl-signature-box { width: 45%; border: 1px dashed #ccc; border-radius: 6px; padding: 12px; height: 95px; font-size: 11px; color: #555; }
        .bl-footer { position: absolute; bottom: 20px; left: 0; width: 100%; text-align: center; font-size: 9.5px; color: #222; z-index: 2; line-height: 1.5; }
        .bl-footer a { color: #0056b3; text-decoration: none; }
      `}</style>

      <div className="bl-page">
        {/* Top Wave */}
        <svg className="bl-wave-top" viewBox="0 0 500 150" preserveAspectRatio="none">
          <path d="M0,40 C150,90 350,-10 500,40 L500,0 L0,0 Z" fill="#f0f2f5" opacity="0.7"></path>
        </svg>

        <div className="bl-content">
          {/* Header */}
          <div className="bl-header">
            <div className="bl-logo-box">
              <h1>
                ADVANCED <span>iT</span>
              </h1>
              <div className="sub-logo">BY WORKSTATION</div>
            </div>
            <div className="bl-company-info">
              <strong>{COMPANY_INFO.name || 'Advanced IT'}</strong>
              <br />
              Rabat, Maroc
              <br />
              ICE : <strong>{COMPANY_INFO.ice}</strong>
            </div>
          </div>

          {/* Delivery Address */}
          <div className="bl-address-section">
            <div className="bl-address-box">
              <strong>Adresse de Livraison</strong>
              <br />
              <span className="font-semibold">{data.client.name || 'CLIENT'}</span>
              <br />
              {data.client.attn && (
                <>
                  Attn: {data.client.attn}
                  <br />
                </>
              )}
              {data.client.phone && (
                <>
                  Tél: {data.client.phone}
                  <br />
                </>
              )}
              {data.client.addressLine1 && (
                <>
                  {data.client.addressLine1}
                  <br />
                </>
              )}
              {data.client.city ? `${data.client.city} - Maroc` : 'Maroc'}
            </div>
          </div>

          {/* Title & Barcode */}
          <div className="bl-title-barcode-row">
            <h2 className="bl-doc-title">
              <span className="bl-doc-label">Bon de livraison</span>
              <span className="bl-doc-number">{blRef}</span>
            </h2>
            <div>
              <svg ref={barcodeRef} id="bl-barcode-svg"></svg>
            </div>
          </div>

          {/* Details Box */}
          <div className="bl-details-box">
            <div className="bl-details-item">
              <label>Commande Interne</label>
              <span>{data.internalOrder || 'N/A'}</span>
            </div>
            <div className="bl-details-item">
              <label>N° BC Client</label>
              <span>{data.clientBcNumber || 'N/A'}</span>
            </div>
            <div className="bl-details-item">
              <label>Date d'expédition</label>
              <span>{data.shippingDate || new Date().toLocaleDateString('fr-FR')}</span>
            </div>
          </div>

          {/* Table */}
          <table className="bl-table">
            <thead>
              <tr>
                <th className="bl-text-left" style={{ width: '70%' }}>
                  Produit
                </th>
                <th className="bl-text-right" style={{ width: '15%' }}>
                  Commandé
                </th>
                <th className="bl-text-right" style={{ width: '15%' }}>
                  Livré
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, idx) => {
                if (item.type === 'section') {
                  return (
                    <tr key={idx} className="bg-slate-100/80">
                      <td colSpan={3} className="font-bold text-slate-800 py-2 px-2 uppercase text-xs">
                        {item.description}
                      </td>
                    </tr>
                  );
                }
                if (item.type === 'note') {
                  return (
                    <tr key={idx}>
                      <td colSpan={3} className="italic text-slate-500 py-1 px-2 text-xs">
                        {item.description}
                      </td>
                    </tr>
                  );
                }

                const isEven = idx % 2 === 0;
                const cmdQty = Number(item.quantity) || 0;
                const delQty = item.deliveredQuantity !== undefined ? Number(item.deliveredQuantity) : cmdQty;

                return (
                  <tr key={idx} className={isEven ? 'bl-table-row-grey' : ''}>
                    <td className="bl-text-left">
                      <div className="font-medium text-slate-900">{item.description}</div>
                      {item.sn && <div className="bl-sn-text">{item.sn}</div>}
                    </td>
                    <td className="bl-text-right font-medium">{cmdQty}</td>
                    <td className="bl-text-right font-semibold text-slate-900">{delQty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Signatures */}
          <div className="bl-signatures-section">
            <div className="bl-signature-box">
              <strong>Transporteur / Livreur :</strong>
            </div>
            <div className="bl-signature-box">
              <strong>Visa / Cachet Client :</strong>
              <div style={{ fontSize: '9px', color: '#888', marginTop: '3px' }}>
                Date et Signature (Précédé de "Reçu conforme")
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Wave */}
        <svg className="bl-wave-bottom" viewBox="0 0 500 150" preserveAspectRatio="none">
          <path d="M0,100 C200,150 350,80 500,120 L500,150 L0,150 Z" fill="#f0f2f5" opacity="0.6"></path>
        </svg>

        {/* Footer */}
        <div className="bl-footer">
          <strong>{COMPANY_INFO.name || 'Advanced it'}</strong> - RIB :{' '}
          <strong>
            {COMPANY_INFO.rib} {COMPANY_INFO.bankName}
          </strong>{' '}
          - RC : <strong>{COMPANY_INFO.rc}</strong> - Taxe professionnelle :{' '}
          <strong>{COMPANY_INFO.tp}</strong> - IF : <strong>{COMPANY_INFO.if}</strong>
          <br />
          ICE : <strong>{COMPANY_INFO.ice}</strong> - Téléphone :{' '}
          <strong>{COMPANY_INFO.phone}</strong> - Email :{' '}
          <a href={`mailto:${COMPANY_INFO.email}`}>{COMPANY_INFO.email}</a>
          <br />
          Page 1 / 1
        </div>
      </div>
    </div>
  );
};

import { InvoiceData } from './types';

export const mockInvoiceData: InvoiceData = {
  type: 'DEVIS',
  number: '#S00001',
  date: '8 juin 2026',
  validity: '7 Jours',
  paymentTerms: 'Paiement immédiat',
  client: {
    name: 'SOMEWAY AGENCY',
    addressLine1: 'Bd Lalla Yacout et rue El Araar, Rés Galis, Casablanca',
    ice: '00344297500001',
  },
  items: [
    {
      id: '1',
      description: 'Ecran gamer MSI G2412F 24" 180Hz IPS FHD 1ms',
      quantity: 1,
      unitPrice: 1890.0,
    },
    {
      id: '2',
      description: 'Clavier Mécanique RGB TKL Switch Red',
      quantity: 2,
      unitPrice: 650.0,
    },
    {
      id: '3',
      description: 'Souris Gamer Sans Fil Légère 12000 DPI',
      quantity: 1,
      unitPrice: 420.0,
    },
    {
      id: '4',
      description: "Prestation d'installation et configuration poste de travail",
      quantity: 1,
      unitPrice: 1500.0,
    },
  ],
  taxRate: 0.2,
  notes:
    "Veuillez vérifier les articles ci-dessus. Tout équipement installé bénéficie d'une garantie d'un an constructeur.\nLe délai de livraison estimé est de 2 semaines après validation.",
  emitter: {
    nameFirstPart: 'ADVANCED',
    nameSecondPart: 'IT',
    tagline: 'BY WORKSTATION',
    email: 'contact@workstation.ma',
    phone: '+212 808 501 756',
    footerLine1:
      'Advanced IT - RIB: 360810000003431546001739 OMNIA BANK - RC: 180841 - Taxe professionnelle: 26308144 - IF: 66093257',
    footerLine2:
      'ICE: 003591901000049 - Téléphone: +212 808 501 756 - Email: contact@workstation.ma',
  },
};

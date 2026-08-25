export interface InvoiceItem {
  id: string | number;
  description: string;
  quantity: number;
  unitPrice: number;
  type?: 'product' | 'section' | 'note';
}

export interface InvoiceData {
  type: 'DEVIS' | 'FACTURE' | 'COMMANDE';
  number: string;
  date: string;
  validity: string;
  paymentTerms: string;
  modeReglement?: string;
  conditionsPaiement?: string;
  client: {
    name: string;
    addressLine1: string;
    city?: string;
    phone?: string;
    ice: string;
  };
  items: InvoiceItem[];
  taxRate: number; // e.g. 0.20 for 20%
  notes?: string;
  amountPaid?: number;
  paymentStatus?: string;
  total?: number;
  subtotal?: number;
  emitter?: {
    nameFirstPart: string;
    nameSecondPart: string;
    tagline: string;
    email: string;
    phone: string;
    footerLine1: string;
    footerLine2: string;
  };
}

export interface Client {
  id: string;
  ownerId: string;
  name: string;
  phone?: string;
  email?: string;
  ice?: string;
  address?: string;
  city?: string;
  linkedPartnerId?: string;
  createdAt?: string;
}

export interface Supplier {
  id: string;
  ownerId: string;
  name: string;
  phone?: string;
  email?: string;
  ice?: string;
  address?: string;
  city?: string;
  contactPerson?: string;
  category?: string;
  createdAt?: string;
}

export interface PurchaseItem {
  description: string;
  quantity: number;
  price: number;
  total?: number;
}

export interface Purchase {
  id: string;
  ownerId: string;
  clientId?: string;
  supplierId?: string;
  ref?: string;
  invoiceNumber?: string;
  type?: 'sale' | 'purchase' | 'devis' | 'facture' | 'bl';
  description?: string;
  price?: number;
  quantity?: number;
  total: number;
  subtotal?: number;
  taxRate?: number;
  taxAmount?: number;
  paymentStatus: 'paid' | 'credit' | 'partial';
  amountPaid: number;
  remainingAmount?: number;
  dueDate?: string;
  date: string;
  items?: PurchaseItem[];
  notes?: string;
  createdAt?: string;
}

export interface Payment {
  id: string;
  ownerId: string;
  clientId?: string;
  supplierId?: string;
  purchaseId?: string;
  amount: number;
  date: string;
  mode?: 'cash' | 'check' | 'transfer' | 'other';
  reference?: string;
  notes?: string;
  createdAt?: string;
}

export interface Expense {
  id: string;
  ownerId: string;
  templateId?: string;
  name: string;
  amount: number;
  date: string;
  category?: string;
  status: 'paid' | 'pending';
  paymentMode?: string;
  notes?: string;
  createdAt?: string;
}

export interface TrackingEvent {
  date: string;
  heure?: string;
  localisation: string;
  details: string;
}

export interface TrackingSummary {
  poids: string;
  produit: string;
  crbt: string;
  depart: string;
  arrivee: string;
}

export interface TrackingRecord {
  code: string;
  summary: TrackingSummary;
  results: TrackingEvent[];
  currentStep: number;
  isFinished: boolean;
  lastUpdated: string;
  fromCache?: boolean;
}


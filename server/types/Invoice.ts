export interface InvoiceItem {
  description: string;
  quantity: number;
  price: number;
}

export interface InvoiceScanResult {
  ref: string;
  date: string;
  supplierId: string | null;
  applyTax: boolean;
  taxRate: number;
  subtotal: number;
  total: number;
  items: InvoiceItem[];
  validationErrors?: string[];
}

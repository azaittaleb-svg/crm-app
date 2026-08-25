export interface ExtractItemsRequest {
  prompt: string;
  exchangeRate: number;
}

export interface ExtractedMotchoItem {
  designation: string;
  qte: number;
  prix_dollar: number;
  price_markup_usd: number;
  ship_usd: number;
  diw_dh: number;
  en_dirham: number;
  qte_total: number;
}

export interface ExtractedMotchoResult {
  vendor_name: string;
  taux_change: number;
  items: ExtractedMotchoItem[];
  grand_total_overall: number;
}

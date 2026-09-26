// api(OCC 風の REST)から受け取るデータの形。
// api 側で項目が増減しても落ちないよう、なくてもよい項目は ? を付けています。
// fields=BASIC / DEFAULT / FULL で返ってくる項目の量が変わるので、ほとんどの項目が ? です。

export interface Price {
  currencyIso?: string;
  value?: number;
  formattedValue?: string;
}

export interface Image {
  url?: string;
  altText?: string;
  format?: string;
}

export interface Stock {
  stockLevelStatus?: string; // inStock / lowStock / outOfStock
  stockLevel?: number;
}

export interface Product {
  code: string;
  name?: string;
  summary?: string;
  description?: string;
  price?: Price;
  images?: Image[];
  stock?: Stock;
  categories?: { code?: string; name?: string }[];
}

export interface Pagination {
  currentPage?: number;
  pageSize?: number;
  totalPages?: number;
  totalResults?: number;
}

export interface ProductSearchPage {
  products?: Product[];
  pagination?: Pagination;
  freeTextSearch?: string;
}

// ---- CMS ----------------------------------------------------------------
// cms/pages の JSON の形:
//   ページ ─ contentSlots.contentSlot[](スロット = 部品を置く「枠」)
//            └ components.component[](部品。typeCode で種類が分かる)

/** CMS の部品 1 つ。typeCode 以外の属性は部品の種類ごとに違います */
export interface CmsComponentData {
  uid: string;
  typeCode: string;
  name?: string;
}

export interface CmsSlot {
  slotId: string;
  position?: string;
  components?: { component?: CmsComponentData[] };
}

export interface CmsPage {
  uid: string;
  name?: string;
  template?: string;
  title?: string;
  contentSlots?: { contentSlot?: CmsSlot[] };
}

// ---- 注文 ----------------------------------------------------------------

export interface OrderEntry {
  product?: { code?: string; name?: string };
  quantity?: number;
  totalPrice?: Price;
}

export interface Order {
  code: string;
  placed?: string;
  status?: string;
  total?: Price;
  entries?: OrderEntry[];
}

export interface OrderHistory {
  orders?: Order[];
}

// ---- OAuth ---------------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

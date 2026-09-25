// API から受け取るデータの形。api 側で項目が増減しても落ちないよう、なくてもよい項目は ? を付けています。

export interface Product {
  id: number | string;
  name: string;
  price: number;
  description?: string;
  imageUrl?: string | null;
  stock?: number;
}

export interface OrderItem {
  productId: number | string;
  name?: string;
  qty: number;
  price: number;
}

export interface Order {
  id: number | string;
  userId?: number | string;
  items?: OrderItem[];
  total?: number;
  createdAt?: string;
}

export interface LoginResponse {
  token: string;
}

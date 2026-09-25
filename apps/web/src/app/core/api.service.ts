import { Injectable, PLATFORM_ID, TransferState, inject, makeStateKey } from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';
import { LoginResponse, Order, Product } from './models';

/**
 * API を呼ぶ窓口。
 * 商品のように「サーバーで描画するときにも使うデータ」は TransferState(サーバーからブラウザへの申し送り)に入れます。
 * ブラウザは最初の表示のとき、申し送りがあれば API を呼び直しません(同じ問い合わせを 2 回しないため)。
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);

  listProducts(q: string): Observable<Product[]> {
    const params = q ? new HttpParams().set('q', q) : undefined;
    return this.cachedGet<Product[]>(`products?q=${q}`, '/api/products', params);
  }

  getProduct(id: string): Observable<Product> {
    return this.cachedGet<Product>(`product:${id}`, `/api/products/${encodeURIComponent(id)}`);
  }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>('/api/login', { username, password });
  }

  // 注文はログインした人だけのデータなので、申し送り(TransferState)には入れません
  myOrders(): Observable<Order[]> {
    return this.http.get<Order[]>('/api/me/orders');
  }

  getOrder(orderId: string): Observable<Order> {
    return this.http.get<Order>(`/api/orders/${encodeURIComponent(orderId)}`);
  }

  private cachedGet<T>(name: string, url: string, params?: HttpParams): Observable<T> {
    const key = makeStateKey<T>(`api:${name}`);
    if (isPlatformBrowser(this.platformId) && this.state.hasKey(key)) {
      const value = this.state.get(key, null as T);
      this.state.remove(key); // 使うのは最初の 1 回だけ。画面を行き来したら新しく取り直します
      return of(value);
    }
    return this.http.get<T>(url, { params }).pipe(
      tap((value) => {
        if (isPlatformServer(this.platformId)) this.state.set(key, value);
      }),
    );
  }
}

/** API のエラーを、画面に出せる短い日本語にします */
export function describeError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401) return 'ログインが必要です(または合言葉の有効期限が切れました)。';
  if (status === 403) return 'この操作は許可されていません。';
  if (status === 404) return '見つかりませんでした。';
  if (status === 429) return 'アクセスが多すぎます。少し待ってからやり直してください。';
  if (status && status >= 500) return `サーバーで問題が起きました(${status})。`;
  return 'API に届きませんでした。';
}

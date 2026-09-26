import { Injectable, PLATFORM_ID, TransferState, inject, makeStateKey } from '@angular/core';
import { isPlatformBrowser, isPlatformServer } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, catchError, of, tap, throwError } from 'rxjs';
import { CmsPage, Order, OrderHistory, Product, ProductSearchPage, TokenResponse } from './models';

/**
 * OCC 風 API の先頭。サイト ID(baseSiteId)は samplestore です。
 * ここでは「住所の後半(パス)」だけを書きます。前半(http://api:3001 か http://api.lab.localhost:18080 か)は
 * api-base.interceptor.ts が、サーバーかブラウザかを見て付け足します。
 */
export const OCC_PREFIX = '/occ/v2/samplestore';
export const TOKEN_PATH = '/authorizationserver/oauth/token';

/** fields パラメータ。返す項目の量(BASIC < DEFAULT < FULL)。多いほど api も通信も重くなります */
export type Fields = 'BASIC' | 'DEFAULT' | 'FULL';

export type CmsPageRequest =
  | { pageType: 'ContentPage'; pageLabelOrId: string }
  | { pageType: 'ProductPage' | 'CategoryPage'; code: string };

/**
 * api を呼ぶ窓口。
 *
 * 【TransferState = サーバーからブラウザへの申し送り】
 * SSR 中にサーバーが api から受け取ったデータ(CMS のページ・商品)は、HTML の中の
 * <script id="ng-state" type="application/json"> に入れてブラウザへ渡します。
 * ブラウザは最初の表示(ハイドレーション)のとき、申し送りがあれば api を呼び直しません。
 * → 同じ問い合わせを 2 回しない / 画面がちらつかない。
 * 開発者ツールの Network で、最初の表示では api への通信が 0 件になることで確かめられます。
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly state = inject(TransferState);
  private readonly platformId = inject(PLATFORM_ID);

  /** CMS のページ(画面の設計図)。例: ?pageType=ContentPage&pageLabelOrId=homepage */
  getCmsPage(req: CmsPageRequest): Observable<CmsPage> {
    let params = new HttpParams().set('pageType', req.pageType);
    params = 'code' in req ? params.set('code', req.code) : params.set('pageLabelOrId', req.pageLabelOrId);
    return this.cachedGet<CmsPage>(`${OCC_PREFIX}/cms/pages`, params);
  }

  getProduct(code: string, fields: Fields = 'DEFAULT'): Observable<Product> {
    return this.cachedGet<Product>(
      `${OCC_PREFIX}/products/${encodeURIComponent(code)}`,
      new HttpParams().set('fields', fields),
    );
  }

  searchProducts(query: string, currentPage = 0, pageSize = 20): Observable<ProductSearchPage> {
    const params = new HttpParams()
      .set('query', query)
      .set('currentPage', String(currentPage))
      .set('pageSize', String(pageSize))
      .set('fields', 'DEFAULT');
    return this.cachedGet<ProductSearchPage>(`${OCC_PREFIX}/products/search`, params);
  }

  /**
   * ログイン = OAuth のトークンをもらう(パスワードグラント)。
   * 本文は JSON ではなく application/x-www-form-urlencoded(HttpParams を渡すと Angular がこの形にします)。
   * client_id=storefront は「このアプリは storefront です」という名乗り。秘密の合言葉(client_secret)は持ちません
   * (ブラウザに置いた秘密は誰でも見られるので、公開クライアントとして扱います)。
   */
  login(username: string, password: string): Observable<TokenResponse> {
    const body = new HttpParams()
      .set('grant_type', 'password')
      .set('client_id', 'storefront')
      .set('username', username)
      .set('password', password);
    return this.http.post<TokenResponse>(TOKEN_PATH, body);
  }

  // 注文はログインした人だけのデータなので、申し送り(TransferState)には入れません
  myOrders(): Observable<OrderHistory> {
    return this.http.get<OrderHistory>(`${OCC_PREFIX}/users/current/orders`);
  }

  getOrder(code: string): Observable<Order> {
    return this.http.get<Order>(`${OCC_PREFIX}/users/current/orders/${encodeURIComponent(code)}`);
  }

  private cachedGet<T>(path: string, params: HttpParams): Observable<T> {
    // 申し送りの名札は「パス + 問い合わせ」。サーバーとブラウザで api の住所(前半)が違っても、名札は同じになります
    const key = makeStateKey<T | NotFoundMark>(`api:${path}?${params.toString()}`);
    if (isPlatformBrowser(this.platformId) && this.state.hasKey(key)) {
      const value = this.state.get(key, null);
      this.state.remove(key); // 使うのは最初の 1 回だけ。画面を行き来したら新しく取り直します
      if (isNotFoundMark(value)) return throwError(() => new HttpErrorResponse({ status: 404, url: path }));
      return of(value as T);
    }
    const isServer = isPlatformServer(this.platformId);
    return this.http.get<T>(path, { params }).pipe(
      tap((value) => {
        if (isServer) this.state.set(key, value);
      }),
      // 「無かった(404)」も申し送ります。ブラウザが同じ 404 を取りに行き直さないためです
      catchError((err: unknown) => {
        if (isServer && err instanceof HttpErrorResponse && err.status === 404) this.state.set(key, { notFound: true });
        return throwError(() => err);
      }),
    );
  }
}

interface NotFoundMark {
  notFound: true;
}
function isNotFoundMark(v: unknown): v is NotFoundMark {
  return typeof v === 'object' && v !== null && (v as NotFoundMark).notFound === true;
}

/** API のエラーを、画面に出せる短い日本語にします */
export function describeError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401) return 'ログインが必要です(またはトークンの有効期限が切れました)。';
  if (status === 403) return 'この操作は許可されていません。';
  if (status === 404) return '見つかりませんでした。';
  if (status === 429) return 'アクセスが多すぎます。少し待ってからやり直してください。';
  if (status && status >= 500) return `サーバーで問題が起きました(${status})。`;
  // status 0 = 返事が読めなかった。別オリジンの api が CORS を許していないときもこうなります
  return 'API に届きませんでした(CORS で断られた可能性もあります。開発者ツールのコンソールを見てください)。';
}

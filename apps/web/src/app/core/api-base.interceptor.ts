import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { API_BASE_URL, API_CALL_TRACER } from './tokens';
import { AuthService } from './auth.service';

/**
 * api へのリクエストに、3 つのことをします。
 *
 * 1. 住所の前半を付ける
 *    画面のコードは「/occ/v2/samplestore/products/...」のようにパスだけを書きます。
 *    前半は、サーバー(SSR 中)なら API_INTERNAL_URL、ブラウザなら API_PUBLIC_URL です(core/tokens.ts)。
 *
 * 2. ログイン中なら Authorization: Bearer <トークン> を付ける(/users/ の下だけ)
 *    商品や CMS のように誰が見ても同じものには付けません。付けると
 *      - cdn-waf がキャッシュしなくなる(人ごとのデータかもしれないため)
 *      - ブラウザが本番の前に「送ってよいか」の確認(CORS のプリフライト = OPTIONS)をするようになる(同じ URL なら 10 分は覚えておくが、商品ごとに URL が違う)
 *    ためです。
 *
 * 3. (サーバーだけ・OpenTelemetry が有効なときだけ)traceparent ヘッダを付ける
 *    「この api 呼び出しは、どの画面リクエストの一部か」を api に伝える番号です。
 *    Tempo で storefront → api のつながりが 1 本の道筋として見えるようになります。
 */
export const apiBaseInterceptor: HttpInterceptorFn = (req, next) => {
  const isApi = req.url.startsWith('/occ/') || req.url.startsWith('/authorizationserver/');
  if (!isApi) return next(req);

  const base = inject(API_BASE_URL).replace(/\/$/, '');
  const token = inject(AuthService).validToken();
  const headers: Record<string, string> = {};
  if (token && req.url.includes('/users/')) headers['Authorization'] = `Bearer ${token}`;

  const trace = inject(API_CALL_TRACER)?.(req.method, req.url) ?? null;
  if (trace) Object.assign(headers, trace.headers);

  const result = next(req.clone({ url: base + req.url, setHeaders: headers }));
  if (!trace) return result;
  return result.pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) trace.end(event.status);
      },
      error: (err: { status?: number }) => trace.end(err?.status ?? 0),
    }),
  );
};

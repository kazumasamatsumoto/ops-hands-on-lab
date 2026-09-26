import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject } from '@angular/core';

/**
 * 【api の住所は 2 つある】
 *
 *   サーバー(SSR 中の Node.js) ──→ API_INTERNAL_URL  例: http://api:3001
 *       … コンテナ同士の「内側の住所」。ブラウザからは届きません。
 *   ブラウザ                    ──→ API_PUBLIC_URL    例: http://api.lab.localhost:18080
 *       … 利用者の PC から届く「外向きの住所」(cdn-waf → ingress → api)。
 *         画面の住所(www.lab.localhost)とは別のオリジンなので、ブラウザは CORS の確認をします。
 *
 * CCv2 でも同じで、JS Storefront(SSR)は api のエンドポイントを呼び、
 * ブラウザは api 用のホスト名(api.…)を直接呼びます。
 *
 * 外向きの住所は「環境ごとに違う」ので、ビルドのときに JS へ焼き込みません(同じイメージを d1・s1・p1 で使うため)。
 * サーバー(server.ts)が HTML の <head> に
 *   <meta name="api-public-url" content="http://api.lab.localhost:18080">
 * を書き足して返し、ブラウザはそれを読みます(下の readPublicUrlFromMeta)。
 * <script> ではなく <meta> にしているのは、CSP(読み込んでよいスクリプトの一覧)に引っかからないためです。
 */
export const DEFAULT_API_PUBLIC_URL = 'http://api.lab.localhost:18080';
export const API_PUBLIC_URL_META = 'api-public-url';

function readPublicUrlFromMeta(): string {
  const meta = inject(DOCUMENT).querySelector(`meta[name="${API_PUBLIC_URL_META}"]`);
  return (meta?.getAttribute('content') || DEFAULT_API_PUBLIC_URL).replace(/\/$/, '');
}

/**
 * ブラウザから見た api の住所(外向き)。画像(/medias/...)の URL にも使います。
 * サーバーでも「HTML に書く画像の URL」には、こちら(外向き)を使います。内側の住所を HTML に書くと、ブラウザは画像を取れません。
 * - ブラウザ: <meta name="api-public-url"> の値
 * - サーバー: 環境変数 API_PUBLIC_URL(app.config.server.ts で上書き)
 */
export const API_PUBLIC_URL = new InjectionToken<string>('API_PUBLIC_URL', {
  providedIn: 'root',
  factory: readPublicUrlFromMeta,
});

/**
 * API を「呼ぶ」ときの住所(先頭部分)。
 * - ブラウザ: API_PUBLIC_URL と同じ
 * - サーバー: 環境変数 API_INTERNAL_URL(app.config.server.ts で上書き)
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => inject(API_PUBLIC_URL),
});

/**
 * わざと SSR を壊すスイッチ(環境変数 SSR_WINDOW_BUG)。
 * サーバーでは環境変数の値、ブラウザでは常に false です。
 */
export const SSR_WINDOW_BUG = new InjectionToken<boolean>('SSR_WINDOW_BUG', {
  providedIn: 'root',
  factory: () => false,
});

/**
 * 警告を記録する係。CMS の知らない部品(typeCode)を見つけたときなどに使います。
 * - ブラウザ: 開発者ツールのコンソールに console.warn で出します
 * - サーバー: 1 行 1 JSON のログとして標準出力に出します(app.config.server.ts で上書き。Loki で探せます)
 */
export type WarnLogger = (event: string, fields: Record<string, unknown>) => void;
export const WARN_LOGGER = new InjectionToken<WarnLogger>('WARN_LOGGER', {
  providedIn: 'root',
  factory: () => (event, fields) => console.warn(`[storefront] ${event}`, fields),
});

/**
 * api を呼ぶたびに声をかける係(サーバーだけ。ブラウザでは使いません)。
 * サーバーではここで OpenTelemetry の「子の区間(span)」を作り、
 * api に渡す traceparent ヘッダ(= この呼び出しがどのリクエストの一部かを示す番号)を返します。
 */
export interface ApiCallTrace {
  headers: Record<string, string>;
  end(status: number): void;
}
export type ApiCallTracer = (method: string, url: string) => ApiCallTrace;
export const API_CALL_TRACER = new InjectionToken<ApiCallTracer | null>('API_CALL_TRACER', {
  providedIn: 'root',
  factory: () => null,
});

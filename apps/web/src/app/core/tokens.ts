import { InjectionToken } from '@angular/core';

/**
 * API の住所(先頭部分)。
 * - サーバーで描画するとき: 環境変数 API_INTERNAL_URL(既定 http://api:3001)。コンテナ同士の内側の住所です。
 * - ブラウザ: 空文字 = 同じオリジンの /api(edge が api へ振り分けます)。
 */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '',
});

/**
 * わざと SSR を壊すスイッチ(環境変数 SSR_WINDOW_BUG)。
 * サーバーでは環境変数の値、ブラウザでは常に false です。
 */
export const SSR_WINDOW_BUG = new InjectionToken<boolean>('SSR_WINDOW_BUG', {
  providedIn: 'root',
  factory: () => false,
});

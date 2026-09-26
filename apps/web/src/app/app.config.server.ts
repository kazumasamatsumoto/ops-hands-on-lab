import { mergeApplicationConfig, ApplicationConfig, REQUEST, REQUEST_CONTEXT, inject } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { API_BASE_URL, API_CALL_TRACER, API_PUBLIC_URL, DEFAULT_API_PUBLIC_URL, SSR_WINDOW_BUG, WARN_LOGGER } from './core/tokens';
import { SsrRequestContext, createApiCallTracer, createWarnLogger } from '../server/app-hooks';

const API_INTERNAL_URL = (process.env['API_INTERNAL_URL'] || 'http://api:3001').replace(/\/$/, '');

// ここはサーバー(Node.js)でだけ使う設定です。環境変数を読めるのはサーバーだけです。
// ブラウザ用の設定(app.config.ts)の上に、ここの値を上書きします。
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // api を「呼ぶ」住所 = 内側の住所
    { provide: API_BASE_URL, useValue: API_INTERNAL_URL },
    // HTML に書く画像などの住所 = 外向きの住所(ブラウザが読むので)
    {
      provide: API_PUBLIC_URL,
      useFactory: () => (process.env['API_PUBLIC_URL'] || DEFAULT_API_PUBLIC_URL).replace(/\/$/, ''),
    },
    { provide: SSR_WINDOW_BUG, useFactory: () => process.env['SSR_WINDOW_BUG'] === 'true' },
    // server.ts が渡した申し送り(トレースの区間)を使って、api 呼び出しをトレースに載せます
    {
      provide: API_CALL_TRACER,
      useFactory: () =>
        createApiCallTracer(inject(REQUEST_CONTEXT, { optional: true }) as SsrRequestContext | null, API_INTERNAL_URL),
    },
    {
      provide: WARN_LOGGER,
      useFactory: () =>
        createWarnLogger(
          inject(REQUEST_CONTEXT, { optional: true }) as SsrRequestContext | null,
          inject(REQUEST, { optional: true })?.url,
        ),
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

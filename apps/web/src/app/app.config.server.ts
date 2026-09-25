import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { API_BASE_URL, SSR_WINDOW_BUG } from './core/tokens';

// ここはサーバー(Node.js)でだけ使う設定です。環境変数を読めるのはサーバーだけです。
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    { provide: API_BASE_URL, useFactory: () => process.env['API_INTERNAL_URL'] || 'http://api:3001' },
    { provide: SSR_WINDOW_BUG, useFactory: () => process.env['SSR_WINDOW_BUG'] === 'true' },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);

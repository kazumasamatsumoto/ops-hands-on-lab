import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  provideClientHydration,
  withEventReplay,
  withNoHttpTransferCache,
} from '@angular/platform-browser';

import { routes } from './app.routes';
import { apiBaseInterceptor } from './core/api-base.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([apiBaseInterceptor])),
    // ハイドレーション = サーバーが作った HTML をそのまま使い、ブラウザは「動き」だけを付け足す仕組み。
    // API の結果の申し送りは ApiService が TransferState で自前で行うので、自動の申し送りは切っています
    // (サーバーとブラウザで API の住所が違うため、自動のものでは一致しません)。
    provideClientHydration(withEventReplay(), withNoHttpTransferCache()),
  ],
};

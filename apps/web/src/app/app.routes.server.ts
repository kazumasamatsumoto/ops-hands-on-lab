import { RenderMode, ServerRoute } from '@angular/ssr';

// どの画面も、リクエストのたびにサーバーで描画します(商品や在庫は変わるので、ビルド時の事前描画はしません)。
// SSR をやめて CSR にする切り替えは、ここではなく server.ts の環境変数 RENDER_MODE で行います。
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];

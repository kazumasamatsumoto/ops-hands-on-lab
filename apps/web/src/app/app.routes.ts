import { Routes } from '@angular/router';
import { CmsRoute } from './cms/cms-route';
import { SearchPage } from './pages/search';
import { LoginPage } from './pages/login';
import { NotFoundPage } from './pages/not-found';

/**
 * 画面の一覧(URL → 部品)。
 * `/`・`/p/:code`・`/c/:code` は CMS 駆動の画面です。data に「どの CMS のページを取るか」を書き、
 * 部品(CmsRoute)はそれを api に頼んで、返ってきた設計図のとおりに部品を並べます(cms/cms-page.ts)。
 * URL の形 /p/{商品コード}・/c/{分類コード} は、CCv2 の Composable Storefront の商品ページ・分類ページの URL に合わせています。
 */
export const routes: Routes = [
  {
    path: '',
    component: CmsRoute,
    data: { pageType: 'ContentPage', pageLabelOrId: 'homepage' },
    title: 'サンプルストア',
  },
  {
    path: 'p/:code',
    component: CmsRoute,
    data: { pageType: 'ProductPage' },
    title: '商品詳細 | サンプルストア',
  },
  {
    // 分類ページ(例 /c/kitchen)。バナーと分類の商品の並びは api の CMS(pageType=CategoryPage)が決めます。
    path: 'c/:code',
    component: CmsRoute,
    data: { pageType: 'CategoryPage' },
    title: '分類 | サンプルストア',
  },
  { path: 'search', component: SearchPage, title: '検索結果 | サンプルストア' },
  { path: 'login', component: LoginPage, title: 'ログイン | サンプルストア' },
  {
    // 注文履歴は「遅延読み込み」。最初の JS には入れず、この画面を開いたときに別ファイル(チャンク)を読み込みます。
    // 最初に読む JS が小さくなるので、トップや商品ページの表示が速くなります。
    path: 'my-account/orders',
    loadChildren: () => import('./my-account/orders.routes').then((m) => m.ORDER_ROUTES),
  },
  { path: '**', component: NotFoundPage, title: 'ページが見つかりません | サンプルストア' },
];

import { Routes } from '@angular/router';
import { HomePage } from './pages/home';
import { ProductListPage } from './pages/product-list';
import { ProductDetailPage } from './pages/product-detail';
import { LoginPage } from './pages/login';
import { NotFoundPage } from './pages/not-found';

export const routes: Routes = [
  { path: '', component: HomePage, title: 'サンプルストア' },
  { path: 'products', component: ProductListPage, title: '商品一覧 | サンプルストア' },
  { path: 'products/:id', component: ProductDetailPage, title: '商品詳細 | サンプルストア' },
  { path: 'login', component: LoginPage, title: 'ログイン | サンプルストア' },
  {
    // 注文履歴は「遅延読み込み」。最初の JS には入れず、この画面を開いたときに別ファイル(チャンク)を読み込みます。
    // 最初に読む JS が小さくなるので、トップや商品一覧の表示が速くなります。
    path: 'me/orders',
    loadChildren: () => import('./orders/orders.routes').then((m) => m.ORDER_ROUTES),
  },
  { path: '**', component: NotFoundPage, title: 'ページが見つかりません | サンプルストア' },
];

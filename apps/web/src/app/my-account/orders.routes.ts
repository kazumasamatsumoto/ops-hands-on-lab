import { Routes } from '@angular/router';
import { OrderListPage } from './order-list';
import { OrderDetailPage } from './order-detail';

// このファイルから先は「遅延読み込み」されます(ビルド結果で別の JS ファイル = チャンクになります)。
export const ORDER_ROUTES: Routes = [
  { path: '', component: OrderListPage, title: '注文履歴 | サンプルストア' },
  { path: ':code', component: OrderDetailPage, title: '注文の詳細 | サンプルストア' },
];

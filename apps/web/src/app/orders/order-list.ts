import { Component, PLATFORM_ID, inject } from '@angular/core';
import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApiService, describeError } from '../core/api.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-order-list',
  imports: [RouterLink, DatePipe, DecimalPipe],
  template: `
    <h1>注文履歴</h1>

    @if (!isBrowser) {
      <!-- サーバーはログインの合言葉を知らないので、注文はブラウザで読み込みます -->
      <p class="muted">読み込み中…</p>
    } @else if (!auth.token()) {
      <p>注文履歴を見るには <a routerLink="/login">ログイン</a> してください。</p>
    } @else if (orders.isLoading()) {
      <p class="muted">読み込み中…</p>
    } @else if (orders.error()) {
      <p class="error">注文履歴を読み込めませんでした。{{ errorText() }}</p>
    } @else {
      @let list = orders.value() ?? [];
      @if (list.length === 0) {
        <p class="muted">注文はまだありません。</p>
      } @else {
        <table class="orders">
          <thead>
            <tr><th>注文番号</th><th>注文日時</th><th>品数</th><th class="num">合計</th></tr>
          </thead>
          <tbody>
            @for (o of list; track o.id) {
              <tr>
                <td><a [routerLink]="['/me/orders', o.id]">{{ o.id }}</a></td>
                <td>{{ o.createdAt ? (o.createdAt | date: 'yyyy/MM/dd HH:mm') : '-' }}</td>
                <td>{{ o.items?.length ?? '-' }}</td>
                <td class="num">{{ o.total !== undefined ? (o.total | number) + ' 円' : '-' }}</td>
              </tr>
            }
          </tbody>
        </table>
      }
    }
  `,
})
export class OrderListPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly orders = rxResource({
    // params が undefined の間は読み込みません(サーバー上や未ログインのとき)
    params: () => (this.isBrowser && this.auth.token() ? { token: this.auth.token() } : undefined),
    stream: () => this.api.myOrders(),
  });

  errorText(): string {
    return describeError(this.orders.error());
  }
}

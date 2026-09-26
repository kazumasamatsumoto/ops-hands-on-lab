import { Component, PLATFORM_ID, effect, inject } from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApiService, describeError } from '../core/api.service';
import { AuthService } from '../core/auth.service';

/**
 * 注文履歴(GET /occ/v2/samplestore/users/current/orders、Bearer 必須)。
 * 「current」= トークンの持ち主。URL に会員番号を書かないので、他人の番号に書き換える事故が起きにくい形です。
 */
@Component({
  selector: 'app-order-list',
  imports: [RouterLink, DatePipe],
  template: `
    <h1>注文履歴</h1>

    @if (!isBrowser) {
      <!-- サーバーはログインのトークンを知らないので、注文はブラウザで読み込みます -->
      <p class="muted">読み込み中…</p>
    } @else if (!auth.token()) {
      <p>注文履歴を見るには <a routerLink="/login">ログイン</a> してください。</p>
    } @else if (orders.isLoading()) {
      <p class="muted">読み込み中…</p>
    } @else if (orders.error()) {
      <p class="error">注文履歴を読み込めませんでした。{{ errorText() }}</p>
    } @else {
      @let list = orders.value()?.orders ?? [];
      @if (list.length === 0) {
        <p class="muted">注文はまだありません。</p>
      } @else {
        <table class="orders">
          <thead>
            <tr><th>注文番号</th><th>注文日時</th><th>状態</th><th>品数</th><th class="num">合計</th></tr>
          </thead>
          <tbody>
            @for (o of list; track o.code) {
              <tr>
                <td><a [routerLink]="['/my-account/orders', o.code]">{{ o.code }}</a></td>
                <td>{{ o.placed ? (o.placed | date: 'yyyy/MM/dd HH:mm') : '-' }}</td>
                <td>{{ o.status ?? '-' }}</td>
                <td>{{ o.entries?.length ?? '-' }}</td>
                <td class="num">{{ o.total?.formattedValue ?? '-' }}</td>
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

  constructor() {
    // トークンの期限切れなどで 401 が返ったら、持っているトークンを捨ててログインへ案内します
    effect(() => {
      const e = this.orders.error();
      if (e instanceof HttpErrorResponse && e.status === 401) this.auth.logout();
    });
  }

  errorText(): string {
    return describeError(this.orders.error());
  }
}

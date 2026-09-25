import { Component, PLATFORM_ID, inject, input } from '@angular/core';
import { DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApiService, describeError } from '../core/api.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-order-detail',
  imports: [RouterLink, DatePipe, DecimalPipe],
  template: `
    <p><a routerLink="/me/orders">← 注文履歴へ戻る</a></p>
    <h1>注文 {{ orderId() }}</h1>

    @if (!isBrowser) {
      <p class="muted">読み込み中…</p>
    } @else if (!auth.token()) {
      <p>注文を見るには <a routerLink="/login">ログイン</a> してください。</p>
    } @else if (order.isLoading()) {
      <p class="muted">読み込み中…</p>
    } @else if (order.error()) {
      <p class="error">注文を表示できませんでした。{{ errorText() }}</p>
    } @else if (order.value(); as o) {
      <p class="muted">
        注文日時: {{ o.createdAt ? (o.createdAt | date: 'yyyy/MM/dd HH:mm') : '-' }}
        / 会員番号: {{ o.userId ?? '-' }}
      </p>
      <table class="orders">
        <thead>
          <tr><th>商品</th><th class="num">数量</th><th class="num">単価</th></tr>
        </thead>
        <tbody>
          @for (item of o.items ?? []; track $index) {
            <tr>
              <td><a [routerLink]="['/products', item.productId]">{{ item.name ?? item.productId }}</a></td>
              <td class="num">{{ item.qty }}</td>
              <td class="num">{{ item.price | number }} 円</td>
            </tr>
          }
        </tbody>
        @if (o.total !== undefined) {
          <tfoot>
            <tr><th colspan="2">合計</th><td class="num">{{ o.total | number }} 円</td></tr>
          </tfoot>
        }
      </table>
    }
  `,
})
export class OrderDetailPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  /** URL の :orderId がここに入ります */
  readonly orderId = input.required<string>();

  readonly order = rxResource({
    params: () =>
      this.isBrowser && this.auth.token() ? { id: this.orderId(), token: this.auth.token() } : undefined,
    stream: ({ params }) => this.api.getOrder(params.id),
  });

  errorText(): string {
    return describeError(this.order.error());
  }
}

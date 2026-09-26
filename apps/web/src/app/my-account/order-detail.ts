import { Component, PLATFORM_ID, inject, input } from '@angular/core';
import { DatePipe, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApiService, describeError } from '../core/api.service';
import { AuthService } from '../core/auth.service';

/**
 * 注文の詳細(GET /occ/v2/samplestore/users/current/orders/{code})。
 * 自分の注文でなければ api は 404 を返します(api の idorBug=true のときは確かめなくなり、他人の注文が見えてしまいます)。
 */
@Component({
  selector: 'app-order-detail',
  imports: [RouterLink, DatePipe],
  template: `
    <p><a routerLink="/my-account/orders">← 注文履歴へ戻る</a></p>
    <h1>注文 {{ code() }}</h1>

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
        注文日時: {{ o.placed ? (o.placed | date: 'yyyy/MM/dd HH:mm') : '-' }} / 状態: {{ o.status ?? '-' }}
      </p>
      <table class="orders">
        <thead>
          <tr><th>商品</th><th class="num">数量</th><th class="num">小計</th></tr>
        </thead>
        <tbody>
          @for (e of o.entries ?? []; track $index) {
            <tr>
              <td>
                @if (e.product?.code; as pc) {
                  <a [routerLink]="['/p', pc]">{{ e.product?.name ?? pc }}</a>
                } @else {
                  -
                }
              </td>
              <td class="num">{{ e.quantity ?? '-' }}</td>
              <td class="num">{{ e.totalPrice?.formattedValue ?? '-' }}</td>
            </tr>
          }
        </tbody>
        @if (o.total?.formattedValue) {
          <tfoot>
            <tr><th colspan="2">合計</th><td class="num">{{ o.total?.formattedValue }}</td></tr>
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
  /** URL の :code がここに入ります */
  readonly code = input.required<string>();

  readonly order = rxResource({
    params: () => (this.isBrowser && this.auth.token() ? { code: this.code(), token: this.auth.token() } : undefined),
    stream: ({ params }) => this.api.getOrder(params.code),
  });

  errorText(): string {
    return describeError(this.order.error());
  }
}

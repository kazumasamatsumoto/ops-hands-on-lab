import { Component, RESPONSE_INIT, effect, inject, input } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApiService, describeError } from '../core/api.service';

@Component({
  selector: 'app-product-detail',
  imports: [RouterLink, DecimalPipe],
  template: `
    <p><a routerLink="/products">← 商品一覧へ戻る</a></p>

    @if (product.isLoading()) {
      <p class="muted">読み込み中…</p>
    } @else if (product.error()) {
      <p class="error">商品を表示できませんでした。{{ errorText() }}</p>
    } @else if (product.value(); as p) {
      <article class="detail">
        @if (p.imageUrl) {
          <img [src]="p.imageUrl" [alt]="p.name" width="480" height="300" />
        } @else {
          <div class="noimage large" aria-hidden="true">画像なし</div>
        }
        <div>
          <h1>{{ p.name }}</h1>
          <p class="price large">{{ p.price | number }} 円</p>
          @if (p.stock !== undefined && p.stock !== null) {
            <p>
              在庫:
              @if (p.stock > 0) {
                {{ p.stock }} 個
              } @else {
                <span class="badge out">在庫なし</span>
              }
            </p>
          }
          @if (p.description) {
            <p class="description">{{ p.description }}</p>
          }
          <p class="muted">商品番号: {{ p.id }}</p>
        </div>
      </article>
    }
  `,
})
export class ProductDetailPage {
  private readonly api = inject(ApiService);
  /** URL の :id がここに入ります */
  readonly id = input.required<string>();

  readonly product = rxResource({
    params: () => ({ id: this.id() }),
    stream: ({ params }) => this.api.getProduct(params.id),
  });

  constructor() {
    // 存在しない商品のときは、サーバーで描画する HTML の状態コードも 404 にします(ブラウザでは null)。
    // 200 のまま返すと、検索エンジンが「中身のないページ」を登録したり、監視で気づけなかったりするためです。
    const init = inject(RESPONSE_INIT, { optional: true });
    effect(() => {
      const e = this.product.error();
      if (init && e instanceof HttpErrorResponse && e.status === 404) init.status = 404;
    });
  }

  errorText(): string {
    return describeError(this.product.error());
  }
}

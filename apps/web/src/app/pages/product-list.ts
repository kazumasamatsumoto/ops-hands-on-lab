import { Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { inject } from '@angular/core';
import { ApiService, describeError } from '../core/api.service';

@Component({
  selector: 'app-product-list',
  imports: [RouterLink, DecimalPipe],
  template: `
    <h1>商品一覧</h1>

    <!-- 検索は普通のフォーム(GET /products?q=...)。JS が動く前でも使えます -->
    <form class="search" action="/products" method="get">
      <label for="q" class="visually-hidden">商品を探す</label>
      <input id="q" name="q" type="search" [value]="q() ?? ''" placeholder="商品名で探す" />
      <button type="submit">探す</button>
    </form>

    @if (q()) {
      <p class="muted">「{{ q() }}」の検索結果</p>
    }

    @if (products.isLoading()) {
      <p class="muted">読み込み中…</p>
    } @else if (products.error()) {
      <p class="error">商品を読み込めませんでした。{{ errorText() }}</p>
    } @else {
      @let list = products.value() ?? [];
      @if (list.length === 0) {
        <p class="muted">該当する商品はありません。</p>
      } @else {
        <ul class="product-grid">
          @for (p of list; track p.id) {
            <li class="product-card">
              <a [routerLink]="['/products', p.id]">
                @if (p.imageUrl) {
                  <img [src]="p.imageUrl" [alt]="p.name" loading="lazy" width="320" height="200" />
                } @else {
                  <div class="noimage" aria-hidden="true">画像なし</div>
                }
                <span class="product-name">{{ p.name }}</span>
              </a>
              <span class="price">{{ p.price | number }} 円</span>
              @if (p.stock === 0) {
                <span class="badge out">在庫なし</span>
              }
            </li>
          }
        </ul>
      }
    }
  `,
})
export class ProductListPage {
  private readonly api = inject(ApiService);
  /** URL の ?q= がここに入ります */
  readonly q = input<string>();

  readonly products = rxResource({
    params: () => ({ q: (this.q() ?? '').trim() }),
    stream: ({ params }) => this.api.listProducts(params.q),
  });

  errorText(): string {
    return describeError(this.products.error());
  }
}

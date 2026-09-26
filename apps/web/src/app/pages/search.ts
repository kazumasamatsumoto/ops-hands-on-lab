import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApiService, describeError } from '../core/api.service';
import { MediaPipe } from '../core/media.pipe';
import { SearchBox } from '../cms/components/search-box';

/**
 * 検索結果(/search?q=...)。
 * GET /occ/v2/samplestore/products/search?query=...&currentPage=0&pageSize=20&fields=DEFAULT を呼びます。
 * 検索の実体は api 側の SEARCH_PROVIDER(db か solr)で、storefront はどちらでも同じ URL を呼ぶだけです。
 *
 * この画面は CMS のページを取りません(結果の並びは検索の返事そのものなので)。
 * 本物の Composable Storefront では、検索結果の画面も CMS のページ(枠)の中に検索結果の部品を置く形です。
 */
@Component({
  selector: 'app-search',
  imports: [RouterLink, MediaPipe, SearchBox],
  template: `
    <h1>商品を探す</h1>
    <app-search-box />

    @if (q()) {
      <p class="muted">「{{ q() }}」の検索結果</p>
    }

    @if (result.isLoading()) {
      <p class="muted">読み込み中…</p>
    } @else if (result.error()) {
      <p class="error">商品を読み込めませんでした。{{ errorText() }}</p>
    } @else {
      @let list = result.value()?.products ?? [];
      @if (list.length === 0) {
        <p class="muted">該当する商品はありません。</p>
      } @else {
        <p class="muted">{{ result.value()?.pagination?.totalResults ?? list.length }} 件</p>
        <ul class="product-grid">
          @for (p of list; track p.code) {
            <li class="product-card">
              <a [routerLink]="['/p', p.code]">
                @if (p.images | media; as src) {
                  <img [src]="src" [alt]="p.name ?? p.code" loading="lazy" width="320" height="200" />
                } @else {
                  <div class="noimage" aria-hidden="true">画像なし</div>
                }
                <span class="product-name">{{ p.name ?? p.code }}</span>
              </a>
              <span class="price">{{ p.price?.formattedValue ?? '' }}</span>
              @if (p.stock?.stockLevelStatus === 'outOfStock') {
                <span class="badge out">在庫なし</span>
              }
            </li>
          }
        </ul>
      }
    }
  `,
})
export class SearchPage {
  private readonly api = inject(ApiService);
  /** URL の ?q= がここに入ります */
  readonly q = input<string>();

  readonly result = rxResource({
    params: () => ({ q: (this.q() ?? '').trim() }),
    stream: ({ params }) => this.api.searchProducts(params.q),
  });

  errorText(): string {
    return describeError(this.result.error());
  }
}

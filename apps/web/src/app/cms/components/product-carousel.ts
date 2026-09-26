import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { rxResource } from '@angular/core/rxjs-interop';
import { catchError, forkJoin, map, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CmsComponentData, Product } from '../../core/models';
import { MediaPipe } from '../../core/media.pipe';

/** typeCode: ProductCarouselComponent の JSON の形 */
export interface ProductCarouselData extends CmsComponentData {
  title?: string;
  /** 商品コードの並び。配列でも「空白区切りの文字列」でも受け付けます */
  productCodes?: string[] | string;
}

/**
 * 商品の並び(カルーセル)。CMS が持っているのは「商品コードの一覧」だけで、
 * 商品名・値段・画像は、この部品が商品ごとに api へ聞きに行きます(GET /products/{code}?fields=DEFAULT)。
 * → 商品が 8 個なら api 呼び出しも 8 回。SSR が遅くなる原因になりやすいところです(性能の演習で見ます)。
 */
@Component({
  selector: 'app-product-carousel',
  imports: [RouterLink, MediaPipe],
  template: `
    <section class="carousel">
      @if (data().title) {
        <h2>{{ data().title }}</h2>
      }
      @if (products.isLoading()) {
        <p class="muted">読み込み中…</p>
      } @else {
        <ul class="product-grid">
          @for (p of products.value() ?? []; track p.code) {
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
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class ProductCarousel {
  private readonly api = inject(ApiService);
  readonly data = input.required<ProductCarouselData>();

  private readonly codes = computed(() => {
    const raw = this.data().productCodes ?? [];
    return (Array.isArray(raw) ? raw : raw.split(/[\s,]+/)).filter((c) => c.length > 0);
  });

  readonly products = rxResource({
    params: () => ({ codes: this.codes() }),
    stream: ({ params }) =>
      params.codes.length === 0
        ? of([] as Product[])
        : forkJoin(
            // 1 つの商品が見つからなくても(404)、並び全体は出します
            params.codes.map((code) => this.api.getProduct(code, 'DEFAULT').pipe(catchError(() => of(null)))),
          ).pipe(map((list) => list.filter((p): p is Product => p !== null))),
  });
}

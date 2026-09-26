import { Component, RESPONSE_INIT, effect, inject, input } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ApiService, describeError } from '../../core/api.service';
import { CmsComponentData } from '../../core/models';
import { MediaPipe } from '../../core/media.pipe';

/**
 * 商品詳細の本体(typeCode: ProductDetailsComponent)。
 * CMS の JSON には属性がありません。「商品ページのこの枠に、商品の詳細を出す」という印だけです。
 * どの商品かは URL(/p/:code)から読みます。本物の Composable Storefront でも、
 * 商品ページの部品は「いまの URL の商品」を見て表示します。
 */
@Component({
  selector: 'app-product-details',
  imports: [RouterLink, MediaPipe],
  template: `
    @if (product.isLoading()) {
      <p class="muted">読み込み中…</p>
    } @else if (product.error()) {
      <h1>商品が見つかりません</h1>
      <p class="error">{{ errorText() }}</p>
      <p><a routerLink="/">トップへ戻る</a></p>
    } @else if (product.value(); as p) {
      <article class="detail">
        @if (p.images | media; as src) {
          <img [src]="src" [alt]="p.name ?? p.code" width="480" height="300" />
        } @else {
          <div class="noimage large" aria-hidden="true">画像なし</div>
        }
        <div>
          <h1>{{ p.name }}</h1>
          <p class="price large">{{ p.price?.formattedValue }}</p>
          @if (p.stock?.stockLevelStatus; as status) {
            <p>
              在庫:
              @switch (status) {
                @case ('outOfStock') { <span class="badge out">在庫なし</span> }
                @case ('lowStock') { 残りわずか{{ p.stock?.stockLevel !== undefined ? '(' + p.stock?.stockLevel + ' 個)' : '' }} }
                @default { あり{{ p.stock?.stockLevel !== undefined ? '(' + p.stock?.stockLevel + ' 個)' : '' }} }
              }
            </p>
          }
          @if (p.summary) {
            <p>{{ p.summary }}</p>
          }
          @if (p.description) {
            <p class="description">{{ p.description }}</p>
          }
          @if (p.categories?.length) {
            <p class="muted">カテゴリ: {{ categoryNames(p.categories ?? []) }}</p>
          }
          <p class="muted">商品コード: {{ p.code }}</p>
        </div>
      </article>
    }
  `,
})
export class ProductDetails {
  private readonly api = inject(ApiService);
  /** この部品には属性が無いので使いませんが、ほかの部品と同じく JSON を受け取れるようにしておきます */
  readonly data = input<CmsComponentData>();

  private readonly code = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('code') ?? '')), {
    initialValue: '',
  });

  readonly product = rxResource({
    params: () => (this.code() ? { code: this.code() } : undefined),
    // 詳細画面なので FULL(説明文・カテゴリなども)をもらいます
    stream: ({ params }) => this.api.getProduct(params.code, 'FULL'),
  });

  constructor() {
    const init = inject(RESPONSE_INIT, { optional: true });
    const title = inject(Title);
    effect(() => {
      // 存在しない商品のときは、サーバーで描画する HTML の状態コードも 404 にします(ブラウザでは init は null)。
      // 200 のまま返すと、検索エンジンが「中身のないページ」を登録したり、監視で気づけなかったりするためです。
      const e = this.product.error();
      if (init && e instanceof HttpErrorResponse && e.status === 404) init.status = 404;
      // エラーのときに value() を読むと、Angular はそのエラーを投げ直します(画面の更新が止まる)。hasValue() で確かめてから読みます。
      const p = this.product.hasValue() ? this.product.value() : undefined;
      if (p?.name) title.setTitle(`${p.name} | サンプルストア`);
    });
  }

  categoryNames(list: { code?: string; name?: string }[]): string {
    return list.map((c) => c.name ?? c.code).join('、');
  }

  errorText(): string {
    return describeError(this.product.error());
  }
}

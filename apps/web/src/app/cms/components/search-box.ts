import { Component, input } from '@angular/core';
import { CmsComponentData } from '../../core/models';

/** typeCode: SearchBoxComponent の JSON の形 */
export interface SearchBoxData extends CmsComponentData {
  placeholder?: string;
}

/**
 * 検索窓(typeCode: SearchBoxComponent)。
 * 普通の HTML のフォーム(GET /search?q=...)なので、JS が動く前(ハイドレーション前)でも使えます。
 * 入力欄の薄い案内の文(placeholder)は CMS の属性 placeholder を使います(無ければ「商品名で探す」)。
 */
@Component({
  selector: 'app-search-box',
  template: `
    <form class="search" action="/search" method="get" role="search">
      <label [attr.for]="inputId" class="visually-hidden">商品を探す</label>
      <input [id]="inputId" name="q" type="search" [placeholder]="data()?.placeholder || '商品名で探す'" />
      <button type="submit">探す</button>
    </form>
  `,
})
export class SearchBox {
  readonly data = input<SearchBoxData>();
  protected readonly inputId = 'search-q';
}

import { Component, RESPONSE_INIT, effect, inject, input } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { rxResource } from '@angular/core/rxjs-interop';
import { ApiService, CmsPageRequest, describeError } from '../core/api.service';
import { CmsPageView } from './cms-page';

/**
 * CMS 駆動の画面の「入口」。ルート(app.routes.ts)から使います。
 *
 *   URL /        → data: { pageType: 'ContentPage', pageLabelOrId: 'homepage' }
 *   URL /p/:code → data: { pageType: 'ProductPage' } + URL の :code
 *   URL /c/:code → data: { pageType: 'CategoryPage' } + URL の :code(分類。例 /c/kitchen)
 *
 * どの URL がどの CMS のページかはルートの表に書き、この部品は
 *   (1) api から cms/pages を取る → (2) CmsPageView に渡して並べてもらう
 * だけをします。画面ごとの中身は一切知りません。
 */
@Component({
  selector: 'app-cms-route',
  imports: [CmsPageView],
  template: `
    @if (page.isLoading()) {
      <p class="muted">読み込み中…</p>
    } @else if (page.error()) {
      <p class="error">ページを表示できませんでした。{{ errorText() }}</p>
    } @else if (page.value(); as p) {
      <app-cms-page [page]="p" [attr.data-page-uid]="p.uid" [attr.data-template]="p.template" />
    }
  `,
})
export class CmsRoute {
  private readonly api = inject(ApiService);
  private readonly title = inject(Title);

  /** ルートの data から入ります(withComponentInputBinding の働き) */
  readonly pageType = input.required<CmsPageRequest['pageType']>();
  readonly pageLabelOrId = input<string>();
  /** URL の :code から入ります(商品ページ) */
  readonly code = input<string>();

  readonly page = rxResource({
    params: (): CmsPageRequest =>
      this.pageType() === 'ContentPage'
        ? { pageType: 'ContentPage', pageLabelOrId: this.pageLabelOrId() ?? 'homepage' }
        : { pageType: this.pageType() as 'ProductPage' | 'CategoryPage', code: this.code() ?? '' },
    stream: ({ params }) => this.api.getCmsPage(params),
  });

  constructor() {
    const init = inject(RESPONSE_INIT, { optional: true });
    effect(() => {
      // CMS のページ自体が無いときは、サーバーの応答も 404 にします(ブラウザでは init は null)
      const e = this.page.error();
      if (init && e instanceof HttpErrorResponse && e.status === 404) init.status = 404;
      // 商品ページの題名は ProductDetails が商品名で付けるので、ここでは ContentPage と CategoryPage のときだけ
      // エラーのときに value() を読むと、Angular はそのエラーを投げ直します(画面の更新が止まる)。hasValue() で確かめてから読みます。
      const p = this.page.hasValue() ? this.page.value() : undefined;
      if (p?.title && this.pageType() !== 'ProductPage') this.title.setTitle(withSiteName(p.title));
    });
  }

  errorText(): string {
    return describeError(this.page.error());
  }
}

/**
 * 題名の後ろに「 | サンプルストア」を付けます。
 * CMS の題名がもともとサイト名で終わるとき(トップの「サンプルストア」、分類の「キッチン | サンプルストア」)は付けません
 * (付けると「サンプルストア | サンプルストア」と重なるため)。
 */
function withSiteName(title: string): string {
  const site = 'サンプルストア';
  return title.endsWith(site) ? title : `${title} | ${site}`;
}

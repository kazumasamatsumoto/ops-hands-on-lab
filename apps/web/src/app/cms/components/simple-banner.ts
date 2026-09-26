import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CmsComponentData } from '../../core/models';
import { MediaPipe } from '../../core/media.pipe';

/** typeCode: SimpleBannerComponent の JSON の形 */
export interface SimpleBannerData extends CmsComponentData {
  headline?: string;
  content?: string;
  media?: { url?: string; altText?: string };
  urlLink?: string;
}

/**
 * バナー(見出し・文・画像・リンク)。
 * backoffice で文言を変えると、ここに出る文が変わります(CMS のデータで画面が決まる例)。
 */
@Component({
  selector: 'app-simple-banner',
  imports: [RouterLink, MediaPipe],
  template: `
    <section class="banner">
      @if (data().media?.url) {
        <img class="banner-image" [src]="data().media?.url | media" [alt]="data().media?.altText ?? data().headline ?? ''"
             width="960" height="320" />
      }
      <div class="banner-text">
        @if (data().headline) {
          <h1>{{ data().headline }}</h1>
        }
        @if (data().content) {
          <p>{{ data().content }}</p>
        }
        @if (data().urlLink; as link) {
          @if (isInternal()) {
            <a class="button" [routerLink]="link">詳しく見る</a>
          } @else {
            <a class="button" [href]="link" rel="noopener">詳しく見る</a>
          }
        }
      </div>
    </section>
  `,
})
export class SimpleBanner {
  /** CmsPageView が、CMS の JSON をそのまま渡してきます */
  readonly data = input.required<SimpleBannerData>();
  /** "/p/100001" のようにサイトの中を指すリンクなら、ページを読み直さずに移動します */
  protected readonly isInternal = computed(() => (this.data().urlLink ?? '').startsWith('/'));
}

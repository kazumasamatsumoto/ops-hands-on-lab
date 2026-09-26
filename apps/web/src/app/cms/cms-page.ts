import { Component, Type, computed, inject, input } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { CmsComponentData, CmsPage } from '../core/models';
import { WARN_LOGGER } from '../core/tokens';
import { CMS_COMPONENT_MAPPING } from './cms-mapping';

/** 描く準備ができた部品 1 つ(対応表で Angular の部品が見つかったもの) */
interface RenderableComponent {
  uid: string;
  typeCode: string;
  type: Type<unknown>;
  data: CmsComponentData;
}

interface RenderableSlot {
  slotId: string;
  position: string;
  components: RenderableComponent[];
}

/**
 * ============================================================================
 *  CMS のページ(JSON)を画面にする部品 ── ヘッドレスの核心
 * ============================================================================
 *
 * 流れ(1 画面ぶん):
 *   1. ルート(cms-route.ts)が api に「このページの設計図をください」と頼む
 *        GET /occ/v2/samplestore/cms/pages?pageType=ContentPage&pageLabelOrId=homepage
 *   2. 返ってきた JSON には、枠(スロット)が並んでいて、枠の中に部品が並んでいる
 *        contentSlots.contentSlot[] → components.component[] → { uid, typeCode, ...属性 }
 *   3. この部品(CmsPageView)が、枠を「JSON に書かれた順」に 1 つずつ描く
 *   4. 枠の中の部品は、typeCode を対応表(cms-mapping.ts)で引いて Angular の部品を決め、
 *        <ng-container *ngComponentOutlet="部品; inputs: { data: JSON }">
 *      で「その場で」作る。部品には JSON をそのまま data として渡す
 *   5. 対応表に無い typeCode は描かない。警告をログに出す(サーバーでは JSON ログ、ブラウザではコンソール)
 *
 * つまり「トップに何を、どの順で出すか」は storefront のコードではなく CMS のデータで決まります。
 * backoffice でバナーの文言を変えると、storefront を作り直さなくても画面が変わるのはこのためです。
 *
 * 補足: 本物の Composable Storefront は、ページの template(このラボのトップなら LandingPageTemplate)ごとに
 *   「どの枠をどの順で置くか」を storefront 側の設定(レイアウト設定)で決めます。
 *   ここでは簡単にするため、api が返した順番のまま並べます。
 *
 * 開発者ツールで <div class="cms-component" data-cms-type="..."> を探すと、
 * どの部品がどの typeCode から作られたかが見えます。
 */
@Component({
  selector: 'app-cms-page',
  imports: [NgComponentOutlet],
  template: `
    @for (slot of slots(); track slot.slotId) {
      <div class="cms-slot" [attr.data-slot]="slot.position" [attr.data-slot-id]="slot.slotId">
        @for (c of slot.components; track c.uid) {
          <div class="cms-component" [attr.data-cms-type]="c.typeCode" [attr.data-cms-uid]="c.uid">
            <ng-container *ngComponentOutlet="c.type; inputs: { data: c.data }" />
          </div>
        }
      </div>
    }
  `,
})
export class CmsPageView {
  private readonly warn = inject(WARN_LOGGER);

  /** api から受け取った CMS のページ(JSON そのまま) */
  readonly page = input.required<CmsPage>();

  /**
   * JSON を「描ける形」に直します。ページが変わったときに 1 回だけ計算されます
   * (computed は、元の値が変わらない限り計算し直しません。だから警告も 1 ページ 1 回です)。
   */
  readonly slots = computed<RenderableSlot[]>(() => {
    const page = this.page();
    return (page.contentSlots?.contentSlot ?? []).map((slot) => ({
      slotId: slot.slotId,
      position: slot.position ?? '',
      components: (slot.components?.component ?? []).flatMap((data) => {
        const type = CMS_COMPONENT_MAPPING[data.typeCode];
        if (!type) {
          // 知らない部品: 描かずに飛ばす(画面は落とさない)。どのページのどの部品かを記録します
          this.warn('cms_unknown_component', {
            typeCode: data.typeCode,
            uid: data.uid,
            pageUid: page.uid,
            slotId: slot.slotId,
          });
          return [];
        }
        return [{ uid: data.uid, typeCode: data.typeCode, type, data }];
      }),
    }));
  });
}

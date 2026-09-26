import { Component, input } from '@angular/core';
import { CmsComponentData } from '../../core/models';

/** typeCode: CMSParagraphComponent の JSON の形 */
export interface ParagraphData extends CmsComponentData {
  content?: string;
}

/**
 * 文章の段落。CMS では content に HTML(<p>・<strong> など)を書けます。
 * [innerHTML] に渡すと、Angular が危ないもの(<script>、onclick など)を取り除いてから入れます(サニタイズ)。
 * CMS に書ける人が悪意のある文を入れても、閲覧者のブラウザでスクリプトが動かないようにするためです。
 */
@Component({
  selector: 'app-paragraph',
  template: `<div class="paragraph" [innerHTML]="data().content ?? ''"></div>`,
})
export class Paragraph {
  readonly data = input.required<ParagraphData>();
}

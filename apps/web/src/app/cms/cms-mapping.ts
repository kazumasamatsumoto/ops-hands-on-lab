import { Type } from '@angular/core';
import { SimpleBanner } from './components/simple-banner';
import { Paragraph } from './components/paragraph';
import { ProductCarousel } from './components/product-carousel';
import { ProductDetails } from './components/product-details';
import { SearchBox } from './components/search-box';
import { Navigation } from './components/navigation';

/**
 * ============================================================================
 *  typeCode → Angular の部品 の対応表(このアプリでただ 1 か所)
 * ============================================================================
 *
 * CMS(api の /cms/pages)は「どの部品を、どの枠に、どの順で置くか」だけを JSON で返します。
 *   { "typeCode": "SimpleBannerComponent", "headline": "秋のセール", ... }
 * JSON には見た目(HTML)は入っていません。見た目を知っているのは storefront の側です。
 * そこで「この typeCode が来たら、この Angular の部品で描く」という対応表を、ここに 1 つだけ持ちます。
 *
 * - 部品を増やすとき: Angular の部品を 1 つ作り、ここに 1 行足すだけ。画面(ルート)のコードは触りません。
 * - 表に無い typeCode が来たとき: 何も描かず、警告をログに出します(cms-page.ts)。
 *   画面全体を落とさないのが大事です。CMS 担当者が新しい部品を置いた日に、
 *   storefront の更新がまだでもサイトが止まらないようにするためです。
 *
 * CCv2 の Composable Storefront でも同じ考え方で、設定の「cmsComponents」に
 * typeCode ごとの部品を登録します(ここはその簡略版です)。
 * 本物は部品を遅延読み込みにもできますが、ここでは分かりやすさを優先して最初から全部読み込みます。
 */
export const CMS_COMPONENT_MAPPING: Readonly<Record<string, Type<unknown>>> = {
  SimpleBannerComponent: SimpleBanner,
  CMSParagraphComponent: Paragraph,
  ProductCarouselComponent: ProductCarousel,
  ProductDetailsComponent: ProductDetails,
  SearchBoxComponent: SearchBox,
  NavigationComponent: Navigation,
};

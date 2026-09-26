import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CmsComponentData } from '../../core/models';

interface NavLink {
  name?: string;
  linkName?: string;
  title?: string;
  url?: string;
}

/** typeCode: NavigationComponent の JSON の形 */
export interface NavigationData extends CmsComponentData {
  links?: NavLink[];
}

/** リンクの並び(typeCode: NavigationComponent)。どのリンクを出すかは CMS のデータで決まります */
@Component({
  selector: 'app-navigation',
  imports: [RouterLink],
  template: `
    <nav class="cms-nav" [attr.aria-label]="data().name ?? 'ナビゲーション'">
      <ul>
        @for (l of links(); track $index) {
          <li>
            @if (l.internal) {
              <a [routerLink]="l.path" [queryParams]="l.query">{{ l.label }}</a>
            } @else {
              <a [href]="l.url" rel="noopener">{{ l.label }}</a>
            }
          </li>
        }
      </ul>
    </nav>
  `,
})
export class Navigation {
  readonly data = input.required<NavigationData>();

  protected readonly links = computed(() =>
    (this.data().links ?? []).map((l) => {
      const url = l.url ?? '/';
      const internal = url.startsWith('/');
      // "/search?q=ノート" のような URL は、パスと ?以降 に分けて routerLink に渡します
      const [path, qs] = url.split('?');
      return {
        label: l.name ?? l.linkName ?? l.title ?? url,
        url,
        internal,
        path,
        query: Object.fromEntries(new URLSearchParams(qs ?? '')),
      };
    }),
  );
}

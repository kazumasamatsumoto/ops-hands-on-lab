import { Component, RESPONSE_INIT, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <h1>ページが見つかりません</h1>
    <p><a routerLink="/">トップへ戻る</a></p>
  `,
})
export class NotFoundPage {
  constructor() {
    // サーバーで描画するときは、HTTP の状態コードも 404 にします(ブラウザでは null)
    const init = inject(RESPONSE_INIT, { optional: true });
    if (init) init.status = 404;
  }
}

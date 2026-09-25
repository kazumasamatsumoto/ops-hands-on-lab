import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth.service';
import { SSR_WINDOW_BUG } from './core/tokens';
import { readRenderMode, renderModeLabel } from './core/render-mode';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
})
export class App {
  protected readonly auth = inject(AuthService);
  protected readonly renderMode = readRenderMode();
  protected readonly renderModeLabel = renderModeLabel(this.renderMode);
  protected screenWidth = 0;

  constructor() {
    if (inject(SSR_WINDOW_BUG)) {
      // 【わざと入れた不具合】isPlatformBrowser で「ブラウザのときだけ」と確かめずに window を触っています。
      // ブラウザには window があるので動きますが、サーバー(Node.js)には window が無いので
      // 「window is not defined」で描画が止まり、SSR は 500 になります。
      // 正しくは: if (isPlatformBrowser(inject(PLATFORM_ID))) { ... } や afterNextRender() の中で触ります。
      this.screenWidth = window.innerWidth;
    }
  }
}

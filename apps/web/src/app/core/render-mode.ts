import { DOCUMENT, isPlatformServer } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';

/**
 * この画面を最初に作ったのがサーバー(SSR)かブラウザ(CSR)かを返します。
 * サーバー(server.ts)が <html data-render-mode="..."> に印を付けて返すので、ブラウザはそれを読みます。
 */
export function readRenderMode(): string {
  if (isPlatformServer(inject(PLATFORM_ID))) return 'ssr';
  return inject(DOCUMENT).documentElement.getAttribute('data-render-mode') || 'csr';
}

export function renderModeLabel(mode: string): string {
  switch (mode) {
    case 'ssr':
      return 'SSR(サーバーで描画)';
    case 'fallback':
      return 'CSR(SSR が時間切れのため、ブラウザで描画)';
    default:
      return 'CSR(ブラウザで描画)';
  }
}

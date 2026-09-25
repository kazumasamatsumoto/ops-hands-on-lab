import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const STORAGE_KEY = 'samplestore.token';

/**
 * ログインの合言葉(JWT)の置き場所。
 * - メモリ(signal)に持ち、ブラウザでは sessionStorage にも控えます(タブを閉じると消えます)。
 * - localStorage には置きません(ずっと残り、盗まれたときの被害が大きいため)。
 * - サーバーでは保存しません(サーバーのメモリは全員で共有なので、人の合言葉が混ざる事故になります)。
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly token = signal<string | null>(this.readSaved());

  setToken(token: string | null): void {
    this.token.set(token);
    if (!this.isBrowser) return;
    try {
      if (token) sessionStorage.setItem(STORAGE_KEY, token);
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // 保存できない環境(プライベートモードなど)でもメモリにはあるので続けます
    }
  }

  logout(): void {
    this.setToken(null);
  }

  private readSaved(): string | null {
    if (!this.isBrowser) return null;
    try {
      return sessionStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
}

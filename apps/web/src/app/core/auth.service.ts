import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const STORAGE_KEY = 'samplestore.token';

interface Saved {
  token: string;
  /** 期限切れの時刻(ミリ秒)。api の expires_in(秒)から計算します */
  expiresAt: number;
}

/**
 * ログインのトークン(OAuth の access_token)の置き場所。
 * - メモリ(signal)に持ち、ブラウザでは sessionStorage にも控えます(タブを閉じると消えます)。
 * - localStorage には置きません(ずっと残り、盗まれたときの被害が大きいため)。
 * - サーバーでは保存しません(サーバーのメモリは全員で共有なので、人のトークンが混ざる事故になります)。
 *   そのため、注文履歴のような「ログインした人だけの画面」は、サーバーでは描かずブラウザで読み込みます。
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private expiresAt = 0;
  readonly token = signal<string | null>(this.readSaved());

  setToken(token: string | null, expiresInSec = 900): void {
    this.expiresAt = token ? Date.now() + expiresInSec * 1000 : 0;
    this.token.set(token);
    if (!this.isBrowser) return;
    try {
      if (token) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt: this.expiresAt } satisfies Saved));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // 保存できない環境(プライベートモードなど)でもメモリにはあるので続けます
    }
  }

  /** 期限切れなら捨てます(api に送っても 401 になるだけなので) */
  validToken(): string | null {
    if (this.token() && Date.now() > this.expiresAt) this.setToken(null);
    return this.token();
  }

  logout(): void {
    this.setToken(null);
  }

  private readSaved(): string | null {
    if (!this.isBrowser) return null;
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Saved | null;
      if (!saved?.token || Date.now() > saved.expiresAt) return null;
      this.expiresAt = saved.expiresAt;
      return saved.token;
    } catch {
      return null;
    }
  }
}

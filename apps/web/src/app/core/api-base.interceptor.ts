import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';

/**
 * 画面のコードは「/api/products」のように書くだけにして、
 * 実際にどこへ送るか(サーバーなら http://api:3001、ブラウザなら同じオリジン)はここで決めます。
 * ログイン済みなら Authorization: Bearer <JWT> も付けます。
 */
export const apiBaseInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) {
    return next(req);
  }
  const base = inject(API_BASE_URL).replace(/\/$/, '');
  const token = inject(AuthService).token();
  return next(
    req.clone({
      url: base + req.url,
      setHeaders: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
};

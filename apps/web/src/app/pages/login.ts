import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService, describeError } from '../core/api.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  template: `
    <h1>ログイン</h1>

    @if (auth.token()) {
      <p>ログインしています。</p>
      <button type="button" (click)="logout()">ログアウト</button>
    } @else {
      <form class="login-form" (submit)="submit($event)">
        <label>
          会員名
          <input name="username" autocomplete="username" required
                 [value]="username()" (input)="username.set(value($event))" />
        </label>
        <label>
          パスワード
          <input name="password" type="password" autocomplete="current-password" required
                 [value]="password()" (input)="password.set(value($event))" />
        </label>
        <button type="submit" [disabled]="busy()">{{ busy() ? '確認中…' : 'ログイン' }}</button>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </form>
      <p class="muted">見本の会員: alice / bob / carol(パスワードはどれも password)</p>
    }
  `,
})
export class LoginPage {
  protected readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly username = signal('');
  readonly password = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  submit(event: Event): void {
    event.preventDefault();
    this.busy.set(true);
    this.error.set('');
    this.api.login(this.username(), this.password()).subscribe({
      next: (res) => {
        this.busy.set(false);
        if (!res?.token) {
          this.error.set('ログインの応答に合言葉(token)がありませんでした。');
          return;
        }
        this.auth.setToken(res.token);
        this.router.navigateByUrl('/me/orders');
      },
      error: (err) => {
        this.busy.set(false);
        this.error.set(
          err?.status === 401 || err?.status === 400
            ? '会員名かパスワードが違います。'
            : describeError(err),
        );
      },
    });
  }

  logout(): void {
    this.auth.logout();
  }
}

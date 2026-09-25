import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  imports: [RouterLink],
  template: `
    <section class="hero">
      <h1>サンプルストアへようこそ</h1>
      <p>架空のネットストアです。性能・セキュリティ・運用の体験ラボの題材として動いています。</p>
      <form class="search" action="/products" method="get">
        <label for="home-q" class="visually-hidden">商品を探す</label>
        <input id="home-q" name="q" type="search" placeholder="商品名で探す" />
        <button type="submit">探す</button>
      </form>
      <p><a routerLink="/products" class="button">商品一覧を見る</a></p>
    </section>

    <section class="cards">
      <div class="card">
        <h2>商品一覧</h2>
        <p>サーバーで描画(SSR)された HTML に、最初から商品名が入っています。</p>
      </div>
      <div class="card">
        <h2>ログイン</h2>
        <p>見本の会員でログインすると、自分の注文履歴が見られます。</p>
      </div>
      <div class="card">
        <h2>描画モード</h2>
        <p>ページのいちばん下に、この画面をサーバーとブラウザのどちらで作ったかが出ます。</p>
      </div>
    </section>
  `,
})
export class HomePage {}

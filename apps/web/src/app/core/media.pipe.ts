import { Pipe, PipeTransform, inject } from '@angular/core';
import { Image } from './models';
import { API_PUBLIC_URL } from './tokens';

/**
 * 画像の URL を「ブラウザから届く住所」にします。
 *   api が返す画像の url は "/medias/100001.svg" のようなパスだけです(OCC と同じ)。
 *   → API_PUBLIC_URL を前に付けて http://api.lab.localhost:18080/medias/100001.svg にします。
 * SSR のときも、内側の住所(http://api:3001)ではなく外向きの住所を使うのが大事です。
 * HTML の <img src> を読むのはサーバーではなく利用者のブラウザだからです。
 *
 * 使い方: <img [src]="product.images | media">(配列なら 1 枚目)、<img [src]="'/medias/x.svg' | media">
 */
@Pipe({ name: 'media' })
export class MediaPipe implements PipeTransform {
  private readonly base = inject(API_PUBLIC_URL).replace(/\/$/, '');

  transform(value: string | Image | Image[] | null | undefined): string | null {
    const url = Array.isArray(value) ? value[0]?.url : typeof value === 'string' ? value : value?.url;
    if (!url) return null;
    if (/^https?:\/\//.test(url)) return url;
    return this.base + (url.startsWith('/') ? url : `/${url}`);
  }
}

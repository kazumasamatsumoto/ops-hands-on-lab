import { defineConfig } from 'vitepress';
import toc from './toc.json';

/** 左の目次。並びは toc.json で決める。 */
const t = toc as Record<string, [string, string][]>;
const items = (dir: string) => t[dir].map(([p, text]) => ({ text, link: `/${dir === 'architecture' || dir === 'detail' ? `design/${dir}` : dir}/${p}` }));

export default defineConfig({
  lang: 'ja-JP',
  title: '体験ラボ',
  description: '設計書に書くことを、実物を動かして体験する(サンプルストア)',
  cleanUrls: true,
  ignoreDeadLinks: [/^https?:\/\/localhost/],
  themeConfig: {
    nav: [
      { text: 'はじめに', link: '/guide/about' },
      { text: '必要なこと一覧', link: '/guide/checklist' },
      { text: '演習', link: '/exercises/01-fe-ssr-vs-csr' },
      { text: 'ラボの設計書', link: '/design/architecture/00-overall' },
    ],
    sidebar: [
      { text: 'はじめに', items: items('guide') },
      { text: '演習(触って覚える)', items: items('exercises') },
      { text: 'ラボの方式設計書', collapsed: true, items: items('architecture') },
      { text: 'ラボの詳細設計書', collapsed: true, items: items('detail') },
    ],
    outline: { level: [2, 3], label: 'このページの目次' },
    docFooter: { prev: '前へ', next: '次へ' },
    search: { provider: 'local' },
    darkModeSwitchLabel: '表示モード',
    sidebarMenuLabel: '目次',
    returnToTopLabel: '先頭へ',
    footer: { message: '架空のネットストア「サンプルストア」を使った学習用のラボです。' },
  },
});

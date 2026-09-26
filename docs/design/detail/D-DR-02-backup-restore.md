# D-DR-02 バックアップと復元

版: 2.0 / 親: [DR 方式](/design/architecture/09-disaster-recovery) / 対象: [tools/backup.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/backup.sh)・[tools/restore.sh](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/tools/restore.sh)

::: tip 3 行まとめ(この文書で決めたこと)
- バックアップは `tools/backup.sh` 1 本。db の中の `pg_dump` で `backups/store-年月日-時分秒.sql` を作ります。商品・会員・注文に加え、CMS の画面の部品(バナーの文言など)とログインのトークンも入ります。
- 復元は `tools/restore.sh [ファイル]` 1 本。途中でエラーなら止め、全部成功するか何も変えないかのどちらかにします。
- 検索の索引(本格版の Solr)はバックアップしません。DB から作り直せる物なので、worker の `searchIndexJob` が 60 秒ごとに全件を入れ直します。演習では「バックアップ → データを変える → 壊す → 復元」を行い、4 つの時刻から RTO と RPO を計算します。
:::

## 0. 親の方式設計書 {#s0}
| 項目 | 内容 |
| --- | --- |
| 親 | [DR 方式](/design/architecture/09-disaster-recovery) |
| 引き継ぐ決定 | 4.1 守るのは DB だけ、4.2 バックアップ、4.3 復元、4.4 RTO と RPO を測る、[4.6](/design/architecture/09-disaster-recovery#s4-6) |
| またがる層 | [BE 方式 4.10](/design/architecture/02-backend#s4-10)(定期ジョブ)・[4.11](/design/architecture/02-backend#s4-11)(検索の実体) |

## 1. 目的と範囲 {#s1}
- **含む**: 2 本のスクリプトの動き、オプションとその理由、ファイルの名前と置き場所、守る物と守らない物、手順、時刻の記録。
- **含まない**: 自動の定期実行、別の場所への保管、本格版(Kubernetes の DB)での手順。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| 動かす場所 | リポジトリのどこから実行してもよい(スクリプトがリポジトリの一番上に移動する) |
| DB | 軽量版の db コンテナ(PostgreSQL 17。ユーザー `store`、DB `store`、ボリューム `db-data`) |
| 置き場所 | リポジトリの `backups/`(無ければ作る。リポジトリには入れない) |
| DB を使う物 | api・backoffice・worker の 3 つの aspect が同じ DB を使う。表を作り見本データを入れるのは api だけ(表が空のとき) |

## 3. 全体像 {#s3}
```text
tools/backup.sh
  docker compose exec -T db pg_dump -U store -d store --clean --if-exists --no-owner > backups/store-YYYYMMDD-HHMMSS.sql

tools/restore.sh [ファイル]          (省略すると backups/store-*.sql の一番新しい物)
  docker compose exec -T db psql -U store -d store -v ON_ERROR_STOP=1 --single-transaction -q < ファイル

Solr の索引(本格版)… バックアップしない。worker の searchIndexJob が DB から 60 秒ごとに作り直す
```

## 4. 仕様 {#s4}
### 4.1 バックアップのオプション {#s4-1}
| オプション | 意味 | 理由 |
| --- | --- | --- |
| `--clean` | 復元のとき、先にテーブルなどを消す文を入れる | 今のデータに上書きで戻せる |
| `--if-exists` | 消すとき「あれば」消す | 空の DB に戻すときもエラーにならない |
| `--no-owner` | 持ち主の情報を入れない | 別のユーザーの DB にも戻せる |

終わると、ファイル名と大きさ(バイト)を表示します。

### 4.2 復元のオプション {#s4-2}
| オプション | 意味 | 理由 |
| --- | --- | --- |
| `-v ON_ERROR_STOP=1` | エラーが出たらそこで止める | 中途半端な状態で「成功」と言わない |
| `--single-transaction` | 全体を 1 つのまとまり(トランザクション)で実行 | 全部成功するか、何も変えないか |
| `-q` | 余計な表示をしない | 結果だけを見やすくする |

ファイルが無ければ「先に tools/backup.sh を実行してください」と出して止まります。

### 4.3 演習の手順と記録 {#s4-3}
| 手順 | 操作 | 記録する時刻 |
| --- | --- | --- |
| 1 | `tools/backup.sh` | **T1: 最後のバックアップ** |
| 2 | データを変える(例: backoffice で商品の価格やトップのバナーの文言を変える) | — |
| 3 | 壊す(例: `docker compose down -v` でボリュームごと消し、`docker compose up -d --build`) | **T2: 壊れた時刻** |
| 4 | `tools/restore.sh` を始める | **T3: 復元の開始** |
| 5 | 画面や API で、商品・注文・バナーが戻ったことを確かめる | **T4: 確かめ終えた時刻** |

- RTO(戻るまでにかかった時間)= T4 − T2
- RPO(失ったデータの時間幅)= T2 − T1。手順 2 で変えた物は、T1 より後なので戻らない(これが RPO の意味)
- 復元そのものにかかった時間 = T4 − T3
- 画面で確かめるときは、cdn-waf のキャッシュ(30 秒)が切れてから見る。すぐ見ると、壊す前の古い画面が出ることがある

::: warning 起動したばかりの DB には見本データが入る
api は起動時にテーブルが空なら見本データを入れます。ボリュームを消して起動し直すと「見本データだけの DB」になり、一見戻ったように見えます。
復元できたかは、**見本データには無い物**(バックアップ前に backoffice で変えた価格やバナーの文言など)で確かめてください。
:::

### 4.4 守る物と守らない物 {#s4-4}
| データ | 置き場所 | バックアップ | 失ったときの戻し方 |
| --- | --- | --- | --- |
| 商品・分類・会員・注文 | DB(`products`・`categories`・`users`・`orders`・`order_entries`) | する | `tools/restore.sh` |
| 画面の部品(CMS) | DB(`cms_pages`・`cms_slots`・`cms_slot_components`・`cms_components`) | する | 同上。backoffice で変えたバナーの文言も戻る |
| ログインのトークン・管理画面のセッション | DB(`oauth_access_tokens`・`backoffice_sessions`) | される(同じ DB のため) | 戻さなくてもよい物。15 分で切れる。戻したくなければ復元のあと消す |
| 検索の索引 | Solr(本格版。コア `products`) | しない | worker の `searchIndexJob` が DB から全件を入れ直す(既定 60 秒ごと)。止まっていれば `CronJobStale` で気づく |
| 画像 | api がその場で作る(`/medias/`) | 不要 | — |
| 指標・ログ | Prometheus・Loki のボリューム | しない | 失ってよい(ラボ) |

索引の作り直しは「全件削除 → 全件を送って確定(commit)」の順で、確定するまでは古い索引で検索できるので途中で空になりません([solr.js](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/src/solr.js))。

## 5. 目標と確認方法 {#s5}
| 項目 | 目標 | 確かめ方 |
| --- | --- | --- |
| RTO | 10 分以内 | T4 − T2 |
| RPO | 最後のバックアップの時点まで | T2 − T1 |
| 復元の成否 | 成功か、何も変わらないか | エラーなら「復元しました。」が出ない |
| 検索の索引(本格版) | 復元から 60 秒ほどで検索結果が DB と一致 | worker のログ `ジョブが成功しました`(`job: searchIndexJob`、`indexed` の件数) |

## 6. 関連する文書 {#s6}
- [D-INF-01 起動構成](/design/detail/D-INF-01-compose-and-k8s)(ボリューム)
- [D-SRE-02 SLO とバーンレートのアラート](/design/detail/D-SRE-02-slo-burn-rate)(`CronJobStale`)
- 仕組みの説明: [DB とバックアップ](/how-it-works/10-db-and-backup)・[検索(Solr と索引)](/how-it-works/09-search-solr)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | バックアップを別の場所に置く方法 |
| 2 | バックアップファイルには会員のパスワードのハッシュとトークンの SHA-256 の値が入る。`backups/` はリポジトリに入れない設定(.gitignore)にしてあるが、PC の中での置き場所の権限と保管期間は決めていない |
| 3 | 本格版(Kubernetes の DB)での同じ手順 |

## 8. レビュー観点 {#s8}
- [ ] 復元が途中で止まったとき、中途半端なデータが残らないか
- [ ] 復元したことを「見本データでは無い物」で確かめているか
- [ ] 4 つの時刻を記録し、RTO と RPO を数字で出しているか
- [ ] 「バックアップする物」と「作り直せるので要らない物(索引など)」が分けて書いてあるか
- [ ] バックアップファイルの置き場所と、見てよい人が決まっているか

## この設計を体験する演習 {#exercises}
- [DR-1 バックアップから戻す(RTO と RPO を測る)](/exercises/16-dr-backup-restore)

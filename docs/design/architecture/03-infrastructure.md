# インフラ方式設計書(ラボ)

版: 1.0 / 親: [全体方式](/design/architecture/00-overall) / 対象: docker compose(軽量版)と kind(本格版)

::: tip 3 行まとめ(この文書で決めたこと)
- 軽量版(docker compose)と本格版(kind = Docker の中の Kubernetes)の 2 つを用意し、**同じイメージ**を使う。構成はすべてファイルで持つ(IaC)。
- 部品ごとにメモリの上限を決め、超えたら強制終了 → 自動で作り直す。root では動かさない。
- 本格版では api・web を 2 台ずつ動かし、1 台ずつ入れ替える(ローリング更新)。更新中も応える台の数を減らさない。
:::

## 0. 位置づけ {#s0}
全体方式の「設定は環境変数」「版を固定する」を受けて、動かす土台を決めます。配下: [D-INF-01 起動構成](/design/detail/D-INF-01-compose-and-k8s)。

## 1. 目的と範囲 {#s1}
- **含む**: 2 つの版の役割、イメージの作り方、メモリの上限、ヘルスチェックと再起動、設定値と秘密情報、ローリング更新、ポート。
- **含まない**: 本物のクラウド、複数ノード、OS のパッチ(現場では要る。[必要なこと一覧](/guide/checklist) 28)。

## 2. 前提 {#s2}
| 前提 | 内容 |
| --- | --- |
| PC | Docker Desktop にメモリ 8GB。軽量版は上限の合計 約 2GB、本格版は 2.5〜3GB ほど |
| 同時起動 | 軽量版と本格版は同じポートを使うので、同時には動かせない |
| イメージ | 公開イメージだけを使い、タグを固定する |

## 3. 全体像 {#s3}
| 項目 | 軽量版(docker compose) | 本格版(kind) |
| --- | --- | --- |
| 動かす単位 | コンテナ | Pod |
| api・web の数 | 1 つずつ | 2 つずつ(`replicas: 2`) |
| 死活監視 | Docker の healthcheck | startup・readiness・liveness の 3 種類の probe |
| api のメモリ上限 | 256MB(`mem_limit`) | 192Mi(`resources.limits`) |
| 版の入れ替え | 止めて作り直す | ローリング更新 |
| 起動 | `docker compose up -d --build` | `k8s/up.sh` |

## 4. 決定事項 {#s4}
### 4.1 2 つの版で同じイメージを使う {#s4-1}
| 項目 | 内容 |
| --- | --- |
| 決定 | api・web のイメージ(`lab/api:local`・`lab/web:local`)を 1 回作り、軽量版でも本格版でも使う。構成は docker-compose.yml とマニフェスト(k8s/manifests)に書く |
| 理由 | 「検証で試した物」と「本番で動く物」を同じにする考え方を、手元で体験する |
| 却下した案 | 本格版だけ別の作り方: 版によって動きが違うと、演習の結果を比べられない |
| 実物 | [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[k8s/manifests/](https://github.com/kazumasamatsumoto/ops-hands-on-lab/tree/main/k8s/manifests) |

### 4.2 イメージの作り方 {#s4-2}
| 項目 | 内容 |
| --- | --- |
| 決定 | 2 段階(マルチステージ)で作り、2 段目には動かすのに要る物だけを入れる。一般ユーザー `node` で動かす(root で動かさない) |
| 理由 | イメージを小さくし、乗っ取られたときにできることを減らす |
| 実物 | [apps/api/Dockerfile](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/api/Dockerfile)・[apps/web/Dockerfile](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/apps/web/Dockerfile) |

### 4.3 メモリの上限 {#s4-3}
| 項目 | 内容 |
| --- | --- |
| 決定 | 全部品に上限を付ける。軽量版: db 256MB、api 256MB、web 384MB、edge 128MB、Prometheus 256MB、Alertmanager 64MB、pager 64MB、Grafana 256MB、Loki 256MB、Alloy 128MB。本格版の api は requests 64Mi / limits 192Mi |
| 理由 | 1 つの部品のメモリ漏れで、同じ PC(ノード)の他の部品まで巻き込まない。超えた部品だけを落として作り直す |
| 却下した案 | 上限なし: 漏れた部品が PC のメモリを食い尽くし、全部が遅くなる |
| 実物 | [docker-compose.yml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/docker-compose.yml)・[k8s/manifests/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/api.yaml#L60-L66) |

### 4.4 ヘルスチェックと再起動 {#s4-4}
| 項目 | 内容 |
| --- | --- |
| 決定 | 軽量版: api は `/readyz` を 5 秒ごと、web は `/healthz` を 10 秒ごとに確かめ、`restart: unless-stopped` で落ちたら再起動。本格版の api: readiness = `/readyz`(5 秒ごと、2 回失敗で振り分けから外す)、liveness = `/healthz`(10 秒ごと、3 回失敗で再起動)、startup = `/healthz`(2 秒ごと、最大 90 回 = 180 秒待つ。初回は DB のイメージ取得に 1〜2 分かかるため) |
| 理由 | 「客を送らない」と「作り直す」を別の基準にする。DB が落ちたときは振り分けから外すだけにして、再起動の連鎖を起こさない |
| 実物 | [k8s/manifests/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/api.yaml#L40-L59) |

### 4.5 設定値と秘密情報 {#s4-5}
| 項目 | 内容 |
| --- | --- |
| 決定 | 秘密でない設定は ConfigMap(本格版)・environment(軽量版)。DB のパスワードと JWT の署名鍵は Secret(本格版)。リポジトリに置くのは**見本の値**だけ(`lab-only-not-a-real-secret`) |
| 理由 | 設定と秘密を分けると、見てよい人・変えてよい人を分けられる |
| 却下した案 | 秘密の値をリポジトリに入れる: 公開した瞬間に漏れる。Secret は base64 にしただけで暗号ではないので、本番は外部の秘密管理や暗号化を使う |
| 実物 | [configmap-app.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/configmap-app.yaml)・[secret.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/secret.yaml) |

### 4.6 止めずに入れ替える {#s4-6}
| 項目 | 内容 |
| --- | --- |
| 決定 | 本格版の api・web は `RollingUpdate`(`maxSurge: 1`、`maxUnavailable: 0`)。止める前に 5 秒待ち(`preStop`)、最大 20 秒で止める(`terminationGracePeriodSeconds: 20`) |
| 理由 | 新しい Pod が準備できてから古い Pod を 1 つ減らすので、更新中も応える台数が減らない。待つ 5 秒の間に振り分け先から外れ、処理中のお客さんを切らない |
| 却下した案 | 全部止めてから入れ替える: 入れ替えの間サイトが止まる |
| 実物 | [k8s/manifests/api.yaml](https://github.com/kazumasamatsumoto/ops-hands-on-lab/blob/main/k8s/manifests/api.yaml#L15-L24) |

## 5. 目標 {#s5}
| 項目 | 目標 | 計算・根拠 |
| --- | --- | --- |
| 更新中に応える api の台数 | 2 台を下回らない | `replicas: 2` − `maxUnavailable: 0` = 2 |
| 軽量版のメモリ | 約 2GB 以内 | 256+256+384+128+256+64+64+256+256+128 = 2,048MB |
| 起動待ちの上限(本格版 api) | 180 秒 | startupProbe 2 秒 × 90 回 |

## 6. 配下の詳細設計書 {#s6}
- [D-INF-01 起動構成(compose と Kubernetes)](/design/detail/D-INF-01-compose-and-k8s)

## 7. 未決事項 {#s7}
| # | 内容 |
| --- | --- |
| 1 | 本格版に HPA(混み具合で台数を自動で増やす)を入れるか。今は手で台数を変える |
| 2 | 環境(開発・検証・本番)を分ける例をラボに入れるか |

## 8. レビュー観点 {#s8}
- [ ] 全部品にメモリの上限があるか
- [ ] readiness と liveness が別の基準になっているか(liveness が DB を見ていないか)
- [ ] 更新中に応える台数が減らない設定か(`maxUnavailable`)
- [ ] 秘密の値がリポジトリに入っていないか(入っているなら見本の値だと分かるか)
- [ ] root で動いていないか

## この設計を体験する演習 {#exercises}
- [インフラ-1 止めずに版を上げる(ローリング更新)](/exercises/05-infra-rolling-update)
- [インフラ-2 設定値とシークレットを環境で分ける](/exercises/06-infra-config-and-secrets)
- [障害-2 メモリ不足で再起動を繰り返す](/exercises/15-incident-crashloop)

---
title: 障害-2 メモリ不足で再起動を繰り返す
---

# 障害-2 メモリ不足で再起動を繰り返す

::: info この演習について
- 所要時間: 約 20 分(本格版もやるなら +15 分)
- 使うもの: 軽量版(docker compose)。`docker events`・`docker inspect`、Grafana の「API のメモリ(RSS)」パネル。本格版(kind)があれば `kubectl`
- 関係する設計書: [インフラ方式 4.3 メモリの上限](/design/architecture/03-infrastructure#s4-3)・[障害対応方式 4.4 再起動に任せる範囲](/design/architecture/08-incident-response#s4-4)・[D-INF-01 起動構成](/design/detail/D-INF-01-compose-and-k8s)
:::

## 1. この設計書はなぜ必要か

プログラムがメモリを使ったまま返さない不具合(メモリリーク)は、すぐには症状が出ません。そして「自動で再起動する仕組み」があると、症状が隠れてしまいます。

> **よくある事故**: 毎日だいたい夕方 5 時ごろ、1 分ほどエラーが出て、自然に直る現象がありました。自動で再起動して戻るので、誰も深く調べませんでした。
> ある日のセールで利用者が 3 倍になると、メモリが溜まる速さも 3 倍になり、10 分おきに落ちるように。
> さらに、メモリの上限を決めていなかったため、同じサーバーの別のアプリまで巻き込んで落ちました。

「1 つのアプリが使ってよいメモリの上限」と「再起動に任せてよい範囲・人が調べる条件」を、インフラと障害対応の方式設計書で決めます。

## 2. 何をやっているのか

api には `leakMb` というスイッチがあり、`/api` へのリクエストのたびに、そのぶんのメモリを溜め込みます。api のメモリの上限は 256MB(`docker-compose.yml` の `mem_limit`)です。
上限を超えると、Docker(の中の Linux)が api を強制終了し(OOM Kill)、`restart: unless-stopped` の決まりで自動的に起動し直します。

この演習では 2 通り試します。

1. **動いている api のスイッチを入れる**: 1 回落ちて再起動すると、スイッチが起動時の値(0)に戻るので「自然に直った」ように見えます。
2. **起動時からスイッチが入っている**(= 不具合の入った版をリリースした状態): 起動 → 溜まる → 落ちる → 起動…を繰り返し、再起動の間隔がだんだん延びます(本格版の CrashLoopBackOff と同じ動き)。

たとえ: **水を捨てずに溜め続けるバケツ** です。バケツ(メモリの上限)があふれたら、管理人(Docker)がバケツを空にして置き直します(再起動)。
でも、蛇口(不具合)が開いたままなら、またすぐあふれます。管理人は「置き直す間隔」をだんだん空けますが、蛇口を閉めるのは人の仕事です。

## 3. まず触ってみる

### 軽量版(docker compose)

1. **いまの再起動の回数を見ておく**。

   ```bash
   docker inspect lab-api-1 -f 'restarts={{.RestartCount}} oom={{.State.OOMKilled}}'
   ```

2. **別のターミナルで、api の出来事(イベント)を見張る**。

   ```bash
   docker events --filter container=lab-api-1 --filter event=oom --filter event=die --filter event=start --filter event=health_status --format '{{.Time}} {{.Action}}'
   ```

3. **動いている api にメモリを溜めさせる**(1 回 5MB)。edge の作り置きに当たらないよう、検索の言葉を毎回変えます。

   ```bash
   tools/chaos.sh set leakMb=5
   for i in $(seq 1 60); do
     c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:18080/api/products?q=leak$i")
     if [ "$c" != 200 ] || [ $((i%10)) -eq 0 ]; then echo "req=$i code=$c $(docker stats --no-stream --format '{{.MemUsage}}' lab-api-1)"; fi
     sleep 0.2
   done
   tools/chaos.sh status
   docker inspect lab-api-1 -f 'restarts={{.RestartCount}}'
   ```

   ::: warning zsh で `$RANDOM` を使うときの注意
   検索の言葉を `q=$RANDOM` にすると、Mac の標準のシェル(zsh)では `$(...)` の中で毎回同じ数になり、edge の作り置きに当たってメモリが溜まりません(実際にはまりました)。ここではループの番号 `$i` を使っています。
   :::

4. **起動時からスイッチが入った api にする**(1 回 20MB)。コマンドの前に書いた値は、この起動のときだけ使われます。

   ```bash
   CHAOS_LEAK_MB=20 docker compose up -d api
   docker compose ps api        # (healthy) を待つ
   for i in $(seq 1 300); do curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 "http://localhost:18080/api/products?q=loop$i"; sleep 0.3; done | sort | uniq -c
   ```

   終わったら状態を見ます。

   ```bash
   docker compose ps api
   docker inspect lab-api-1 -f 'restarts={{.RestartCount}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
   docker compose logs api --no-log-prefix --since 5m | grep -c 'api を起動しました'
   ```

5. **Grafana で見る**。「サンプルストア SLO」の「API のメモリ(RSS)」パネルに、上がっては 0 に落ちる「のこぎりの歯」の形が出ます。

### 本格版では

本格版(kind)では、同じことが Kubernetes の言葉で見えます。コマンドの詳細は `k8s/README.md` を見てください(本格版の api のメモリ上限は 192Mi です)。

```bash
k8s/chaos.sh boot leakMb=20                          # 起動時からメモリを溜める api にする
while true; do curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:18080/api/products?q=$RANDOM"; sleep 0.3; done   # 別のターミナルで
kubectl -n lab get pods -l app=api -w                # OOMKilled(終了コード 137)→ CrashLoopBackOff
kubectl -n lab describe pod -l app=api | grep -A5 'Last State'
kubectl -n lab logs deploy/api --previous            # 落ちる前の api のログ
k8s/chaos.sh boot-reset                              # 元に戻す(10 秒ほどで回復)
```

## 4. 何が見えたら成功か

**手順 3(1 回だけ落ちる)**: 10 回ごとに約 50MB ずつ増え、上限 256MB の手前で api が消え(502)、すぐに 37MB で起動し直しました。スイッチは 0 に戻っています。

```text
req=10 code=200 149.2MiB / 256MiB
req=20 code=200 198.3MiB / 256MiB
req=30 code=200 248.5MiB / 256MiB
req=32 code=502 0B / 0B
req=40 code=200 37.16MiB / 256MiB
...
{"latencyMs":0,"errorRate":0,"leakMb":0,"idorBug":false,"sqliBug":false,"leakedMb":0}
restarts=1
```

イベントには、強制終了(`oom`)→ 停止(`die`)→ 起動(`start`)が同じ秒に並び、その 5 秒後にヘルスチェックが `healthy` に戻りました。

```text
1790352815 oom
1790352815 die
1790352815 start
1790352820 health_status: healthy
```

失敗したのは 60 回中 1 回だけ。**「自然に直る」ように見えて、実は 1 回死んでいる** のです。気づく手がかりは `restarts=1` の数字と、メモリのグラフの形だけです。

**手順 4(再起動を繰り返す)**: 約 100 秒で 10 回落ち、再起動の間隔がだんだん延びました(下は、試し始めてからの秒数)。

```text
4s oom / 4s start
8s oom / 8s start
13s oom / 13s start
18s oom / 19s start
24s oom / 25s start
29s oom / 33s start      ← 4 秒待ってから起動
37s oom / 44s start      ← 7 秒
48s oom / 61s start      ← 13 秒
65s oom / 91s start      ← 26 秒
95s oom
```

お客様から見ると、300 回のうち成功は 108 回だけでした。

```text
    108 200
    184 502
      8 504
```

終わったときの状態。終了コード 137 は「外から強制終了された」、`oom=true` は「メモリの上限を超えたから」という意味です。

```text
lab-api-1 Restarting (137) 38 seconds ago
restarts=10 exit=137 oom=true
10            ← 「api を起動しました」のログが 10 回
```

起動のログには、起動時のスイッチ `leakMb: 20` が毎回出ていて、「不具合が入ったまま起動している」ことが分かります。

```text
{"level":30,"service":"api","port":3001,"chaos":{"latencyMs":0,"errorRate":0,"leakMb":20,...},"msg":"api を起動しました"}
```

**本格版**: Pod の STATUS が `OOMKilled` → `CrashLoopBackOff` と変わり、`RESTARTS` の数が増えていきます。`describe` の `Last State` に `Reason: OOMKilled`、`Exit Code: 137` が出ます。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| メモリリーク | 使ったメモリを返さず、溜まり続ける不具合 | 水を捨てないバケツ | 10 回ごとに約 50MB 増えた |
| メモリの上限(limit) | 1 つのアプリが使ってよいメモリの最大 | バケツの大きさ | `mem_limit: 256m`、本格版は 192Mi |
| OOM Kill | 上限を超えたので、OS が強制終了すること | あふれたバケツを管理人が空にする | `oom` のイベント、終了コード 137 |
| 自動再起動 | 落ちたら自動で起動し直す決まり | 管理人がバケツを置き直す | `restart: unless-stopped`、`restarts=10` |
| 再起動の待ち時間の延長(バックオフ) | 何度も落ちるなら、起動し直すまでの間を空けていく | 置き直す間隔をだんだん空ける | 4 → 7 → 13 → 26 秒 |
| CrashLoopBackOff | Kubernetes の「落ちては起動を繰り返しているので、待ち時間を延ばしている」状態 | 管理人が「またか」と様子見している | 本格版の `kubectl get pods` |
| 終了コード 137 | 外から強制終了された(128 + 9 番の合図) | 強制退場の印 | `Restarting (137)` |

## 6. 設計書ではここに書く

- **[インフラ方式 4.3 メモリの上限](/design/architecture/03-infrastructure#s4-3)**: 「すべてのコンテナにメモリの上限を付ける(api 256MB、web 384MB)」「上限は、負荷試験で測った使用量 × 1.5 を目安にする」「上限が無いと、1 つの不具合が同じサーバーのほかのアプリを巻き込む」。
- **[インフラ方式 4.4 ヘルスチェックと再起動](/design/architecture/03-infrastructure#s4-4)**: 自動で再起動する条件と、何回まで・どれくらいの間隔で。
- **[障害対応方式 4.4 再起動に任せる範囲](/design/architecture/08-incident-response#s4-4)**: 「再起動は応急処置。1 日に 1 回でも OOM で再起動したら、人が原因を調べる(チケットを切る)」「再起動を繰り返したら、直前のリリースを戻す」。
- **[D-INF-01 起動構成 4.3 本格版の Pod](/design/detail/D-INF-01-compose-and-k8s#s4-3)**(一般のカタログでは D-INF-01): コンテナごとのメモリの requests / limits の表と、その根拠。
- **[SRE 方式 4.3 アラート](/design/architecture/05-sre#s4-3)**: 「再起動の回数」「メモリが上限の 80% を超えた」を見張る(お客様への影響が出る前に気づくため)。

## 7. レビューで聞く質問

- 「すべてのコンテナに、メモリの上限は付いていますか。その数字はどうやって決めましたか。」
- 「上限を超えて強制終了されたとき、それに気づく仕組み(再起動の回数のアラートなど)はありますか。」
- 「自動で再起動して戻った場合でも、原因を調べる決まりになっていますか。」
- 「再起動を繰り返す状態になったら、誰が何をしますか(前の版に戻す、など)。」
- 「強制終了される前に、ログやメモリの記録(ヒープの情報など)は残せますか。」

## 8. 片付け

起動時のスイッチを既定(0)に戻して起動し直します。

```bash
docker compose up -d api                  # CHAOS_LEAK_MB を付けずに起動 = 0
docker compose ps api                     # (healthy) ならよい
tools/chaos.sh status                     # "leakMb":0 ならよい
```

見張りのターミナル(`docker events`)は Ctrl+C で止めます。本格版で試した場合は `k8s/chaos.sh boot-reset` です。

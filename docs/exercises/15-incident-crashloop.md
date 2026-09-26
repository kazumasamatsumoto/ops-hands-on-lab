---
title: 障害-2 メモリ不足で再起動を繰り返す
---

# 障害-2 メモリ不足で再起動を繰り返す

::: info この演習について
- 所要時間: 約 20 分(本格版もやるなら +15 分)
- 使うもの: 軽量版(docker compose)。`curl`、`docker events`、`docker stats`、`tools/chaos.sh`。本格版(kind)があれば CrashLoopBackOff が見られます
- 仕組みはこちら: [仕組み-3 Kubernetes の基本](/how-it-works/03-kubernetes-basics)・[仕組み-8 aspect と worker](/how-it-works/08-aspects-and-worker)
- 関係する設計書: [障害対応方式](/design/architecture/08-incident-response)・[インフラ方式](/design/architecture/03-infrastructure)
- 用語集: [メモリ上限](/guide/glossary#memory-limit)・[OOMKilled](/guide/glossary#oomkilled)・[CrashLoopBackOff](/guide/glossary#crashloopbackoff)・[liveness プローブ](/guide/glossary#liveness-probe)
:::

## 1. この設計書はなぜ必要か

メモリを少しずつ溜め込む不具合(メモリリーク)は、リリースの瞬間は元気に動きます。溜まりきって落ちるまで時間がかかるので、「動いているから大丈夫」と見過ごされます。

> **よくある事故**: リリース後、しばらくは何ともありませんでした。数時間後から、api が数分おきに数秒だけ落ちては復活する、を繰り返し始めます。
> 「たまに 502 が出る」という散発的な苦情が続きましたが、そのたびに復活しているので原因が分からず、丸 1 日つぶれました。
> 原因は、1 リクエストごとに少しずつメモリを溜める 1 行でした。

「メモリの上限を決め、超えたら再起動する」「再起動を繰り返す状態にどう気づくか」を、インフラ・障害対応の方式設計書で決めます。

## 2. 何をやっているのか

api には `leakMb` というスイッチがあり、OCC の API へのリクエストのたびに、そのぶんのメモリを溜め込みます。api のメモリの上限は 256MB(`docker-compose.yml` の `mem_limit`)です。
上限を超えると、Docker(の中の Linux)が api を強制終了し(OOM Kill)、`restart: unless-stopped` の決まりで自動的に起動し直します。

この演習では 2 通り試します。

1. **動いている api のスイッチを入れる**: 1 回落ちて再起動すると、スイッチが起動時の値(0)に戻るので「自然に直った」ように見えます。
2. **起動時からスイッチが入っている**(= 不具合の入った版をリリースした状態): 起動 → 溜まる → 落ちる → 起動…を繰り返し、再起動の間隔がだんだん延びます(本格版の CrashLoopBackOff と同じ動き)。

たとえ: **水を捨てずに溜め続けるバケツ** です。バケツ(メモリの上限)があふれたら、管理人(Docker)がバケツを空にして置き直します(再起動)。
でも、蛇口(不具合)が開いたままなら、またすぐあふれます。管理人は「置き直す間隔」をだんだん空けますが、蛇口を閉めるのは人の仕事です。

::: tip CCv2 では
本格版(Kubernetes / CCv2)では、Pod のメモリの上限(`limits.memory`)を超えると `OOMKilled`(終了コード 137)になり、再起動を繰り返すと `CrashLoopBackOff` になります。
再起動の間隔をだんだん延ばす(バックオフ)のも Kubernetes の仕組みです。「生きているか」の検査(liveness)で落ちるのとは別で、これは「メモリの天井にぶつかって外から殺される」動きです。
:::

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

3. **動いている api にメモリを溜めさせる**(1 回 5MB)。cdn-waf の作り置きに当たらないよう、検索の言葉を毎回変えます。

   ```bash
   tools/chaos.sh set leakMb=5
   for i in $(seq 1 60); do
     c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=leak$i")
     if [ "$c" != 200 ] || [ $((i%10)) -eq 0 ]; then echo "req=$i code=$c $(docker stats --no-stream --format '{{.MemUsage}}' lab-api-1)"; fi
     sleep 0.2
   done
   tools/chaos.sh status
   docker inspect lab-api-1 -f 'restarts={{.RestartCount}}'
   ```

   ::: warning zsh で `$RANDOM` を使うときの注意
   検索の言葉を `query=$RANDOM` にすると、Mac の標準のシェル(zsh)では `$(...)` の中で毎回同じ数になり、cdn-waf の作り置きに当たってメモリが溜まりません(実際にはまりました)。ここではループの番号 `$i` を使っています。
   :::

4. **起動時からスイッチが入った api にする**(1 回 20MB)。コマンドの前に書いた値は、この起動のときだけ使われます。

   ```bash
   CHAOS_LEAK_MB=20 docker compose up -d api
   docker compose ps api        # (healthy) を待つ
   for i in $(seq 1 300); do curl -s -o /dev/null -w '%{http_code}\n' --max-time 5 "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=loop$i"; sleep 0.3; done | sort | uniq -c
   ```

   終わったら状態を見ます。

   ```bash
   docker compose ps api
   docker inspect lab-api-1 -f 'restarts={{.RestartCount}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}'
   docker compose logs api --no-log-prefix --since 5m | grep -c '起動しました'
   ```

5. **Grafana で見る**。「サンプルストア SLO」の「メモリ(RSS。api・backoffice・worker・storefront)」のパネル(`api` の線)に、上がっては 0 に落ちる「のこぎりの歯」の形が出ます。

### 本格版では

本格版(kind)では、同じことが Kubernetes の言葉で見えます。詳しくは `k8s/README.md`([準備と起動](/guide/setup))を見てください(本格版の api のメモリ上限は 256Mi です)。

```bash
k8s/chaos.sh boot leakMb=20                                                  # 起動時からメモリを溜める api にする
while true; do curl -s -o /dev/null -w '%{http_code}\n' "http://api.lab.localhost:18080/occ/v2/samplestore/products/search?query=$RANDOM"; sleep 0.3; done   # 別のターミナルで
kubectl -n lab get pods -l app.kubernetes.io/name=api -w                      # OOMKilled → CrashLoopBackOff
kubectl -n lab describe pod -l app.kubernetes.io/name=api | grep -A5 'Last State'   # Reason: OOMKilled / Exit Code: 137
kubectl -n lab logs deploy/api --previous                                     # 落ちる前の api のログ
k8s/chaos.sh boot-reset                                                       # 元に戻す(10 秒ほどで回復)
```

## 4. 何が見えたら成功か

**手順 3(1 回だけ落ちる)**: 10 回ごとに約 50MB ずつ増え、上限 256MB の手前で api が消え(502)、すぐに 32MB で起動し直しました。スイッチは 0 に戻っています。

```text
req=10 code=200 114.7MiB / 256MiB
req=20 code=200 164.8MiB / 256MiB
req=30 code=200 215MiB / 256MiB
req=40 code=502 0B / 0B
req=50 code=200 32.38MiB / 256MiB
req=60 code=200 32.40MiB / 256MiB
{"latencyMs":0,"errorRate":0,"leakMb":0,...}
restarts=1
```

イベントには、強制終了(`oom`)→ 停止(`die`)→ 起動(`start`)が同じ秒に並び、その 5 秒後にヘルスチェックが `healthy` に戻りました。

```text
1790388801 oom
1790388801 die
1790388801 start
1790388806 health_status: healthy
```

**「自然に直る」ように見えて、実は 1 回死んでいる** のです。気づく手がかりは `restarts=1` の数字と、メモリのグラフの形だけです。

**手順 4(再起動を繰り返す)**: 約 100 秒で 10 回落ち、再起動の間隔がだんだん延びました(下は、試し始めてからの秒数)。

```text
4s oom / 4s start
9s oom / 9s start
13s oom / 14s start
19s oom / 19s start
24s oom / 25s start
30s oom / 33s start      ← 3 秒待ってから起動
38s oom / 44s start      ← 6 秒
49s oom / 62s start      ← 13 秒
66s oom / 91s start      ← 25 秒
96s oom
```

お客様から見ると、300 回のうち成功は 110 回だけでした。

```text
    110 200
    181 502
      9 504
```

終わったときの状態。終了コード 137 は「外から強制終了された」、`oom=true` は「メモリの上限を超えたから」という意味です。

```text
lab-api-1 Restarting (137) 40 seconds ago
restarts=10 exit=137 oom=true
10            ← 「起動しました」のログが 10 回(最初の起動 1 回 + 起動し直せた 9 回。10 回目の起動はまだ待っているところ)
```

見るタイミングによっては、ちょうど起動し直した直後で `Up 1 second (health: starting)`・`exit=0 oom=false` と出ます(起動し直すと、前回の終わり方の記録が消えるためです)。
そのときは「起動しました」が 11 回になります。どちらのときも `restarts=10` の数と「起動しました」の回数は残っているので、「何度も落ちている」ことが分かります。

**本格版**: Pod の STATUS が `OOMKilled` → `CrashLoopBackOff` と変わり、`RESTARTS` の数が増えていきます。`describe` の `Last State` に `Reason: OOMKilled`、`Exit Code: 137` が出ます。

## 5. ここで覚える言葉

| 言葉 | 一言でいうと | たとえ | この演習で見たもの |
| --- | --- | --- | --- |
| メモリリーク | メモリを溜め続けて放さない不具合 | 水を捨てないバケツ | `leakMb` で RSS がじわじわ増える |
| [メモリ上限](/guide/glossary#memory-limit) | ここを超えたら強制終了、という天井 | バケツの縁 | `mem_limit: 256m` |
| [OOMKilled](/guide/glossary#oomkilled) | メモリの上限を超えて強制終了されたこと | あふれてバケツを空にされる | `oom=true` / 終了コード 137 |
| [CrashLoopBackOff](/guide/glossary#crashloopbackoff) | 起動しては落ちるので、再起動の間隔を延ばす状態 | 少し待ってからバケツを置き直す | 再起動の間隔が延びていく |
| [liveness プローブ](/guide/glossary#liveness-probe) | 生きているかの検査(これとは別で殺される) | 脈を取る点呼 | 今回は脈ではなく天井が原因 |
| 散発的な障害 | たまに起きてすぐ復活する、気づきにくい障害 | ときどき落ちるブレーカー | 「たまに 502」の正体 |

## 6. 設計書ではここに書く

- **[インフラ方式 4.3 メモリの上限](/design/architecture/03-infrastructure#s4-3)・[4.4 ヘルスチェックと再起動](/design/architecture/03-infrastructure#s4-4)**: 各サービスのメモリ上限、超えたときの動き(再起動)、再起動が続く状態への気づき方。
- **[障害対応方式 4.4 再起動に任せる範囲](/design/architecture/08-incident-response#s4-4)**: 自動で再起動させてよい障害と、人が要る障害の線引き。
- **[障害対応方式 4.3 気づき方と一次対応](/design/architecture/08-incident-response#s4-3)**: 「自然に直る」ように見える障害を、再起動の回数やメモリのグラフで見つける。

## 7. レビューで聞く質問

- 「各サービスのメモリの上限は決まっていますか。超えたらどうなりますか(再起動・アラート)。」
- 「メモリを溜め込む不具合(リーク)は、どうやって見つけますか。リリース直後は元気なことを分かっていますか。」
- 「再起動を繰り返す状態(CrashLoopBackOff)に、誰がどの指標で気づきますか。」
- 「『たまに 502 が出て、すぐ直る』という散発的な障害を、どう追いますか。」
- 「再起動で一時的に直ることと、根本の不具合を直すことを、分けて扱っていますか。」

## 8. 片付け

```bash
docker compose up -d api        # CHAOS_LEAK_MB を付けずに起動 = 起動時の値も 0 に戻る
docker compose ps api           # (healthy) を待つ
tools/chaos.sh status           # leakMb が 0 ならよい
```

手順 2 の `docker events` は Ctrl+C で止めます。

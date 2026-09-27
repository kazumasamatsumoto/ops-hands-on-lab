#!/usr/bin/env node
// manifest.json(構成の設計図)を読み、本格版(Kubernetes)の定義ファイルを k8s/generated/ に書き出します。
// 「manifest に 1 行書くと、裏でこういうリソースができる」を見せるための道具です。CCv2 で manifest.json を
// 書いてビルド・デプロイすると、裏で Kubernetes のリソースが作られるのと同じ考え方です(このラボ独自の簡単な形)。
//
//   使い方:
//     node tools/manifest/render.mjs           k8s/generated/ を作り直す
//     node tools/manifest/render.mjs --check   作り直さずに、docker-compose.yml・ingress の設定と食い違いがないかだけ確かめる
//
//   できる物(k8s/generated/):
//     base/kustomization.yaml       下の全部をまとめる目次
//     base/storefront.yaml          storefront の Deployment(台数・環境変数・見回り)と Service(中の住所)
//     base/api.yaml                 aspect ごとの Deployment と Service(api・backoffice・worker)
//     base/backoffice.yaml
//     base/worker.yaml
//     base/ingress.yaml             エンドポイントごとの Ingress(ホスト名 → Service、IP フィルタ、回数制限、閉じる口)
//     envs/d1|s1|p1/kustomization.yaml  環境ごとの差分(台数・キャッシュの ON/OFF など)
//     envs/d1|s1|p1/patches/*.yaml      環境ごとの上書き(環境変数・IP フィルタ)
//
//   確かめ方: kubectl kustomize k8s/generated/envs/p1(クラスタが無くても、組み立てた結果の YAML が見られます)
//
// 外部のパッケージは使いません(Node.js 24 だけで動きます)。YAML は下の toYaml で書きます。
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'k8s', 'generated');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

// ---------------------------------------------------------------------------
// YAML を書く小さな関数
// 文字列は、数や true/false と見分けがつかないもの・記号を含むものだけ "..." で囲みます(囲めば特別な文字が入っても壊れません)。
// ---------------------------------------------------------------------------
function scalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  const plain = /^[A-Za-z_/.][A-Za-z0-9_./-]*$/.test(s) && !/^(true|false|yes|no|on|off|null|y|n)$/i.test(s);
  return plain ? s : JSON.stringify(s);
}
function toYaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object' && !(Array.isArray(item) && item.length === 0) && Object.keys(item).length > 0) {
          const body = toYaml(item, indent + 2);
          return `${pad}- ${body.slice(indent + 2)}`;
        }
        return `${pad}- ${typeof item === 'object' && item !== null ? (Array.isArray(item) ? '[]' : '{}') : scalar(item)}`;
      })
      .join('\n');
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    return entries
      .map(([k, v]) => {
        const key = /^[A-Za-z0-9_./-]+$/.test(k) ? k : JSON.stringify(k);
        if (v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)) {
          return `${pad}${key}:\n${toYaml(v, indent + 2)}`;
        }
        return `${pad}${key}: ${v !== null && typeof v === 'object' ? (Array.isArray(v) ? '[]' : '{}') : scalar(v)}`;
      })
      .join('\n');
  }
  return pad + scalar(value);
}
const HEADER = '# このファイルは tools/manifest/render.mjs が manifest.json から作りました。手で直さず、manifest.json を直して作り直してください。\n';
function docs(...objs) {
  return HEADER + objs.map((o) => '---\n' + toYaml(o)).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 部品を作る関数
// ---------------------------------------------------------------------------
const ING = 'nginx.ingress.kubernetes.io';

function labels(service, extra = {}) {
  return { 'app.kubernetes.io/name': service, 'app.kubernetes.io/part-of': manifest.name, ...extra };
}

/** トレースの送り先(本格版だけ)。manifest.tracing が無ければ何も足しません */
function tracingEnv() {
  return manifest.tracing?.otlpEndpoint ? { OTEL_EXPORTER_OTLP_ENDPOINT: manifest.tracing.otlpEndpoint } : {};
}

function envList(plain, secretKeys = []) {
  const list = Object.entries(plain).map(([name, value]) => ({ name, value: String(value) }));
  for (const key of secretKeys) {
    list.push({ name: key, valueFrom: { secretKeyRef: { name: manifest.secrets.name, key } } });
  }
  return list;
}

/** Deployment(何台・どのイメージ・どの環境変数・どう見回るか)と Service(中の住所)の組 */
function workload({ service, image, port, replicas, env, secretEnv, resources, readinessPath, extraLabels }) {
  const sel = labels(service);
  const deployment = {
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: { name: service, labels: labels(service, extraLabels) },
    spec: {
      replicas,
      selector: { matchLabels: { 'app.kubernetes.io/name': service } },
      // ローリング更新: 新しい Pod が準備できてから古い Pod を 1 つずつ止めます(止めずに入れ替える)。
      // ただし worker(定期ジョブ)だけは Recreate: 古い Pod を止めてから新しい Pod を起動します。
      // ローリング更新だと入れ替えの間に 2 台が同時に動き、同じ定期ジョブが二重に実行されるためです
      // (在庫の取り込みが 2 回走る、など。定期ジョブの二重実行は本番でもよくある事故です)。
      strategy:
        service === 'worker'
          ? { type: 'Recreate' }
          : { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 0, maxSurge: 1 } },
      template: {
        metadata: { labels: labels(service, extraLabels), annotations: { 'lab/metrics-port': String(port) } },
        spec: {
          terminationGracePeriodSeconds: 20,
          containers: [
            {
              name: service,
              image,
              imagePullPolicy: 'IfNotPresent',
              ports: [{ name: 'http', containerPort: port }],
              env: envList(env, secretEnv),
              // startup: 起動が終わるまで(最大 120 秒)は liveness を待たせる。DB を待つ api が「起動中なのに死んだ」と誤解されないため
              // readiness: 準備ができていなければ振り分け先から外す(Pod は殺さない) / liveness: 応答しなければ作り直す
              startupProbe: { httpGet: { path: '/healthz', port: 'http' }, periodSeconds: 2, failureThreshold: 60 },
              readinessProbe: { httpGet: { path: readinessPath, port: 'http' }, periodSeconds: 5, timeoutSeconds: 3, failureThreshold: 2 },
              livenessProbe: { httpGet: { path: '/healthz', port: 'http' }, periodSeconds: 10, timeoutSeconds: 3, failureThreshold: 3 },
              // requests = 予約(ノードに置けるかの判断に使う) / limits = 上限(メモリを超えると OOMKilled)
              resources: {
                requests: { cpu: resources.cpu, memory: resources.memory },
                limits: { memory: resources.memoryLimit },
              },
              // 止める前に 5 秒待つ。その間に ingress の振り分け先から外れるので、ローリング更新で処理中のお客さんを切らない
              lifecycle: { preStop: { sleep: { seconds: 5 } } },
            },
          ],
        },
      },
    },
  };
  const svc = {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: service, labels: labels(service, extraLabels) },
    spec: { selector: sel, ports: [{ name: 'http', port, targetPort: 'http' }] },
  };
  return [deployment, svc];
}

function ipList(filterName) {
  if (!filterName) return undefined;
  const list = manifest.ipFilters[filterName];
  if (!list) throw new Error(`ipFilters に "${filterName}" がありません`);
  return list.join(',');
}

function servicePort(service) {
  if (service === manifest.storefront.service) return manifest.storefront.port;
  const a = manifest.aspects.find((x) => x.service === service);
  if (!a) throw new Error(`エンドポイントの行き先 ${service} が storefront にも aspects にもありません`);
  return a.port;
}

/** エンドポイント 1 つ → Ingress(本体・回数制限・閉じる口)。ingress-nginx の注釈(annotations)で設定します */
function ingressesFor(ep) {
  const port = servicePort(ep.service);
  const backend = { service: { name: ep.service, port: { number: port } } };
  const allow = ipList(ep.ipFilter);
  const base = (name, annotations, paths) => ({
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { name, labels: labels(ep.service, { 'lab/endpoint': ep.name }), annotations },
    spec: {
      ingressClassName: 'nginx',
      rules: [{ host: ep.host, http: { paths: paths.map(([path, pathType]) => ({ path, pathType, backend })) } }],
    },
  });
  const out = [];
  // 本体: ホスト名のすべてのパス → Service。IP フィルタがあれば allowlist-source-range(それ以外は 403)
  out.push(base(`${ep.name}`, allow ? { [`${ING}/allowlist-source-range`]: allow } : {}, [['/', 'Prefix']]));
  // 回数制限: パスごとに別の Ingress にします(注釈は Ingress 全体に効くため)。
  //   limit-rps = 1 秒あたりの回数、limit-burst-multiplier = まとめて通す回数(rps × この数)
  ep.rateLimits.forEach((rl, i) => {
    out.push(
      base(
        `${ep.name}-ratelimit-${i + 1}`,
        {
          [`${ING}/limit-rps`]: String(rl.rps),
          [`${ING}/limit-burst-multiplier`]: String(Math.max(1, Math.round(rl.burst / rl.rps))),
          ...(allow ? { [`${ING}/allowlist-source-range`]: allow } : {}),
        },
        [[rl.path, 'Exact']],
      ),
    );
  });
  // 閉じる口(/admin・/metrics・/readyz): denylist-source-range に「すべての IP(0.0.0.0/0)」を書き、誰からでも 403 にします。
  //   allowlist を 127.0.0.1/32 にする書き方は使いません。cdn-waf は「ホスト PC から来た」通信を 127.0.0.1 として伝えるので、
  //   それだとホスト PC からは開いてしまうためです(中の人は Pod の中から直接呼びます。k8s/chaos.sh)。
  if (ep.blockedPaths.length > 0) {
    out.push(
      base(
        `${ep.name}-blocked`,
        { [`${ING}/denylist-source-range`]: '0.0.0.0/0' },
        ep.blockedPaths.map((p) => [p, p === '/admin' ? 'Prefix' : 'Exact']),
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// base(どの環境でも同じ部分)
// ---------------------------------------------------------------------------
function renderBase() {
  const files = {};
  const sf = manifest.storefront;
  files['storefront.yaml'] = docs(
    ...workload({
      service: sf.service,
      image: manifest.images.storefront,
      port: sf.port,
      replicas: sf.replicas,
      env: {
        PORT: sf.port,
        RENDER_MODE: sf.ssr.renderMode,
        SSR_TIMEOUT_MS: sf.ssr.timeoutMs,
        ...sf.env,
        ...tracingEnv(),
      },
      secretEnv: [],
      resources: sf.resources,
      readinessPath: '/healthz',
      extraLabels: { 'lab/role': 'storefront' },
    }),
  );
  for (const a of manifest.aspects) {
    files[`${a.service}.yaml`] = docs(
      ...workload({
        service: a.service,
        image: manifest.images.platform,
        port: a.port,
        replicas: a.replicas,
        env: { ASPECT: a.name, PORT: a.port, ...manifest.commonEnv, ...a.env, ...tracingEnv() },
        secretEnv: a.secretEnv,
        resources: a.resources,
        readinessPath: '/readyz',
        extraLabels: { 'lab/aspect': a.name },
      }),
    );
  }
  files['ingress.yaml'] = docs(...manifest.endpoints.flatMap(ingressesFor));
  files['kustomization.yaml'] =
    HEADER +
    toYaml({
      apiVersion: 'kustomize.config.k8s.io/v1beta1',
      kind: 'Kustomization',
      resources: Object.keys(files).sort(),
    }) +
    '\n';
  return files;
}

// ---------------------------------------------------------------------------
// envs/<環境>(base との差分だけを書く)
// ---------------------------------------------------------------------------
function serviceOf(nameInReplicas) {
  if (nameInReplicas === 'storefront') return manifest.storefront.service;
  const a = manifest.aspects.find((x) => x.name === nameInReplicas);
  if (!a) throw new Error(`replicas の ${nameInReplicas} が aspects にありません`);
  return a.service;
}

/** 環境の差分を返します: { 'kustomization.yaml': 本文, 'patches/xxx.yaml': 本文, ... } */
function renderEnv(envName, env) {
  const files = {};
  const patches = [];
  const addPatch = (fileName, obj) => {
    files[`patches/${fileName}`] = HEADER + toYaml(obj) + '\n';
    patches.push({ path: `patches/${fileName}` });
  };
  // 1. 環境変数の差分(同じ名前の env を上書き。strategic merge patch = 名前で突き合わせて混ぜる)
  const searchAspects = manifest.aspects.filter((a) => 'SEARCH_PROVIDER' in a.env).map((a) => a.service);
  const all = [manifest.storefront.service, ...manifest.aspects.map((a) => a.service)];
  for (const service of all) {
    const extra = { ...env.env };
    if (searchAspects.includes(service) && env.searchProvider) extra.SEARCH_PROVIDER = env.searchProvider;
    if (service === manifest.storefront.service) delete extra.LOG_LEVEL; // storefront は LOG_LEVEL を使いません
    if (Object.keys(extra).length === 0) continue;
    addPatch(`env-${service}.yaml`, {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: service },
      spec: { template: { spec: { containers: [{ name: service, env: envList(extra) }] } } },
    });
  }
  // 2. IP フィルタの差分(エンドポイントの本体と回数制限の Ingress に allowlist-source-range を付ける)
  for (const [epName, filter] of Object.entries(env.ipFilterOverrides ?? {})) {
    const ep = manifest.endpoints.find((e) => e.name === epName);
    if (!ep) throw new Error(`ipFilterOverrides の ${epName} が endpoints にありません`);
    const names = [ep.name, ...ep.rateLimits.map((_, i) => `${ep.name}-ratelimit-${i + 1}`)];
    for (const name of names) {
      addPatch(`ip-filter-${name}.yaml`, {
        apiVersion: 'networking.k8s.io/v1',
        kind: 'Ingress',
        metadata: { name, annotations: { [`${ING}/allowlist-source-range`]: ipList(filter) } },
      });
    }
  }
  const kustomization = {
    apiVersion: 'kustomize.config.k8s.io/v1beta1',
    kind: 'Kustomization',
    namespace: manifest.namespace,
    resources: ['../../base'],
    // 3. 台数
    replicas: Object.entries(env.replicas).map(([n, count]) => ({ name: serviceOf(n), count })),
    // 4. 環境の情報を ConfigMap lab-environment に置きます(cdn-waf がキャッシュの ON/OFF を読む、など)
    configMapGenerator: [
      {
        name: 'lab-environment',
        literals: [
          `LAB_ENV=${envName}`,
          `EDGE_CACHE=${env.cdnCache ? 'on' : 'off'}`,
          `SEARCH_PROVIDER=${env.searchProvider}`,
        ],
      },
    ],
    generatorOptions: { disableNameSuffixHash: true },
    patches,
  };
  files['kustomization.yaml'] = HEADER + `# 環境 ${envName}: ${env.description}\n` + toYaml(kustomization) + '\n';
  return files;
}

// ---------------------------------------------------------------------------
// --check: 軽量版(手で合わせている docker-compose.yml と ingress の設定)と食い違いがないか
// ---------------------------------------------------------------------------
function check() {
  const compose = readFileSync(join(ROOT, 'docker-compose.yml'), 'utf8');
  const ingress = readFileSync(join(ROOT, 'ingress', 'default.conf.template'), 'utf8');
  const problems = [];
  const block = (service) => {
    const m = compose.match(new RegExp(`\\n  ${service}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:\\n|\\nvolumes:)`));
    return m ? m[1] : '';
  };
  for (const a of manifest.aspects) {
    const b = block(a.service);
    if (!b) problems.push(`compose にサービス ${a.service} がありません`);
    else if (!b.includes(`ASPECT: ${a.name}`)) problems.push(`compose の ${a.service} が ASPECT: ${a.name} になっていません`);
    for (const [k, v] of Object.entries(a.env)) {
      const inBlock = b.match(new RegExp(`\\n\\s+${k}: (.*)`));
      const inCommon = compose.match(new RegExp(`x-db-env:[\\s\\S]*?\\n  ${k}: (.*)`));
      const actual = (inBlock?.[1] ?? inCommon?.[1] ?? '').replace(/^\$\{[A-Z_]+:-(.*)\}$/, '$1').replace(/^"|"$/g, '');
      if (actual !== String(v)) problems.push(`${a.service} の ${k}: manifest は "${v}"、compose は "${actual}"`);
    }
  }
  for (const ep of manifest.endpoints) {
    const port = servicePort(ep.service);
    const re = new RegExp(`server_name ${ep.host.replace(/\./g, '\\.')};[\\s\\S]*?set \\$backend http://${ep.service}:${port};`);
    if (!re.test(ingress)) problems.push(`ingress/default.conf.template に ${ep.host} → ${ep.service}:${port} がありません`);
    for (const rl of ep.rateLimits) {
      if (!ingress.includes(`location = ${rl.path}`)) problems.push(`ingress に ${rl.path} の回数制限がありません`);
    }
    if (ep.ipFilter) {
      const m = compose.match(/BACKOFFICE_IP_ALLOWLIST: \$\{BACKOFFICE_IP_ALLOWLIST:-(.*)\}/);
      const composeList = (m?.[1] ?? '').split(/[\s,]+/).filter(Boolean).join(',');
      if (composeList !== ipList(ep.ipFilter)) problems.push(`IP フィルタ ${ep.ipFilter}: manifest は ${ipList(ep.ipFilter)}、compose は ${composeList}`);
    }
  }
  if (problems.length) {
    console.error('食い違いがあります:\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }
  console.log('manifest.json と docker-compose.yml・ingress/default.conf.template は食い違っていません(軽量版の既定値で比べています)。');
}

// ---------------------------------------------------------------------------
if (process.argv.includes('--check')) {
  check();
} else {
  rmSync(OUT, { recursive: true, force: true });
  const base = renderBase();
  mkdirSync(join(OUT, 'base'), { recursive: true });
  for (const [name, text] of Object.entries(base)) writeFileSync(join(OUT, 'base', name), text);
  for (const [envName, env] of Object.entries(manifest.environments)) {
    for (const [name, text] of Object.entries(renderEnv(envName, env))) {
      mkdirSync(dirname(join(OUT, 'envs', envName, name)), { recursive: true });
      writeFileSync(join(OUT, 'envs', envName, name), text);
    }
  }
  console.log(`k8s/generated/ を作りました(base: ${Object.keys(base).length} ファイル、環境: ${Object.keys(manifest.environments).join('・')})`);
}

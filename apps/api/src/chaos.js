// わざと壊すスイッチ(カオス)の状態を持つところです。
// 起動時は環境変数から読み、あとから POST /admin/chaos で変えられます。
//
// たとえ: 工場の配電盤に並んだブレーカーです。1 つずつ上げ下げして、
// 「この部品が壊れたら全体はどう見えるか」を安全な場所で試します。

function toNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const DEFAULTS = Object.freeze({
  latencyMs: 0, // すべての /api に足す遅延(ミリ秒)
  errorRate: 0, // 0〜1。この割合で 500 を返す
  leakMb: 0, // リクエストのたびにため込むメモリ(MB)。0 以外だと最後は落ちます
  idorBug: false, // true: 注文詳細で持ち主を確かめない(他人の注文が見える)
  sqliBug: false, // true: 検索語を文字列連結で SQL に入れる(SQL インジェクション)
});

export const chaos = {
  latencyMs: toNumber(process.env.CHAOS_LATENCY_MS, DEFAULTS.latencyMs),
  errorRate: toNumber(process.env.CHAOS_ERROR_RATE, DEFAULTS.errorRate),
  leakMb: toNumber(process.env.CHAOS_LEAK_MB, DEFAULTS.leakMb),
  idorBug: toBool(process.env.CHAOS_IDOR_BUG, DEFAULTS.idorBug),
  sqliBug: toBool(process.env.CHAOS_SQLI_BUG, DEFAULTS.sqliBug),
};

// ため込んだメモリ(leakMb 用)。わざと解放しないように配列で持ち続けます。
const leaked = [];

export function leakedMb() {
  return leaked.length === 0 ? 0 : leaked.reduce((sum, b) => sum + b.length, 0) / 1024 / 1024;
}

// 値を検査してから反映します。知らない名前や変な値は 400 にするため、エラーの一覧を返します。
export function updateChaos(input) {
  const errors = [];
  const next = { ...chaos };
  if (input === null || typeof input !== 'object') {
    return { errors: ['JSON のオブジェクトを送ってください'] };
  }
  if (input.reset === true) {
    Object.assign(next, DEFAULTS);
  }
  for (const [key, value] of Object.entries(input)) {
    if (key === 'reset') continue;
    if (!(key in DEFAULTS)) {
      errors.push(`知らないスイッチです: ${key}`);
      continue;
    }
    if (typeof DEFAULTS[key] === 'boolean') {
      next[key] = toBool(value, next[key]);
    } else {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        errors.push(`${key} は 0 以上の数にしてください`);
        continue;
      }
      if (key === 'errorRate' && n > 1) {
        errors.push('errorRate は 0〜1 にしてください(0.5 なら半分が 500)');
        continue;
      }
      next[key] = n;
    }
  }
  if (errors.length > 0) return { errors };
  Object.assign(chaos, next);
  // leakMb を 0 に戻したら、ため込んだメモリも手放します(演習の片付けを楽にするため)。
  if (chaos.leakMb === 0) leaked.length = 0;
  return { errors: [] };
}

// /api/* の前に通す関門です。遅延・エラー・メモリ漏れをここで起こします。
export async function chaosMiddleware(req, res, next) {
  if (chaos.leakMb > 0) {
    // Buffer.alloc は中身を 0 で埋めるので、実際にメモリ(RSS)が増えます。
    leaked.push(Buffer.alloc(Math.floor(chaos.leakMb * 1024 * 1024), 1));
  }
  if (chaos.latencyMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, chaos.latencyMs));
  }
  if (chaos.errorRate > 0 && Math.random() < chaos.errorRate) {
    req.log?.warn({ chaos: 'errorRate' }, 'chaos: わざと 500 を返します');
    res.status(500).json({ error: 'internal_error', message: 'わざと起こしたエラーです(chaos errorRate)' });
    return;
  }
  next();
}

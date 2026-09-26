/**
 * サーバーのログ。1 行 = 1 つの JSON で標準出力に出します(Loki などで項目ごとに絞り込めます)。
 * trace_id があれば入れます。Grafana で trace_id から Tempo のトレース(1 リクエストの道筋)に飛べます。
 */
export function log(fields: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify({ time: new Date().toISOString(), service: 'storefront', ...fields }) + '\n');
}

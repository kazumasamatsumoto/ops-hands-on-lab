// pager: Alertmanager からの通知(webhook)を受け取り、画面に並べるだけの小さなサービスです。
// 本物の現場では、ここが電話・チャット・呼び出しサービスになります。ラボでは外に送らず、ここで止めます。
//
//   POST /webhook   … Alertmanager が通知を送ってくる場所
//   GET  /          … 受け取った通知の一覧(5 秒ごとに自動で読み直します)
//   GET  /api/alerts … 同じ一覧を JSON で
//   POST /clear     … 一覧を空にする
//
// 依存パッケージを使わず、Node.js の標準機能だけで書いています。
import http from 'node:http';

const PORT = Number(process.env.PORT ?? 9094);
const MAX_ENTRIES = 200;
const received = []; // 新しい順

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function formatTime(iso) {
  if (!iso || iso.startsWith('0001')) return '';
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
}

function renderPage() {
  const rows = received
    .map((entry) => {
      const a = entry.alert;
      const firing = a.status === 'firing';
      return `<tr class="${firing ? 'firing' : 'resolved'}">
  <td>${escapeHtml(formatTime(entry.receivedAt))}</td>
  <td><strong>${firing ? '発生中' : '解消'}</strong></td>
  <td>${escapeHtml(a.labels?.severity)}</td>
  <td>${escapeHtml(a.labels?.alertname)}</td>
  <td>${escapeHtml(a.labels?.job)}</td>
  <td>${escapeHtml(a.annotations?.summary)}<br><small>${escapeHtml(a.annotations?.description)}</small></td>
  <td>${escapeHtml(formatTime(a.startsAt))}</td>
</tr>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="5">
<title>pager(ラボの通知受け口)</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 16px; color: #222; background: #fafafa; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; font-size: 14px; }
  th { background: #eee; }
  tr.firing td:nth-child(2) { color: #b00020; }
  tr.resolved td:nth-child(2) { color: #1b5e20; }
  small { color: #555; }
</style>
</head>
<body>
<h1>pager(ラボの通知受け口)</h1>
<p>Alertmanager から届いた通知を新しい順に並べています(5 秒ごとに自動更新。最大 ${MAX_ENTRIES} 件、再起動で消えます)。</p>
<p>届いた件数: ${received.length}</p>
<table>
<thead><tr><th>受け取った時刻</th><th>状態</th><th>重大度</th><th>アラート名</th><th>対象</th><th>内容</th><th>発生時刻</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="7">まだ通知は届いていません。</td></tr>'}
</tbody>
</table>
</body>
</html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/webhook') {
      const payload = JSON.parse(await readBody(req));
      const receivedAt = new Date().toISOString();
      for (const alert of payload.alerts ?? []) {
        received.unshift({ receivedAt, alert });
        console.log(
          JSON.stringify({ service: 'pager', msg: 'alert received', status: alert.status, alertname: alert.labels?.alertname, severity: alert.labels?.severity }),
        );
      }
      received.splice(MAX_ENTRIES);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (req.method === 'POST' && req.url === '/clear') {
      received.length = 0;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
      return;
    }
    if (req.method === 'GET' && req.url === '/api/alerts') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(received));
      return;
    }
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
      return;
    }
    if (req.method === 'GET' && req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderPage());
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end(`bad request: ${err.message}`);
  }
});

server.listen(PORT, () => console.log(JSON.stringify({ service: 'pager', msg: `listening on ${PORT}` })));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

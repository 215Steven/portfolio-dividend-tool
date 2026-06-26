// ─────────────────────────────────────────────────────────
// 組合分析工具 — CORS Proxy（Vercel Serverless Function）
// 將前端對 invest.fubonlife.com.tw 的請求轉發出去，並加上 CORS 標頭
// 使用方式：GET /api/proxy?url=<已 encodeURIComponent 的富邦相對路徑>
// ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  try {
    const target = req.query && req.query.url;
    if (!target || typeof target !== 'string' || !target.startsWith('/')) {
      res.status(400).send('缺少或不合法的 url 參數');
      return;
    }
    const fullUrl = 'https://invest.fubonlife.com.tw' + target;
    const upstream = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://invest.fubonlife.com.tw/',
        'Accept': '*/*'
      }
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.status(upstream.status).send(buf);
  } catch (e) {
    res.status(502).send('Proxy 轉發失敗：' + (e && e.message ? e.message : String(e)));
  }
}

/**
 * 富邦新版 JSON API 轉發（POST）
 *
 * 2026/10 富邦改版，舊的 djjson 端點全數 404，新版改用 POST + JSON。
 * proxy.js 只支援 GET，故另開這支。
 */

const ALLOWED_BASE = 'https://invest.fubonlife.com.tw';
const ALLOWED_PREFIX = ['/api/asset/', '/api/fund/', '/api/etf/', '/api/option/'];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const path = req.query.path;
  if (!path || !path.startsWith('/')) {
    return res.status(400).json({ error: 'Invalid path: must start with /' });
  }
  // 防 SSRF：不允許協議字元，且只放行已知的資料端點
  if (path.includes('://') || path.includes('@') || path.includes('..')) {
    return res.status(400).json({ error: 'Invalid path characters' });
  }
  if (!ALLOWED_PREFIX.some(function (p) { return path.startsWith(p); })) {
    return res.status(400).json({ error: 'Path not allowed' });
  }

  let body = req.body;
  if (typeof body !== 'string') body = JSON.stringify(body || {});

  try {
    const upstream = await fetch(ALLOWED_BASE + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.7',
        'Origin': ALLOWED_BASE,
        'Referer': ALLOWED_BASE + '/funds/overview',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      },
      body: body,
      signal: AbortSignal.timeout(25000)
    });
    const text = await upstream.text();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // 清單類資料一天只變一次，讓 CDN 幫忙擋下重複請求
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400');
    return res.status(upstream.status).send(text);
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};

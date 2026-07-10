const VCCT_API   = 'https://vcct-dividend-tool.vercel.app/api/data';
const VCCT_PROXY = 'https://vcct-dividend-tool.vercel.app/api/proxy';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=43200, stale-while-revalidate=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  try {
    const raw = await fetch(VCCT_API, {
      headers: { 'User-Agent': 'vcct-top10-bot/1.0' }
    }).then(r => r.json());

    function decodeBig5(b64) {
      const bytes = Buffer.from(b64, 'base64');
      return new TextDecoder('big5').decode(bytes);
    }

    // --- Parse rrList: NAV, returns, freq ---
    const rrJson = JSON.parse(decodeBig5(raw.rrList));
    const funds = {};
    rrJson.ResultSet.Result.forEach(r => {
      if (!r.V29) return;
      funds[r.V29] = {
        code:  r.V29,
        name:  r.V3,
        cur:   r.V26 || '',
        nav:   parseFloat(r.V18) || null,
        ret6m: r.V12 !== '' && r.V12 !== 'N/A' ? parseFloat(r.V12) : null,
        ret1y: r.V13 !== '' && r.V13 !== 'N/A' ? parseFloat(r.V13) : null,
        ret3y: r.V15 !== '' && r.V15 !== 'N/A' ? parseFloat(r.V15) : null,
        freq:  r.V42 || '無',
        rate:  null,
        rr:    null,
        type:  null,
        v40:   null,
        v41:   null,
      };
    });

    // --- Parse fundList: RR, type, V40, V41 ---
    const flJson = JSON.parse(decodeBig5(raw.fundList));
    flJson.ResultSet.Result.forEach(r => {
      if (!r.V29) return;
      const f = funds[r.V29];
      if (!f) return;
      f.rr  = r.V28 || '?';
      f.type = r.V5 || '';
      f.v40 = r.V40 || null;
      f.v41 = r.V41 || null;
    });

    // --- Helpers ---
    function parseDivHtml(html, nav) {
      // Extract up to 6 monthly dividend amounts from Big5 HTML table
      const amounts = [];
      const re = />(\d+\.\d{2,4})</g;
      let m;
      while ((m = re.exec(html)) !== null) {
        const v = parseFloat(m[1]);
        if (v > 0 && v < nav * 0.3) amounts.push(v);
        if (amounts.length >= 6) break;
      }
      return amounts;
    }

    function computeRate(amounts, nav) {
      if (!amounts.length || !nav) return null;
      const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      return +(avg * 12 / nav * 100).toFixed(2);
    }

    // --- Step 1: Process pre-fetched divData (24 VCCT-curated funds) ---
    for (const [key, entry] of Object.entries(raw.divData || {})) {
      const code = key.split('-').pop();
      const f = funds[code];
      if (!f || !f.nav) continue;
      try {
        const html = decodeBig5(entry.data);
        f.rate = computeRate(parseDivHtml(html, f.nav), f.nav);
      } catch (e) { /* skip */ }
    }

    // --- Step 2: Fetch remaining monthly funds via vcct proxy ---
    // Covers all 101 monthly-paying funds not already in divData
    const remaining = Object.values(funds).filter(f =>
      f.freq === '月配' &&
      f.rate === null &&
      f.nav != null &&
      f.v40 && (f.v41 === 'A' || f.v41 === 'B' || f.v41 === 'C')
    );

    async function fetchFundDiv(f) {
      let path;
      if      (f.v41 === 'C') path = `/ETFData/djjson/et050000json.djjson?a=${f.v40}`;
      else if (f.v41 === 'B') path = `/w/wb/wb05.djhtm?a=${f.v40}`;
      else                    path = `/w/wr/wr10.djhtm?a=${f.v40}`;

      const url = `${VCCT_PROXY}?url=${encodeURIComponent(path)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'vcct-top10-bot/1.0' },
          signal: controller.signal
        });
        const buf = await resp.arrayBuffer();
        const text = new TextDecoder('big5').decode(buf);

        if (f.v41 === 'C') {
          // ETF dividend JSON: ResultSet.Result[].V4 = amount
          const data = JSON.parse(text);
          const amounts = (data.ResultSet.Result || [])
            .slice(0, 6)
            .map(r => parseFloat(r.V4))
            .filter(v => v > 0);
          f.rate = computeRate(amounts, f.nav);
        } else {
          // HTML dividend table (type A or B)
          f.rate = computeRate(parseDivHtml(text, f.nav), f.nav);
        }
      } catch (e) {
        // timeout or parse error — leave rate as null
      } finally {
        clearTimeout(timer);
      }
    }

    // All fetches run in parallel; settle regardless of individual failures
    await Promise.allSettled(remaining.map(f => fetchFundDiv(f)));

    // --- Build ranked lists ---
    const arr = Object.values(funds);

    const fmt = f => ({
      code:  f.code,
      name:  f.name,
      cur:   f.cur,
      rr:    f.rr || '?',
      freq:  f.freq || '無',
      nav:   f.nav,
      rate:  f.rate,
      ret6m: f.ret6m,
      ret1y: f.ret1y,
      ret3y: f.ret3y,
      type:  f.type || '',
    });
    const addRanks = list => list.map((f, i) => ({ rank: i + 1, ...fmt(f) }));

    // TOP 10 年化配息率 (monthly only)
    const top10Rate = addRanks(
      arr.filter(f => f.rate > 0).sort((a, b) => b.rate - a.rate).slice(0, 10)
    );

    // TOP 10 三年報酬率 (all funds)
    const top10Ret3y = addRanks(
      arr.filter(f => f.ret3y != null).sort((a, b) => b.ret3y - a.ret3y).slice(0, 10)
    );

    // TOP 10 三年報酬率 (RR3 only)
    const top10Ret3yRR3 = addRanks(
      arr.filter(f => f.ret3y != null && f.rr === 'RR3').sort((a, b) => b.ret3y - a.ret3y).slice(0, 10)
    );

    res.json({
      top10Rate,
      top10Ret3y,
      top10Ret3yRR3,
      fetchedAt:   raw.fetchedAt,
      generatedAt: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

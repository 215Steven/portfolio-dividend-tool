const VCCT_API = 'https://vcct-dividend-tool.vercel.app/api/data';

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

    // Parse rrList: performance & basic fund info
    const rrJson = JSON.parse(decodeBig5(raw.rrList));
    const funds = {};
    rrJson.ResultSet.Result.forEach(r => {
      if (!r.V29) return;
      funds[r.V29] = {
        code: r.V29,
        name: r.V3,
        cur: r.V26 || '',
        nav: parseFloat(r.V18) || null,
        ret6m: r.V12 !== '' && r.V12 !== 'N/A' ? parseFloat(r.V12) : null,
        ret1y: r.V13 !== '' && r.V13 !== 'N/A' ? parseFloat(r.V13) : null,
        ret3y: r.V15 !== '' && r.V15 !== 'N/A' ? parseFloat(r.V15) : null,
        freq: r.V42 || '無',
        rate: null,
        rr: null,
        type: null
      };
    });

    // Parse fundList: RR level & fund type
    const flJson = JSON.parse(decodeBig5(raw.fundList));
    flJson.ResultSet.Result.forEach(r => {
      if (!r.V29 || !funds[r.V29]) return;
      funds[r.V29].rr = r.V28 || '?';
      funds[r.V29].type = r.V5 || '';
    });

    // Parse divData: calculate annualized dividend rate
    // Key format: "ACFP141-FBT9" → code = last segment after "-"
    // data = base64 Big5 HTML → regex for amounts → avg(first 6) * 12 / nav * 100
    for (const [key, entry] of Object.entries(raw.divData || {})) {
      const code = key.split('-').pop();
      const f = funds[code];
      if (!f || !f.nav) continue;
      try {
        const html = decodeBig5(entry.data);
        const amounts = [];
        const re = />(\d+\.\d{2,4})</g;
        let m;
        while ((m = re.exec(html)) !== null) {
          const v = parseFloat(m[1]);
          if (v > 0 && v < f.nav * 0.3) amounts.push(v);
          if (amounts.length >= 6) break;
        }
        if (amounts.length >= 1) {
          const avg = amounts.reduce((s, v) => s + v, 0) / amounts.length;
          f.rate = +(avg * 12 / f.nav * 100).toFixed(2);
        }
      } catch (e) {
        // skip parse errors
      }
    }

    const arr = Object.values(funds);

    const fmt = f => ({
      code: f.code,
      name: f.name,
      cur: f.cur,
      rr: f.rr || '?',
      freq: f.freq || '無',
      nav: f.nav,
      rate: f.rate,
      ret6m: f.ret6m,
      ret1y: f.ret1y,
      ret3y: f.ret3y,
      type: f.type || ''
    });

    const addRanks = list => list.map((f, i) => ({ rank: i + 1, ...fmt(f) }));

    // TOP 10 by annualized dividend rate (monthly-paying funds only)
    const top10Rate = addRanks(
      arr
        .filter(f => f.rate > 0)
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 10)
    );

    // TOP 10 by 3-year total return (all funds)
    const top10Ret3y = addRanks(
      arr
        .filter(f => f.ret3y != null)
        .sort((a, b) => b.ret3y - a.ret3y)
        .slice(0, 10)
    );

    // TOP 10 by 3-year total return (RR3 only)
    const top10Ret3yRR3 = addRanks(
      arr
        .filter(f => f.ret3y != null && f.rr === 'RR3')
        .sort((a, b) => b.ret3y - a.ret3y)
        .slice(0, 10)
    );

    res.json({
      top10Rate,
      top10Ret3y,
      top10Ret3yRR3,
      fetchedAt: raw.fetchedAt,
      generatedAt: new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

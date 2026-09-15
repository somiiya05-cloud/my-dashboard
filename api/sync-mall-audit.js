// 자사몰 9곳을 매일 검수해서 결과를 Supabase의 mall_audits 표에 넣는 Vercel 서버리스 함수입니다.
// 대시보드의 "자사몰 검수" 카드와 빨간 배지가 이 값을 읽습니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "sync-mall-audit.js" 로 저장하세요.
//    최종 경로: api/sync-mall-audit.js
//
// ── 검수 원리 ────────────────────────────────────────────────────────────
// 자사몰 9곳은 전부 카페24입니다. 카페24는 "진열함" 상태인 상품만 sitemap.xml 에 넣습니다.
// 그래서 로그인 없이도 sitemap.xml 한 번만 읽으면 "지금 공개된 상품 전부"를 알 수 있습니다.
//
//   · 신규 상품    : 어제 사이트맵에 없던 상품번호가 오늘 생겼다 → 새로 등록된 것
//   · 히든링크 노출 : 숨어 있어야 할 상품(mall_hidden_links)이 사이트맵에 떴다 → 사고
//   · 이름 의심    : 공개된 상품 이름에 "비밀링크·공동구매" 같은 표시가 있다 → 사람이 확인
//
// 몰 하나당 요청 1번이라 9번이면 끝나고, 몇 초 안에 돌아옵니다.
//
// ── 필요한 Vercel 환경변수 ───────────────────────────────────────────────
//   SUPABASE_SERVICE_ROLE_KEY - Supabase 프로젝트 설정 → API → service_role 키
//   CRON_SECRET               - 다른 sync 함수와 같은 값
//
// ── 수동 테스트 (터미널에서) ─────────────────────────────────────────────
//   저장까지: curl -H "Authorization: Bearer <CRON_SECRET>" "https://내주소.vercel.app/api/sync-mall-audit"
//   확인만  : curl -H "Authorization: Bearer <CRON_SECRET>" "https://내주소.vercel.app/api/sync-mall-audit?debug=1"
//   한 몰만 : curl -H "Authorization: Bearer <CRON_SECRET>" "https://내주소.vercel.app/api/sync-mall-audit?brand=멜루션"
//   히든링크 재탐색:
//             curl -H "Authorization: Bearer <CRON_SECRET>" "https://내주소.vercel.app/api/sync-mall-audit?discover=1&brand=멜루션"

const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';

// 상품 이름에 이 말이 들어 있으면 "원래 숨겨야 할 상품"으로 의심합니다.
// 공개 목록에 이런 이름이 떠 있으면 사람이 한 번 확인해야 합니다.
const HIDDEN_NAME_MARKERS = [
  '비밀링크', '시크릿', 'secret', '공동구매', '공구전용', '임직원',
  '테스트', '샘플용', '체험단', '협찬', '더미', '복사본', '내부용'
];

// 히든링크 재탐색 시 사이트맵 최대 상품번호 아래로 이만큼만 찍어봅니다.
// 새로 만든 히든상품은 거의 항상 번호가 가장 크기 때문에 이 범위면 충분합니다.
const DISCOVER_WINDOW = 200;
const DISCOVER_CONCURRENCY = 20;

function todayInSeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

async function fetchText(url, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'selfdiylab-mall-audit/1.0' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// 카페24 사이트맵에서 공개 상품만 뽑습니다.
// 상품 주소 모양: https://몰주소/product/상품이름-슬러그/상품번호/
function parseSitemapProducts(xml, host) {
  const out = new Map();
  const locs = xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/g) || [];
  for (const raw of locs) {
    const loc = raw.replace(/<\/?loc>/g, '').trim();
    const m = loc.match(/\/product\/([^/]+)\/(\d+)\/?$/);
    if (!m) continue;
    const productNo = m[2];
    let name = m[1];
    try {
      name = decodeURIComponent(name);
    } catch (e) {
      // 슬러그가 깨져 있어도 검수는 계속합니다. 이름만 원본 그대로 둡니다.
    }
    name = name.replace(/-/g, ' ').trim();
    out.set(productNo, { product_no: productNo, name, url: loc, host });
  }
  return out;
}

function looksHiddenByName(name) {
  const lowered = String(name || '').toLowerCase();
  return HIDDEN_NAME_MARKERS.filter((marker) => lowered.includes(marker.toLowerCase()));
}

// 상세페이지가 살아 있는지 봅니다. 없는 상품은 카페24가 기본 제목("카페24")만 돌려줍니다.
async function probeProduct(origin, productNo) {
  try {
    const html = await fetchText(`${origin}/product/detail.html?product_no=${productNo}`, 15000);
    const m = html.match(/<title>([^<]*)<\/title>/i);
    const title = m ? m[1].trim() : '';
    if (!title || title === '카페24') return null;
    return { product_no: String(productNo), name: title };
  } catch (e) {
    return null;
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceKey) {
    return res.status(500).json({
      error: 'missing_service_key',
      detail: 'SUPABASE_SERVICE_ROLE_KEY 가 설정돼 있는지 확인하세요.'
    });
  }

  const supabaseHeaders = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json'
  };

  const debug = req.query && (req.query.debug === '1' || req.query.debug === 'true');
  const discover = req.query && (req.query.discover === '1' || req.query.discover === 'true');
  const onlyBrand = req.query && req.query.brand ? String(req.query.brand) : null;

  // ── 1. 검수 대상 몰 목록 읽기 ──────────────────────────────────────────
  let sites;
  try {
    let siteUrl = `${SUPABASE_URL}/rest/v1/mall_sites?is_active=eq.true&select=*&order=sort_order.asc`;
    if (onlyBrand) siteUrl += `&brand=eq.${encodeURIComponent(onlyBrand)}`;
    const siteRes = await fetch(siteUrl, { headers: supabaseHeaders });
    if (!siteRes.ok) {
      return res.status(500).json({ error: 'supabase_read_error', detail: await siteRes.text() });
    }
    sites = await siteRes.json();
  } catch (err) {
    return res.status(500).json({ error: 'supabase_unreachable', detail: String(err) });
  }

  if (!sites.length) {
    return res.status(200).json({
      skipped: 'no_active_mall',
      detail: 'mall_sites 표에 활성화된 몰이 없습니다.'
    });
  }

  // ── 2. 등록된 히든링크 목록 읽기 ───────────────────────────────────────
  let hiddenLinks = [];
  try {
    const hiddenRes = await fetch(
      `${SUPABASE_URL}/rest/v1/mall_hidden_links?is_active=eq.true&select=brand,product_code,product_name,url`,
      { headers: supabaseHeaders }
    );
    if (hiddenRes.ok) hiddenLinks = await hiddenRes.json();
  } catch (e) {
    // 히든링크 표를 못 읽어도 신규 상품 검수는 계속합니다.
  }

  const hiddenByBrand = new Map();
  for (const link of hiddenLinks) {
    if (!hiddenByBrand.has(link.brand)) hiddenByBrand.set(link.brand, []);
    hiddenByBrand.get(link.brand).push(link);
  }

  const checkDate = todayInSeoul();
  const results = [];
  const rowsToInsert = [];

  for (const site of sites) {
    const origin = String(site.url || '').replace(/\/+$/, '');
    const sitemapUrl = site.sitemap_url || `${origin}/sitemap.xml`;
    let host = '';
    try {
      host = new URL(origin).host;
    } catch (e) {
      host = origin;
    }

    try {
      // ── 3. 지금 공개된 상품 전부 ──────────────────────────────────────
      const xml = await fetchText(sitemapUrl, 25000);
      const publicMap = parseSitemapProducts(xml, host);
      const publicList = Array.from(publicMap.values());

      if (!publicList.length) {
        rowsToInsert.push({
          check_date: checkDate,
          brand: site.brand,
          url: origin,
          status: 'error',
          error_message: '사이트맵에서 상품을 하나도 못 찾았습니다. 주소나 사이트맵 설정을 확인하세요.'
        });
        results.push({ brand: site.brand, status: 'error', detail: 'empty_sitemap' });
        continue;
      }

      // ── 4. 직전 검수와 비교해 신규 상품 가려내기 ───────────────────────
      const prevRes = await fetch(
        `${SUPABASE_URL}/rest/v1/mall_audits?brand=eq.${encodeURIComponent(site.brand)}` +
          `&select=products,checked_at&order=checked_at.desc&limit=1`,
        { headers: supabaseHeaders }
      );
      const prevRows = prevRes.ok ? await prevRes.json() : [];
      const isFirstRun = prevRows.length === 0;
      const prevNos = new Set(
        isFirstRun ? [] : (prevRows[0].products || []).map((p) => String(p.product_no))
      );

      // 첫 검수는 기준선만 잡습니다. 기존 상품 전부를 "신규"로 알리면 안 되기 때문입니다.
      const newProducts = isFirstRun
        ? []
        : publicList.filter((p) => !prevNos.has(String(p.product_no)));

      // ── 5. 히든링크가 공개 목록에 떴는지 ───────────────────────────────
      const exposed = [];
      for (const link of hiddenByBrand.get(site.brand) || []) {
        const code = link.product_code ? String(link.product_code) : null;
        if (code && publicMap.has(code)) {
          const hit = publicMap.get(code);
          exposed.push({
            product_no: code,
            product_name: link.product_name || hit.name,
            url: hit.url,
            reason: '등록된 히든링크가 공개 목록(사이트맵)에 노출됨'
          });
        }
      }

      // ── 6. 이름만 봐도 숨겨야 할 것 같은 상품이 공개돼 있는지 ───────────
      const alreadyFlagged = new Set(exposed.map((e) => e.product_no));
      for (const p of publicList) {
        if (alreadyFlagged.has(p.product_no)) continue;
        const markers = looksHiddenByName(p.name);
        if (markers.length) {
          exposed.push({
            product_no: p.product_no,
            product_name: p.name,
            url: p.url,
            reason: `상품명에 "${markers.join('·')}" 표시가 있는데 공개돼 있음`
          });
        }
      }

      const status = exposed.length ? 'warn' : 'ok';
      rowsToInsert.push({
        check_date: checkDate,
        brand: site.brand,
        url: origin,
        status,
        product_count: publicList.length,
        new_count: newProducts.length,
        exposed_count: exposed.length,
        new_products: newProducts,
        exposed_hidden: exposed,
        products: publicList.map((p) => ({ product_no: p.product_no, name: p.name, url: p.url }))
      });

      results.push({
        brand: site.brand,
        status,
        first_run: isFirstRun,
        product_count: publicList.length,
        new_count: newProducts.length,
        exposed_count: exposed.length,
        new_products: newProducts.map((p) => p.name),
        exposed: exposed.map((e) => `${e.product_name} (${e.reason})`)
      });
    } catch (err) {
      rowsToInsert.push({
        check_date: checkDate,
        brand: site.brand,
        url: origin,
        status: 'error',
        error_message: String(err && err.message ? err.message : err)
      });
      results.push({ brand: site.brand, status: 'error', detail: String(err) });
    }
  }

  // ── 7. 히든링크 재탐색 (요청했을 때만) ─────────────────────────────────
  // 사이트맵에는 없는데 상세페이지는 살아 있는 상품 = 지금 숨어 있는 히든링크입니다.
  const discovered = [];
  if (discover) {
    for (const site of sites) {
      const origin = String(site.url || '').replace(/\/+$/, '');
      try {
        const xml = await fetchText(`${origin}/sitemap.xml`, 25000);
        const publicMap = parseSitemapProducts(xml, '');
        const nos = Array.from(publicMap.keys()).map(Number).filter(Number.isFinite);
        const maxNo = nos.length ? Math.max(...nos) : 0;
        const from = Math.max(1, maxNo - DISCOVER_WINDOW);
        const to = maxNo + 20;

        const candidates = [];
        for (let n = from; n <= to; n++) {
          if (!publicMap.has(String(n))) candidates.push(n);
        }
        const found = await mapWithConcurrency(candidates, DISCOVER_CONCURRENCY, (n) =>
          probeProduct(origin, n)
        );
        const hits = found.filter(Boolean).map((p) => ({
          brand: site.brand,
          product_code: p.product_no,
          product_name: p.name,
          url: `${origin}/product/detail.html?product_no=${p.product_no}`,
          memo: `자동 탐색 ${checkDate}`
        }));
        discovered.push(...hits);
      } catch (e) {
        // 한 몰을 못 읽어도 나머지 몰 탐색은 계속합니다.
      }
    }
  }

  if (debug) {
    return res.status(200).json({
      debug: true,
      saved: false,
      check_date: checkDate,
      results,
      discovered_count: discovered.length,
      discovered
    });
  }

  // ── 8. 저장 ──────────────────────────────────────────────────────────
  if (rowsToInsert.length) {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/mall_audits`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify(rowsToInsert)
    });
    if (!insertRes.ok) {
      return res.status(500).json({ error: 'supabase_insert_error', detail: await insertRes.text() });
    }
  }

  if (discovered.length) {
    // 이미 등록된 히든링크는 건너뛰고, 새로 찾은 것만 넣습니다.
    const known = new Set(hiddenLinks.map((l) => `${l.brand}|${l.product_code}`));
    const fresh = discovered.filter((d) => !known.has(`${d.brand}|${d.product_code}`));
    if (fresh.length) {
      // 이미 있는 상품이 섞여 들어와도 그냥 넘어가게 합니다.
      // (mall_hidden_links 에 brand+product_code 중복 방지 제약이 걸려 있습니다)
      await fetch(`${SUPABASE_URL}/rest/v1/mall_hidden_links?on_conflict=brand,product_code`, {
        method: 'POST',
        headers: { ...supabaseHeaders, Prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify(fresh)
      });
    }
  }

  const totalNew = results.reduce((sum, r) => sum + (r.new_count || 0), 0);
  const totalExposed = results.reduce((sum, r) => sum + (r.exposed_count || 0), 0);

  return res.status(200).json({
    saved: true,
    check_date: checkDate,
    mall_count: sites.length,
    new_total: totalNew,
    exposed_total: totalExposed,
    discovered_count: discovered.length,
    results
  });
};

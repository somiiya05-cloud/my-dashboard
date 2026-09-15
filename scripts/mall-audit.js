// 자사몰 9곳을 매일 검수해서 결과를 Supabase의 mall_audits 표에 넣는 스크립트입니다.
// 대시보드의 "자사몰 검수" 화면과 메뉴 옆 빨간 배지가 이 값을 읽습니다.
//
// ⚠️ Vercel 서버리스 함수가 아니라 GitHub Actions 안에서 직접 돕니다.
//    Vercel 무료 플랜은 배포당 함수가 12개까지인데 이미 12개를 다 쓰고 있어서,
//    여기에 함수를 하나 더 넣으면 배포 자체가 실패합니다.
//    이 검수는 "사이트 읽기 + Supabase 저장"뿐이라 Actions 러너에서 그냥 돌리면 됩니다.
//    실행: .github/workflows/ping-mall-audit.yml
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
// ── 환경변수 ─────────────────────────────────────────────────────────────
//   MALL_AUDIT_MODE  - 'audit'(기본) | 'debug'(저장 안 함) | 'discover'(히든링크 재탐색)
//   MALL_AUDIT_BRAND - 특정 몰만 볼 때 브랜드명 (비우면 전체)
//   SUPABASE_KEY     - 비워두면 대시보드가 쓰는 공개 키를 그대로 씁니다.
//                      mall_* 표는 공개 정책(RLS)이라 이 키로도 읽고 쓸 수 있습니다.
//
// ── 손으로 돌려보기 ──────────────────────────────────────────────────────
//   node scripts/mall-audit.js
//   MALL_AUDIT_MODE=debug node scripts/mall-audit.js
//   MALL_AUDIT_MODE=discover MALL_AUDIT_BRAND=멜루션 node scripts/mall-audit.js

const fs = require('fs');

const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
// 대시보드(index.html)가 쓰는 것과 같은 공개 키입니다.
const DEFAULT_KEY = 'sb_publishable_uE-8s2DbZBUSs0z1uQ-nIA_za2Ah3uT';

// 상품 이름에 이 말이 들어 있으면 "원래 숨겨야 할 상품"으로 의심합니다.
// 공개 목록에 이런 이름이 떠 있으면 사람이 한 번 확인해야 합니다.
const HIDDEN_NAME_MARKERS = [
  '비밀링크', '시크릿', 'secret', '공동구매', '공구전용', '임직원',
  '테스트', '샘플용', '체험단', '협찬', '더미', '복사본', '내부용'
];

// 히든링크 재탐색은 상품번호를 1번부터 전부 찍어봅니다.
// Actions 에는 실행시간 제한이 넉넉해서, 범위를 좁히지 않고 정확하게 봅니다.
const DISCOVER_CONCURRENCY = 15;

const MODE = process.env.MALL_AUDIT_MODE || 'audit';
const ONLY_BRAND = (process.env.MALL_AUDIT_BRAND || '').trim();
const KEY = process.env.SUPABASE_KEY || DEFAULT_KEY;

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json'
};

function todayInSeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

async function fetchText(url, timeoutMs = 25000) {
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

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`Supabase 조회 실패 (${res.status}): ${await res.text()}`);
  return res.json();
}

async function sbInsert(path, rows, extraHeaders) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...headers, ...(extraHeaders || {}) },
    body: JSON.stringify(rows)
  });
  if (!res.ok) throw new Error(`Supabase 저장 실패 (${res.status}): ${await res.text()}`);
}

// 카페24 사이트맵에서 공개 상품만 뽑습니다.
// 상품 주소 모양: https://몰주소/product/상품이름-슬러그/상품번호/
function parseSitemapProducts(xml) {
  const out = new Map();
  const locs = xml.match(/<loc>\s*([^<]+?)\s*<\/loc>/g) || [];
  for (const raw of locs) {
    const loc = raw.replace(/<\/?loc>/g, '').trim();
    const m = loc.match(/\/product\/([^/]+)\/(\d+)\/?$/);
    if (!m) continue;
    let name = m[1];
    try {
      name = decodeURIComponent(name);
    } catch (e) {
      // 슬러그가 깨져 있어도 검수는 계속합니다. 이름만 원본 그대로 둡니다.
    }
    out.set(m[2], { product_no: m[2], name: name.replace(/-/g, ' ').trim(), url: loc });
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

async function main() {
  const checkDate = todayInSeoul();

  // ── 1. 검수 대상 몰 목록 ────────────────────────────────────────────────
  let sitePath = 'mall_sites?is_active=eq.true&select=*&order=sort_order.asc';
  if (ONLY_BRAND) sitePath += `&brand=eq.${encodeURIComponent(ONLY_BRAND)}`;
  const sites = await sbGet(sitePath);

  if (!sites.length) {
    console.log('검수할 몰이 없습니다. mall_sites 표를 확인하세요.');
    return { newTotal: 0, exposedTotal: 0, errorCount: 0, results: [] };
  }

  // ── 2. 등록된 히든링크 목록 ─────────────────────────────────────────────
  let hiddenLinks = [];
  try {
    hiddenLinks = await sbGet('mall_hidden_links?is_active=eq.true&select=brand,product_code,product_name,url&limit=2000');
  } catch (e) {
    console.log('히든링크 목록을 못 읽었습니다(신규 상품 검수는 계속합니다): ' + e.message);
  }
  const hiddenByBrand = new Map();
  for (const link of hiddenLinks) {
    if (!hiddenByBrand.has(link.brand)) hiddenByBrand.set(link.brand, []);
    hiddenByBrand.get(link.brand).push(link);
  }

  const results = [];
  const rowsToInsert = [];

  for (const site of sites) {
    const origin = String(site.url || '').replace(/\/+$/, '');
    const sitemapUrl = site.sitemap_url || `${origin}/sitemap.xml`;

    try {
      // ── 3. 지금 공개된 상품 전부 ────────────────────────────────────────
      const publicMap = parseSitemapProducts(await fetchText(sitemapUrl));
      const publicList = Array.from(publicMap.values());

      if (!publicList.length) {
        rowsToInsert.push({
          check_date: checkDate, brand: site.brand, url: origin, status: 'error',
          error_message: '사이트맵에서 상품을 하나도 못 찾았습니다. 주소나 사이트맵 설정을 확인하세요.'
        });
        results.push({ brand: site.brand, status: 'error', detail: '사이트맵이 비어 있음' });
        continue;
      }

      // ── 4. 직전 검수와 비교해 신규 상품 가려내기 ────────────────────────
      const prevRows = await sbGet(
        `mall_audits?brand=eq.${encodeURIComponent(site.brand)}` +
        '&select=products,checked_at&order=checked_at.desc&limit=1'
      );
      const isFirstRun = prevRows.length === 0;
      const prevNos = new Set(
        isFirstRun ? [] : (prevRows[0].products || []).map((p) => String(p.product_no))
      );

      // 첫 검수는 기준선만 잡습니다. 기존 상품 전부를 "신규"로 알리면 안 되기 때문입니다.
      const newProducts = isFirstRun
        ? []
        : publicList.filter((p) => !prevNos.has(String(p.product_no)));

      // ── 5. 히든링크가 공개 목록에 떴는지 ────────────────────────────────
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

      // ── 6. 이름만 봐도 숨겨야 할 것 같은 상품이 공개돼 있는지 ────────────
      const flagged = new Set(exposed.map((e) => e.product_no));
      for (const p of publicList) {
        if (flagged.has(p.product_no)) continue;
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
        brand: site.brand, status, firstRun: isFirstRun,
        productCount: publicList.length,
        newCount: newProducts.length,
        exposedCount: exposed.length,
        newProducts, exposed
      });
    } catch (err) {
      const message = String(err && err.message ? err.message : err);
      rowsToInsert.push({
        check_date: checkDate, brand: site.brand, url: origin,
        status: 'error', error_message: message
      });
      results.push({ brand: site.brand, status: 'error', detail: message });
    }
  }

  // ── 7. 화면에 보기 좋게 출력 ────────────────────────────────────────────
  console.log(`\n검수일 ${checkDate} · 자사몰 ${sites.length}곳\n`);
  for (const r of results) {
    if (r.status === 'error') {
      console.log(`  ${r.brand.padEnd(9)} 읽기 실패 — ${r.detail}`);
      continue;
    }
    const mark = r.exposedCount ? '⚠ ' : '  ';
    console.log(
      `${mark}${r.brand.padEnd(9)} 공개 ${String(r.productCount).padStart(4)}개` +
      `  신규 ${r.newCount}  노출 ${r.exposedCount}${r.firstRun ? '  (첫 검수 — 기준선만 잡음)' : ''}`
    );
    r.exposed.forEach((e) => console.log(`      ⚠ ${e.product_name} — ${e.reason}`));
    r.newProducts.forEach((p) => console.log(`      🆕 ${p.name}`));
  }

  // ── 8. 저장 ────────────────────────────────────────────────────────────
  if (MODE === 'debug') {
    console.log('\n[확인만 모드] 저장하지 않았습니다.');
  } else if (rowsToInsert.length) {
    await sbInsert('mall_audits', rowsToInsert);
    console.log(`\n${rowsToInsert.length}건을 mall_audits 에 저장했습니다.`);
  }

  // ── 9. 히든링크 재탐색 (discover 모드일 때만) ───────────────────────────
  // 사이트맵에는 없는데 상세페이지는 살아 있는 상품 = 지금 숨어 있는 히든링크입니다.
  let discoveredCount = 0;
  if (MODE === 'discover') {
    const known = new Set(hiddenLinks.map((l) => `${l.brand}|${l.product_code}`));
    for (const site of sites) {
      const origin = String(site.url || '').replace(/\/+$/, '');
      try {
        const publicMap = parseSitemapProducts(await fetchText(`${origin}/sitemap.xml`));
        const nos = Array.from(publicMap.keys()).map(Number).filter(Number.isFinite);
        const maxNo = nos.length ? Math.max(...nos) : 0;

        const candidates = [];
        for (let n = 1; n <= maxNo + 20; n++) {
          if (!publicMap.has(String(n))) candidates.push(n);
        }
        const found = (await mapWithConcurrency(candidates, DISCOVER_CONCURRENCY, (n) => probeProduct(origin, n)))
          .filter(Boolean)
          .map((p) => ({
            brand: site.brand,
            product_code: p.product_no,
            product_name: p.name,
            url: `${origin}/product/detail.html?product_no=${p.product_no}`,
            memo: `자동 탐색 ${checkDate}`
          }));
        const fresh = found.filter((d) => !known.has(`${d.brand}|${d.product_code}`));
        console.log(`  ${site.brand.padEnd(9)} 히든 ${found.length}건 (새로 찾음 ${fresh.length}건, ${candidates.length}번 조회)`);
        if (fresh.length) {
          await sbInsert('mall_hidden_links?on_conflict=brand,product_code', fresh, {
            Prefer: 'resolution=ignore-duplicates'
          });
          discoveredCount += fresh.length;
        }
      } catch (e) {
        console.log(`  ${site.brand.padEnd(9)} 재탐색 실패 — ${e.message}`);
      }
    }
    console.log(`\n히든링크 ${discoveredCount}건을 새로 등록했습니다.`);
  }

  const newTotal = results.reduce((s, r) => s + (r.newCount || 0), 0);
  const exposedTotal = results.reduce((s, r) => s + (r.exposedCount || 0), 0);
  const errorCount = results.filter((r) => r.status === 'error').length;

  // ── 10. Actions 실행 요약에 크게 띄우기 ─────────────────────────────────
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [
      '## 자사몰 검수 결과',
      '',
      `- 검수한 자사몰: **${sites.length}곳**`,
      `- 새로 등록된 상품: **${newTotal}건**`,
      `- 히든링크 노출: **${exposedTotal}건**`,
      ''
    ];
    if (exposedTotal) {
      lines.push('> ⚠️ 숨어 있어야 할 상품이 공개 목록에 떠 있습니다.', '');
      results.forEach((r) => (r.exposed || []).forEach((e) => {
        lines.push(`- **${r.brand}** · ${e.product_name}`, `  - ${e.reason}`, `  - ${e.url}`);
      }));
      lines.push('');
    }
    if (newTotal) {
      lines.push('### 새로 등록된 상품', '');
      results.forEach((r) => (r.newProducts || []).forEach((p) => {
        lines.push(`- **${r.brand}** · ${p.name}`);
      }));
      lines.push('');
    }
    if (errorCount) lines.push(`> ${errorCount}곳은 읽지 못했습니다. 로그를 확인하세요.`, '');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
  }

  return { newTotal, exposedTotal, errorCount, results };
}

main()
  .then(({ errorCount }) => {
    // 못 읽은 몰이 있으면 실패로 표시해 사람이 알아채게 합니다.
    // 노출·신규가 있는 건 "정상 동작"이므로 실패로 보지 않습니다(대시보드 배지로 알립니다).
    process.exit(errorCount ? 1 : 0);
  })
  .catch((err) => {
    console.error('검수 중 오류가 났습니다:', err && err.message ? err.message : err);
    process.exit(1);
  });

// 네이버 파워링크 「순위별 예상 입찰가」를 받아 Supabase 에 저장하는 Vercel 서버리스 함수입니다 (2026-09-13).
// 대시보드 키워드 표의 「예상 순위」 칸 — 지금 입찰가 / 권장 입찰가로 바꾸면 각각 몇 위쯤인지 — 가 씁니다.
//
// 네이버 API: POST /estimate/average-position-bid/keyword
//   body { device: 'MOBILE' | 'PC', items: [{ key: 키워드, position: 1 }, ...] }
//   → 그 키워드를 그 순위에 올리려면 필요한 예상 입찰가. 키워드 "글자" 기준 시장 추정치라
//     계정·캠페인과 무관하고, 실제 순위는 품질지수에 따라 달라질 수 있습니다.
//
// 대상 키워드: 최근 30일에 클릭이 한 번이라도 있었던 키워드(2026-09-13 기준 369개).
//   노출만 있는 키워드까지 받으면 1,100개가 넘어 네이버 호출이 세 배가 되는데, 입찰가를 손댈
//   만한 키워드는 대부분 클릭이 있습니다. 순위 1~5위 × 기기 1개 씩 호출합니다.
//
// ?device=MOBILE 또는 ?device=PC 로 기기 하나씩 처리합니다(워크플로가 두 번 부름) — 한 번에 둘 다
// 하면 60초 제한에 가까워집니다.
//
// ⚠️ 배치 위치: api/sync-naver-bid-estimates.js
// ⚠️ naver_keyword_bid_estimate.sql 을 Supabase SQL Editor 에서 먼저 실행해야 합니다.
// 필요한 Vercel 환경변수: sync-naver-keywords.js 와 같음 (NAVER_API_KEY, NAVER_SECRET_KEY,
//   NAVER_CUSTOMER_ID, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET) — 계정1 키만 씁니다(시장 추정치라 계정 무관).
//
// 수동 테스트:
//   curl -H "Authorization: Bearer <CRON_SECRET>" "https://내주소.vercel.app/api/sync-naver-bid-estimates?device=MOBILE&debug=1"

const crypto = require('crypto');

const NAVER_BASE = 'https://api.searchad.naver.com';
const ESTIMATE_URI = '/estimate/average-position-bid/keyword';
const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const POSITIONS = [1, 2, 3, 4, 5];
const DEVICES = ['MOBILE', 'PC'];
const TARGET_DAYS = 30;
const BATCH_ITEMS = 100;          // 한 번에 보낼 (키워드×순위) 개수. 네이버가 너무 많다고 거절하면 반씩 쪼갠다.
const REQUEST_GAP_MS = 250;       // 호출 사이 간격 — 429 를 피하려고 순서대로, 조금씩 쉬면서
const MAX_RETRIES = 6;
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 4000;
const UPSERT_CHUNK_SIZE = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sign(timestamp, method, uri, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(`${timestamp}.${method}.${uri}`).digest('base64');
}

// sync-naver-keywords.js 의 naverRequest 와 같은 429 백오프. 여기는 POST + JSON 본문이다.
async function naverPost(uri, body, attempt = 0) {
  const timestamp = String(Date.now());
  const res = await fetch(NAVER_BASE + uri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Timestamp': timestamp,
      'X-API-KEY': process.env.NAVER_API_KEY,
      'X-Customer': process.env.NAVER_CUSTOMER_ID,
      'X-Signature': sign(timestamp, 'POST', uri, process.env.NAVER_SECRET_KEY)
    },
    body: JSON.stringify(body)
  });
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const retryAfterSec = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(retryAfterSec * 1000, 10000)
      : Math.min(RETRY_BASE_MS * Math.pow(2, attempt), RETRY_MAX_MS);
    await sleep(waitMs);
    return naverPost(uri, body, attempt + 1);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const err = new Error(`네이버 API 요청 실패 POST ${uri} (${res.status}): ${text.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  try { return JSON.parse(text); } catch (e) { return {}; }
}

// 응답 모양이 문서와 조금 달라도 읽히게 후보를 여럿 본다.
function readEstimates(data) {
  const list = Array.isArray(data) ? data : (data.estimate || data.estimates || data.data || []);
  return list.map((e) => ({
    keyword: e.keyword != null ? e.keyword : e.key,
    position: Number(e.position),
    bid: Number(e.bid != null ? e.bid : e.bidAmt)
  })).filter((e) => e.keyword && e.position > 0 && Number.isFinite(e.bid));
}

// items 를 보내고, 네이버가 400 으로 거절하면 반씩 쪼개 다시 보낸다. 끝까지 거절되는 한 개는 건너뛴다
// (예상 입찰가를 못 내는 키워드가 섞여 있어도 나머지는 저장되게).
async function estimateItems(device, items, state) {
  try {
    const data = await naverPost(ESTIMATE_URI, { device, items });
    if (state.debug && !state.sample) state.sample = data;
    state.requests++;
    await sleep(REQUEST_GAP_MS);
    return readEstimates(data);
  } catch (e) {
    if (e.status !== 400) throw e;
    if (items.length === 1) {
      state.skipped.add(items[0].key);
      if (!state.firstRejection) state.firstRejection = String(e).slice(0, 300);
      return [];
    }
    const mid = Math.ceil(items.length / 2);
    const a = await estimateItems(device, items.slice(0, mid), state);
    const b = await estimateItems(device, items.slice(mid), state);
    return a.concat(b);
  }
}

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!res.ok) throw new Error(`Supabase 조회 실패 (${res.status}): ${await res.text().catch(() => '')}`);
  return res.json();
}

// 최근 30일에 클릭이 있었던 키워드 글자(중복 제거).
async function loadTargetKeywords(fromDate) {
  const keywords = new Set();
  for (let offset = 0; ; offset += 1000) {
    const rows = await supabaseGet(
      `naver_keyword_performance_daily?select=keyword&date=gte.${fromDate}&clicks=gt.0&order=id&offset=${offset}&limit=1000`
    );
    for (const r of rows) if (r.keyword) keywords.add(r.keyword);
    if (rows.length < 1000) break;
  }
  return [...keywords];
}

async function upsertRows(rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    let lastText = '', lastStatus = 0;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/naver_keyword_bid_estimate?on_conflict=date,device,keyword,position`, {
        method: 'POST',
        headers: {
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify(chunk)
      });
      if (res.ok) { lastStatus = 0; break; }
      lastStatus = res.status;
      lastText = await res.text().catch(() => '');
      if (!(res.status >= 500 || res.status === 429) || attempt === 3) break;
      await sleep(Math.min(700 * Math.pow(2, attempt), 4000));
    }
    if (lastStatus) throw new Error(`Supabase upsert 실패 (${lastStatus}): ${lastText}`);
  }
}

function seoulDate(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const missing = ['NAVER_API_KEY', 'NAVER_SECRET_KEY', 'NAVER_CUSTOMER_ID', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);
  if (missing.length) return res.status(500).json({ error: 'missing_env_vars', detail: `${missing.join(', ')} 가 설정돼 있는지 확인하세요.` });

  const device = String((req.query && req.query.device) || '').toUpperCase();
  if (!DEVICES.includes(device)) {
    return res.status(400).json({ error: 'bad_device', detail: '?device=MOBILE 또는 ?device=PC 를 지정하세요.' });
  }
  const debug = req.query && req.query.debug === '1';
  // ?limit=10 — 처음 확인할 때 키워드 몇 개만 보내 보는 용도
  const limit = Math.max(0, Number((req.query && req.query.limit) || 0) || 0);

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const state = { debug, sample: null, requests: 0, skipped: new Set(), firstRejection: null };

  try {
    let keywords = await loadTargetKeywords(seoulDate(-(TARGET_DAYS - 1)));
    if (limit) keywords = keywords.slice(0, limit);
    console.log(`[bid-estimate][${device}] 대상 키워드 ${keywords.length}개 (${elapsed()})`);

    const items = keywords.flatMap((key) => POSITIONS.map((position) => ({ key, position })));
    const estimates = [];
    for (let i = 0; i < items.length; i += BATCH_ITEMS) {
      estimates.push(...await estimateItems(device, items.slice(i, i + BATCH_ITEMS), state));
    }
    console.log(`[bid-estimate][${device}] 예상 입찰가 ${estimates.length}건, 호출 ${state.requests}회, 건너뛴 키워드 ${state.skipped.size}개 (${elapsed()})`);

    const date = seoulDate();
    const updatedAt = new Date().toISOString();
    const rows = estimates.map((e) => ({ date, device, keyword: e.keyword, position: e.position, bid: Math.round(e.bid), updated_at: updatedAt }));
    await upsertRows(rows);

    return res.status(200).json({
      date, device,
      keywordCount: keywords.length,
      savedCount: rows.length,
      requests: state.requests,
      skippedCount: state.skipped.size,
      skippedSample: [...state.skipped].slice(0, 10),
      firstRejection: state.firstRejection,
      elapsed: elapsed(),
      ...(debug ? { rawSample: JSON.stringify(state.sample).slice(0, 1500) } : {})
    });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err), requests: state.requests, elapsed: elapsed() });
  }
};

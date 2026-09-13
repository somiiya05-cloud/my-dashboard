// 네이버 파워링크 「순위별 예상 입찰가」를 받아 Supabase 에 저장하는 Vercel 서버리스 함수입니다 (2026-09-13).
// 대시보드 키워드 표의 「1위 예상가」 · 「추천 입찰가」 아랫줄 예상 순위가 씁니다.
//
// 두 가지 방식이 있습니다(?by=).
//   - by=keyword(기본): POST /estimate/average-position-bid/keyword — 키워드 "글자" 기준 시장 평균.
//       우리 광고 품질지수를 몰라서, 대조해 보니 추정 순위가 실제와 1위 이내로 맞는 게 절반(47%)뿐이었습니다.
//       → naver_keyword_bid_estimate (date, device, keyword, position)
//   - by=id: POST /estimate/average-position-bid/id — 우리 "키워드 ID" 기준. 그 키워드의 품질지수를 반영합니다.
//       키워드를 가진 광고 계정으로 요청해야 해서, 키워드 성과 표의 account_id 로 계정별로 나눠 부릅니다.
//       → naver_keyword_bid_estimate_by_id (date, device, keyword_id, position)
//
// 대상 키워드: 최근 30일에 클릭이 한 번이라도 있었던 키워드(2026-09-13 기준 369개).
// ?device=MOBILE 또는 ?device=PC 로 기기 하나씩 처리합니다(워크플로가 나눠 부름) — 60초 제한 때문.
//
// ⚠️ 배치 위치: api/sync-naver-bid-estimates.js
// ⚠️ naver_keyword_bid_estimate.sql · naver_keyword_bid_estimate_by_id.sql 을 Supabase SQL Editor 에서 먼저 실행해야 합니다.
// 필요한 Vercel 환경변수: sync-naver-keywords.js 와 같음 (계정1 NAVER_API_KEY/SECRET/CUSTOMER_ID,
//   계정2 *_2, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET). by=keyword 는 계정1 키만 씁니다(시장 추정치라 계정 무관).
//
// 수동 테스트:
//   curl -H "Authorization: Bearer <CRON_SECRET>" "https://내주소.vercel.app/api/sync-naver-bid-estimates?device=MOBILE&by=id&limit=10&debug=1"

const crypto = require('crypto');

const NAVER_BASE = 'https://api.searchad.naver.com';
const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const POSITIONS = [1, 2, 3, 4, 5];
const DEVICES = ['MOBILE', 'PC'];
const TARGET_DAYS = 30;
const BATCH_ITEMS = 100;          // 한 번에 보낼 (키워드×순위) 개수. 네이버가 거절하면 반씩 쪼갠다.
const REQUEST_GAP_MS = 250;       // 호출 사이 간격 — 429 를 피하려고 순서대로, 조금씩 쉬면서
const MAX_RETRIES = 6;
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 4000;
const UPSERT_CHUNK_SIZE = 500;

// sync-naver-keywords.js 의 ACCOUNTS 와 같은 계정 번호·환경변수 이름 (브랜드 목록은 여기선 필요 없음)
const ACCOUNTS = [
  { id: '1', label: '계정1', apiKeyEnv: 'NAVER_API_KEY', secretKeyEnv: 'NAVER_SECRET_KEY', customerIdEnv: 'NAVER_CUSTOMER_ID' },
  { id: '2', label: '계정2', apiKeyEnv: 'NAVER_API_KEY_2', secretKeyEnv: 'NAVER_SECRET_KEY_2', customerIdEnv: 'NAVER_CUSTOMER_ID_2' }
];

const MODES = {
  keyword: { uri: '/estimate/average-position-bid/keyword', table: 'naver_keyword_bid_estimate', conflict: 'date,device,keyword,position' },
  id: { uri: '/estimate/average-position-bid/id', table: 'naver_keyword_bid_estimate_by_id', conflict: 'date,device,keyword_id,position' }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sign(timestamp, method, uri, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(`${timestamp}.${method}.${uri}`).digest('base64');
}

// sync-naver-keywords.js 의 naverRequest 와 같은 429 백오프. 여기는 POST + JSON 본문이다.
async function naverPost(account, uri, body, attempt = 0) {
  const timestamp = String(Date.now());
  const res = await fetch(NAVER_BASE + uri, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Timestamp': timestamp,
      'X-API-KEY': process.env[account.apiKeyEnv],
      'X-Customer': process.env[account.customerIdEnv],
      'X-Signature': sign(timestamp, 'POST', uri, process.env[account.secretKeyEnv])
    },
    body: JSON.stringify(body)
  });
  if (res.status === 429 && attempt < MAX_RETRIES) {
    const retryAfterSec = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
      ? Math.min(retryAfterSec * 1000, 10000)
      : Math.min(RETRY_BASE_MS * Math.pow(2, attempt), RETRY_MAX_MS);
    await sleep(waitMs);
    return naverPost(account, uri, body, attempt + 1);
  }
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    const err = new Error(`네이버 API 요청 실패 [${account.label}] POST ${uri} (${res.status}): ${text.slice(0, 500)}`);
    err.status = res.status;
    throw err;
  }
  try { return JSON.parse(text); } catch (e) { return {}; }
}

// 응답 모양이 문서와 조금 달라도 읽히게 후보를 여럿 본다. key = 키워드 글자(by=keyword) 또는 키워드 ID(by=id).
function readEstimates(data, by) {
  const list = Array.isArray(data) ? data : (data.estimate || data.estimates || data.data || []);
  return list.map((e) => ({
    key: by === 'id' ? (e.nccKeywordId || e.keywordId || e.id || e.key) : (e.keyword != null ? e.keyword : e.key),
    position: Number(e.position),
    bid: Number(e.bid != null ? e.bid : e.bidAmt)
  })).filter((e) => e.key && e.position > 0 && Number.isFinite(e.bid));
}

// items 를 보내고, 네이버가 거절(400)하면 반씩 쪼개 다시 보낸다. 끝까지 거절되는 한 개는 건너뛴다
// (예상가를 못 내는 키워드가 섞여 있어도 나머지는 저장되게).
async function estimateItems(account, mode, by, device, items, state) {
  try {
    const data = await naverPost(account, mode.uri, { device, items });
    if (state.debug && !state.sample) state.sample = data;
    state.requests++;
    await sleep(REQUEST_GAP_MS);
    return readEstimates(data, by);
  } catch (e) {
    if (e.status !== 400) throw e;
    if (items.length === 1) {
      state.skipped.add(items[0].key);
      if (!state.firstRejection) state.firstRejection = String(e).slice(0, 300);
      return [];
    }
    const mid = Math.ceil(items.length / 2);
    const a = await estimateItems(account, mode, by, device, items.slice(0, mid), state);
    const b = await estimateItems(account, mode, by, device, items.slice(mid), state);
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

// 최근 30일에 클릭이 있었던 키워드. by=keyword 는 글자 목록, by=id 는 { keyword_id → { keyword, account_id } }.
async function loadTargets(fromDate, by) {
  const map = new Map();
  const select = by === 'id' ? 'keyword,keyword_id,account_id' : 'keyword';
  for (let offset = 0; ; offset += 1000) {
    const rows = await supabaseGet(
      `naver_keyword_performance_daily?select=${select}&date=gte.${fromDate}&clicks=gt.0&order=id&offset=${offset}&limit=1000`
    );
    for (const r of rows) {
      if (by === 'id') {
        // 계정을 모르는 옛 행(account_id 를 저장하기 전)은 건너뛴다 — 계정 없이는 ID 로 조회할 수 없다.
        if (r.keyword_id && r.account_id) map.set(r.keyword_id, { keyword: r.keyword, account_id: r.account_id });
      } else if (r.keyword) {
        map.set(r.keyword, { keyword: r.keyword });
      }
    }
    if (rows.length < 1000) break;
  }
  return map;
}

async function upsertRows(mode, rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    let lastText = '', lastStatus = 0;
    for (let attempt = 0; attempt <= 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${mode.table}?on_conflict=${mode.conflict}`, {
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
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'missing_env_vars', detail: 'SUPABASE_SERVICE_ROLE_KEY 가 설정돼 있는지 확인하세요.' });
  }

  const device = String((req.query && req.query.device) || '').toUpperCase();
  if (!DEVICES.includes(device)) {
    return res.status(400).json({ error: 'bad_device', detail: '?device=MOBILE 또는 ?device=PC 를 지정하세요.' });
  }
  const by = (req.query && req.query.by) === 'id' ? 'id' : 'keyword';
  const mode = MODES[by];
  const debug = req.query && req.query.debug === '1';
  // ?limit=10 — 처음 확인할 때 키워드 몇 개만 보내 보는 용도
  const limit = Math.max(0, Number((req.query && req.query.limit) || 0) || 0);

  const activeAccounts = ACCOUNTS.filter((a) => process.env[a.apiKeyEnv] && process.env[a.secretKeyEnv] && process.env[a.customerIdEnv]);
  if (!activeAccounts.length) {
    return res.status(500).json({ error: 'missing_env_vars', detail: 'NAVER_API_KEY / NAVER_SECRET_KEY / NAVER_CUSTOMER_ID 가 설정돼 있는지 확인하세요.' });
  }

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const state = { debug, sample: null, requests: 0, skipped: new Set(), firstRejection: null };

  try {
    let targets = [...(await loadTargets(seoulDate(-(TARGET_DAYS - 1)), by)).entries()];
    if (limit) targets = targets.slice(0, limit);
    console.log(`[bid-estimate][${by}][${device}] 대상 키워드 ${targets.length}개 (${elapsed()})`);

    // by=keyword 는 계정1 하나로 전부, by=id 는 키워드를 가진 계정별로 나눠 보낸다.
    const groups = by === 'id'
      ? activeAccounts.map((a) => ({ account: a, keys: targets.filter(([, t]) => t.account_id === a.id).map(([k]) => k) }))
      : [{ account: activeAccounts[0], keys: targets.map(([k]) => k) }];
    const noAccount = by === 'id' ? targets.filter(([, t]) => !activeAccounts.some((a) => a.id === t.account_id)).length : 0;

    const estimates = [];
    const perAccount = {};
    for (const g of groups) {
      const items = g.keys.flatMap((key) => POSITIONS.map((position) => ({ key, position })));
      const before = estimates.length;
      for (let i = 0; i < items.length; i += BATCH_ITEMS) {
        estimates.push(...await estimateItems(g.account, mode, by, device, items.slice(i, i + BATCH_ITEMS), state));
      }
      perAccount[g.account.label] = { keywords: g.keys.length, saved: estimates.length - before };
    }
    console.log(`[bid-estimate][${by}][${device}] 예상 입찰가 ${estimates.length}건, 호출 ${state.requests}회, 건너뛴 키워드 ${state.skipped.size}개 (${elapsed()})`);

    const date = seoulDate();
    const updatedAt = new Date().toISOString();
    const targetMap = new Map(targets);
    const rows = estimates.map((e) => (by === 'id'
      ? { date, device, keyword_id: e.key, keyword: (targetMap.get(e.key) || {}).keyword || null, position: e.position, bid: Math.round(e.bid), updated_at: updatedAt }
      : { date, device, keyword: e.key, position: e.position, bid: Math.round(e.bid), updated_at: updatedAt }));
    await upsertRows(mode, rows);

    return res.status(200).json({
      date, device, by,
      keywordCount: targets.length,
      perAccount,
      noAccountCount: noAccount,
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

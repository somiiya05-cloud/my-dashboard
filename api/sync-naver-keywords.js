// 네이버 검색광고 키워드별 월간 성과를 캠페인 → 광고그룹 → 키워드 순으로 내려가며
// 수집해서 Supabase의 naver_keyword_performance 테이블에 저장하는 Vercel 서버리스
// 함수입니다. 마케팅대시보드 브랜드별 페이지의 "낭비 키워드"(클릭은 있는데 전환이
// 없는 키워드 등) 표에 쓰입니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "sync-naver-keywords.js" 로 저장하세요.
//    최종 경로: api/sync-naver-keywords.js
//    (naver_keyword_performance.sql을 Supabase SQL Editor에서 먼저 실행해야 합니다.)
//
// 필요한 Vercel 환경변수: sync-naver-ads.js와 동일
//   NAVER_API_KEY, NAVER_SECRET_KEY, NAVER_CUSTOMER_ID, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
// 계정2(추가 네이버 광고 계정)를 붙이는 방법도 sync-naver-ads.js와 동일합니다:
//   NAVER_API_KEY_2/NAVER_SECRET_KEY_2/NAVER_CUSTOMER_ID_2를 등록하고, 아래 ACCOUNTS의
//   두 번째 항목 brands를 채우세요. (두 파일의 ACCOUNTS는 반드시 같은 내용으로 유지하세요.)
//
// ⚠️ 캠페인·키워드 수가 많으면 1건씩 호출하는 방식은 60초 실행 제한을 넘기기 쉬워서,
// 네이버 API의 "여러 id를 한 번에 조회"하는 벌크 통계 엔드포인트(GET /stats?ids=...)를
// 써서 호출 횟수를 크게 줄였습니다. (캠페인 목록 조회, 광고그룹/키워드 목록 조회는
// 부모 id 하나씩만 지정할 수 있어 여전히 개별 호출입니다.)
//
// 수동 테스트 방법 (터미널에서):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/sync-naver-keywords?month=2026-09"
//   디버그(벌크 통계 원본 응답 1건을 로그로 출력): 뒤에 &debug=1 추가

const crypto = require('crypto');

const NAVER_BASE = 'https://api.searchad.naver.com';
const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const LIST_CONCURRENCY = 3; // /ncc/adgroups, /ncc/keywords 같은 목록 조회용
const LIST_REQUEST_GAP_MS = 200;
const BULK_BATCH_SIZE = 100; // 벌크 통계 조회 시 한 번에 묶을 id 개수
const BULK_CONCURRENCY = 4; // 위 배치를 동시에 몇 개씩 조회할지 (쇼핑검색 등 키워드가 수천 개인 계정 대응)
const BULK_REQUEST_GAP_MS = 120;
const UPSERT_CHUNK_SIZE = 200;
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// sync-naver-ads.js와 동일한 계정별 브랜드 매칭표 (두 파일의 ACCOUNTS는 항상 같게 유지)
const ACCOUNTS = [
  {
    id: '1',
    label: '계정1',
    apiKeyEnv: 'NAVER_API_KEY',
    secretKeyEnv: 'NAVER_SECRET_KEY',
    customerIdEnv: 'NAVER_CUSTOMER_ID',
    brands: [
      { name: '코드니처', channel: '네이버 코드니처' },
      { name: '미니멀룸', channel: '네이버 미니멀룸' },
      { name: '빠이러스', channel: '네이버 빠이러스' },
      { name: '그로우뮤즈', channel: '네이버 그로우유즈' },
      { name: '라스마', channel: '네이버 라스마' },
      { name: '잠비에', channel: '네이버 잠비에' },
      { name: '글로리핏', channel: '네이버 글로리핏' },
      { name: '명퉤', channel: '네이버 명퉤' },
      { name: '멜루션', channel: '네이버 멜루션' },
      { name: '폴크', channel: '네이버 폴크' }
    ]
  },
  {
    id: '2',
    label: '계정2',
    apiKeyEnv: 'NAVER_API_KEY_2',
    secretKeyEnv: 'NAVER_SECRET_KEY_2',
    customerIdEnv: 'NAVER_CUSTOMER_ID_2',
    // 계정1과 같은 브랜드들이 계정2에도 캠페인을 따로 운영 중이라 브랜드 매칭표를 그대로 공유합니다.
    brands: [
      { name: '코드니처', channel: '네이버 코드니처' },
      { name: '미니멀룸', channel: '네이버 미니멀룸' },
      { name: '빠이러스', channel: '네이버 빠이러스' },
      { name: '그로우뮤즈', channel: '네이버 그로우유즈' },
      { name: '라스마', channel: '네이버 라스마' },
      { name: '잠비에', channel: '네이버 잠비에' },
      { name: '글로리핏', channel: '네이버 글로리핏' },
      { name: '명퉤', channel: '네이버 명퉤' },
      { name: '멜루션', channel: '네이버 멜루션' },
      { name: '폴크', channel: '네이버 폴크' }
    ]
  }
];
const FALLBACK_CHANNEL = '네이버 기타';

function sign(timestamp, method, uri, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(`${timestamp}.${method}.${uri}`).digest('base64');
}

// 네이버 API가 429(Too Many Requests)를 주면 점점 더 오래 기다렸다가 재시도합니다.
// params의 값이 배열이면 같은 키를 반복해서 붙입니다(예: ids=a&ids=b), 벌크 조회용.
async function naverRequest(account, method, uri, params, attempt = 0) {
  const timestamp = String(Date.now());
  const url = new URL(NAVER_BASE + uri);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Timestamp': timestamp,
      'X-API-KEY': process.env[account.apiKeyEnv],
      'X-Customer': process.env[account.customerIdEnv],
      'X-Signature': sign(timestamp, method, uri, process.env[account.secretKeyEnv])
    }
  });
  if (res.status === 429 && attempt < MAX_RETRIES) {
    await sleep(300 * Math.pow(2, attempt));
    return naverRequest(account, method, uri, params, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`네이버 API 요청 실패 [${account.label}] ${method} ${uri} (${res.status}): ${text}`);
  }
  return res.json();
}

function matchChannel(brands, campaignName) {
  const sorted = [...brands].sort((a, b) => b.name.length - a.name.length);
  const hit = sorted.find((b) => campaignName.startsWith(b.name));
  return hit ? hit.channel : FALLBACK_CHANNEL;
}

// /ncc/ads 응답에서 랜딩 URL을 뽑아냅니다. 네이버 API의 정확한 필드 위치가 소재 타입마다
// 조금씩 다를 수 있어 여러 후보 경로를 순서대로 시도합니다(모바일 우선, 그다음 PC).
// 광고그룹에 소재가 여럿이면 첫 번째로 URL이 확인되는 소재를 대표값으로 씁니다.
function extractLandingUrl(ads) {
  if (!Array.isArray(ads)) return null;
  for (const item of ads) {
    const ad = (item && item.ad) || item;
    if (!ad) continue;
    const candidates = [
      ad.mobile && (ad.mobile.final || ad.mobile.url),
      ad.pc && (ad.pc.final || ad.pc.url),
      ad.mobileFinalUrl,
      ad.pcFinalUrl
    ];
    const found = candidates.find((u) => typeof u === 'string' && /^https?:\/\//.test(u));
    if (found) return found;
  }
  return null;
}

// 랜딩 URL 도메인으로 자사몰/스마트스토어를 구분합니다.
function classifySalesChannel(url) {
  if (!url) return null;
  let host = '';
  try { host = new URL(url).host; } catch (e) { host = url; }
  if (host.includes('smartstore.naver.com') || host.includes('shopping.naver.com')) return '스마트스토어';
  if (host.includes('brand.naver.com')) return '네이버브랜드스토어'; // 네이버 안의 공식 브랜드관, 자체 도메인 자사몰과는 구분
  return '자사몰';
}

// 여러 id의 기간 합계 통계를 한 번에 조회합니다 (id 1개당 1회 호출하는 대신
// BULK_BATCH_SIZE개씩 묶고, 그 배치들을 BULK_CONCURRENCY만큼 동시에 조회해서
// 키워드가 수천 개인 계정(쇼핑검색은 상품마다 키워드가 자동 생성돼 아주 많아짐)도
// 시간 안에 끝낼 수 있게 합니다. 반환값은 id -> 합계 Map.
async function fetchBulkTotals(account, ids, since, until, debugSample) {
  const totalsById = new Map();
  const batches = [];
  for (let i = 0; i < ids.length; i += BULK_BATCH_SIZE) batches.push(ids.slice(i, i + BULK_BATCH_SIZE));

  await mapWithConcurrency(batches, BULK_CONCURRENCY, async (batch, i) => {
    const data = await naverRequest(account, 'GET', '/stats', {
      ids: batch,
      fields: JSON.stringify(['salesAmt', 'impCnt', 'clkCnt', 'ccnt', 'convAmt']),
      timeRange: JSON.stringify({ since, until })
    });
    if (debugSample && i === 0) {
      debugSample.raw = data;
      console.log(`[naver-keywords][DEBUG] 벌크 통계 원본 응답: ${JSON.stringify(data).slice(0, 1500)}`);
    }
    const rows = data.data || [];
    for (const r of rows) {
      totalsById.set(r.id, {
        spend: Number(r.salesAmt) || 0,
        impressions: Number(r.impCnt) || 0,
        clicks: Number(r.clkCnt) || 0,
        conversions: Number(r.ccnt) || 0,
        revenue: Number(r.convAmt) || 0
      });
    }
  }, BULK_REQUEST_GAP_MS);

  return totalsById;
}

// 동시 실행 개수를 제한하면서 배열의 각 항목을 처리합니다.
async function mapWithConcurrency(items, limit, fn, gapMs = LIST_REQUEST_GAP_MS) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const cur = next++;
      results[cur] = await fn(items[cur], cur);
      await sleep(gapMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, worker));
  return results;
}

async function upsertInChunks(table, conflictCols, rows) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) chunks.push(rows.slice(i, i + UPSERT_CHUNK_SIZE));

  await mapWithConcurrency(chunks, 3, async (chunk) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${conflictCols}`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates'
      },
      body: JSON.stringify(chunk)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase upsert 실패 (${res.status}): ${text}`);
    }
  }, 0);
}

// 계정 하나에 대해 캠페인 → 광고그룹 → 키워드까지 내려가며 성과를 모읍니다.
// 여러 계정을 순회할 때 계정마다 이 함수를 한 번씩 호출합니다.
// shard/shards: 활동 캠페인이 많은 계정(예: 쇼핑검색 키워드가 자동으로 많이 생기는 계정)은
// 광고그룹/키워드까지 개별 호출로 내려가는 단계가 60초를 넘기기 쉬워서, 활동 캠페인을
// shards개로 나눠 캠페인 인덱스 % shards === shard 인 것만 처리한다. 호출하는 쪽(워크플로)이
// 같은 계정을 shard 0..shards-1로 여러 번(=여러 Vercel 함수 실행) 나눠 부르면 된다.
async function syncNaverKeywordsForAccount(account, since, until, monthStr, debug, elapsed, shard = 0, shards = 1) {
  const allCampaigns = await naverRequest(account, 'GET', '/ncc/campaigns');
  console.log(`[naver-keywords][${account.label}] 캠페인 ${allCampaigns.length}개 조회 완료 (${elapsed()})`);

  // 이번 달에 노출·클릭·광고비가 전혀 없었던 캠페인은 광고그룹/키워드까지 내려가 봐야
  // 어차피 낭비 키워드가 나올 수 없으므로, 먼저 캠페인 단위로 걸러서 이후 API 호출량을 줄입니다.
  // (벌크 통계 조회라 캠페인이 몇백 개라도 몇 번의 호출로 끝납니다.)
  const campaignBulkDebug = {};
  const campaignTotals = await fetchBulkTotals(
    account,
    allCampaigns.map((c) => c.nccCampaignId),
    since,
    until,
    debug ? campaignBulkDebug : null
  );
  const activeCampaigns = allCampaigns.filter((c) => {
    const t = campaignTotals.get(c.nccCampaignId);
    return t && (t.spend > 0 || t.impressions > 0 || t.clicks > 0);
  });
  const campaigns = shards > 1 ? activeCampaigns.filter((_, i) => i % shards === shard) : activeCampaigns;
  console.log(
    `[naver-keywords][${account.label}] 활동 캠페인 ${activeCampaigns.length}/${allCampaigns.length}개` +
      (shards > 1 ? `, 이 조각(${shard + 1}/${shards})이 처리할 캠페인 ${campaigns.length}개` : '') +
      ` (${elapsed()})`
  );

  // 캠페인 → 광고그룹 (부모 id 하나씩만 조회 가능해서 개별 호출이지만, 활동 캠페인만 대상이라 수가 적음)
  const campaignAdgroups = await mapWithConcurrency(campaigns, LIST_CONCURRENCY, async (campaign) => {
    const adgroups = await naverRequest(account, 'GET', '/ncc/adgroups', { nccCampaignId: campaign.nccCampaignId });
    return { channel: matchChannel(account.brands, campaign.name), campaignName: campaign.name, adgroups: adgroups || [] };
  });

  const adgroupTargets = [];
  for (const { channel, campaignName, adgroups } of campaignAdgroups) {
    for (const ag of adgroups) {
      adgroupTargets.push({ channel, campaignName, adgroupId: ag.nccAdgroupId, adgroupName: ag.name });
    }
  }
  console.log(`[naver-keywords][${account.label}] 광고그룹 ${adgroupTargets.length}개 조회 완료 (${elapsed()})`);

  // 광고그룹 → 키워드, 광고그룹 → 소재(랜딩 URL)를 동시에 조회합니다(순서대로 하면 시간이
  // 두 배로 늘어 60초 제한에 걸리기 쉬움). 소재 조회가 실패해도 낭비 키워드 진단 자체는
  // 계속 돼야 하므로 개별로 실패를 흡수합니다.
  const adsDebug = {};
  const [adgroupKeywords, adgroupAds] = await Promise.all([
    mapWithConcurrency(adgroupTargets, LIST_CONCURRENCY, async (t) => {
      const keywords = await naverRequest(account, 'GET', '/ncc/keywords', { nccAdgroupId: t.adgroupId });
      return { ...t, keywords: keywords || [] };
    }),
    mapWithConcurrency(adgroupTargets, LIST_CONCURRENCY, async (t, i) => {
      try {
        const ads = await naverRequest(account, 'GET', '/ncc/ads', { nccAdgroupId: t.adgroupId, showDetail: '1' });
        if (debug && i === 0 && !adsDebug.raw) {
          adsDebug.raw = ads;
          console.log(`[naver-keywords][DEBUG] 광고 소재 원본 응답: ${JSON.stringify(ads).slice(0, 1500)}`);
        }
        return { adgroupId: t.adgroupId, landingUrl: extractLandingUrl(ads) };
      } catch (e) {
        return { adgroupId: t.adgroupId, landingUrl: null };
      }
    }, LIST_REQUEST_GAP_MS)
  ]);

  const adgroupSalesChannel = new Map();
  for (const { adgroupId, landingUrl } of adgroupAds) {
    adgroupSalesChannel.set(adgroupId, { landingUrl, salesChannel: classifySalesChannel(landingUrl) });
  }
  console.log(
    `[naver-keywords][${account.label}] 광고 소재(랜딩URL) ${adgroupAds.filter((a) => a.landingUrl).length}/${adgroupTargets.length}개 조회 완료 (${elapsed()})`
  );

  const keywordTargets = [];
  for (const t of adgroupKeywords) {
    for (const kw of t.keywords) {
      keywordTargets.push({
        channel: t.channel,
        campaign: t.campaignName,
        adgroup: t.adgroupName,
        adgroupId: t.adgroupId,
        keyword: kw.keyword,
        keywordId: kw.nccKeywordId
      });
    }
  }
  console.log(`[naver-keywords][${account.label}] 키워드 ${keywordTargets.length}개 조회 완료 (${elapsed()})`);

  // 키워드별 성과 — 벌크 통계 조회로 몇백 개라도 몇 번의 호출로 끝냅니다.
  const keywordBulkDebug = {};
  const keywordTotals = await fetchBulkTotals(
    account,
    keywordTargets.map((t) => t.keywordId),
    since,
    until,
    debug ? keywordBulkDebug : null
  );
  const rows = keywordTargets.map((t) => {
    const channelInfo = adgroupSalesChannel.get(t.adgroupId) || { landingUrl: null, salesChannel: null };
    return {
      month: monthStr,
      channel: t.channel,
      campaign: t.campaign,
      adgroup: t.adgroup,
      keyword: t.keyword,
      keyword_id: t.keywordId,
      landing_url: channelInfo.landingUrl,
      sales_channel: channelInfo.salesChannel,
      ...(keywordTotals.get(t.keywordId) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 })
    };
  });
  console.log(`[naver-keywords][${account.label}] 키워드별 성과 수집 완료 (${elapsed()})`);

  // 캠페인 레벨 통계(campaignTotals) vs 그 캠페인에 속한 키워드들의 통계 합
  // — 쇼핑검색처럼 캠페인 스펜드가 키워드 단위로 안 잡히는 경우를 확인하기 위한 진단 로그.
  const adgroupCountByCampaign = new Map();
  const keywordCountByCampaign = new Map();
  for (const t of adgroupTargets) {
    adgroupCountByCampaign.set(t.campaignName, (adgroupCountByCampaign.get(t.campaignName) || 0) + 1);
  }
  const keywordSumByCampaign = new Map();
  for (const r of rows) {
    const cur = keywordSumByCampaign.get(r.campaign) || { spend: 0, clicks: 0, count: 0 };
    cur.spend += r.spend;
    cur.clicks += r.clicks;
    cur.count += 1;
    keywordSumByCampaign.set(r.campaign, cur);
    keywordCountByCampaign.set(r.campaign, (keywordCountByCampaign.get(r.campaign) || 0) + 1);
  }
  console.log(`[naver-keywords][${account.label}] 캠페인별 진단 (캠페인 레벨 통계 vs 키워드 합):`);
  for (const campaign of campaigns) {
    const campaignLevel = campaignTotals.get(campaign.nccCampaignId) || { spend: 0, clicks: 0 };
    const kwSum = keywordSumByCampaign.get(campaign.name) || { spend: 0, clicks: 0, count: 0 };
    console.log(
      `  - ${campaign.name} (${campaign.campaignTp}): 캠페인레벨 광고비=${campaignLevel.spend}/클릭=${campaignLevel.clicks}` +
        ` | 광고그룹=${adgroupCountByCampaign.get(campaign.name) || 0}개, 키워드=${keywordCountByCampaign.get(campaign.name) || 0}개` +
        ` | 키워드합계 광고비=${kwSum.spend}/클릭=${kwSum.clicks}`
    );
  }

  return {
    label: account.label,
    rows,
    totalCampaignCount: allCampaigns.length,
    activeCampaignCount: campaigns.length,
    adgroupCount: adgroupTargets.length,
    keywordCount: keywordTargets.length,
    landingUrlResolvedCount: adgroupAds.filter((a) => a.landingUrl).length,
    campaignBulkDebug,
    keywordBulkDebug,
    adsDebug
  };
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // 계정1(기존 계정)은 필수, 계정2 이후는 환경변수 3종이 다 있을 때만 사용합니다
  // (sync-naver-ads.js와 동일한 규칙).
  const missing = ['NAVER_API_KEY', 'NAVER_SECRET_KEY', 'NAVER_CUSTOMER_ID', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: `${missing.join(', ')} 가 설정돼 있는지 확인하세요.`
    });
  }

  // ?account=1 처럼 계정 하나만 지정하면 그 계정만 처리합니다. 계정이 여러 개면 계정마다
  // 캠페인→광고그룹→키워드까지 내려가야 해서 시간이 오래 걸리고, 한 번의 호출에서 계정을
  // 다 처리하면 Vercel 함수 실행 제한(60초)을 넘기기 쉽습니다. 그래서 워크플로에서 계정별로
  // 나눠서 호출합니다 (지정 안 하면 이전처럼 활성 계정 전부를 순서대로 처리합니다).
  const accountParam = req.query && req.query.account;
  const accountsToRun = accountParam ? ACCOUNTS.filter((a) => a.id === String(accountParam)) : ACCOUNTS;
  if (accountParam && !accountsToRun.length) {
    return res.status(400).json({ error: 'unknown_account', detail: `account=${accountParam} 에 해당하는 계정이 없습니다.` });
  }

  const activeAccounts = accountsToRun.filter(
    (a) => process.env[a.apiKeyEnv] && process.env[a.secretKeyEnv] && process.env[a.customerIdEnv]
  );
  const skippedAccounts = accountsToRun.filter((a) => !activeAccounts.includes(a)).map((a) => a.label);

  const monthParam = req.query && req.query.month;
  const debug = req.query && req.query.debug === '1';
  // ?shard=0&shards=3 처럼 지정하면 이 계정의 활동 캠페인을 shards개로 나눠 그중
  // shard번째 조각만 처리합니다. 캠페인/키워드가 아주 많은 계정 하나를 여러 호출로
  // 쪼개 각각 60초 안에 끝내려는 용도입니다 (?account=와 함께 씁니다).
  const shard = Math.max(0, Number((req.query && req.query.shard) || 0) || 0);
  const shards = Math.max(1, Number((req.query && req.query.shards) || 1) || 1);
  const now = new Date();
  const year = monthParam ? Number(monthParam.split('-')[0]) : now.getUTCFullYear();
  const mon = monthParam ? Number(monthParam.split('-')[1]) : now.getUTCMonth() + 1;
  const monthStr = `${year}-${String(mon).padStart(2, '0')}`;
  const since = `${monthStr}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const until = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

  try {
    const perAccountResults = [];
    for (const account of activeAccounts) {
      perAccountResults.push(await syncNaverKeywordsForAccount(account, since, until, monthStr, debug, elapsed, shard, shards));
    }

    const rows = perAccountResults.flatMap((r) => r.rows);
    // 노출도 클릭도 전혀 없었던 키워드는 저장하지 않아 표를 깔끔하게 유지합니다.
    const meaningfulRows = rows.filter((r) => r.spend > 0 || r.impressions > 0 || r.clicks > 0);
    await upsertInChunks('naver_keyword_performance', 'month,keyword_id', meaningfulRows);
    console.log(`[naver-keywords] Supabase 저장 완료 — ${meaningfulRows.length}건 (${elapsed()})`);

    return res.status(200).json({
      month: monthStr,
      shard, shards,
      accountsUsed: activeAccounts.map((a) => a.label),
      accountsSkipped: skippedAccounts,
      totalCampaignCount: perAccountResults.reduce((s, r) => s + r.totalCampaignCount, 0),
      activeCampaignCount: perAccountResults.reduce((s, r) => s + r.activeCampaignCount, 0),
      adgroupCount: perAccountResults.reduce((s, r) => s + r.adgroupCount, 0),
      keywordCount: perAccountResults.reduce((s, r) => s + r.keywordCount, 0),
      landingUrlResolvedCount: perAccountResults.reduce((s, r) => s + r.landingUrlResolvedCount, 0),
      savedCount: meaningfulRows.length,
      elapsed: elapsed(),
      ...(debug
        ? {
            debugSamples: perAccountResults.map((r) => ({
              label: r.label,
              campaignBulkSample: r.campaignBulkDebug.raw,
              keywordBulkSample: r.keywordBulkDebug.raw,
              adsSample: r.adsDebug.raw
            }))
          }
        : {})
    });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err), elapsed: elapsed() });
  }
};

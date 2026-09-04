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
//
// ⚠️ 캠페인 수 × 광고그룹 수 × 키워드 수만큼 네이버 API를 호출하기 때문에
// sync-naver-ads.js보다 훨씬 오래 걸립니다. 동시 요청 수를 제한(CONCURRENCY)해서
// 네이버 쪽 요청 제한에 안 걸리게 하고, vercel.json에서 이 함수의 실행 시간 제한을
// 늘려뒀습니다(maxDuration).
//
// 수동 테스트 방법 (터미널에서):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/sync-naver-keywords?month=2026-09"

const crypto = require('crypto');

const NAVER_BASE = 'https://api.searchad.naver.com';
const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const CONCURRENCY = 4;
const UPSERT_CHUNK_SIZE = 200;
const MAX_RETRIES = 5;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// sync-naver-ads.js와 동일한 브랜드 매칭표
const BRANDS = [
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
];
const FALLBACK_CHANNEL = '네이버 기타';

function sign(timestamp, method, uri, secretKey) {
  return crypto.createHmac('sha256', secretKey).update(`${timestamp}.${method}.${uri}`).digest('base64');
}

// 네이버 API가 429(Too Many Requests)를 주면 점점 더 오래 기다렸다가 재시도합니다.
async function naverRequest(method, uri, params, attempt = 0) {
  const timestamp = String(Date.now());
  const url = new URL(NAVER_BASE + uri);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Timestamp': timestamp,
      'X-API-KEY': process.env.NAVER_API_KEY,
      'X-Customer': process.env.NAVER_CUSTOMER_ID,
      'X-Signature': sign(timestamp, method, uri, process.env.NAVER_SECRET_KEY)
    }
  });
  if (res.status === 429 && attempt < MAX_RETRIES) {
    await sleep(500 * Math.pow(2, attempt));
    return naverRequest(method, uri, params, attempt + 1);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`네이버 API 요청 실패 ${method} ${uri} (${res.status}): ${text}`);
  }
  return res.json();
}

function matchChannel(campaignName) {
  const sorted = [...BRANDS].sort((a, b) => b.name.length - a.name.length);
  const hit = sorted.find((b) => campaignName.startsWith(b.name));
  return hit ? hit.channel : FALLBACK_CHANNEL;
}

// 캠페인/키워드 등 모든 개체에 공통으로 쓰는 통계 조회 (id 하나에 대한 기간 합계)
async function fetchEntityTotals(entityId, since, until) {
  const data = await naverRequest('GET', '/stats', {
    id: entityId,
    fields: JSON.stringify(['salesAmt', 'impCnt', 'clkCnt', 'ccnt', 'convAmt']),
    timeRange: JSON.stringify({ since, until }),
    timeIncrement: '1'
  });
  const days = data.data || [];
  return days.reduce(
    (acc, d) => ({
      spend: acc.spend + (Number(d.salesAmt) || 0),
      impressions: acc.impressions + (Number(d.impCnt) || 0),
      clicks: acc.clicks + (Number(d.clkCnt) || 0),
      conversions: acc.conversions + (Number(d.ccnt) || 0),
      revenue: acc.revenue + (Number(d.convAmt) || 0)
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }
  );
}

// 동시 실행 개수를 CONCURRENCY로 제한하면서 배열의 각 항목을 처리합니다.
// 요청 사이에 짧은 간격을 둬서 순간적으로 몰리는 것도 막습니다.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const cur = next++;
      results[cur] = await fn(items[cur], cur);
      await sleep(80);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 0 }, worker));
  return results;
}

async function upsertInChunks(table, conflictCols, rows) {
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
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
  }
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const missing = ['NAVER_API_KEY', 'NAVER_SECRET_KEY', 'NAVER_CUSTOMER_ID', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: `${missing.join(', ')} 가 설정돼 있는지 확인하세요.`
    });
  }

  const monthParam = req.query && req.query.month;
  const now = new Date();
  const year = monthParam ? Number(monthParam.split('-')[0]) : now.getUTCFullYear();
  const mon = monthParam ? Number(monthParam.split('-')[1]) : now.getUTCMonth() + 1;
  const monthStr = `${year}-${String(mon).padStart(2, '0')}`;
  const since = `${monthStr}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const until = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

  try {
    const allCampaigns = await naverRequest('GET', '/ncc/campaigns');

    // 이번 달에 노출·클릭·광고비가 전혀 없었던 캠페인은 광고그룹/키워드까지 내려가 봐야
    // 어차피 낭비 키워드가 나올 수 없으므로, 먼저 캠페인 단위로 걸러서 API 호출량을 줄입니다.
    const campaignActivity = await mapWithConcurrency(allCampaigns, CONCURRENCY, async (campaign) => {
      const totals = await fetchEntityTotals(campaign.nccCampaignId, since, until);
      return { campaign, active: totals.spend > 0 || totals.impressions > 0 || totals.clicks > 0 };
    });
    const campaigns = campaignActivity.filter((c) => c.active).map((c) => c.campaign);

    // 캠페인 → 광고그룹
    const campaignAdgroups = await mapWithConcurrency(campaigns, CONCURRENCY, async (campaign) => {
      const adgroups = await naverRequest('GET', '/ncc/adgroups', { nccCampaignId: campaign.nccCampaignId });
      return { channel: matchChannel(campaign.name), campaignName: campaign.name, adgroups: adgroups || [] };
    });

    const adgroupTargets = [];
    for (const { channel, campaignName, adgroups } of campaignAdgroups) {
      for (const ag of adgroups) {
        adgroupTargets.push({ channel, campaignName, adgroupId: ag.nccAdgroupId, adgroupName: ag.name });
      }
    }

    // 광고그룹 → 키워드
    const adgroupKeywords = await mapWithConcurrency(adgroupTargets, CONCURRENCY, async (t) => {
      const keywords = await naverRequest('GET', '/ncc/keywords', { nccAdgroupId: t.adgroupId });
      return { ...t, keywords: keywords || [] };
    });

    const keywordTargets = [];
    for (const t of adgroupKeywords) {
      for (const kw of t.keywords) {
        keywordTargets.push({
          channel: t.channel,
          campaign: t.campaignName,
          adgroup: t.adgroupName,
          keyword: kw.keyword,
          keywordId: kw.nccKeywordId
        });
      }
    }

    // 키워드별 성과
    const rows = await mapWithConcurrency(keywordTargets, CONCURRENCY, async (t) => {
      const totals = await fetchEntityTotals(t.keywordId, since, until);
      return {
        month: monthStr,
        channel: t.channel,
        campaign: t.campaign,
        adgroup: t.adgroup,
        keyword: t.keyword,
        keyword_id: t.keywordId,
        ...totals
      };
    });

    // 노출도 클릭도 전혀 없었던 키워드는 저장하지 않아 표를 깔끔하게 유지합니다.
    const meaningfulRows = rows.filter((r) => r.spend > 0 || r.impressions > 0 || r.clicks > 0);
    await upsertInChunks('naver_keyword_performance', 'month,keyword_id', meaningfulRows);

    return res.status(200).json({
      month: monthStr,
      totalCampaignCount: allCampaigns.length,
      activeCampaignCount: campaigns.length,
      adgroupCount: adgroupTargets.length,
      keywordCount: keywordTargets.length,
      savedCount: meaningfulRows.length
    });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

// 네이버 검색광고(파워링크/쇼핑검색/브랜드검색 등)의 월간 광고비를 캠페인명 기준으로
// 브랜드별로 나눠 Supabase의 ad_performance 테이블에 저장하는 Vercel 서버리스 함수입니다.
// api/sync-meta-ads.js와 동일한 방식(월별 채널 집계)으로 동작하며, 같은 표/사이드바에
// '네이버 OOO' 채널로 나란히 보이게 됩니다.
// 채널 합계와 별도로, 캠페인 단위 행은 ad_performance_campaigns 테이블에, 날짜별 채널
// 합계는 ad_performance_daily 테이블에 저장되어 마케팅대시보드 브랜드별 페이지의
// "캠페인별 성과" / "일별 성과" 표에 각각 쓰입니다.
// (ad_performance_campaigns.sql, ad_performance_daily.sql을 Supabase SQL Editor에서
//  먼저 실행해야 합니다.)
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "sync-naver-ads.js" 로 저장하세요.
//    최종 경로: api/sync-naver-ads.js
//
// 필요한 Vercel 환경변수 (계정 1 — 기존 계정):
//   NAVER_API_KEY, NAVER_SECRET_KEY, NAVER_CUSTOMER_ID  - 네이버 검색광고 API 키
//   SUPABASE_SERVICE_ROLE_KEY - Supabase 프로젝트 설정 → API → service_role 키
//   CRON_SECRET               - sync-meta-ads.js와 같은 값을 그대로 재사용하면 됩니다.
//
// 계정 2(추가 네이버 광고 계정)를 붙이려면:
//   1) 네이버 검색광고 관리자센터에서 API 라이선스를 발급받아 Vercel에 NAVER_API_KEY_2,
//      NAVER_SECRET_KEY_2, NAVER_CUSTOMER_ID_2 세 개를 환경변수로 등록하세요.
//   2) 아래 ACCOUNTS 배열의 두 번째 항목 brands에 그 계정에 속한 브랜드를 채우세요.
//      (name은 캠페인명 접두어, channel은 마케팅대시보드 index.html의 MARKETING_BRANDS에
//       있는 채널명과 정확히 같아야 합니다. 새 브랜드라면 거기도 같이 추가해야 합니다.)
//   계정 2의 환경변수가 아직 없으면 이 함수는 계정 2를 건너뛰고 계정 1만 그대로 동기화합니다.
//
// 네이버 광고 계정 하나에 여러 브랜드 캠페인이 섞여 있어서, 캠페인명이 그 계정의 brands
// 이름으로 시작하면 그 브랜드 채널로, 아니면 '네이버 기타' 채널로 집계합니다.
// (매출(revenue)은 전환추적이 연결돼 있어야 값이 나오며, 없으면 0으로 기록됩니다.)
//
// 수동 테스트 방법 (터미널에서):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/sync-naver-ads?month=2026-09"

const crypto = require('crypto');

const NAVER_BASE = 'https://api.searchad.naver.com';
const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const STATS_CONCURRENCY = 3; // 캠페인별 /stats 조회를 몇 개씩 동시에 호출할지 (계정2 추가 후 429 방지)
const STATS_REQUEST_GAP_MS = 150;
const MAX_RETRIES = 4;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 동시 실행 개수를 제한하면서 배열의 각 항목을 처리합니다 (sync-naver-keywords.js와 동일한 패턴).
async function mapWithConcurrency(items, limit, fn, gapMs) {
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

// 계정이 여러 개면 이 배열에 하나씩 추가합니다. 각 계정은 자기 자신의 API 키/브랜드
// 매칭표를 갖고, 서로 다른 네이버 검색광고 계정이라 브랜드명이 겹쳐도 문제없습니다.
const ACCOUNTS = [
  {
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
    label: '계정2',
    apiKeyEnv: 'NAVER_API_KEY_2',
    secretKeyEnv: 'NAVER_SECRET_KEY_2',
    customerIdEnv: 'NAVER_CUSTOMER_ID_2',
    // 계정1과 같은 브랜드들이 계정2에도 캠페인을 따로 운영 중이라 브랜드 매칭표를 그대로 공유합니다.
    // 같은 채널명이면 계정1·계정2 합계가 totalsByChannel에서 자동으로 더해집니다.
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

// 네이버 API가 429(Too Many Requests)를 주면 점점 더 오래 기다렸다가 재시도합니다
// (sync-naver-keywords.js와 동일한 방식 — 계정2 추가로 계정당 호출량이 늘어난 뒤 필요해졌습니다).
async function naverRequest(account, method, uri, params, attempt = 0) {
  const timestamp = String(Date.now());
  const url = new URL(NAVER_BASE + uri);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

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

// 캠페인명이 브랜드명으로 시작하는지 확인합니다. 이름이 겹치는 경우
// (예: '미니멀' vs '미니멀룸') 더 긴 이름을 우선 매칭합니다.
function matchChannel(brands, campaignName) {
  const sorted = [...brands].sort((a, b) => b.name.length - a.name.length);
  const hit = sorted.find((b) => campaignName.startsWith(b.name));
  return hit ? hit.channel : FALLBACK_CHANNEL;
}

// 캠페인명에 'PPP'가 들어가면 파워링크 캠페인이라 '파워링크'로, 나머지는 'SA'로 태그합니다.
// (마케팅대시보드의 "네이버 광고 구분" 패널에서 SA/GFA/파워링크를 나눠 보여주는 데 씁니다.)
function matchAdType(campaignName) {
  return campaignName.includes('PPP') ? '파워링크' : 'SA';
}

// 실제 API 응답은 문서(dailyStatResponse.data)와 달리 최상위에 data 배열을 바로 내려줍니다.
// days(일별 원본 배열)도 같이 반환해서 호출하는 쪽에서 "일별 성과" 집계에 재사용합니다.
async function fetchCampaignTotals(account, campaignId, since, until) {
  const data = await naverRequest(account, 'GET', '/stats', {
    id: campaignId,
    fields: JSON.stringify(['salesAmt', 'impCnt', 'clkCnt', 'ccnt', 'convAmt']),
    timeRange: JSON.stringify({ since, until }),
    timeIncrement: '1'
  });
  const days = data.data || [];
  const totals = days.reduce(
    (acc, d) => ({
      spend: acc.spend + (Number(d.salesAmt) || 0),
      impressions: acc.impressions + (Number(d.impCnt) || 0),
      clicks: acc.clicks + (Number(d.clkCnt) || 0),
      conversions: acc.conversions + (Number(d.ccnt) || 0),
      revenue: acc.revenue + (Number(d.convAmt) || 0)
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 }
  );
  return { totals, days };
}

module.exports = async function handler(req, res) {
  // Vercel Cron이 자동으로 붙여주는 Authorization 헤더 검증 (수동 호출 시에도 동일하게 필요)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  // 계정1(기존 계정)은 필수, 계정2 이후는 환경변수 3종이 다 있을 때만 사용합니다
  // (아직 API 키를 발급받기 전이라 계정2 환경변수가 없어도 계정1만으로 정상 동작합니다).
  const missing = ['NAVER_API_KEY', 'NAVER_SECRET_KEY', 'NAVER_CUSTOMER_ID', 'SUPABASE_SERVICE_ROLE_KEY'].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: `${missing.join(', ')} 가 설정돼 있는지 확인하세요.`
    });
  }
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const activeAccounts = ACCOUNTS.filter(
    (a) => process.env[a.apiKeyEnv] && process.env[a.secretKeyEnv] && process.env[a.customerIdEnv]
  );
  const skippedAccounts = ACCOUNTS.filter((a) => !activeAccounts.includes(a)).map((a) => a.label);

  // 조회할 월 (?month=2026-09 로 지정 가능, 없으면 이번 달)
  const monthParam = req.query && req.query.month;
  const now = new Date();
  const year = monthParam ? Number(monthParam.split('-')[0]) : now.getUTCFullYear();
  const mon = monthParam ? Number(monthParam.split('-')[1]) : now.getUTCMonth() + 1;
  const monthStr = `${year}-${String(mon).padStart(2, '0')}`;
  const since = `${monthStr}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const until = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

  try {
    let campaignCount = 0;
    const perCampaign = [];
    for (const account of activeAccounts) {
      const campaigns = await naverRequest(account, 'GET', '/ncc/campaigns');
      campaignCount += campaigns.length;
      const accountPerCampaign = await mapWithConcurrency(
        campaigns,
        STATS_CONCURRENCY,
        async (campaign) => {
          const { totals, days } = await fetchCampaignTotals(account, campaign.nccCampaignId, since, until);
          return { name: campaign.name, channel: matchChannel(account.brands, campaign.name), totals, days };
        },
        STATS_REQUEST_GAP_MS
      );
      perCampaign.push(...accountPerCampaign);
    }

    const totalsByChannel = new Map();
    for (const { channel, totals } of perCampaign) {
      const cur = totalsByChannel.get(channel) || { spend: 0, impressions: 0, clicks: 0, conversions: 0, revenue: 0 };
      cur.spend += totals.spend;
      cur.impressions += totals.impressions;
      cur.clicks += totals.clicks;
      cur.conversions += totals.conversions;
      cur.revenue += totals.revenue;
      totalsByChannel.set(channel, cur);
    }

    const results = [];
    for (const [channel, totals] of totalsByChannel.entries()) {
      const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/ad_performance?on_conflict=month,channel`, {
        method: 'POST',
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify([{ month: monthStr, channel, ...totals }])
      });

      if (!upsertRes.ok) {
        const errText = await upsertRes.text();
        results.push({ channel, error: 'supabase_upsert_error', detail: errText });
        continue;
      }
      results.push({ channel, ok: true, ...totals });
    }

    // 브랜드별 페이지의 "캠페인별 성과" 표용 — 채널 합계와 별도로 캠페인 단위 행도 저장합니다.
    // ad_type은 matchAdType으로 SA/파워링크를 나눠서 태그합니다 (GFA 원본은 이 API에 안 잡혀서
    // 대시보드에서 수동 업로드로 별도 태그가 붙습니다).
    const campaignRows = perCampaign
      .filter(({ totals }) => totals.spend > 0 || totals.impressions > 0)
      .map(({ name, channel, totals }) => ({
        month: monthStr, channel, campaign: name, ad_type: matchAdType(name), ...totals
      }));

    if (campaignRows.length) {
      const campaignUpsertRes = await fetch(
        `${SUPABASE_URL}/rest/v1/ad_performance_campaigns?on_conflict=month,channel,ad_type,campaign`,
        {
          method: 'POST',
          headers: {
            apikey: supabaseServiceKey,
            Authorization: `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates'
          },
          body: JSON.stringify(campaignRows)
        }
      );
      if (!campaignUpsertRes.ok) {
        const errText = await campaignUpsertRes.text();
        results.push({ error: 'supabase_campaign_upsert_error', detail: errText });
      }
    }

    // 브랜드별 페이지의 "일별 성과" 표용 — 캠페인별 일별 데이터를 채널 단위로 합산해서 저장합니다.
    const dailyByKey = new Map();
    for (const { channel, days } of perCampaign) {
      for (const d of days) {
        if (!d.dateStart) continue;
        const key = `${d.dateStart}|${channel}`;
        const cur = dailyByKey.get(key) || {
          date: d.dateStart,
          channel,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversions: 0,
          revenue: 0
        };
        cur.spend += Number(d.salesAmt) || 0;
        cur.impressions += Number(d.impCnt) || 0;
        cur.clicks += Number(d.clkCnt) || 0;
        cur.conversions += Number(d.ccnt) || 0;
        cur.revenue += Number(d.convAmt) || 0;
        dailyByKey.set(key, cur);
      }
    }
    const dailyRows = Array.from(dailyByKey.values()).filter(
      (r) => r.spend > 0 || r.impressions > 0 || r.clicks > 0
    );

    if (dailyRows.length) {
      // updated_at 은 테이블에서 default now() 로 잡혀 있는데, 그 기본값은 "처음 넣을 때"만
      // 찍힌다. on_conflict 로 덮어쓸 때는 그대로 남아서, 값은 새로 들어왔는데 시각은 옛날에
      // 멈춰 있었다 — 대시보드가 이 값을 「마지막 업데이트」로 보여주기 때문에 오늘치를 새로
      // 받아도 계속 옛 시각이 떴다(2026-09-12: 20:04 에 받았는데 화면은 13:43). 직접 실어준다.
      const syncedAt = new Date().toISOString();
      const dailyUpsertRes = await fetch(`${SUPABASE_URL}/rest/v1/ad_performance_daily?on_conflict=date,channel`, {
        method: 'POST',
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify(dailyRows.map((r) => ({ ...r, updated_at: syncedAt })))
      });
      if (!dailyUpsertRes.ok) {
        const errText = await dailyUpsertRes.text();
        results.push({ error: 'supabase_daily_upsert_error', detail: errText });
      }
    }

    return res.status(200).json({
      month: monthStr,
      accountsUsed: activeAccounts.map((a) => a.label),
      accountsSkipped: skippedAccounts,
      campaignCount,
      dailyRowCount: dailyRows.length,
      results
    });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

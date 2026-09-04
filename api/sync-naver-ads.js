// 네이버 검색광고(파워링크/쇼핑검색/브랜드검색 등)의 월간 광고비를 캠페인명 기준으로
// 브랜드별로 나눠 Supabase의 ad_performance 테이블에 저장하는 Vercel 서버리스 함수입니다.
// api/sync-meta-ads.js와 동일한 방식(월별 채널 집계)으로 동작하며, 같은 표/사이드바에
// '네이버 OOO' 채널로 나란히 보이게 됩니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "sync-naver-ads.js" 로 저장하세요.
//    최종 경로: api/sync-naver-ads.js
//
// 필요한 Vercel 환경변수:
//   NAVER_API_KEY, NAVER_SECRET_KEY, NAVER_CUSTOMER_ID  - 네이버 검색광고 API 키
//   SUPABASE_SERVICE_ROLE_KEY - Supabase 프로젝트 설정 → API → service_role 키
//   CRON_SECRET               - sync-meta-ads.js와 같은 값을 그대로 재사용하면 됩니다.
//
// 네이버 광고 계정 하나에 여러 브랜드 캠페인이 섞여 있어서, 캠페인명이 아래 BRANDS의
// 이름으로 시작하면 그 브랜드 채널로, 아니면 '네이버 기타' 채널로 집계합니다.
// (매출(revenue)은 전환추적이 연결돼 있어야 값이 나오며, 없으면 0으로 기록됩니다.)
//
// 수동 테스트 방법 (터미널에서):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/sync-naver-ads?month=2026-09"

const crypto = require('crypto');

const NAVER_BASE = 'https://api.searchad.naver.com';
const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';

// name은 캠페인명 매칭에 쓰이고, channel은 ad_performance 테이블 및 마케팅 대시보드
// 사이드바(index.html의 MARKETING_BRANDS)에 있는 채널명과 정확히 같아야 매칭됩니다.
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

async function naverRequest(method, uri, params) {
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
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`네이버 API 요청 실패 ${method} ${uri} (${res.status}): ${text}`);
  }
  return res.json();
}

// 캠페인명이 브랜드명으로 시작하는지 확인합니다. 이름이 겹치는 경우
// (예: '미니멀' vs '미니멀룸') 더 긴 이름을 우선 매칭합니다.
function matchChannel(campaignName) {
  const sorted = [...BRANDS].sort((a, b) => b.name.length - a.name.length);
  const hit = sorted.find((b) => campaignName.startsWith(b.name));
  return hit ? hit.channel : FALLBACK_CHANNEL;
}

// 실제 API 응답은 문서(dailyStatResponse.data)와 달리 최상위에 data 배열을 바로 내려줍니다.
async function fetchCampaignTotals(campaignId, since, until) {
  const data = await naverRequest('GET', '/stats', {
    id: campaignId,
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

module.exports = async function handler(req, res) {
  // Vercel Cron이 자동으로 붙여주는 Authorization 헤더 검증 (수동 호출 시에도 동일하게 필요)
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
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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
    const campaigns = await naverRequest('GET', '/ncc/campaigns');

    const perCampaign = await Promise.all(
      campaigns.map(async (campaign) => ({
        channel: matchChannel(campaign.name),
        totals: await fetchCampaignTotals(campaign.nccCampaignId, since, until)
      }))
    );

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

    return res.status(200).json({ month: monthStr, campaignCount: campaigns.length, results });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

// Meta(Facebook) 광고 데이터를 매일 자동으로 끌어와 Supabase의 ad_performance 테이블에 저장하는
// Vercel 서버리스 함수입니다.
//
// ⚠️ 배치 위치: GitHub 저장소의 최상위에 "api" 폴더를 만들고, 그 안에
//    이 파일을 "sync-meta-ads.js" 라는 이름으로 넣어주세요.
//    최종 경로: api/sync-meta-ads.js
//
// 필요한 Vercel 환경변수 (Project Settings → Environment Variables 에서 추가):
//   META_ACCESS_TOKEN         - Meta 비즈니스 관리자에서 발급한 시스템 사용자 액세스 토큰
//   META_AD_ACCOUNT_ID        - 예: act_678553324545924 (코드니처 광고 계정)
//   SUPABASE_SERVICE_ROLE_KEY - Supabase 프로젝트 설정 → API → service_role 키 (절대 프론트엔드에 넣지 말 것)
//   CRON_SECRET               - 임의의 랜덤 문자열(16자 이상). Vercel Cron이 자동으로
//                               Authorization: Bearer <CRON_SECRET> 헤더를 붙여서 호출해줍니다.
//
// 수동 테스트 방법 (터미널에서):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/sync-meta-ads?month=2026-07"

const META_API_VERSION = 'v26.0';
const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const CHANNEL_NAME = '코드니처 메타';

module.exports = async function handler(req, res) {
  // Vercel Cron이 자동으로 붙여주는 Authorization 헤더 검증 (수동 호출 시에도 동일하게 필요)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!accessToken || !adAccountId || !supabaseServiceKey) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: 'META_ACCESS_TOKEN, META_AD_ACCOUNT_ID, SUPABASE_SERVICE_ROLE_KEY 가 모두 설정돼 있는지 확인하세요.'
    });
  }

  // 조회할 월 (?month=2026-07 로 지정 가능, 없으면 이번 달)
  const monthParam = req.query && req.query.month;
  const now = new Date();
  const year = monthParam ? Number(monthParam.split('-')[0]) : now.getUTCFullYear();
  const mon = monthParam ? Number(monthParam.split('-')[1]) : (now.getUTCMonth() + 1);
  const monthStr = `${year}-${String(mon).padStart(2, '0')}`;

  const since = `${monthStr}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const until = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

  try {
    const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
    const insightsUrl =
      `https://graph.facebook.com/${META_API_VERSION}/${adAccountId}/insights` +
      `?fields=spend,impressions,clicks,actions,action_values` +
      `&time_range=${timeRange}` +
      `&access_token=${accessToken}`;

    const metaRes = await fetch(insightsUrl);
    const metaJson = await metaRes.json();

    if (metaJson.error) {
      return res.status(502).json({ error: 'meta_api_error', detail: metaJson.error });
    }

    const row = (metaJson.data && metaJson.data[0]) || {};
    const spend = Number(row.spend || 0);
    const impressions = Number(row.impressions || 0);
    const clicks = Number(row.clicks || 0);

    const purchaseAction = (row.actions || []).find(
      (a) => a.action_type === 'omni_purchase' || a.action_type === 'purchase'
    );
    const conversions = purchaseAction ? Number(purchaseAction.value) : 0;

    const purchaseValue = (row.action_values || []).find(
      (a) => a.action_type === 'omni_purchase' || a.action_type === 'purchase'
    );
    const revenue = purchaseValue ? Number(purchaseValue.value) : 0;

    // month + channel 기준으로 upsert (07_add_ad_performance_unique_constraint.sql 실행 필요)
    const upsertRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ad_performance?on_conflict=month,channel`,
      {
        method: 'POST',
        headers: {
          apikey: supabaseServiceKey,
          Authorization: `Bearer ${supabaseServiceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify([
          { month: monthStr, channel: CHANNEL_NAME, spend, impressions, clicks, conversions, revenue }
        ])
      }
    );

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      return res.status(502).json({ error: 'supabase_upsert_error', detail: errText });
    }

    return res.status(200).json({
      ok: true,
      month: monthStr,
      channel: CHANNEL_NAME,
      spend,
      impressions,
      clicks,
      conversions,
      revenue
    });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
}

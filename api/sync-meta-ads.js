// 여러 브랜드(Meta 광고 계정)의 광고 데이터를 매일 자동으로 끌어와
// Supabase의 ad_performance 테이블에 저장하는 Vercel 서버리스 함수입니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "sync-meta-ads.js" 로 저장하세요.
//    최종 경로: api/sync-meta-ads.js
//
// 새 브랜드를 연동하고 싶을 때: 아래 BRANDS 배열에 이미 등록된 브랜드라면 코드는 건드릴 필요 없이,
// Vercel 환경변수에 META_ACCESS_TOKEN_<KEY>, META_AD_ACCOUNT_ID_<KEY> 두 개만 추가하면
// 다음 실행부터 자동으로 그 브랜드도 함께 동기화됩니다. (토큰이 없는 브랜드는 자동으로 건너뜁니다)
//
// 필요한 공통 Vercel 환경변수:
//   SUPABASE_SERVICE_ROLE_KEY - Supabase 프로젝트 설정 → API → service_role 키
//   CRON_SECRET               - 임의의 랜덤 문자열(16자 이상). Vercel Cron이 자동으로
//                               Authorization: Bearer <CRON_SECRET> 헤더를 붙여서 호출해줍니다.
//
// 브랜드별 환경변수 (연동된 브랜드만 있으면 됨, 예: 코드니처):
//   META_ACCESS_TOKEN_CODENATURE  (또는 이전 이름 META_ACCESS_TOKEN 도 인식함)
//   META_AD_ACCOUNT_ID_CODENATURE (또는 이전 이름 META_AD_ACCOUNT_ID 도 인식함)
//
// 수동 테스트 방법 (터미널에서):
//   전체 브랜드(연동된 것만) 동기화:
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/sync-meta-ads?month=2026-07"
//   특정 브랜드 하나만:
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/sync-meta-ads?month=2026-07&brand=CODENATURE"

const META_API_VERSION = 'v26.0';
const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';

// key는 환경변수 이름에 쓰이고, channel은 ad_performance 테이블과 마케팅 대시보드
// 사이드바(index.html의 MARKETING_BRANDS)에 있는 채널명과 정확히 같아야 매칭됩니다.
const BRANDS = [
  { key: 'CODENATURE', channel: '메타 코드니처' },
  { key: 'MINIMALROOM', channel: '메타 미니멀룸' },
  { key: 'PIRUS', channel: '메타 빠이러스' },
  { key: 'GROWMUSE', channel: '메타 그로우유즈' },
  { key: 'LASMA', channel: '메타 라스마' },
  { key: 'ZAMBIE', channel: '메타 잠비에' },
  { key: 'GLORYFIT', channel: '메타 글로리핏' },
  { key: 'MYEONGTWE', channel: '메타 명퉤' },
  { key: 'MELUSION', channel: '메타 멜루션' },
  { key: 'POLKE', channel: '메타 폴크' }
];

module.exports = async function handler(req, res) {
  // Vercel Cron이 자동으로 붙여주는 Authorization 헤더 검증 (수동 호출 시에도 동일하게 필요)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceKey) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: 'SUPABASE_SERVICE_ROLE_KEY 가 설정돼 있는지 확인하세요.'
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

  // ?brand=CODENATURE 로 특정 브랜드 하나만 동기화할 수도 있음 (없으면 토큰 준비된 브랜드 전체 순회)
  const brandFilter = req.query && req.query.brand;
  const targets = brandFilter ? BRANDS.filter((b) => b.key === brandFilter) : BRANDS;

  const results = [];

  for (const brand of targets) {
    // 코드니처는 처음 설정했던 공통 이름의 환경변수(META_ACCESS_TOKEN 등)도 함께 인식합니다.
    const accessToken =
      process.env[`META_ACCESS_TOKEN_${brand.key}`] ||
      (brand.key === 'CODENATURE' ? process.env.META_ACCESS_TOKEN : undefined);
    const adAccountId =
      process.env[`META_AD_ACCOUNT_ID_${brand.key}`] ||
      (brand.key === 'CODENATURE' ? process.env.META_AD_ACCOUNT_ID : undefined);

    if (!accessToken || !adAccountId) {
      results.push({ channel: brand.channel, skipped: true, reason: 'no_credentials' });
      continue;
    }

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
        results.push({ channel: brand.channel, error: 'meta_api_error', detail: metaJson.error });
        continue;
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
            { month: monthStr, channel: brand.channel, spend, impressions, clicks, conversions, revenue }
          ])
        }
      );

      if (!upsertRes.ok) {
        const errText = await upsertRes.text();
        results.push({ channel: brand.channel, error: 'supabase_upsert_error', detail: errText });
        continue;
      }

      results.push({ channel: brand.channel, ok: true, spend, impressions, clicks, conversions, revenue });
    } catch (err) {
      results.push({ channel: brand.channel, error: 'unexpected_error', detail: String(err) });
    }
  }

  return res.status(200).json({ month: monthStr, results });
};

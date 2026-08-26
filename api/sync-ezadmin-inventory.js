// 이지어드민(EzAdmin) 재고 API에서 상품별 재고를 끌어와
// Supabase의 product_inventory 테이블에 저장하는 Vercel 서버리스 함수입니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "sync-ezadmin-inventory.js" 로 저장하세요.
//    최종 경로: api/sync-ezadmin-inventory.js
//
// 필요한 Vercel 환경변수:
//   SUPABASE_SERVICE_ROLE_KEY - Supabase 프로젝트 설정 → API → service_role 키
//   CRON_SECRET               - 임의의 랜덤 문자열(16자 이상). Vercel Cron이 자동으로
//                               Authorization: Bearer <CRON_SECRET> 헤더를 붙여서 호출해줍니다.
//   EZADMIN_PARTNER_KEY       - 이지어드민 개발자센터에서 발급받은 파트너키
//   EZADMIN_DOMAIN_KEY        - 이지어드민 개발자센터에서 발급받은 업체키
//
// 이 두 키가 아직 없으면(연동 전) 이 함수는 매번 "no_credentials" 로 건너뛰기만 하고
// 아무 것도 하지 않으니, 안전하게 미리 배치해둘 수 있습니다. 키가 준비되면 위 두 환경변수만
// 추가하면 다음 실행부터 자동으로 동기화가 시작됩니다.
//
// 동기화 대상 상품코드는 원가 대시보드(product_cost 테이블)에 등록된 상품코드를 그대로 사용합니다.
// (이지어드민 상품코드와 원가 대시보드의 "상품코드"가 같은 값이어야 매칭됩니다)
//
// 수동 테스트 방법 (터미널에서):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/sync-ezadmin-inventory"

const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const EZADMIN_API_URL = 'https://api2.ezadmin.co.kr/function.php';
const BATCH_SIZE = 100; // 이지어드민 재고조회는 한 번에 최대 100개 상품코드까지 조회 가능
const RATE_LIMIT_MS = 1100; // 재호출 대기시간 1초 제한 (여유를 두고 1.1초)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = async function handler(req, res) {
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

  const partnerKey = process.env.EZADMIN_PARTNER_KEY;
  const domainKey = process.env.EZADMIN_DOMAIN_KEY;
  if (!partnerKey || !domainKey) {
    return res.status(200).json({
      skipped: true,
      reason: 'no_credentials',
      detail: 'EZADMIN_PARTNER_KEY / EZADMIN_DOMAIN_KEY 환경변수가 아직 설정되지 않았습니다.'
    });
  }

  const supabaseHeaders = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json'
  };

  // 원가 대시보드에 등록된 상품코드 목록을 동기화 대상으로 사용
  const productCodeRes = await fetch(
    `${SUPABASE_URL}/rest/v1/product_cost?select=product_code&product_code=not.is.null`,
    { headers: supabaseHeaders }
  );
  if (!productCodeRes.ok) {
    const errText = await productCodeRes.text();
    return res.status(500).json({ error: 'supabase_read_error', detail: errText });
  }
  const productCodeRows = await productCodeRes.json();
  const productIds = Array.from(
    new Set(productCodeRows.map((r) => (r.product_code || '').trim()).filter(Boolean))
  );

  if (productIds.length === 0) {
    return res.status(200).json({
      skipped: true,
      reason: 'no_product_codes',
      detail: '원가 대시보드(product_cost)에 상품코드가 등록된 상품이 없습니다.'
    });
  }

  const batches = [];
  for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
    batches.push(productIds.slice(i, i + BATCH_SIZE));
  }

  const results = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      const url =
        `${EZADMIN_API_URL}?action=get_stock_info` +
        `&partner_key=${encodeURIComponent(partnerKey)}` +
        `&domain_key=${encodeURIComponent(domainKey)}` +
        `&product_id=${encodeURIComponent(batch.join(','))}` +
        `&include_ready_trans=1`;

      const ezRes = await fetch(url);
      const ezJson = await ezRes.json();

      if (ezJson.error) {
        results.push({ batch: i, error: 'ezadmin_api_error', detail: ezJson });
        continue;
      }

      const now = new Date().toISOString();
      const rows = Object.values(ezJson.data || {}).map((item) => ({
        product_id: item.product_id,
        stock: Number(item.stock || 0),
        available_stock: Number(item.stock || 0) - Number(item.ready_trans_stock || 0),
        stock_unit: item.stock_unit || null,
        checked_at: item.check_date || null,
        synced_at: now
      }));

      if (rows.length > 0) {
        const upsertRes = await fetch(
          `${SUPABASE_URL}/rest/v1/product_inventory?on_conflict=product_id`,
          {
            method: 'POST',
            headers: { ...supabaseHeaders, Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify(rows)
          }
        );
        if (!upsertRes.ok) {
          const errText = await upsertRes.text();
          results.push({ batch: i, error: 'supabase_upsert_error', detail: errText });
          continue;
        }
      }

      results.push({ batch: i, ok: true, synced: rows.length });
    } catch (err) {
      results.push({ batch: i, error: 'unexpected_error', detail: String(err) });
    }

    if (i < batches.length - 1) {
      await sleep(RATE_LIMIT_MS);
    }
  }

  return res.status(200).json({ product_count: productIds.length, results });
};

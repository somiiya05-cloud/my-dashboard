// 인플루언서 매니저(공구 > 일정)에서 공구 일정만 끌어와 Supabase의
// groupbuy_schedule 테이블에 저장하는 Vercel 서버리스 함수입니다.
// 영업팀 워크스페이스의 "일정" 화면이 이 테이블을 읽어서 캘린더로 보여줍니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "sync-groupbuy-schedule.js" 로 저장하세요.
//    최종 경로: api/sync-groupbuy-schedule.js
//
// 필요한 Vercel 환경변수:
//   SUPABASE_SERVICE_ROLE_KEY - 이미 다른 sync 함수들이 쓰고 있는 것과 동일한 키
//   CRON_SECRET               - 이미 다른 sync 함수들이 쓰고 있는 것과 동일한 값
//   IM_USERNAME                - 인플루언서 매니저 로그인 아이디 (영업팀 계정)
//   IM_PASSWORD                - 위 계정의 비밀번호
//
// 수동 테스트 방법 (터미널에서):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/sync-groupbuy-schedule"

const IM_BASE = 'https://influencer-manager-six.vercel.app';
const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';

async function loginToInfluencerManager(name, password) {
  const res = await fetch(`${IM_BASE}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', name, password })
  });
  if (!res.ok) throw new Error(`인플루언서 매니저 로그인 실패 (${res.status})`);
  const setCookie = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('로그인 세션 쿠키를 받지 못했습니다.');
  return cookie;
}

async function loadInfluencerManagerData(cookie) {
  const res = await fetch(`${IM_BASE}/api/data`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`데이터 조회 실패 (${res.status})`);
  return res.json();
}

function codeColor(codes, field, name) {
  const opts = (codes[field] && codes[field].options) || [];
  const hit = opts.find((o) => o.name === name);
  return hit ? hit.color : 'default';
}

// 인플루언서 매니저 store.js의 typeGroupOf()와 동일한 로직 —
// '유형' 옵션 이름을 그룹 키(flagship/sponsor/groupbuy)로 변환합니다.
function typeGroupOf(codes, name) {
  const def = codes['유형'];
  if (!def || !def.groups || !name) return null;
  const opt = (def.options || []).find((o) => o.name === name);
  if (!opt) return null;
  const hit = Object.entries(def.groups).find(([, id]) => id === opt.id);
  return hit ? hit[0] : null;
}

function buildRows(data) {
  const deals = data.deals || [];
  const brandById = new Map((data.brands || []).map((b) => [b.id, b]));
  const influencerById = new Map((data.influencers || []).map((i) => [i.id, i]));
  const codes = data.codes || {};

  return deals
    .filter((d) => typeGroupOf(codes, d.유형) === 'groupbuy')
    .filter((d) => d.공구기간 && d.공구기간.start)
    .map((d) => {
      const b = d.브랜드 ? brandById.get(d.브랜드) : null;
      const inf = d.인플루언서 ? influencerById.get(d.인플루언서) : null;
      const brandName = b ? [b.브랜드사, b.제품명].filter(Boolean).join('_') : null;
      return {
        id: d.id,
        brand_name: brandName,
        brand_company: b ? b.브랜드사 || null : null,
        brand_product: b ? b.제품명 || null : null,
        influencer_name: inf ? inf.이름 || null : null,
        start_date: d.공구기간.start.slice(0, 10),
        end_date: (d.공구기간.end || d.공구기간.start).slice(0, 10),
        commission_rate: typeof d.수수료율 === 'number' ? d.수수료율 : null,
        status: d.상태 || null,
        status_color: d.상태 ? codeColor(codes, '상태', d.상태) : null,
        settlement_method: d.정산방식 || null,
        settlement_method_color: d.정산방식 ? codeColor(codes, '정산방식', d.정산방식) : null,
        department: d.진행부서 || null,
        department_color: d.진행부서 ? codeColor(codes, '진행부서', d.진행부서) : null,
        synced_at: new Date().toISOString()
      };
    });
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// 영업팀이 진행하는 공구 건은 캘린더뿐 아니라 "정산" 목록에도 자동으로 올려준다.
// 이미 같은 인플루언서·기간으로 등록된 정산 건은 건드리지 않는다(수기로 채운 정산액 보존).
function buildSettlementRows(groupbuyRows, existingSettlements) {
  const existingKeys = new Set(
    existingSettlements.map((s) => `${s.partner || ''}|${s.period_start || ''}|${s.period_end || ''}`)
  );
  return groupbuyRows
    .filter((r) => r.department === '영업팀')
    .filter((r) => !existingKeys.has(`${r.influencer_name || ''}|${r.start_date || ''}|${r.end_date || ''}`))
    .map((r) => {
      const pct = typeof r.commission_rate === 'number' ? `${Math.round(r.commission_rate * 100)}%` : '미정';
      const settleMethod = r.settlement_method || '정산방식 미정';
      return {
        category: '공동구매',
        partner: r.influencer_name,
        amount: null,
        period_start: r.start_date,
        period_end: r.end_date,
        settlement_date: r.end_date ? addDays(r.end_date, 14) : null,
        status: '대기',
        memo: `${r.brand_product || ''} · 수수료 ${pct} · ${settleMethod} · ${r.start_date}~${r.end_date}`
      };
    });
}

async function supabaseRest(path, options, serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(options && options.headers)
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase 요청 실패 (${res.status}): ${body}`);
  }
  return res;
}

module.exports = async function handler(req, res) {
  // Vercel Cron이 자동으로 붙여주는 Authorization 헤더 검증 (수동 호출 시에도 동일하게 필요)
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const imUsername = process.env.IM_USERNAME;
  const imPassword = process.env.IM_PASSWORD;
  if (!supabaseServiceKey || !imUsername || !imPassword) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: 'SUPABASE_SERVICE_ROLE_KEY / IM_USERNAME / IM_PASSWORD 가 설정돼 있는지 확인하세요.'
    });
  }

  try {
    const cookie = await loginToInfluencerManager(imUsername, imPassword);
    const data = await loadInfluencerManagerData(cookie);
    const rows = buildRows(data);

    if (rows.length) {
      await supabaseRest(
        'groupbuy_schedule',
        { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(rows) },
        supabaseServiceKey
      );
    }

    // 인플루언서 매니저에서 삭제되었거나 더 이상 공구가 아니게 된 건은 여기서도 지웁니다.
    const existingRes = await supabaseRest('groupbuy_schedule?select=id', { method: 'GET' }, supabaseServiceKey);
    const existing = await existingRes.json();
    const currentIds = new Set(rows.map((r) => r.id));
    const toDelete = existing.map((r) => r.id).filter((id) => !currentIds.has(id));
    if (toDelete.length) {
      const filter = toDelete.map((id) => encodeURIComponent(id)).join(',');
      await supabaseRest(`groupbuy_schedule?id=in.(${filter})`, { method: 'DELETE' }, supabaseServiceKey);
    }

    // 영업팀 공구 건을 정산 목록에도 자동으로 추가 (이미 있는 건은 건드리지 않음)
    const settlementsRes = await supabaseRest('settlements?select=partner,period_start,period_end', { method: 'GET' }, supabaseServiceKey);
    const existingSettlements = await settlementsRes.json();
    const newSettlements = buildSettlementRows(rows, existingSettlements);
    if (newSettlements.length) {
      await supabaseRest('settlements', { method: 'POST', body: JSON.stringify(newSettlements) }, supabaseServiceKey);
    }

    return res.status(200).json({ ok: true, updated: rows.length, deleted: toDelete.length, settlementsAdded: newSettlements.length });
  } catch (err) {
    return res.status(500).json({ error: 'sync_failed', detail: String(err && err.message || err) });
  }
};

/* ===========================================================================
   영업계획실행보드 — 팀 대시보드(tasks.html)와 실시간 매출(live-sales.html)이
   같이 쓰는 한 벌입니다. 두 화면에서 같은 날짜·상품의 계획을 열고 고칩니다.

   쓰는 표 (sales_plan.sql 로 만듭니다)
     sales_plans         상품 하나의 하루치 계획 — 쿠팡 운영안 · 네이버 판매안 · 검증
     sales_period_plans  주간 · 월간 · 익월 · 분기 기획안

   읽어 쓰는 기존 자료
     sales_daily_rollup  전일 확정 매출 (채널 = 판매처 이름 앞글자로 가름)
     live_sales_totals   당일 실시간 몰별 합계
     live_sales_items    상품별 매출 · 수량
     live_product_meta   네이버쇼핑 순위 · 노출가 · 리뷰

   붙이는 법
     <script src="sales-plan.js"></script> 를 넣고 SalesPlan.init(supabaseClient).
     팀 대시보드는 SalesPlan.mountBoard(el) 로 보드를 그립니다.
     어느 화면에서든 SalesPlan.open({date, product}) 로 작성 패널이 열립니다.
   =========================================================================== */
(function () {
  'use strict';

  let db = null;                 // supabase 클라이언트 (페이지가 넘겨줍니다)
  const seeds = {};              // '날짜|상품' → 그 화면이 미리 구해 둔 매출 근거
  let boardEl = null;            // 보드를 그릴 자리 (팀 대시보드)
  let tab = 'today';             // today | week | month | next | quarter
  let boardDate = '';            // 보드가 보고 있는 날짜
  let showAll = false;           // 집중 상품 3개만 / 전체
  let plans = [];                // 그 날짜의 판매계획
  let totals = null;             // 위쪽 매출 띠에 쓸 숫자
  let periodCache = {};          // '종류|기간' → 기획안 한 줄
  let afterSave = null;          // 저장 뒤 부를 함수 (화면마다 다름)

  // ---- 작은 도구들 -------------------------------------------------------
  const kst = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const won = (n) => Math.round(Number(n) || 0).toLocaleString('ko-KR');
  const man = (n) => Math.round((Number(n) || 0) / 1e4).toLocaleString('ko-KR') + '만';
  const addDays = (s, n) => {
    const d = new Date(s + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const el = (id) => document.getElementById(id);
  // 값이 없으면 '미수집' — 수집이 안 된 것과 0원을 구분해서 적습니다.
  const orNone = (v, f) => (v == null || v === '' ? '<span class="sp-na">미수집</span>' : (f ? f(v) : esc(v)));

  // 주차 — 월요일에 시작하고, 1일이 낀 주가 그 달의 1주차입니다(대시보드 기준).
  function weekNoOfMonth(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const firstMonday = Date.UTC(y, m - 1, 1 - ((firstDow + 6) % 7));
    return Math.floor((Date.UTC(y, m - 1, d) - firstMonday) / 604800000) + 1;
  }
  function periodKeyOf(kind, date) {
    const ym = date.slice(0, 7);
    const [y, m] = ym.split('-').map(Number);
    if (kind === 'week') return ym + '-W' + weekNoOfMonth(date);
    if (kind === 'month') return ym;
    if (kind === 'next') return m === 12 ? (y + 1) + '-01' : ym.slice(0, 5) + String(m + 1).padStart(2, '0');
    if (kind === 'quarter') return y + '-Q' + Math.ceil(m / 3);
    return ym;
  }

  // 판매처 이름으로 채널을 가릅니다.
  // 매출DB에는 '쿠팡(로켓그로스)' · '쿠팡(셀플로우)' · '쿠팡(법인)',
  // 네이버는 '스토어팜(코드니처)' 처럼 스토어별로 쪼개져 들어옵니다.
  // (브랜드 이름만 있는 '코드니처' 같은 줄은 자사몰이라 채널에 넣지 않습니다)
  function channelOf(vendor) {
    const v = String(vendor || '');
    if (v.indexOf('쿠팡') === 0) return '쿠팡';
    if (v.indexOf('스토어팜') === 0 || v.indexOf('스마트스토어') === 0) return '네이버';
    return '';
  }

  // =========================================================================
  // 자료 읽기
  // =========================================================================

  // 서버가 한 번에 1000줄까지만 주므로 나눠 받습니다.
  // 정렬을 정해두지 않으면 쪽이 넘어갈 때 줄이 겹치거나 빠져 합계가 틀립니다.
  const PAGE = 1000;
  async function allRows(make) {
    const out = [];
    for (let i = 0; i < 20; i++) {
      const { data, error } = await make().range(i * PAGE, (i + 1) * PAGE - 1);
      if (error) return { data: out, error };
      out.push(...(data || []));
      if ((data || []).length < PAGE) break;
    }
    return { data: out, error: null };
  }

  // 위쪽 매출 띠 — 전일 확정 · 최근 7일 추이 · 당일 실시간.
  // 확정과 실시간은 섞지 않습니다. 당일 숫자를 확정 매출로 적으면 안 됩니다.
  async function loadTotals(date) {
    const from = addDays(date, -7);
    const [roll, live] = await Promise.all([
      // 쿠팡·네이버 줄만 받습니다 (매출DB에는 자사몰·공구까지 다 들어 있어 8일이면 1000줄을 넘습니다)
      allRows(() => db.from('sales_daily_rollup').select('sale_date,vendor,amount')
        .gte('sale_date', from).lte('sale_date', date)
        .or('vendor.like.쿠팡*,vendor.like.스토어팜*,vendor.like.스마트스토어*')
        .order('sale_date').order('vendor').order('brand').order('product_name')),
      db.from('live_sales_totals').select('date,mall,amount,collected_at').gte('date', from).lte('date', date),
    ]);
    const byDay = {};            // 날짜 → {쿠팡, 네이버}
    (roll.data || []).forEach((r) => {
      const c = channelOf(r.vendor);
      if (!c) return;
      (byDay[r.sale_date] ||= { 쿠팡: 0, 네이버: 0 })[c] += Number(r.amount || 0);
    });
    const days = Object.keys(byDay).sort();
    const lastDay = days[days.length - 1] || '';
    const liveRows = (live.data || []).filter((r) => r.date === date);
    const liveBy = { 쿠팡: 0, 네이버: 0, 그외: 0 };
    liveRows.forEach((r) => {
      if (r.mall === '쿠팡' || r.mall === '네이버') liveBy[r.mall] += Number(r.amount || 0);
      else liveBy.그외 += Number(r.amount || 0);
    });
    return {
      lastDay,
      last: byDay[lastDay] || null,
      live: liveRows.length ? liveBy : null,
      liveAt: liveRows.map((r) => r.collected_at).filter(Boolean).sort().pop() || '',
      isToday: date === kst(),
      err: (roll.error || live.error) ? (roll.error || live.error).message : '',
    };
  }

  let tableMissing = '';     // 표가 아직 없으면 그 까닭을 적어 둡니다
  async function loadPlans(date) {
    const { data, error } = await db.from('sales_plans').select('*').eq('plan_date', date)
      .order('focus', { ascending: false }).order('focus_rank').order('id');
    if (error) {
      tableMissing = error.message;
      console.warn('[판매계획]', error.message);
      return [];
    }
    tableMissing = '';
    return data || [];
  }

  // 상품 고르는 칸에 넣을 목록 — 그날 실제로 팔린 상품을 쿠팡 매출 높은 순으로.
  async function loadProducts(date) {
    const { data } = await db.from('live_sales_items').select('mall,product,amount,qty').eq('date', date);
    const by = {};
    (data || []).forEach((r) => {
      const base = String(r.product || '').split(',')[0].trim();
      if (!base) return;
      const o = (by[base] ||= { product: base, cp: 0, nv: 0, cpQty: 0, nvQty: 0 });
      if (r.mall === '쿠팡') { o.cp += Number(r.amount || 0); o.cpQty += Number(r.qty || 0); }
      if (r.mall === '네이버') { o.nv += Number(r.amount || 0); o.nvQty += Number(r.qty || 0); }
    });
    return Object.values(by).sort((a, b) => b.cp - a.cp);
  }

  // 상품 하나의 매출 근거를 모아 옵니다 (그 화면이 미리 넘겨준 게 있으면 그것부터).
  async function gatherSeed(date, product) {
    const given = seeds[date + '|' + product];
    if (given) return given;
    const list = await loadProducts(date);
    const hit = list.find((x) => x.product === product)
      || list.find((x) => product.indexOf(x.product) >= 0 || x.product.indexOf(product) >= 0);
    const { data: meta } = await db.from('live_product_meta').select('*').eq('product', product);
    const nv = (meta || []).find((m) => m.mall === '네이버쇼핑');
    const cp = (meta || []).find((m) => m.mall === '쿠팡');
    const cs = (meta || []).find((m) => m.mall === '쿠팡검색');
    return {
      cp_sales: hit ? hit.cp : null,
      nv_sales: hit ? hit.nv : null,
      cp_qty: hit ? hit.cpQty : null,
      nv_qty: hit ? hit.nvQty : null,
      nv_rank: nv ? nv.rank : null,
      nv_rank_kind: nv ? rankKind(nv) : null,
      nv_query: nv ? nv.query : null,
      nv_price: nv ? nv.price : null,
      cp_price: cs ? cs.price : null,
      low_price: nv ? nv.low_price : null,
      low_store: nv ? nv.low_store : null,
      cp_review: cp ? cp.review_count : null,
      nv_review: nv ? nv.review_count : null,
    };
  }

  // 브랜드를 붙여야 나오는 순위는 따로 적습니다 — 일반 검색에서는 안 잡힌다는 뜻이라서요.
  const BRANDS = /^(코드니처|슬로우케어|빠이러스|미니멀룸|잠비에|명퉤|그로우뮤즈|글로리핏|멜루션|라이프스타일마트)\s/;
  function rankKind(nv) {
    if (!nv) return null;
    if (nv.rank && BRANDS.test(nv.query || '')) return '브랜드';
    if (nv.rank) return '일반';
    if (nv.ad_only) return '광고만';
    return '미노출';
  }

  // =========================================================================
  // 꾸밈
  // =========================================================================
  function injectCss() {
    if (el('spCss')) return;
    const s = document.createElement('style');
    s.id = 'spCss';
    s.textContent = `
.sp-wrap { font-family: inherit; }
.sp-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.sp-head h2 { margin: 0; font-size: 16px; font-weight: 800; color: #0f172a; }
.sp-tabs { display: inline-flex; gap: 4px; background: #f1f5f9; border-radius: 999px; padding: 3px; }
.sp-tab { border: 0; background: transparent; border-radius: 999px; padding: 6px 14px; cursor: pointer;
  font-family: inherit; font-size: 12.5px; font-weight: 700; color: #64748b; }
.sp-tab.on { background: #fff; color: #1d4ed8; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
.sp-right { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.sp-btn { border: 1px solid #cfdcf4; border-radius: 8px; background: #fff; color: #2f5ce4;
  font-family: inherit; font-size: 12.5px; font-weight: 700; padding: 6px 12px; cursor: pointer; }
.sp-btn:hover { background: #f3f7ff; }
.sp-btn.main { background: #2f5ce4; border-color: #2f5ce4; color: #fff; }
.sp-btn.main:hover { background: #2449c0; }
.sp-btn.ghost { border-color: #e2e8f0; color: #64748b; }
.sp-btn.danger { border-color: #fecaca; color: #dc2626; }
.sp-date { border: 1px solid #dbe3ef; border-radius: 8px; padding: 5px 9px; font-family: inherit; font-size: 12.5px; }

/* 위쪽 매출 띠 */
.sp-strip { display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch; margin-bottom: 14px; }
.sp-card { flex: 1 1 200px; border: 1px solid #e8edf6; border-radius: 10px; padding: 10px 14px; background: #fbfcfe; }
.sp-card .k { font-size: 11.5px; font-weight: 800; color: #94a3b8; }
.sp-card .v { font-size: 17px; font-weight: 800; color: #0f172a; margin-top: 3px; }
.sp-card .s { font-size: 11.5px; font-weight: 700; color: #94a3b8; margin-top: 2px; }
.sp-card .cp { color: #c2410c; } .sp-card .nv { color: #15803d; }

/* 상품표 */
.sp-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.sp-tbl th { text-align: left; padding: 8px 10px; background: #f6f8fc; color: #64748b;
  font-size: 11.5px; font-weight: 800; border-bottom: 1px solid #e8edf6; white-space: nowrap; }
.sp-tbl td { padding: 10px; border-bottom: 1px solid #eef2f8; vertical-align: top; line-height: 1.55; color: #334155; }
.sp-tbl tr:hover td { background: #fcfdff; }
.sp-tbl td.cp { background: #fffaf5; } .sp-tbl tr:hover td.cp { background: #fff5ec; }
.sp-tbl td.nv { background: #f7fdf9; } .sp-tbl tr:hover td.nv { background: #effaf3; }
.sp-name { font-size: 13px; font-weight: 800; color: #0f172a; cursor: pointer; }
.sp-name:hover { color: #2f5ce4; }
.sp-why { margin-top: 4px; color: #64748b; font-size: 11.5px; white-space: pre-wrap; }
.sp-nums { margin-top: 5px; display: flex; gap: 6px; flex-wrap: wrap; }
.sp-chip { border-radius: 999px; padding: 1px 7px; font-size: 10.5px; font-weight: 800; background: #f1f5f9; color: #475569; }
.sp-chip.cp { background: #ffedd5; color: #9a3412; }
.sp-chip.nv { background: #dcfce7; color: #166534; }
.sp-chip.rk { background: #e0e7ff; color: #3730a3; }
.sp-chip.br { background: #fef9c3; color: #854d0e; }
.sp-na { color: #b6c0d0; font-weight: 700; }
.sp-lbl { font-size: 10.5px; font-weight: 800; color: #94a3b8; display: block; }
.sp-txt { white-space: pre-wrap; }
.sp-focus { display: inline-block; width: 18px; height: 18px; line-height: 17px; text-align: center;
  border-radius: 6px; background: #2f5ce4; color: #fff; font-size: 10.5px; font-weight: 800; margin-right: 6px; }
.sp-empty { padding: 26px 10px; text-align: center; color: #94a3b8; font-size: 12.5px; }
.sp-state { display: inline-block; border-radius: 999px; padding: 1px 8px; font-size: 10.5px; font-weight: 800; }
.sp-state.작성 { background: #e2e8f0; color: #475569; }
.sp-state.검증중 { background: #dbeafe; color: #1d4ed8; }
.sp-state.완료 { background: #dcfce7; color: #166534; }
.sp-state.중단 { background: #fee2e2; color: #b91c1c; }

/* 작성 패널 */
.sp-mask { position: fixed; inset: 0; background: rgba(15,23,42,.45); z-index: 9000;
  display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 24px 16px; }
.sp-modal { background: #fff; border-radius: 14px; width: min(980px, 100%); box-shadow: 0 24px 64px rgba(15,23,42,.3); }
.sp-modal-head { display: flex; align-items: center; gap: 10px; padding: 16px 20px; border-bottom: 1px solid #eef2f8; }
.sp-modal-head h3 { margin: 0; font-size: 15px; font-weight: 800; color: #0f172a; }
.sp-modal-body { padding: 16px 20px; }
.sp-modal-foot { display: flex; gap: 8px; align-items: center; padding: 14px 20px; border-top: 1px solid #eef2f8; }
.sp-sec { margin-bottom: 16px; }
.sp-sec > h4 { margin: 0 0 7px; font-size: 12px; font-weight: 800; color: #475569; }
.sp-sec > h4 small { font-weight: 700; color: #a8b2c4; margin-left: 6px; }
.sp-two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.sp-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.sp-f { display: block; margin-bottom: 8px; }
.sp-f span { display: block; font-size: 11px; font-weight: 800; color: #94a3b8; margin-bottom: 3px; }
.sp-modal input[type=text], .sp-modal input[type=date], .sp-modal select, .sp-modal textarea {
  width: 100%; box-sizing: border-box; border: 1px solid #dbe3ef; border-radius: 8px; padding: 8px 10px;
  font-family: inherit; font-size: 13px; color: #0f172a; background: #fff; }
.sp-modal textarea { min-height: 62px; resize: vertical; line-height: 1.6; }
.sp-modal input:focus, .sp-modal select:focus, .sp-modal textarea:focus { outline: none; border-color: #4d7cfe; }
.sp-seed { display: flex; gap: 6px; flex-wrap: wrap; padding: 9px 11px; background: #f8fafc;
  border: 1px solid #eef2f8; border-radius: 9px; font-size: 11.5px; }
.sp-seed b { color: #0f172a; }
.sp-pick { display: inline-flex; gap: 4px; }
.sp-pick button { border: 1px solid #dbe3ef; background: #fff; border-radius: 999px; padding: 5px 11px;
  font-family: inherit; font-size: 11.5px; font-weight: 700; color: #64748b; cursor: pointer; }
.sp-pick button.on { background: #eef3ff; border-color: #4d7cfe; color: #1d4ed8; }
.sp-msg { margin-left: auto; font-size: 12px; font-weight: 700; color: #16a34a; }
.sp-msg.bad { color: #dc2626; }

/* 기간 기획안 */
/* 주차 고르는 줄 */
.sp-weekbar { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-bottom: 14px;
  padding-bottom: 12px; border-bottom: 1px solid #eef2f8; }
.sp-weekbar > b { font-size: 13px; font-weight: 800; color: #0f172a; margin: 0 4px; }
.sp-week { position: relative; border: 1px solid #dbe3ef; background: #fff; border-radius: 10px;
  padding: 6px 13px; cursor: pointer; font-family: inherit; font-size: 12.5px; font-weight: 800;
  color: #475569; line-height: 1.25; text-align: left; }
.sp-week small { display: block; font-size: 10.5px; font-weight: 700; color: #a8b2c4; margin-top: 1px; }
.sp-week:hover { border-color: #b9c7e4; background: #f8fbff; }
.sp-week.on { border-color: #2f5ce4; background: #eef3ff; color: #1d4ed8; box-shadow: 0 0 0 3px rgba(77,124,254,.12); }
.sp-week.on small { color: #5b7fe0; }
/* 이미 써 둔 주차 */
.sp-week.has::after { content: ''; position: absolute; top: 6px; right: 7px;
  width: 6px; height: 6px; border-radius: 50%; background: #16a34a; }
.sp-week i.now { display: block; font-style: normal; font-size: 9.5px; font-weight: 800; color: #16a34a; margin-top: 2px; }

.sp-period { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.sp-period .sp-f.wide { grid-column: 1 / -1; }
.sp-period .sp-f { margin-bottom: 0; }
.sp-period .sp-f span { font-size: 11.5px; font-weight: 800; color: #64748b; margin-bottom: 5px; }
/* 보드에 있는 칸이라 작성 패널(.sp-modal) 규칙이 닿지 않습니다 — 여기서 따로 줍니다. */
.sp-period textarea {
  width: 100%; box-sizing: border-box; display: block;
  border: 1px solid #dbe3ef; border-radius: 9px; padding: 9px 11px;
  font-family: inherit; font-size: 13px; line-height: 1.65; color: #0f172a; background: #fff;
  min-height: 86px; resize: vertical;
}
.sp-period .sp-f.wide textarea { min-height: 72px; }
.sp-period textarea:focus { outline: none; border-color: #4d7cfe; box-shadow: 0 0 0 3px rgba(77,124,254,.12); }
.sp-period textarea::placeholder { color: #c3cbd9; }
/* 메타 상품이 18줄쯤 들어가므로 이 칸만 더 높입니다. */
.sp-f.has-meta textarea { min-height: 112px; }
.sp-meta { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
.sp-meta-t { width: 100%; font-size: 11.5px; color: #64748b; font-weight: 700; display: flex; align-items: center; gap: 7px; }
.sp-meta-chip { border: 1px solid #dbe3ef; background: #f8fafc; border-radius: 999px; padding: 3px 10px;
  font-size: 11.5px; font-weight: 700; color: #334155; cursor: pointer; font-family: inherit; }
.sp-meta-chip:hover { border-color: #4d7cfe; color: #1d4ed8; background: #eef4ff; }
.sp-meta-chip i { font-style: normal; color: #94a3b8; font-weight: 600; margin-left: 3px; }
.sp-linked { border: 1px solid #e8edf6; border-radius: 10px; padding: 10px 12px; background: #fbfcfe; }
.sp-link-row { padding: 7px 0; border-bottom: 1px dashed #e8edf6; font-size: 12px; }
.sp-link-row:last-child { border-bottom: 0; }
.sp-link-row b { color: #0f172a; }
.sp-link-row .d { color: #64748b; margin-top: 2px; }
.sp-link-pick { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.sp-link-pick label { display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px;
  font-weight: 700; color: #475569; background: #fff; border: 1px solid #dbe3ef;
  border-radius: 999px; padding: 4px 10px; cursor: pointer; }
@media (max-width: 900px) { .sp-two, .sp-period { grid-template-columns: 1fr; } }
`;
    document.head.appendChild(s);
  }

  // =========================================================================
  // 보드 (팀 대시보드)
  // =========================================================================
  function mountBoard(node) {
    injectCss();
    boardEl = node;
    if (!boardDate) boardDate = kst();
    node.classList.add('sp-wrap');
    render();
  }

  async function render() {
    if (!boardEl) return;
    boardEl.innerHTML = headHtml() + '<div id="spBody"><div class="sp-empty">불러오는 중…</div></div>';
    if (tab === 'today') {
      const [t, p] = await Promise.all([loadTotals(boardDate), loadPlans(boardDate)]);
      totals = t; plans = p;
      if (el('spBody')) el('spBody').innerHTML = stripHtml() + planTableHtml();
    } else if (tab === 'week') {
      // 주간은 그 달의 주차를 모두 늘어놓고 골라 씁니다.
      const ym = boardDate.slice(0, 7);
      if (!weekSel || weekSel.slice(0, 7) !== ym) weekSel = periodKeyOf('week', boardDate);
      const [row, saved] = await Promise.all([loadPeriod('week', weekSel), savedWeeks(ym)]);
      if (el('spBody')) el('spBody').innerHTML = weekBarHtml(ym, saved) + periodHtml('week', row);
    } else {
      const row = await loadPeriod(tab, periodKeyOf(tab, boardDate));
      if (el('spBody')) el('spBody').innerHTML = periodHtml(tab, row);
    }
  }

  // ---- 주차 고르기 ----------------------------------------------------
  let weekSel = '';          // 지금 보고 있는 주차 ('2026-11-W5')

  // 그 달에 몇 주가 있는지 — 1일이 낀 주가 1주차입니다.
  // 달을 걸치는 마지막 주(예: 11/30~12/6)는 다음 달 1일이 들어 있으니 다음 달 1주차로 넘깁니다.
  // 그러지 않으면 같은 7일이 「11월 6주차」와 「12월 1주차」 두 군데에 생깁니다.
  function weeksOfMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    const last = String(new Date(y, m, 0).getDate()).padStart(2, '0');
    const n = weekNoOfMonth(ym + '-' + last);
    const nextFirst = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const out = [];
    for (let w = 1; w <= n; w++) {
      const period = ym + '-W' + w;
      const [from, to] = periodRange('week', period);
      if (from <= nextFirst && nextFirst <= to) break;   // 다음 달 1주차입니다
      out.push({ no: w, period, from, to });
    }
    return out;
  }

  // 이미 써 둔 주차에는 점을 찍어 둡니다.
  async function savedWeeks(ym) {
    const { data } = await db.from('sales_period_plans').select('period')
      .eq('kind', 'week').like('period', ym + '-W%');
    return new Set((data || []).map((r) => r.period));
  }

  function weekBarHtml(ym, saved) {
    const md = (s) => Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10));
    const thisWeek = periodKeyOf('week', kst());
    return `
      <div class="sp-weekbar">
        <button type="button" class="sp-btn ghost" onclick="SalesPlan.month(-1)">‹ 지난달</button>
        <b>${esc(ym.replace('-', '년 '))}월</b>
        ${weeksOfMonth(ym).map((w) => `
          <button type="button" class="sp-week${w.period === weekSel ? ' on' : ''}${saved.has(w.period) ? ' has' : ''}"
            onclick="SalesPlan.week('${w.period}')"
            title="${w.from} ~ ${w.to}${saved.has(w.period) ? ' · 써 둔 기획안 있음' : ''}">
            ${w.no}주차<small>${md(w.from)}~${md(w.to)}</small>
            ${w.period === thisWeek ? '<i class="now">이번 주</i>' : ''}
          </button>`).join('')}
        <button type="button" class="sp-btn ghost" onclick="SalesPlan.month(1)">다음달 ›</button>
      </div>`;
  }

  const TABS = [['today', '오늘'], ['week', '주간'], ['month', '월간'], ['next', '익월'], ['quarter', '분기']];

  function headHtml() {
    return `
      <div class="sp-head">
        <h2>영업계획실행보드</h2>
        <span class="sp-tabs">
          ${TABS.map(([k, v]) => `<button type="button" class="sp-tab${tab === k ? ' on' : ''}"
            onclick="SalesPlan.tab('${k}')">${v}</button>`).join('')}
        </span>
        <span class="sp-right">
          <input type="date" class="sp-date" value="${esc(boardDate)}" onchange="SalesPlan.date(this.value)">
          ${tab === 'today' ? `
            <button type="button" class="sp-btn ghost" onclick="SalesPlan.toggleAll()">${showAll ? '집중 상품만' : '전체 보기'}</button>
            <button type="button" class="sp-btn ghost" onclick="SalesPlan.copyBrief()">아침 보고 복사</button>
            <button type="button" class="sp-btn main" onclick="SalesPlan.open({})">판매계획 작성</button>` : ''}
        </span>
      </div>`;
  }

  // 위쪽 매출 띠 — 전일 확정 / 7일 추이 / 당일 실시간을 따로 적습니다.
  function stripHtml() {
    if (!totals) return '';
    if (totals.err) return `<div class="sp-strip"><div class="sp-card"><div class="k">매출</div><div class="v">못 읽었습니다</div><div class="s">${esc(totals.err)}</div></div></div>`;
    const L = totals.last;
    const liveTime = totals.liveAt
      ? new Date(totals.liveAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
      : '';
    return `
      <div class="sp-strip">
        <div class="sp-card">
          <div class="k">전일 확정 매출</div>
          <div class="v">${L ? `<span class="cp">쿠팡 ${man(L.쿠팡)}</span> · <span class="nv">네이버 ${man(L.네이버)}</span>` : '<span class="sp-na">미수집</span>'}</div>
          <div class="s">${L ? '집계 기준일 ' + esc(totals.lastDay) + ' · 매출DB 확정' : '아직 들어온 매출DB가 없습니다'}</div>
        </div>
        <div class="sp-card">
          <div class="k">${esc(boardDate)} 실시간 매출</div>
          <div class="v">${totals.live
            ? `<span class="cp">쿠팡 ${man(totals.live.쿠팡)}</span> · <span class="nv">네이버 ${man(totals.live.네이버)}</span>`
            : '<span class="sp-na">미수집</span>'}</div>
          <div class="s">${totals.live
            ? (liveTime ? liveTime + ' 기준 · 아직 확정 아님' : '아직 확정 아님')
            : '실시간 수집 전'}</div>
        </div>
      </div>`;
  }

  function planTableHtml() {
    const list = showAll ? plans : plans.filter((p) => p.focus).slice(0, 3);
    const n = plans.filter((p) => p.focus).length;
    if (tableMissing) {
      return `<div class="sp-empty" style="color:#b45309">판매계획을 담을 표가 아직 없습니다.
        <br>Supabase 프로젝트 대시보드 &gt; SQL Editor 에서 <b>sales_plan.sql</b> 을 실행해주세요.
        <br><br><small style="color:#94a3b8">${esc(tableMissing)}</small></div>`;
    }
    if (!plans.length) {
      return `<div class="sp-empty">${esc(boardDate)} 에 세운 판매계획이 없습니다.
        <br><br><button type="button" class="sp-btn main" onclick="SalesPlan.open({})">판매계획 작성</button></div>`;
    }
    if (!list.length) {
      return `<div class="sp-empty">집중 상품으로 고른 계획이 없습니다. 「전체 보기」로 ${plans.length}건을 볼 수 있습니다.</div>`;
    }
    return `
      <div style="overflow:auto">
      <table class="sp-tbl">
        <thead><tr>
          <th style="width:26%">상품 · 매출 근거</th>
          <th style="width:24%">쿠팡 운영안</th>
          <th style="width:28%">네이버 판매안</th>
          <th style="width:22%">검증 기준</th>
        </tr></thead>
        <tbody>${list.map(rowHtml).join('')}</tbody>
      </table></div>
      <div class="sp-head" style="margin:10px 0 0">
        <span style="font-size:11.5px;font-weight:700;color:#94a3b8">
          집중 상품 ${n}건 · 전체 ${plans.length}건${showAll ? '' : ' · 집중 상품만 보는 중'}</span>
      </div>`;
  }

  function rowHtml(p) {
    const rk = p.nv_rank
      ? `<span class="sp-chip ${p.nv_rank_kind === '브랜드' ? 'br' : 'rk'}">${p.nv_rank_kind === '브랜드' ? '브랜드 검색 ' : ''}${p.nv_rank}위</span>`
      : (p.nv_rank_kind ? `<span class="sp-chip">${esc(p.nv_rank_kind)}</span>` : '');
    // 채널 매출 비율 — 쿠팡이 0원이면 나눌 수가 없습니다.
    const ratio = (p.cp_sales == null || p.nv_sales == null) ? '<span class="sp-na">미수집</span>'
      : (!(Number(p.cp_sales) > 0) ? '<span class="sp-na">산출 불가</span>'
        : Math.round(Number(p.nv_sales) / Number(p.cp_sales) * 100) + '%');
    return `
      <tr>
        <td>
          ${p.focus ? `<span class="sp-focus">${p.focus_rank || '★'}</span>` : ''}
          <span class="sp-name" onclick="SalesPlan.open({id:${p.id}})">${esc(p.product)}</span>
          <div class="sp-nums">
            <span class="sp-chip cp">쿠팡 ${p.cp_sales == null ? '미수집' : man(p.cp_sales)}</span>
            <span class="sp-chip nv">네이버 ${p.nv_sales == null ? '미수집' : man(p.nv_sales)}</span>
            ${p.nv_set_sales ? `<span class="sp-chip nv">세트 안분 ${man(p.nv_set_sales)}</span>` : ''}
            <span class="sp-chip">채널 매출 비율 ${ratio}</span>
            ${rk}
          </div>
          ${p.evidence ? `<div class="sp-why">${esc(p.evidence)}</div>` : ''}
        </td>
        <td class="cp"><div class="sp-txt">${p.cp_plan ? esc(p.cp_plan) : '<span class="sp-na">아직 없음</span>'}</div></td>
        <td class="nv">
          ${p.nv_issue && p.nv_issue !== '미정' ? `<span class="sp-chip nv">${esc(p.nv_issue)}</span>` : ''}
          ${p.nv_fact ? `<div style="margin-top:4px"><span class="sp-lbl">확인된 사실</span><span class="sp-txt">${esc(p.nv_fact)}</span></div>` : ''}
          ${p.nv_cause ? `<div style="margin-top:4px"><span class="sp-lbl">원인 가설</span><span class="sp-txt">${esc(p.nv_cause)}</span></div>` : ''}
          ${p.nv_action ? `<div style="margin-top:4px"><span class="sp-lbl">실행할 변경</span><span class="sp-txt">${esc(p.nv_action)}</span></div>` : ''}
          ${!p.nv_fact && !p.nv_cause && !p.nv_action ? '<span class="sp-na">아직 없음</span>' : ''}
        </td>
        <td>
          <span class="sp-state ${esc(p.status || '작성')}">${esc(p.status || '작성')}</span>
          ${p.metric ? `<div style="margin-top:5px"><span class="sp-lbl">지표</span><span class="sp-txt">${esc(p.metric)}</span></div>` : ''}
          ${p.success ? `<div style="margin-top:4px"><span class="sp-lbl">성공 기준</span><span class="sp-txt">${esc(p.success)}</span></div>` : ''}
          ${p.check_until ? `<div style="margin-top:4px"><span class="sp-lbl">검증 기간</span>${esc(p.check_until)} 까지</div>` : ''}
          ${p.result ? `<div style="margin-top:4px"><span class="sp-lbl">실행 결과</span><span class="sp-txt">${esc(p.result)}</span></div>` : ''}
          ${p.decision ? `<div style="margin-top:4px"><span class="sp-lbl">다음 판단</span><span class="sp-txt">${esc(p.decision)}</span></div>` : ''}
          ${p.review_on ? `<div style="margin-top:4px"><span class="sp-lbl">재검토일</span>${esc(p.review_on)}</div>` : ''}
        </td>
      </tr>`;
  }

  // =========================================================================
  // 작성 패널 — 두 화면에서 똑같이 씁니다
  // =========================================================================
  let editing = null;      // 지금 고치고 있는 계획

  async function open(opts) {
    injectCss();
    const o = opts || {};
    const date = o.date || boardDate || kst();
    afterSave = o.onSaved || null;

    let row = null;
    if (o.id) {
      const { data } = await db.from('sales_plans').select('*').eq('id', o.id).limit(1);
      row = (data || [])[0] || null;
    } else if (o.product) {
      const { data } = await db.from('sales_plans').select('*')
        .eq('plan_date', date).eq('product', o.product).limit(1);
      row = (data || [])[0] || null;
    }
    const product = row ? row.product : (o.product || '');
    const seed = row ? null : (product ? await gatherSeed(date, product) : null);
    const picks = await loadProducts(date);
    editing = row || Object.assign({ plan_date: date, product, status: '작성', nv_issue: '미정' }, seed || {});
    if (o.seed && !row) Object.assign(editing, o.seed);
    showModal(picks);
  }

  function showModal(picks) {
    closeModal();
    const p = editing;
    const isNew = !p.id;
    const mask = document.createElement('div');
    mask.className = 'sp-mask';
    mask.id = 'spMask';
    mask.onclick = (e) => { if (e.target === mask) closeModal(); };
    const f = (k, label, type) => `
      <label class="sp-f"><span>${label}</span>
        ${type === 'area'
          ? `<textarea id="sp_${k}">${esc(p[k] || '')}</textarea>`
          : `<input type="${type || 'text'}" id="sp_${k}" value="${esc(p[k] || '')}">`}
      </label>`;
    const ratio = (p.cp_sales == null || p.nv_sales == null) ? '미수집'
      : (!(Number(p.cp_sales) > 0) ? '산출 불가' : Math.round(Number(p.nv_sales) / Number(p.cp_sales) * 100) + '%');
    mask.innerHTML = `
      <div class="sp-modal">
        <div class="sp-modal-head">
          <h3>${isNew ? '판매계획 작성' : '판매계획 수정'}</h3>
          <span style="font-size:12px;font-weight:700;color:#94a3b8">${esc(p.plan_date)}</span>
          <span class="sp-right"><button type="button" class="sp-btn ghost" onclick="SalesPlan.close()">닫기</button></span>
        </div>
        <div class="sp-modal-body">
          <div class="sp-sec">
            <h4>상품</h4>
            ${isNew ? `
              <select id="sp_pick" onchange="SalesPlan.pickProduct(this.value)">
                <option value="">— 그날 팔린 상품에서 고르기 —</option>
                ${picks.map((x) => `<option value="${esc(x.product)}" ${x.product === p.product ? 'selected' : ''}>${esc(x.product)} · 쿠팡 ${man(x.cp)}</option>`).join('')}
              </select>
              <div style="height:6px"></div>` : ''}
            <input type="text" id="sp_product" value="${esc(p.product || '')}" placeholder="상품명">
          </div>

          <div class="sp-sec">
            <h4>매출 근거 <small>계획을 세운 시점의 숫자를 그대로 적어 둡니다</small></h4>
            <div class="sp-seed">
              <span>쿠팡 <b>${p.cp_sales == null ? '미수집' : won(p.cp_sales) + '원'}</b></span>
              <span>· 네이버 <b>${p.nv_sales == null ? '미수집' : won(p.nv_sales) + '원'}</b></span>
              ${p.nv_set_sales ? `<span>(세트 안분 <b>${won(p.nv_set_sales)}원</b>)</span>` : ''}
              <span>· 채널 매출 비율 <b>${ratio}</b></span>
              <span>· 네이버쇼핑 <b>${p.nv_rank ? (p.nv_rank_kind === '브랜드' ? '브랜드 검색 ' : '') + p.nv_rank + '위' : (p.nv_rank_kind || '미수집')}</b></span>
              <span>· 네이버 노출가 <b>${p.nv_price == null ? '미수집' : won(p.nv_price)}</b></span>
              <span>· 쿠팡 노출가 <b>${p.cp_price == null ? '미수집' : won(p.cp_price)}</b></span>
              <span>· 최저가 <b>${p.low_price == null ? '미수집' : won(p.low_price) + (p.low_store ? ' ' + esc(p.low_store) : '')}</b></span>
              <span>· 수량 쿠팡 <b>${p.cp_qty == null ? '미수집' : p.cp_qty}</b> / 네이버 <b>${p.nv_qty == null ? '미수집' : p.nv_qty}</b></span>
              <span>· 리뷰 쿠팡 <b>${p.cp_review == null ? '미수집' : won(p.cp_review)}</b> / 네이버 <b>${p.nv_review == null ? '미수집' : won(p.nv_review)}</b></span>
              <span>· 상품 방문 <b>미수집</b></span>
              <span>· 주문 수 <b>미수집</b></span>
              <span>· 실구매가 <b>비교 불가</b> <small style="color:#a8b2c4">(쿠폰·배송비가 없어 같은 조건으로 못 맞춥니다)</small></span>
            </div>
            <div style="height:8px"></div>
            ${f('evidence', '관찰 근거 — 무엇을 보고 이 계획을 세웠는지', 'area')}
          </div>

          <div class="sp-two">
            <div class="sp-sec">
              <h4>쿠팡 운영안</h4>
              ${f('cp_plan', '지금 쿠팡에서 무엇을 할지', 'area')}
            </div>
            <div class="sp-sec">
              <h4>네이버 판매안 <small>확인된 사실 → 원인 가설 → 실행할 변경</small></h4>
              <div class="sp-pick" style="margin-bottom:8px">
                ${['방문 적음', '방문 있으나 주문 적음', '미정'].map((x) => `
                  <button type="button" class="${(p.nv_issue || '미정') === x ? 'on' : ''}"
                    onclick="SalesPlan.issue('${x}')">${x}</button>`).join('')}
              </div>
              ${f('nv_fact', '확인된 사실', 'area')}
              ${f('nv_cause', '원인 가설', 'area')}
              ${f('nv_action', '실행할 변경', 'area')}
            </div>
          </div>

          <div class="sp-sec">
            <h4>검증</h4>
            <div class="sp-two">
              ${f('metric', '검증 지표', 'area')}
              ${f('success', '성공 기준', 'area')}
            </div>
            <div class="sp-two">
              ${f('check_until', '검증 기간 (이 날짜까지)', 'date')}
              <label class="sp-f"><span>상태</span>
                <select id="sp_status">
                  ${['작성', '검증중', '완료', '중단'].map((x) => `<option ${p.status === x ? 'selected' : ''}>${x}</option>`).join('')}
                </select></label>
            </div>
          </div>

          <div class="sp-sec">
            <h4>실행 결과와 다음 판단</h4>
            <div class="sp-two">
              ${f('result', '실행 결과', 'area')}
              ${f('decision', '다음 판단', 'area')}
            </div>
            ${f('review_on', '재검토일', 'date')}
          </div>

          <div class="sp-sec">
            <h4>오늘의 집중 상품</h4>
            <div class="sp-row">
              <label style="font-size:12.5px;font-weight:700;color:#475569">
                <input type="checkbox" id="sp_focus" ${p.focus ? 'checked' : ''}> 집중 상품으로 올리기</label>
              <label style="font-size:12.5px;font-weight:700;color:#475569">순서
                <input type="text" id="sp_focus_rank" value="${esc(p.focus_rank || '')}" style="width:56px;display:inline-block;margin-left:5px"></label>
              <span style="font-size:11.5px;color:#94a3b8">보드 위쪽에 3개까지 먼저 보입니다</span>
            </div>
          </div>
        </div>
        <div class="sp-modal-foot">
          <button type="button" class="sp-btn main" onclick="SalesPlan.save()">저장</button>
          <button type="button" class="sp-btn" onclick="SalesPlan.copyOne()">아침 보고 복사</button>
          ${p.id ? `<button type="button" class="sp-btn danger" onclick="SalesPlan.remove()">삭제</button>` : ''}
          <span class="sp-msg" id="spMsg"></span>
        </div>
      </div>`;
    document.body.appendChild(mask);
  }

  function closeModal() { const m = el('spMask'); if (m) m.remove(); }

  function collect() {
    const v = (k) => { const n = el('sp_' + k); return n ? n.value.trim() : ''; };
    const p = editing;
    return {
      plan_date: p.plan_date,
      product: v('product'),
      focus: !!(el('sp_focus') && el('sp_focus').checked),
      focus_rank: Number(v('focus_rank')) || null,
      evidence: v('evidence') || null,
      cp_sales: p.cp_sales ?? null, nv_sales: p.nv_sales ?? null, nv_set_sales: p.nv_set_sales ?? null,
      nv_rank: p.nv_rank ?? null, nv_rank_kind: p.nv_rank_kind ?? null, nv_query: p.nv_query ?? null,
      nv_price: p.nv_price ?? null, cp_price: p.cp_price ?? null,
      low_price: p.low_price ?? null, low_store: p.low_store ?? null,
      cp_qty: p.cp_qty ?? null, nv_qty: p.nv_qty ?? null,
      cp_review: p.cp_review ?? null, nv_review: p.nv_review ?? null,
      cp_plan: v('cp_plan') || null,
      nv_issue: p.nv_issue || '미정',
      nv_fact: v('nv_fact') || null, nv_cause: v('nv_cause') || null, nv_action: v('nv_action') || null,
      metric: v('metric') || null, success: v('success') || null,
      check_until: v('check_until') || null,
      result: v('result') || null, decision: v('decision') || null,
      review_on: v('review_on') || null,
      status: (el('sp_status') || {}).value || '작성',
    };
  }

  function msg(text, bad) {
    const m = el('spMsg');
    if (!m) return;
    m.textContent = text;
    m.className = 'sp-msg' + (bad ? ' bad' : '');
  }

  async function save() {
    const body = collect();
    if (!body.product) { msg('상품명을 적어주세요.', true); return; }
    let res;
    if (editing.id) res = await db.from('sales_plans').update(body).eq('id', editing.id).select();
    else res = await db.from('sales_plans').insert(body).select();
    if (res.error) {
      msg(res.error.message.indexOf('sales_plans') >= 0 && res.error.code === '42P01'
        ? 'sales_plan.sql 을 Supabase에서 먼저 실행해주세요.' : '저장하지 못했습니다: ' + res.error.message, true);
      return;
    }
    editing = (res.data || [])[0] || editing;
    msg('저장했습니다');
    if (boardEl && editing.plan_date === boardDate) await render();
    if (afterSave) afterSave(editing);
    setTimeout(closeModal, 450);
  }

  async function remove() {
    if (!editing.id) return;
    if (!confirm(editing.product + ' 의 ' + editing.plan_date + ' 판매계획을 지울까요? 되돌릴 수 없습니다.')) return;
    const { error } = await db.from('sales_plans').delete().eq('id', editing.id);
    if (error) { msg('지우지 못했습니다: ' + error.message, true); return; }
    closeModal();
    if (boardEl) render();
    if (afterSave) afterSave(null);
  }

  // ---- 아침 보고 복사 ----------------------------------------------------
  function briefOf(p) {
    const L = [];
    L.push('[' + p.plan_date + '] ' + p.product);
    const nums = [];
    if (p.cp_sales != null) nums.push('쿠팡 ' + won(p.cp_sales) + '원');
    if (p.nv_sales != null) nums.push('네이버 ' + won(p.nv_sales) + '원');
    if (p.cp_sales != null && p.nv_sales != null) {
      nums.push('채널 매출 비율 ' + (Number(p.cp_sales) > 0 ? Math.round(p.nv_sales / p.cp_sales * 100) + '%' : '산출 불가'));
    }
    if (p.nv_rank) nums.push('네이버쇼핑 ' + (p.nv_rank_kind === '브랜드' ? '브랜드 검색 ' : '') + p.nv_rank + '위');
    if (nums.length) L.push('· 매출 근거: ' + nums.join(' / '));
    if (p.evidence) L.push('· 관찰: ' + p.evidence);
    if (p.cp_plan) L.push('· 쿠팡 운영안: ' + p.cp_plan);
    const nv = [];
    if (p.nv_issue && p.nv_issue !== '미정') nv.push('(' + p.nv_issue + ')');
    if (p.nv_fact) nv.push('사실 ' + p.nv_fact);
    if (p.nv_cause) nv.push('가설 ' + p.nv_cause);
    if (p.nv_action) nv.push('변경 ' + p.nv_action);
    if (nv.length) L.push('· 네이버 판매안: ' + nv.join(' → '));
    if (p.metric || p.success) L.push('· 검증: ' + [p.metric, p.success].filter(Boolean).join(' / ')
      + (p.check_until ? ' (' + p.check_until + '까지)' : ''));
    if (p.result) L.push('· 결과: ' + p.result);
    if (p.decision) L.push('· 다음 판단: ' + p.decision);
    return L.join('\n');
  }

  function copyText(text, where) {
    const done = () => { if (where === 'modal') msg('복사했습니다'); else alert('아침 보고를 복사했습니다.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { alert(text); }
      ta.remove();
    }
  }

  function copyBrief() {
    const list = showAll ? plans : plans.filter((p) => p.focus).slice(0, 3);
    if (!list.length) { alert('복사할 계획이 없습니다.'); return; }
    const head = totals && totals.last
      ? `■ ${boardDate} 아침 보고\n전일 확정(${totals.lastDay}) 쿠팡 ${won(totals.last.쿠팡)}원 · 네이버 ${won(totals.last.네이버)}원`
      : `■ ${boardDate} 아침 보고`;
    const live = totals && totals.live
      ? `\n오늘 실시간 쿠팡 ${won(totals.live.쿠팡)}원 · 네이버 ${won(totals.live.네이버)}원 (아직 확정 아님)`
      : '';
    copyText(head + live + '\n\n' + list.map(briefOf).join('\n\n'));
  }

  // =========================================================================
  // 기간별 기획안
  // =========================================================================
  const PERIOD_FORMS = {
    week: {
      label: '주간 기획안', unit: '주차',
      fields: [
        ['last', '이번주 채널별 실적'], ['focus', '집중 상품', 0, 'meta'],
        ['cp', '쿠팡 운영안'], ['nv', '네이버 테스트안'],
        ['check', '검증 기간 · 성공 기준'], ['result', '결과'],
        ['next', '차주 판단', 1],
      ],
    },
    month: {
      label: '월간 운영안', unit: '월',
      fields: [
        ['goal', '채널별 목표 · 누계 · 예상 마감 · 목표 차이', 1],
        ['main', '주력 상품'], ['ops', '채널별 운영안'],
        ['cost', '행사 · 광고비 · 이익률'], ['fix', '남은 기간 보완안', 1],
      ],
    },
    next: {
      label: '익월 기획안', unit: '월',
      fields: [
        ['season', '시즌 수요'], ['cand', '후보 상품'],
        ['event', '채널별 행사 · 출시안'], ['price', '가격 · 구성 · 혜택'],
        ['stock', '필요 재고'], ['due', '구좌 신청 · 소재 마감'],
        ['approve', '승인 필요 사항', 1],
      ],
    },
    quarter: {
      label: '분기 기획안', unit: '분기',
      fields: [
        ['last', '직전 분기 실적'], ['goal', '채널별 매출 · 이익 목표'],
        ['group', '집중 상품군'], ['event', '월별 주요 행사'],
        ['alloc', '광고비 · 재고 배분'], ['rule', '확대 · 중단 기준', 1],
      ],
    },
  };

  // ---- 지금 켜진 메타 광고 ------------------------------------------------
  // meta_active_ads 는 api/sync-meta-ads.js 가 매일 아침 통째로 바꿔 넣습니다.
  // 캠페인 이름 앞의 「[상품명]」으로 상품을 가립니다. 괄호를 안 쓰는 계정은 아래 낱말로 맞춥니다.
  const META_ALIAS = [
    ['패딩빨아망', '패딩 2중 세탁망'], ['패딩압축세탁망', '패딩 2중 세탁망'],
    ['수면돔', '원조 난방 수면돔'], ['수면양말', '수면양말'],
    ['제습', '스트롱 제습서버', '메타 라스마'],
  ];
  let metaCache = null;   // { at, list:[{product, brand, spend, ads}], unknown }

  function metaProductOf(a) {
    const camp = String(a.campaign_name || '');
    const alias = (text) => {
      const t = String(text || '').replace(/\s+/g, '');
      const hit = META_ALIAS.find(([w, , ch]) => t.includes(w) && (!ch || a.channel === ch));
      return hit ? hit[1] : null;
    };
    const br = (camp.match(/^\s*\[([^\]]+)\]/) || [])[1];
    if (br) return alias(br) || br.trim();
    return alias(camp + ' ' + (a.adset_name || '') + ' ' + (a.ad_name || ''));
  }

  // 받은 시각은 한국 시간으로 적습니다 (synced_at 은 UTC 로 들어옵니다).
  const atKst = (iso) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  async function loadMetaAds() {
    if (metaCache) return metaCache;
    const { data, error } = await db.from('meta_active_ads')
      .select('channel,campaign_name,adset_name,ad_name,spend_7d,synced_at');
    if (error) { metaCache = { err: error.message, list: [], unknown: 0 }; return metaCache; }
    const by = {};
    let unknown = 0, at = '';
    (data || []).forEach((a) => {
      if (a.synced_at > at) at = a.synced_at;
      const name = metaProductOf(a);
      if (!name) { unknown++; return; }
      const o = (by[name] = by[name] || { product: name, brands: new Set(), spend: 0, ads: 0 });
      o.brands.add(String(a.channel || '').replace(/^메타\s*/, ''));
      o.spend += Number(a.spend_7d) || 0;
      o.ads++;
    });
    const list = Object.values(by)
      .map((o) => ({ product: o.product, brand: [...o.brands].join('·'), spend: o.spend, ads: o.ads }))
      .sort((x, y) => y.spend - x.spend);
    metaCache = { at, list, unknown };
    return metaCache;
  }

  // 집중 상품 칸에는 상품명만 적습니다(11/26 사용자 요청). 광고비는 아래 단추에 붙여 둡니다.
  function metaLine(x) {
    return x.product;
  }

  // 「집중 상품」 칸 아래에 지금 켜진 메타 상품을 달아 둡니다. 칸이 비어 있으면 그대로 채웁니다.
  async function fillMeta(fieldId) {
    const box = el('spMeta');
    const ta = el(fieldId);
    if (!box || !ta) return;
    const m = await loadMetaAds();
    if (m.err) { box.innerHTML = '<span class="sp-na">메타 광고 목록을 못 읽었습니다 — ' + esc(m.err) + '</span>'; return; }
    if (!m.list.length) { box.innerHTML = '<span class="sp-na">지금 켜진 메타 광고가 없습니다.</span>'; return; }
    if (!ta.value.trim()) ta.value = m.list.map(metaLine).join('\n');
    box.innerHTML =
      '<div class="sp-meta-t">지금 켜진 메타 광고 ' + m.list.length + '개 상품'
      + (m.at ? ' · ' + esc(atKst(m.at)) + ' 받음' : '')
      + (m.unknown ? ' · 이름으로 상품을 못 가린 광고 ' + m.unknown + '개' : '')
      + ' <button type="button" class="sp-btn ghost" onclick="SalesPlan.metaAll(\'' + fieldId + '\')">모두 넣기</button></div>'
      + m.list.map((x, i) => '<button type="button" class="sp-meta-chip" data-i="' + i
        + '" onclick="SalesPlan.metaAdd(\'' + fieldId + '\',' + i + ')">' + esc(x.product)
        + ' <i>' + man(x.spend * 1.1) + '</i></button>').join('');
  }

  // 칸에 이미 적힌 상품은 다시 넣지 않습니다.
  function metaPut(fieldId, rows) {
    const ta = el(fieldId);
    if (!ta) return;
    const add = rows.filter((x) => !ta.value.includes(x.product)).map(metaLine);
    if (!add.length) { msg('이미 적혀 있습니다'); return; }
    ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n' : '') + add.join('\n');
    ta.focus();
  }

  async function loadPeriod(kind, period) {
    const key = kind + '|' + period;
    const { data, error } = await db.from('sales_period_plans').select('*')
      .eq('kind', kind).eq('period', period).limit(1);
    if (error) { console.warn('[기간 기획안]', error.message); return { kind, period, data: {}, plan_ids: [], _err: error.message }; }
    const row = (data || [])[0] || { kind, period, data: {}, plan_ids: [] };
    periodCache[key] = row;
    return row;
  }

  // 그 달의 마지막 날 — '2026-11-31' 같은 없는 날짜를 물으면 아무것도 안 돌아옵니다.
  function monthEnd(y, m) {
    return y + '-' + String(m).padStart(2, '0') + '-' + String(new Date(y, m, 0).getDate());
  }

  // 그 기간에 들어가는 상품 판매계획 — 연결 후보로 보여줍니다.
  function periodRange(kind, period) {
    const y = Number(period.slice(0, 4));
    if (kind === 'quarter') {
      const q = Number(period.slice(-1));
      return [y + '-' + String((q - 1) * 3 + 1).padStart(2, '0') + '-01', monthEnd(y, q * 3)];
    }
    const m = Number(period.slice(5, 7));
    if (kind === 'week') {
      // 월요일에 시작하고, 1일이 낀 주가 1주차입니다.
      const w = Number(period.slice(period.indexOf('W') + 1));
      const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
      const monday = new Date(Date.UTC(y, m - 1, 1 - ((firstDow + 6) % 7) + (w - 1) * 7));
      const a = monday.toISOString().slice(0, 10);
      return [a, addDays(a, 6)];
    }
    return [period + '-01', monthEnd(y, m)];
  }

  async function plansInPeriod(kind, period) {
    const [from, to] = periodRange(kind, period);
    const { data } = await db.from('sales_plans').select('id,plan_date,product,status,result,decision,nv_action,cp_plan')
      .gte('plan_date', from).lte('plan_date', to).order('plan_date', { ascending: false });
    return data || [];
  }

  function periodHtml(kind, row) {
    const F = PERIOD_FORMS[kind];
    const d = row.data || {};
    const err = row._err
      ? `<div class="sp-empty" style="color:#dc2626">기획안 표를 못 읽었습니다 — sales_plan.sql 을 Supabase에서 실행해주세요.<br><small>${esc(row._err)}</small></div>`
      : '';
    setTimeout(() => fillLinked(kind, row), 0);
    const metaField = (F.fields.find(([, , , tag]) => tag === 'meta') || [])[0];
    if (metaField) setTimeout(() => fillMeta('spp_' + metaField), 0);
    return `
      ${err}
      <div class="sp-head" style="margin-bottom:10px">
        <span style="font-size:13px;font-weight:800;color:#0f172a">${esc(row.period)} ${F.label}</span>
        <span class="sp-right">
          <span class="sp-msg" id="spMsg"></span>
          <button type="button" class="sp-btn main" onclick="SalesPlan.savePeriod('${kind}','${esc(row.period)}')">저장</button>
        </span>
      </div>
      <div class="sp-period">
        ${F.fields.map(([k, label, wide, tag]) => `
          <label class="sp-f${wide ? ' wide' : ''}${tag === 'meta' ? ' has-meta' : ''}"><span>${label}</span>
            <textarea id="spp_${k}">${esc(d[k] || '')}</textarea>
            ${tag === 'meta' ? '<div class="sp-meta" id="spMeta"><span class="sp-na">메타 광고 보는 중…</span></div>' : ''}</label>`).join('')}
        <div class="sp-f wide"><span>연결한 상품 판매계획 — 검증 결과와 다음 판단을 같이 봅니다</span>
          <div class="sp-linked" id="spLinked"><span class="sp-na">불러오는 중…</span></div>
        </div>
      </div>`;
  }

  async function fillLinked(kind, row) {
    const box = el('spLinked');
    if (!box) return;
    const list = await plansInPeriod(kind, row.period);
    const on = new Set((row.plan_ids || []).map(Number));
    if (!list.length) { box.innerHTML = '<span class="sp-na">이 기간에 세운 상품 판매계획이 없습니다.</span>'; return; }
    const linked = list.filter((x) => on.has(Number(x.id)));
    box.innerHTML = `
      ${linked.length ? linked.map((x) => `
        <div class="sp-link-row">
          <b onclick="SalesPlan.open({id:${x.id}})" style="cursor:pointer">${esc(x.product)}</b>
          <span class="sp-state ${esc(x.status || '작성')}" style="margin-left:6px">${esc(x.status || '작성')}</span>
          <span style="color:#94a3b8;margin-left:6px">${esc(x.plan_date)}</span>
          <div class="d">${x.result ? '결과 · ' + esc(x.result) : '결과 아직 없음'}${x.decision ? ' / 다음 판단 · ' + esc(x.decision) : ''}</div>
        </div>`).join('') : '<span class="sp-na">아직 연결한 계획이 없습니다.</span>'}
      <div class="sp-link-pick">
        ${list.map((x) => `<label><input type="checkbox" class="spLink" value="${x.id}" ${on.has(Number(x.id)) ? 'checked' : ''}>
          ${esc(x.plan_date.slice(5))} ${esc(x.product)}</label>`).join('')}
      </div>`;
  }

  async function savePeriod(kind, period) {
    const F = PERIOD_FORMS[kind];
    const data = {};
    F.fields.forEach(([k]) => { const n = el('spp_' + k); if (n && n.value.trim()) data[k] = n.value.trim(); });
    const plan_ids = [...document.querySelectorAll('.spLink:checked')].map((x) => Number(x.value));
    const { error } = await db.from('sales_period_plans')
      .upsert({ kind, period, data, plan_ids }, { onConflict: 'kind,period' });
    if (error) { msg('저장하지 못했습니다: ' + error.message, true); return; }
    msg('저장했습니다');
    const row = await loadPeriod(kind, period);
    setTimeout(() => fillLinked(kind, row), 0);
  }

  // =========================================================================
  // 바깥에서 쓰는 것들
  // =========================================================================
  window.SalesPlan = {
    init(client) { db = client; injectCss(); },
    mountBoard,
    refresh: render,
    open,
    close: closeModal,
    save, remove, savePeriod,
    copyBrief,
    copyOne() { copyText(briefOf(Object.assign({}, editing, collect())), 'modal'); },
    issue(x) { editing.nv_issue = x; showModal([]); },
    async pickProduct(name) {
      if (!name) return;
      const seed = await gatherSeed(editing.plan_date, name);
      editing = Object.assign(editing, seed, { product: name });
      showModal(await loadProducts(editing.plan_date));
    },
    tab(k) { tab = k; render(); },
    date(v) { if (v) { boardDate = v; render(); } },
    week(period) { weekSel = period; render(); },
    async metaAdd(fieldId, i) { const m = await loadMetaAds(); metaPut(fieldId, [m.list[i]].filter(Boolean)); },
    async metaAll(fieldId) { const m = await loadMetaAds(); metaPut(fieldId, m.list); },
    // 주간 탭에서 달을 넘깁니다 (고른 주차는 그 달의 1주차로).
    month(n) {
      const [y, m] = boardDate.slice(0, 7).split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      const ym = d.toISOString().slice(0, 7);
      boardDate = ym + '-01';
      weekSel = ym + '-W1';
      render();
    },
    toggleAll() { showAll = !showAll; render(); },
    setDate(v) { boardDate = v; },
    // 그 화면이 이미 구해 둔 매출 근거를 넘겨 둡니다(실시간 매출 화면의 비교표).
    seed(date, product, obj) { seeds[date + '|' + product] = obj; },
    // 그 날짜에 계획이 있는 상품 이름들 — 비교표에서 단추 모양을 바꾸는 데 씁니다.
    async plannedOn(date) {
      const { data } = await db.from('sales_plans').select('product').eq('plan_date', date);
      return new Set((data || []).map((r) => r.product));
    },
  };
})();

-- 실시간 매출·광고비중 (live-sales.html) 테이블
-- 네이버(스마트스토어)·쿠팡·오늘의집·G마켓의 "오늘 실시간" 매출과 전일자 확정치를 날짜별로 쌓습니다.
-- 값은 사무실 PC의 외부광고수집기(C:\외부광고수집기\sales.py)가 전용 크롬으로 각 판매자센터를 읽어 넣습니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 한 번 실행하세요.
--
-- 매출 기준(작업보고 2026-10-16~30 과 같음): 결제금액 − 취소·반품 = 순매출(할인 뺀 실제 받는 금액)
-- 오늘 값은 is_final=false 로 계속 덮이고, 다음 날 아침 확정 수집이 같은 날짜를 is_final=true 로 갈아끼웁니다.

-- 1) 몰 합계 (몰마다 하루 한 줄) — 상품별 표가 상위 몇 개만 주는 몰(쿠팡 WING 상위 20개)이 있어 합계는 따로 둔다
create table if not exists live_sales_totals (
  date date not null,
  mall text not null,                       -- 네이버 / 쿠팡 / 오늘의집 / G마켓
  orders integer not null default 0,
  qty integer not null default 0,
  amount numeric not null default 0,        -- 순매출
  cancel_amount numeric not null default 0,
  is_final boolean not null default false,
  note text not null default '',
  collected_at timestamptz not null default now(),
  primary key (date, mall)
);

-- 2) 상품별 매출
create table if not exists live_sales_items (
  date date not null,
  mall text not null,
  product_id text not null default '',
  product text not null default '',
  qty integer not null default 0,
  amount numeric not null default 0,
  is_final boolean not null default false,
  collected_at timestamptz not null default now(),
  primary key (date, mall, product_id, product)
);
create index if not exists live_sales_items_date_idx on live_sales_items(date);

-- 3) 오늘 광고비 (어제까지는 외부 광고 리포트의 cpc_ad_rows 를 그대로 쓴다)
create table if not exists live_ad_spend (
  date date not null,
  mall text not null,                       -- 광고가 붙는 판매몰: 네이버 / 쿠팡 / 오늘의집 / G마켓
  channel text not null default '',         -- 네이버 ADVoost, 쿠팡 광고센터 …
  campaign text not null default '',
  product text not null default '',
  cost numeric not null default 0,          -- VAT 별도 원값. 화면에서 ×1.1
  collected_at timestamptz not null default now(),
  primary key (date, mall, channel, campaign, product)
);

-- 4) 상품 묶기 규칙 — 몰마다 다른 상품명·광고 이름을 같은 대표 상품 줄로 모은다
--    kind='alias'  : 이름(공백 뺀)에 pattern 이 들어 있으면 target 으로 (앞 순서가 이긴다)
--    kind='keyword': 이름에 pattern 이 들어 있으면 그 낱말이 대표 상품
create table if not exists live_item_rules (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('alias', 'keyword')),
  pattern text not null,
  target text not null default '',
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

-- 5) 대시보드 「지금 받기」 버튼 → 사무실 PC 수집기에 요청 (우체통)
--    refresh_requests 는 쿠팡 수집기 감시 프로그램이 보고 있어서 섞이지 않게 따로 둔다
create table if not exists live_sales_requests (
  id bigint generated always as identity primary key,
  target_date date not null default ((now() at time zone 'Asia/Seoul')::date),
  status text not null default 'pending',   -- pending | running | done | failed
  message text,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists live_sales_requests_status_idx on live_sales_requests(status, requested_at);

-- 공개 키로 읽고 쓴다(대시보드 다른 표와 같은 방식)
alter table live_sales_totals enable row level security;
alter table live_sales_items enable row level security;
alter table live_ad_spend enable row level security;
alter table live_item_rules enable row level security;
alter table live_sales_requests enable row level security;

do $$
declare t text;
begin
  foreach t in array array['live_sales_totals','live_sales_items','live_ad_spend','live_item_rules','live_sales_requests'] loop
    execute format('drop policy if exists "public all" on %I', t);
    execute format('create policy "public all" on %I for all using (true) with check (true)', t);
  end loop;
end $$;

-- 처음 규칙 (작업보고 KW_ALIAS 그대로, 앞에서부터 처음 걸린 것이 이긴다)
insert into live_item_rules (kind, pattern, target, sort)
select * from (values
  ('alias', '오행반지염주', '반지염주', 10),
  ('alias', '베게2중압축', '2중', 20),
  ('alias', '롤티슈', '메가스크럽', 30),
  ('alias', '의류보호망', '자켓', 40),
  ('alias', '목라인', '목라인', 50),
  ('alias', '벽지제거제', '벽지얼룩', 60),
  ('alias', '오염케어티슈', '오염케어티슈', 70),
  ('alias', '명태', '액막이', 80),
  ('alias', '베게', '베개', 90),
  ('alias', '악취세정서버', '하수구', 100),
  -- 대표 낱말 (화면 「상품 묶기 규칙」에서 더하고 뺄 수 있다)
  ('keyword', '반지염주', '', 1000), ('keyword', '염주', '', 1010), ('keyword', '자켓', '', 1020),
  ('keyword', '2중', '', 1030), ('keyword', '목라인', '', 1040), ('keyword', '메가스크럽', '', 1050),
  ('keyword', '하수구', '', 1060), ('keyword', '변기', '', 1070), ('keyword', '베개', '', 1080),
  ('keyword', '벽지얼룩', '', 1090), ('keyword', '벽지', '', 1100), ('keyword', '오염케어티슈', '', 1110),
  ('keyword', '텀블러', '', 1120), ('keyword', '습기제거', '', 1130), ('keyword', '클린업', '', 1140),
  ('keyword', '토퍼', '', 1150), ('keyword', '패브릭', '', 1160), ('keyword', '정전기', '', 1170),
  ('keyword', '결로', '', 1180), ('keyword', '다한증', '', 1190), ('keyword', '행주', '', 1200),
  ('keyword', '수세미', '', 1210), ('keyword', '액막이', '', 1220), ('keyword', '탈취', '', 1230)
) v(kind, pattern, target, sort)
where not exists (select 1 from live_item_rules);

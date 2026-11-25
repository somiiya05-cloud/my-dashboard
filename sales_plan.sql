-- 영업계획실행보드 — 표 두 개를 만듭니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에 이 파일 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.
--
--   sales_plans         상품 하나의 하루치 판매계획 (쿠팡 운영안 + 네이버 판매안 + 검증)
--   sales_period_plans  주간·월간·익월·분기 기획안 (칸이 양식마다 달라 jsonb 로 둡니다)

-- ---------------------------------------------------------------------------
-- 1) 상품별 판매계획
-- ---------------------------------------------------------------------------
create table if not exists sales_plans (
  id            bigserial primary key,
  plan_date     date not null,
  product       text not null,          -- 쿠팡 기준 대표 상품명
  focus         boolean default false,  -- 오늘의 집중 상품
  focus_rank    int,                    -- 집중 상품 순서 1~3

  -- 매출 근거 — 계획을 세운 시점의 숫자를 그대로 적어 둡니다(나중에 바뀌어도 판단 근거가 남게)
  evidence      text,                   -- 관찰 근거 (사람이 쓰는 글)
  cp_sales      numeric,                -- 쿠팡 매출
  nv_sales      numeric,                -- 네이버 매출 (단품)
  nv_set_sales  numeric,                -- 네이버 세트에서 나눠 넣은 몫
  nv_rank       int,                    -- 네이버쇼핑 노출 순위
  nv_rank_kind  text,                   -- '일반' | '브랜드' | '광고만' | '미노출'
  nv_query      text,                   -- 그때 쓴 검색어
  nv_price      numeric,                -- 네이버 노출가
  cp_price      numeric,                -- 쿠팡 노출가
  low_price     numeric,                -- 가격비교 최저가
  low_store     text,
  cp_qty        int,                    -- 쿠팡 판매 수량
  nv_qty        int,                    -- 네이버 판매 수량
  cp_review     int,
  nv_review     int,

  -- 쿠팡 운영안
  cp_plan       text,

  -- 네이버 판매안 — 확인된 사실 → 원인 가설 → 실행할 변경
  nv_issue      text,                   -- '방문 적음' | '방문 있으나 주문 적음' | '미정'
  nv_fact       text,
  nv_cause      text,
  nv_action     text,

  -- 검증
  metric        text,                   -- 검증 지표
  success       text,                   -- 성공 기준
  check_until   date,                   -- 검증 기간
  result        text,                   -- 실행 결과
  decision      text,                   -- 다음 판단
  review_on     date,                   -- 재검토일
  status        text default '작성',     -- 작성 | 검증중 | 완료 | 중단

  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (plan_date, product)
);

create index if not exists sales_plans_date_idx on sales_plans (plan_date desc);
create index if not exists sales_plans_product_idx on sales_plans (product);

-- ---------------------------------------------------------------------------
-- 2) 기간별 기획안 (주간 · 월간 · 익월 · 분기)
--    양식마다 칸이 달라 내용은 jsonb 한 칸에 넣고, 화면이 양식을 그립니다.
-- ---------------------------------------------------------------------------
create table if not exists sales_period_plans (
  id          bigserial primary key,
  kind        text not null,            -- 'week' | 'month' | 'next' | 'quarter'
  period      text not null,            -- '2026-W48' | '2026-11' | '2026-12' | '2026-Q4'
  data        jsonb not null default '{}'::jsonb,
  plan_ids    bigint[] not null default '{}',   -- 연결한 상품 판매계획(sales_plans.id)
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique (kind, period)
);

-- ---------------------------------------------------------------------------
-- 3) 누구나 읽고 쓰게 (다른 표와 같은 방식)
-- ---------------------------------------------------------------------------
alter table sales_plans        enable row level security;
alter table sales_period_plans enable row level security;

drop policy if exists sales_plans_all on sales_plans;
create policy sales_plans_all on sales_plans for all using (true) with check (true);

drop policy if exists sales_period_plans_all on sales_period_plans;
create policy sales_period_plans_all on sales_period_plans for all using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4) 고친 시각 자동 기록
-- ---------------------------------------------------------------------------
create or replace function sales_plan_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sales_plans_touch on sales_plans;
create trigger sales_plans_touch before update on sales_plans
  for each row execute function sales_plan_touch();

drop trigger if exists sales_period_plans_touch on sales_period_plans;
create trigger sales_period_plans_touch before update on sales_period_plans
  for each row execute function sales_plan_touch();

-- 확인
select '판매계획' as "표", count(*) as "줄" from sales_plans
union all
select '기간 기획안', count(*) from sales_period_plans;

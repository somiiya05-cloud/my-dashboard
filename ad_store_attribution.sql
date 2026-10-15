-- 외부 광고 리포트(cpc.html)의 "스마트스토어 실제 결제" 카드용 테이블
-- 광고 관리자가 잡는 구매(광고 본 뒤 다른 경로로 산 것까지 포함)와 별개로, 스마트스토어센터
-- 데이터분석 → 방문 분석에서 "그 광고 경로로 들어와 결제한 것"만 날짜별로 저장합니다.
-- C:\외부광고수집기 가 매일 채웁니다. cpc_ad_rows 에 섞으면 캠페인 합계가 틀어져서 따로 둡니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists ad_store_attribution (
  id bigint generated always as identity primary key,
  date date not null,
  channel text not null,                 -- cpc_ad_rows.mall 과 같은 이름 (예: 네이버 ADVoost)
  path text not null default '',         -- 방문 분석 경로 (예: 네이버 광고 > 디스플레이 광고 > ADVoost쇼핑(제품광고))
  visits bigint not null default 0,      -- 그 경로 방문수
  pays bigint not null default 0,        -- 그 경로 상품결제건수
  sales numeric not null default 0,      -- 그 경로 판매금액(총)
  store_visits bigint not null default 0, -- 같은 날 스토어 전체 방문수
  store_pays bigint not null default 0,   -- 같은 날 스토어 전체 상품결제건수
  store_sales numeric not null default 0, -- 같은 날 스토어 전체 판매금액(총)
  updated_at timestamptz not null default now(),
  unique (date, channel)
);

alter table ad_store_attribution enable row level security;

create policy "public read access" on ad_store_attribution for select using (true);
create policy "public insert access" on ad_store_attribution for insert with check (true);
create policy "public update access" on ad_store_attribution for update using (true);
create policy "public delete access" on ad_store_attribution for delete using (true);

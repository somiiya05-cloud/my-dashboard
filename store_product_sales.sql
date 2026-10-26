-- 외부 광고 리포트(cpc.html)의 "상품별 스토어 매출 대비 광고비" 표용 테이블
-- 스마트스토어센터 데이터분석 → 방문 분석(채널상품별)의 상품별 결제를 날짜별로 저장합니다.
-- 유입 경로 구분 없는 스토어 전체 매출이라, 광고비가 그 상품 매출에 비해 적정한지 보는 데 씁니다.
-- C:\외부광고수집기 가 매일 채웁니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists store_product_sales (
  id bigint generated always as identity primary key,
  date date not null,
  product_no text not null,              -- 스마트스토어 채널상품번호
  product text not null default '',      -- 채널상품명 (예: 코드니처 홈드라이 자켓세탁망 ...)
  visits bigint not null default 0,      -- 그 상품 방문수
  pays bigint not null default 0,        -- 상품결제건수
  sales numeric not null default 0,      -- 판매금액(총)
  updated_at timestamptz not null default now(),
  unique (date, product_no)
);

alter table store_product_sales enable row level security;

create policy "public read access" on store_product_sales for select using (true);
create policy "public insert access" on store_product_sales for insert with check (true);
create policy "public update access" on store_product_sales for update using (true);
create policy "public delete access" on store_product_sales for delete using (true);

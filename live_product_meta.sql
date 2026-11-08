-- 실시간 매출 「쿠팡 대비 네이버 부진」 표의 상품 정보 — 후기·별점·네이버쇼핑 노출·가격비교 최저가
-- 사무실 PC 수집기(C:\외부광고수집기\sales.py)가 넣습니다.
--   mall = '쿠팡'       : WING 판매분석의 상품 후기 수·별점
--   mall = '네이버쇼핑' : 쿠팡 상품명(브랜드 뺀 것)으로 네이버쇼핑을 검색한 결과
--                         rank = 우리 스토어가 광고 아닌 결과 중 몇 번째(없으면 null), ad_only = 광고로만 보임
--                         price = 우리 스토어 노출가, low_price = 같은 상품 중 최저 노출가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 한 번 실행하세요.

create table if not exists live_product_meta (
  mall text not null,
  product text not null,            -- 쿠팡 상품명(옵션 앞까지)
  query text not null default '',
  store text not null default '',   -- 네이버에서 찾은 우리 스토어 이름
  review_count integer,
  rating numeric,
  price numeric,
  low_price numeric,
  low_store text not null default '',
  rank integer,
  ad_only boolean not null default false,
  checked_at timestamptz not null default now(),
  primary key (mall, product)
);

alter table live_product_meta enable row level security;
drop policy if exists "public all" on live_product_meta;
create policy "public all" on live_product_meta for all using (true) with check (true);

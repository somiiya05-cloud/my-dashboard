-- 1+1세트처럼 한 상품 안에 원가 대시보드 기준 상품이 여러 개 들어있는 경우,
-- 개당 원가 × 수량으로 SKU손익을 계산하기 위한 컬럼입니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table codenit_products
  add column if not exists cost_qty integer not null default 1;

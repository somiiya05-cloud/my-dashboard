-- SKU손익 화면에서 상품명이 서로 달라 자동 매칭되지 않는 상품(원가 미매칭)을
-- 원가 대시보드(product_cost)의 특정 항목과 수동으로 연결하기 위한 컬럼입니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table codenit_products
  add column if not exists cost_product_id bigint references product_cost(id) on delete set null;

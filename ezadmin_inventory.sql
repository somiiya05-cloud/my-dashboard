-- 이지어드민 재고 연동 결과를 저장할 테이블
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists product_inventory (
  product_id text primary key,
  stock numeric,
  ready_trans_stock numeric,
  stock_unit text,
  checked_at text,
  synced_at timestamptz default now()
);

alter table product_inventory enable row level security;

create policy "public read access" on product_inventory for select using (true);

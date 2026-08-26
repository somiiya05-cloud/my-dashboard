-- 재고 CSV/엑셀 수동 업로드 기능을 위한 마이그레이션
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table product_inventory add column if not exists available_stock numeric;
alter table product_inventory drop column if exists ready_trans_stock;

create policy "public insert access" on product_inventory for insert with check (true);
create policy "public update access" on product_inventory for update using (true);
create policy "public delete access" on product_inventory for delete using (true);

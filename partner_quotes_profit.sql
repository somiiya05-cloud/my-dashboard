-- 견적서별 손익 계산
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다.
--
-- 거래처별로 따로 쓰던 "매입 손익.xlsx" 를 견적서 화면에서 바로 계산합니다.
-- 그 파일들이 쓰던 계산식을 그대로 옮깁니다.
--
--   최종공급액 = 단가 × 수량              (견적서 품목에 이미 있음)
--   부가세     = 최종공급액 ÷ 11
--   경비       = 최종공급액 × 경비율(24%)
--   원가       = 개당원가 × 수량          (원가 대시보드 product_cost 에서 가져옴)
--   손익       = 최종공급액 − (원가 + 물류비 + 부가세 + 경비)
--   손익율     = 손익 ÷ 최종공급액

-- 견적서 한 장에 붙는 값
alter table partner_quotes add column if not exists logistics_cost numeric;              -- 물류비 (건별로 직접 입력)
alter table partner_quotes add column if not exists expense_rate   numeric default 0.24; -- 경비율 (기본 24%)

-- 품목 줄마다 붙는 값
-- 원가는 그때그때 product_cost 를 다시 읽지 않고 견적 시점 값을 박아 둡니다.
-- 원가가 나중에 바뀌어도 지난 견적서의 손익이 흔들리지 않게 하기 위함입니다.
alter table partner_quote_items add column if not exists unit_cost      numeric;
alter table partner_quote_items add column if not exists consumer_price numeric;          -- 소비자가 (공급율 보기용, 선택)
-- 이름이 달라 자동으로 못 찾는 상품을 원가 대시보드 항목과 손으로 이어 줍니다.
alter table partner_quote_items add column if not exists cost_product_id bigint references product_cost(id) on delete set null;

create index if not exists partner_quote_items_cost_product_idx on partner_quote_items (cost_product_id);

-- 확인 — 아래 5줄이 나오면 성공입니다.
select table_name as "표", column_name as "추가된 칸"
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'partner_quotes'      and column_name in ('logistics_cost', 'expense_rate')) or
    (table_name = 'partner_quote_items' and column_name in ('unit_cost', 'consumer_price', 'cost_product_id'))
  )
order by table_name, column_name;

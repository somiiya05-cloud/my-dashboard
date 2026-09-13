-- 진행 중 거래 건 관리에 "공급가 / 세액" 칸을 추가합니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 세금계산서를 끊을 때 쓰는 금액입니다.
--   · supply_amount : 공급가 (부가세 제외 금액)
--   · tax_amount    : 세액   (부가세. 수출 영세율이면 0)
-- 기존 expected_amount(예상 매출액)는 그대로 두고 따로 관리합니다.
--
-- 여러 번 실행해도 안전합니다 (if not exists).

alter table partner_deals add column if not exists supply_amount numeric;
alter table partner_deals add column if not exists tax_amount numeric;

-- 확인 — 아래 결과가 2줄 나오면 성공입니다.
select column_name as "추가된 칸", data_type as "형식"
from information_schema.columns
where table_schema = 'public'
  and table_name = 'partner_deals'
  and column_name in ('supply_amount', 'tax_amount')
order by column_name;

-- 매출 대시보드용 "묶음" 뷰
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- (sales_summary_views.sql 을 먼저 실행한 뒤에 이 파일을 실행해주세요)
--
-- 왜 만드나:
--   8월부터 매출을 주문 한 줄씩 넣기 시작해 행이 15배로 늘었습니다.
--   2~4월은 하루 33행이었는데 8~9월은 하루 1,600행입니다.
--   중복이 아니라 진짜 주문들입니다 — 예를 들어 2026-08-20 에는 같은 공동구매 상품
--   26,900원짜리 주문만 1,864건 있습니다.
--
--   그런데 대시보드는 어차피 (날짜 × 판매처 × 브랜드 × 상품)으로 합쳐서 씁니다.
--   그 단위로 미리 묶어 두면 9월 기준 34,485행 → 2,807행(12.3배)으로 줄어,
--   받는 요청이 35회에서 3회가 됩니다. 매출 합계는 그대로입니다.
--
--   tx_count 는 묶기 전 주문 줄 수입니다. 화면의 "총 거래 건수"가 이 값을 더해서
--   쓰기 때문에, 묶어도 건수는 예전과 똑같이 나옵니다.
--
-- 뷰라서 따로 갱신할 필요가 없습니다. 원본이 바뀌면 바로 따라옵니다.
-- 여러 번 실행해도 안전합니다.

create or replace view sales_daily_rollup as
select
  sale_date,
  vendor,
  brand,
  product_name,
  sum(quantity)::bigint as quantity,
  sum(amount)::bigint   as amount,
  count(*)::bigint      as tx_count
from sales_transactions
group by sale_date, vendor, brand, product_name;

-- 대시보드는 로그인 없이 publishable(anon) 키로 붙습니다. 읽기 권한을 열어 줍니다.
grant select on sales_daily_rollup to anon, authenticated;

-- 확인 — 묶은 뒤에도 매출 합계와 거래 건수가 원본과 같아야 합니다.
select
  (select count(*)   from sales_transactions)                as "원본 행수",
  (select count(*)   from sales_daily_rollup)                as "묶은 행수",
  (select sum(amount) from sales_transactions)               as "원본 매출",
  (select sum(amount) from sales_daily_rollup)               as "묶은 매출",
  (select sum(tx_count) from sales_daily_rollup)             as "묶음 건수합";

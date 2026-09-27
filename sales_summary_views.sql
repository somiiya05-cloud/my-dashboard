-- 매출 대시보드를 빠르게 하기 위한 요약 뷰 2개
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 왜 만드나:
--   대시보드는 열 때마다 sales_transactions 전체를 받아왔습니다.
--   2026-09 기준 99,742행 · 20.3MB · 요청 100회 · 11.7초이고, 하루 1,400행씩 늘어
--   시간이 갈수록 더 느려집니다.
--
--   화면이 실제로 쓰는 건 대부분 "고른 한 달"뿐인데, 월 목록과 증감추이 때문에
--   전체를 받아야 했습니다. 그 두 가지를 아래 요약 뷰가 대신하면
--   본문은 고른 달만 받아도 됩니다.
--
--   · sales_month_list : 달마다 1줄 (월 목록 · 월별 증감추이용)
--   · sales_date_list  : 날짜마다 1줄 (품별 화면의 일자 드롭다운용)
--
-- 뷰라서 따로 갱신할 필요가 없습니다. 원본이 바뀌면 바로 따라옵니다.
-- 여러 번 실행해도 안전합니다.

create or replace view sales_month_list as
select
  to_char(sale_date, 'YYYY-MM')        as month,
  sum(amount)::bigint                  as amount,
  sum(quantity)::bigint                as quantity,
  count(*)::bigint                     as row_count
from sales_transactions
group by 1;

create or replace view sales_date_list as
select
  sale_date,
  sum(amount)::bigint                  as amount,
  count(*)::bigint                     as row_count
from sales_transactions
group by 1;

-- 대시보드는 로그인 없이 publishable(anon) 키로 붙습니다. 읽기 권한을 열어 줍니다.
grant select on sales_month_list to anon, authenticated;
grant select on sales_date_list  to anon, authenticated;

-- 확인 — 월 목록이 나오면 성공입니다 (달 수만큼 줄이 나옵니다).
select month as "달", row_count as "행 수", amount as "매출"
from sales_month_list
order by month desc
limit 12;

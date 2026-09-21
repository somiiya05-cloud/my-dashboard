-- 쌓아둔 주문에 어떤 공구가 들어 있는지 한 줄로 보여 주는 뷰
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다 (create or replace).
--
-- 왜 필요한가:
--   공구 정산 계산의 공구 목록을 groupbuy_commission_rates 에서만 만들고 있어서,
--   특약 요율을 넣어 둔 공구만 고를 수 있었습니다. 주문은 쌓여 있는데 목록에 없어
--   데이원·로준홈·히히스카이라운지 같은 공구를 고를 수가 없었습니다.
--
--   목록을 만들자고 groupbuy_order_lines 를 통째로 읽어 오면(하루 50줄씩 쌓이면 1년에 2만 줄)
--   화면 열 때마다 낭비라, 공구 단위로 줄여 주는 뷰를 둡니다.

create or replace view groupbuy_campaigns as
select
  campaign_key,
  min(campaign)    as campaign,      -- 표기가 "X " / "X  " 로 흔들려 하나를 대표로 씁니다
  count(*)         as line_count,
  sum(amount)      as total_amount,
  min(order_date)  as first_date,
  max(order_date)  as last_date
from groupbuy_order_lines
group by campaign_key;

-- 대시보드는 로그인 없이 공개 키로 읽습니다. 밑에 깔린 표도 공개 읽기라 같은 수준입니다.
grant select on groupbuy_campaigns to anon, authenticated;

-- 확인 — 쌓아둔 공구가 줄줄이 나오면 성공입니다.
select campaign as "공구", line_count as "줄수", total_amount as "판매금액",
       first_date as "처음", last_date as "마지막"
from groupbuy_campaigns
order by total_amount desc;

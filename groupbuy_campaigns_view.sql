-- 쌓아둔 공구 주문을 "공구 × 날짜" 로 줄여 주는 뷰
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다 (create or replace).
--
-- 왜 날짜까지 남기나:
--   같은 셀러가 공구를 두 번 하면 기획전명이 같습니다(수아로움 9/4~9/13, 9/21~9/27 둘 다
--   "코드니처 X  수아로움 공동구매"). 공구 단위로만 합쳐 두면 2차 기간에 1차 매출이 붙어
--   버립니다. 날짜를 남겨 두면 화면이 일정표의 기간으로 잘라 쓸 수 있습니다.
--
--   그렇다고 groupbuy_order_lines 를 통째로 읽으면(하루 50줄씩 1년에 2만 줄) 화면 열 때마다
--   낭비인데, 공구×날짜로 줄이면 공구 10개에 한 달이면 100줄대라 가볍습니다.
--
-- 취소·반품·환불은 빼고 셉니다. 정산 화면이 쓰는 기준과 같아야 목록의 누적 매출과
-- 실제 정산 금액이 어긋나지 않습니다. 교환은 매출이 살아 있으므로 넣습니다.

drop view if exists groupbuy_campaigns;

create or replace view groupbuy_campaign_days as
select
  campaign_key,
  min(campaign)   as campaign,      -- 표기가 "X " / "X  " 로 흔들려 하나를 대표로 씁니다
  order_date,
  count(*)        as line_count,
  sum(amount)     as total_amount
from groupbuy_order_lines
where cs_status is null or cs_status !~ '취소|반품|환불'
group by campaign_key, order_date;

-- 대시보드는 로그인 없이 공개 키로 읽습니다. 밑에 깔린 표도 공개 읽기라 같은 수준입니다.
grant select on groupbuy_campaign_days to anon, authenticated;

-- 확인 — 공구별로 합쳐 보면 이렇게 나옵니다.
select campaign as "공구", sum(line_count) as "줄수", sum(total_amount) as "누적 매출",
       min(order_date) as "처음", max(order_date) as "마지막"
from groupbuy_campaign_days
group by campaign_key, campaign
order by 3 desc;

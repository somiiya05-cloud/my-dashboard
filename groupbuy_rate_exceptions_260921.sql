-- 공구별 수수료 특약 2건 등록 (2026-09-21 정산분)
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전합니다 (같은 공구·옵션이면 요율만 새로 씁니다).
--
-- 기준표 "(기본 요율)" 35줄은 이미 올리셨고, 아래는 그 기준표와 다르게 가는 예외만 넣습니다.
-- 공구별 요율이 있으면 기준표보다 먼저 쓰이고, 없으면 기준표를 씁니다.
--
--   1) 로라도라홈 — 하수구 악취 세정서버 1+1 (20ea) 은 기준표 25% 가 아니라 30% 특약입니다.
--   2) 수아로움   — 변기수조3+하수구2 가 40,900 말고 45,900 으로도 팔렸습니다. 기준표에는
--                  40,900 줄만 있어 45,900 건이 계산에서 빠집니다. 옵션 기준 25% 를 걸어
--                  값과 무관하게 붙게 합니다.
--
-- unit_price 를 비워 두는 이유: 값을 적어 두면 정산서의 "공구판매가" 칸에 그 값이 찍혀,
-- 45,900 에 팔린 줄이 40,900 으로 보입니다. 비워 두면 실제 팔린 값을 그대로 씁니다.
--
-- campaign 은 주문 파일의 "판매처 상품명" 과 글자 하나까지 같아야 합니다.
-- (X 뒤에 공백이 두 칸입니다 — 아래 값을 그대로 쓰세요)

insert into groupbuy_commission_rates
  (campaign, partner, option_name, option_key, unit_price, commission_rate)
values
  ('코드니처 X  로라도라홈 공동구매', '로라도라홈',
   '하수구 악취 세정서버 1+1 (20ea)', '하수구악취세정서버1+120ea', null, 0.30),
  ('코드니처 X  수아로움 공동구매', '수아로움',
   '변기수조 세정서버3 (18ea)+ 하수구 악취 세정서버2 (20ea)',
   '변기수조세정서버318ea+하수구악취세정서버220ea', null, 0.25)
on conflict (campaign, option_key) do update
  set commission_rate = excluded.commission_rate,
      partner         = excluded.partner,
      option_name     = excluded.option_name,
      unit_price      = excluded.unit_price;

-- 확인 — 아래가 2줄 나오면 성공입니다.
select campaign as "공구", option_name as "옵션", commission_rate as "요율"
from groupbuy_commission_rates
where campaign <> '(기본 요율)'
order by campaign;

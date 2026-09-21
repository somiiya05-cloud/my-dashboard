-- 견적서 자동 발행 점검 — Supabase 프로젝트 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
--
-- 읽기만 합니다. 표를 만들거나 고치거나 지우지 않으므로 몇 번을 돌려도 안전합니다.
-- 결과가 5덩이로 나옵니다. [1]~[4]는 데이터가 제대로 들어갔는지,
-- [5]는 수량별로 어떤 단가가 나올지를 화면과 같은 규칙으로 미리 보여줍니다.
--
-- ※ Supabase SQL Editor 는 마지막 SELECT 하나만 표로 보여줍니다.
--   덩이별로 보시려면 [1]부터 차례로 한 덩이씩 블록 선택 후 Run 하세요.


-- ─────────────────────────────────────────────────────────────
-- [1] 표 두 개가 만들어졌는지 — 2줄 나오면 정상
-- ─────────────────────────────────────────────────────────────
select table_name as "표 이름", count(*) as "칸 수"
from information_schema.columns
where table_schema = 'public'
  and table_name in ('partner_quotes', 'partner_quote_items')
group by table_name
order by table_name;


-- ─────────────────────────────────────────────────────────────
-- [2] 히스토리가 들어갔는지 — 견적서 4건, 품목 합계 16줄이면 정상
-- ─────────────────────────────────────────────────────────────
select q.quote_no as "견적번호", q.quote_date as "견적일", q.partner_name as "거래처",
       q.tax_type as "과세구분",
       to_char(q.total_amount, 'FM999,999,999') as "합계금액",
       count(i.id) as "품목 수", q.status as "상태", q.source as "출처"
from partner_quotes q
left join partner_quote_items i on i.quote_id = q.id
group by q.id, q.quote_no, q.quote_date, q.partner_name, q.tax_type, q.total_amount, q.status, q.source
order by q.quote_date;


-- ─────────────────────────────────────────────────────────────
-- [3] 공급가 + 세액 = 합계 가 맞는지 — "판정" 칸이 모두 OK 여야 정상
--     품목 금액을 다 더한 값이 합계와 같은지도 함께 봅니다.
-- ─────────────────────────────────────────────────────────────
select q.quote_no as "견적번호", q.tax_type as "과세구분",
       to_char(q.supply_amount, 'FM999,999,999') as "공급가",
       to_char(q.tax_amount,    'FM999,999,999') as "세액",
       to_char(q.total_amount,  'FM999,999,999') as "합계",
       case when q.supply_amount + q.tax_amount = q.total_amount then 'OK' else '불일치' end as "판정",
       to_char(coalesce(sum(i.amount), 0), 'FM999,999,999') as "품목 금액 합",
       case when coalesce(sum(i.amount), 0) = q.total_amount then 'OK' else '불일치' end as "품목합 판정"
from partner_quotes q
left join partner_quote_items i on i.quote_id = q.id
group by q.id, q.quote_no, q.tax_type, q.supply_amount, q.tax_amount, q.total_amount
order by q.quote_date;


-- ─────────────────────────────────────────────────────────────
-- [4] 같은 상품이 하나로 묶였는지
--     띄어쓰기가 달라도 product_key 가 같아야 "같은 상품"으로 봅니다.
--     "스트롱 제습 서버" 와 "스트롱제습서버" 가 한 줄로 묶여 나오면 정상입니다.
-- ─────────────────────────────────────────────────────────────
select i.product_key as "비교용 이름",
       string_agg(distinct i.product_name, ' / ') as "실제 적힌 품명",
       count(*) as "견적 건수",
       string_agg(i.qty || '개 ' || to_char(i.unit_price, 'FM999,999') || '원',
                  ', ' order by i.qty) as "수량별 단가"
from partner_quote_items i
join partner_quotes q on q.id = i.quote_id
where q.status <> '취소'
group by i.product_key
having count(*) > 1
order by count(*) desc;


-- ─────────────────────────────────────────────────────────────
-- [5] 수량별로 어떤 단가가 나올지 미리 보기  ★ 여기가 핵심
--
--     화면의 자동 발행과 같은 규칙을 SQL로 다시 쓴 것입니다.
--       · 이번 수량 "이하"의 과거 건 중 수량이 가장 큰 건을 씁니다
--       · 그런 건이 없으면 과거 중 수량이 가장 적은 건을 씁니다
--       · 같은 거래처 단가는 "같은 수량대"일 때만 씁니다
--
--     아래 "주문" 목록의 숫자만 바꿔 가며 돌려보시면 됩니다.
--     거래처명을 적으면 그 거래처 단가가 적용되는지도 같이 확인됩니다.
-- ─────────────────────────────────────────────────────────────
with 주문 (번호, 상품명, 수량, 거래처명) as (
  values
    (1, '스트롱제습서버',     51::numeric, null::text),
    (2, '스트롱제습서버',     600,         null),
    (3, '스트롱제습서버',     2000,        null),
    (4, '스트롱제습서버',     10,          null),
    (5, '스트롱 제습 서버',   51,          '까르멘기프트'),
    (6, '스트롱 제습 서버',   600,         '까르멘기프트'),
    (7, '스 트 롱 제습서버',  500,         null),
    (8, '캡모자 복구 클리너', 100,         null),
    (9, '신규상품XYZ',        50,          null)
)
select
  o.상품명                                  as "상품명",
  to_char(o.수량, 'FM999,999') || '개'      as "주문 수량",
  coalesce(o.거래처명, '-')                 as "거래처",
  case when 전체.unit_price is null then '이력 없음 — 초안 안 만듦'
       else to_char(case when 거래처.qty is not null and 거래처.qty = 전체.qty
                         then 거래처.unit_price else 전체.unit_price end,
                    'FM999,999') || '원'
  end                                       as "나올 단가",
  case when 전체.unit_price is null then '-'
       when 거래처.qty is not null and 거래처.qty = 전체.qty then '거래처 단가'
       else '물량 구간'
  end                                       as "적용 기준",
  case when 전체.unit_price is null then '-'
       else (case when 거래처.qty is not null and 거래처.qty = 전체.qty
                  then 거래처.partner_name || ' · ' || 거래처.quote_date || ' · '
                       || to_char(거래처.qty, 'FM999,999') || '개 '
                       || to_char(거래처.unit_price, 'FM999,999') || '원'
                  else 전체.partner_name || ' · ' || 전체.quote_date || ' · '
                       || to_char(전체.qty, 'FM999,999') || '개 '
                       || to_char(전체.unit_price, 'FM999,999') || '원' end)
  end                                       as "기준으로 삼은 과거 견적",
  case when 전체.unit_price is null then '-'
       else to_char(o.수량 * (case when 거래처.qty is not null and 거래처.qty = 전체.qty
                                   then 거래처.unit_price else 전체.unit_price end),
                    'FM999,999,999') || '원'
  end                                       as "견적 합계"
from 주문 o

-- 전체 이력에서 고른 수량 구간
left join lateral (
  select i.qty, i.unit_price, q.partner_name, q.quote_date
  from partner_quote_items i
  join partner_quotes q on q.id = i.quote_id
  where i.product_key = lower(regexp_replace(o.상품명, '[^0-9A-Za-z가-힣]', '', 'g'))
    and i.unit_price > 0
    and q.status <> '취소'
  order by (i.qty <= o.수량) desc,                              -- 구간 안에 드는 건을 먼저
           case when i.qty <= o.수량 then i.qty end desc nulls last,  -- 구간 안에서는 큰 수량
           case when i.qty >  o.수량 then i.qty end asc  nulls last,  -- 구간 밖이면 작은 수량
           q.quote_date desc                                    -- 같으면 최근 견적
  limit 1
) 전체 on true

-- 같은 거래처 이력에서 고른 수량 구간 (거래처명을 안 적었으면 아무것도 안 나옵니다)
left join lateral (
  select i.qty, i.unit_price, q.partner_name, q.quote_date
  from partner_quote_items i
  join partner_quotes q on q.id = i.quote_id
  where i.product_key = lower(regexp_replace(o.상품명, '[^0-9A-Za-z가-힣]', '', 'g'))
    and i.unit_price > 0
    and q.status <> '취소'
    and q.partner_id = (select p.id from partners p where p.name = o.거래처명 limit 1)
  order by (i.qty <= o.수량) desc,
           case when i.qty <= o.수량 then i.qty end desc nulls last,
           case when i.qty >  o.수량 then i.qty end asc  nulls last,
           q.quote_date desc
  limit 1
) 거래처 on true

order by o.번호;

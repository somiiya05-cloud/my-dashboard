-- 원가 연결 추가 — 확인된 것만 넣습니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에 붙여넣고 Run 하세요. 여러 번 돌려도 안전합니다.

-- 스트롱 에어컨 탈취 제습 서버(10p)
--   (10p) 는 10개입이 아니라 1개 기준이라고 확인받았습니다.
--   그래서 [코드니처] 스트롱 에어컨 제습 서버 의 개당원가 2,088원을 그대로 씁니다.
insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
select '스트롱에어컨탈취제습서버10p', '스트롱 에어컨 탈취 제습 서버(10p)', 483,
       '[코드니처] 스트롱 에어컨 제습 서버 2,088원 · (10p)는 1개 기준'
where exists (select 1 from product_cost c where c.id = 483)
  and not exists (select 1 from product_cost_aliases a where a.quote_product_key = '스트롱에어컨탈취제습서버10p');

-- 확인 — 연결이 9건이 되고, 맨 아래에 이 줄이 보이면 성공입니다.
select a.quote_product_name as "견적서 품명",
       c.product_name as "원가 대시보드 항목",
       coalesce(nullif(c.option_size, '-'), '') as "옵션",
       to_char(c.unit_cost_krw, 'FM999,999') || '원' as "개당원가"
from product_cost_aliases a
join product_cost c on c.id = a.cost_product_id
order by a.created_at;


-- ─────────────────────────────────────────────
-- 추가 — 가글
-- 개당원가는 원가 대시보드의 1,720원이 맞다고 확인받았습니다.
-- 집다운 손익 파일이 1,837원으로 잡고 있던 것이 잘못된 값이었습니다.
-- ─────────────────────────────────────────────
insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
select '가글', '가글', 307, '[빠이러스] ♡킬파이어 꽃 가글 1,720원'
where exists (select 1 from product_cost c where c.id = 307)
  and not exists (select 1 from product_cost_aliases a where a.quote_product_key = '가글');


-- ─────────────────────────────────────────────
-- 추가 — 확인받은 나머지 4건
--   액막이(루비)          → 액막이 명퉤 (하이곤 아님)
--   리모드매트리스_네이비   → 리모드 매트리스 NEW / Q (SS 아님)
--   기름흡수 프로 행주     → 기름제거 프로 행주 (이름만 다르고 같은 상품)
--   미니라이트            → [폴크] 미니 무드등
-- ─────────────────────────────────────────────
insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
select v.k, v.n, v.id, v.memo
from (values
  ('액막이루비',          '액막이(루비)',           374, '[명퉤] 액막이 명퉤 6,291원 — 하이곤(id383)이 아님'),
  ('리모드매트리스네이비',  '리모드매트리스_네이비',    350, '[잠비에] 리모드 매트리스 NEW / Q 20,700원 — SS(id348)가 아님'),
  ('기름흡수프로행주',     '기름흡수 프로 행주',      488, '[코드니처] 기름제거 프로 행주 390원 — 이름만 다르고 같은 상품'),
  ('미니라이트',          '미니라이트',             331, '[폴크] 미니 무드등 5,820원')
) as v(k, n, id, memo)
where exists (select 1 from product_cost c where c.id = v.id)
  and not exists (select 1 from product_cost_aliases a where a.quote_product_key = v.k);

-- 확인 — 연결이 14건이 되면 성공입니다.
select count(*) as "연결 건수" from product_cost_aliases;

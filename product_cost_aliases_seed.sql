-- 견적서 품명 ↔ 원가 대시보드 항목 연결
-- Supabase 프로젝트 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
-- product_cost_aliases.sql 을 먼저 실행하셨어야 합니다. 여러 번 돌려도 안전합니다.
--
-- 원가 대시보드의 상품명은 손대지 않습니다. 연결만 기록합니다.
-- quote_product_key 는 품명에서 띄어쓰기·기호를 뗀 값으로, 화면의 규칙과 같습니다.

-- ─────────────────────────────────────────────
-- A. 같은 상품으로 판단되는 것
-- ─────────────────────────────────────────────
insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
select v.k, v.n, v.id, v.memo
from (values
  ('러닝제습서버',              '러닝 제습 서버',                              347, '[라스마] 러닝 슈즈 제습 서버 2,220원 — "슈즈"만 빠진 이름'),
  ('킬파이어구취제거치약',       '킬파이어 구취제거 치약',                       309, '[빠이러스] 킬파이어 치약 1,290원'),
  ('슈즈탈취제습롱드라이팩',     '슈즈 탈취&제습 롱 드라이 팩',                  548, '[코드니처] 슈즈 롱 드라이팩 3,750원'),
  ('오행염주',                  '오행염주',                                   423, '[명퉤] 길운 오행 염주 3,324원 — 남자(id428)와 원가가 같습니다'),
  ('패딩세탁망롱패딩',           '패딩 세탁망 롱패딩',                          697, '[코드니처] 패딩 2중 압축 세탁망 V2 / 롱 2,760원'),
  ('패딩세탁망숏패딩',           '패딩 세탁망 숏패딩',                          698, '[코드니처] 패딩 2중 압축 세탁망 V2 / 숏 2,760원'),
  ('미니멀룸히말라야듀얼쿨링침구세트sss', '[미니멀룸] 히말라야 듀얼 쿨링 침구세트 S/SS', 134, '[미니멀룸] 히말라야 쿨링 침구세트 / SS 13,320원'),
  ('미니멀룸히말라야듀얼쿨링침구세트q',   '[미니멀룸] 히말라야 듀얼 쿨링 침구세트 Q',    137, '[미니멀룸] 히말라야 쿨링 침구세트 / Q 17,520원')
) as v(k, n, id, memo)
where exists (select 1 from product_cost c where c.id = v.id)
  and not exists (select 1 from product_cost_aliases a where a.quote_product_key = v.k);


-- ─────────────────────────────────────────────
-- B. 확인이 필요한 것 — 맞는 줄만 주석(--)을 풀고 Run 하세요
--    잘못 이으면 원가가 틀려 단가를 잘못 정하게 됩니다.
-- ─────────────────────────────────────────────

-- 기름흡수 프로 행주 → [코드니처] 기름제거 프로 행주 390원 (id488)
--   원가 대시보드에 "행주"는 이것 하나뿐입니다. 다만 이름이 "흡수" / "제거" 로 다르고,
--   그린종합상사에 2,100~2,550원에 견적을 냈으니 원가 390원이면 마진이 85%입니다.
-- insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
-- values ('기름흡수프로행주', '기름흡수 프로 행주', 488, '[코드니처] 기름제거 프로 행주 390원')
-- on conflict (quote_product_key) do nothing;

-- 액막이(루비) → 둘 중 어느 것인가요?
--   id374 [명퉤] 액막이 명퉤         6,291원
--   id383 [명퉤] 액막이 명퉤-하이곤   4,950원
--   (팀크리에이티브에 50개 25,900원으로 견적한 건입니다)
-- insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
-- values ('액막이루비', '액막이(루비)', 374, '[명퉤] 액막이 명퉤 6,291원')
-- on conflict (quote_product_key) do nothing;

-- 리모드매트리스_네이비 → 네이비는 색상이라 사이즈를 알 수 없습니다. 어느 것인가요?
--   id348 [잠비에] 리모드 매트리스 NEW / SS  18,300원
--   id350 [잠비에] 리모드 매트리스 NEW / Q   20,700원
--   (Double M 에 300개 95,400원으로 견적한 건입니다)
-- insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
-- values ('리모드매트리스네이비', '리모드매트리스_네이비', 348, '[잠비에] 리모드 매트리스 NEW / SS 18,300원')
-- on conflict (quote_product_key) do nothing;

-- 스트롱 에어컨 탈취 제습 서버(10p) → [코드니처] 스트롱 에어컨 제습 서버 2,088원 (id483)
--   ★ (10p) 가 10개입이면 원가는 20,880원이 되어야 합니다.
--     트리플렛츠에 72개 8,500원으로 견적한 건이라, 10개입이면 크게 적자입니다.
--     1개 기준이 맞는지 확인해주세요.
-- insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
-- values ('스트롱에어컨탈취제습서버10p', '스트롱 에어컨 탈취 제습 서버(10p)', 483, '[코드니처] 스트롱 에어컨 제습 서버 2,088원')
-- on conflict (quote_product_key) do nothing;

-- 가글 → [빠이러스] ♡킬파이어 꽃 가글 1,720원 (id307)
--   ★ 집다운 손익 파일은 가글 원가를 1,837원으로 잡고 있습니다. 어느 쪽이 맞나요?
-- insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
-- values ('가글', '가글', 307, '[빠이러스] ♡킬파이어 꽃 가글 1,720원')
-- on conflict (quote_product_key) do nothing;

-- 미니라이트 → [폴크] 미니 무드등 5,820원 (id331) 이 맞나요?
--   견적서 건명이 "폴크 미니라이트" 였고, 폴크 브랜드에 조명류가 이것들뿐입니다.
--   (남양유업·라한호텔에 500개 23,000원으로 견적한 건입니다)
-- insert into product_cost_aliases (quote_product_key, quote_product_name, cost_product_id, memo)
-- values ('미니라이트', '미니라이트', 331, '[폴크] 미니 무드등 5,820원')
-- on conflict (quote_product_key) do nothing;


-- 확인 — A만 실행하면 8건이 나옵니다.
select a.quote_product_name as "견적서 품명",
       c.product_name as "원가 대시보드 항목",
       coalesce(nullif(c.option_size, '-'), '') as "옵션",
       to_char(c.unit_cost_krw, 'FM999,999') || '원' as "개당원가"
from product_cost_aliases a
join product_cost c on c.id = a.cost_product_id
order by a.quote_product_name;

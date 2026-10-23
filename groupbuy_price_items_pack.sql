-- 공구 가격표 — 세트당 개입 수(객단가 계산용)
-- Supabase 프로젝트 대시보드 > SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
--   · pack_qty : 1세트에 든 낱개 수. 예) 키즈 성장 삭스 1set = 3개입 → 3
--     객단가 = 공구판매가 ÷ (구성 세트 수 × pack_qty). 비어 있으면 1로 봅니다(예전과 같음).
--     원가·택배비는 지금처럼 세트 기준입니다.

alter table groupbuy_price_items add column if not exists pack_qty numeric;

select column_name from information_schema.columns
where table_name = 'groupbuy_price_items' and column_name = 'pack_qty';

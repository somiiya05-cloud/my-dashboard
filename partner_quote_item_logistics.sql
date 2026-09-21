-- 품목 줄별 물류비
-- Supabase 프로젝트 대시보드 > SQL Editor 에 붙여넣고 Run 하세요.
-- partner_quotes_profit.sql 을 먼저 실행하셨어야 합니다. 여러 번 돌려도 안전합니다.
--
-- 수량 구간이 여러 개인 견적서는 줄마다 물류비가 다릅니다.
-- 히트유통 손익 파일을 보면 500개는 136,000원, 1,000개는 242,000원,
-- 메가스크럽티슈는 388,000원처럼 줄마다 따로 적혀 있습니다.
-- 견적서 한 장에 물류비 하나로는 이걸 맞출 수 없어 줄마다 칸을 둡니다.
--
-- 총 물류비 = 품목 줄 물류비 합 + 견적서 공통 물류비
--   · 줄마다 다르면 → 줄에 적습니다
--   · 건 전체에 한 번 붙는 비용이면 → 견적서 공통 물류비에 적습니다

alter table partner_quote_items add column if not exists logistics_cost numeric;

-- 확인 — 1줄 나오면 성공입니다.
select column_name as "추가된 칸", data_type as "형식"
from information_schema.columns
where table_schema = 'public'
  and table_name = 'partner_quote_items'
  and column_name = 'logistics_cost';

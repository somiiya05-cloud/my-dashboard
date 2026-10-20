-- 공구 가격표 — 유관부서가 "이 수수료면 손익이 어떻게 되나" 넣어 보는 To-be 수수료율 칸
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
--   · fee_rate      : As-is 수수료율. 영업팀만 고칩니다.
--   · fee_rate_tobe : To-be 수수료율. 유관부서가 넣어 보는 값이며 영업팀 화면에도 보입니다.

alter table groupbuy_price_items add column if not exists fee_rate_tobe numeric;

-- 확인 — 아래가 1줄 나오면 성공입니다.
select column_name as "추가된 칸"
from information_schema.columns
where table_schema = 'public' and table_name = 'groupbuy_price_items' and column_name = 'fee_rate_tobe';

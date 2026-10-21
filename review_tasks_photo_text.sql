-- 리뷰작업 표에 포토/텍스트 건수 칸을 추가합니다. (review_tasks.sql 실행 후)
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- review_count 는 그대로 두고 "합계"로 씁니다. 화면에서 포토·텍스트를 고치면
-- 둘을 더한 값이 review_count 에 같이 저장됩니다.

alter table review_tasks add column if not exists photo_count integer;
alter table review_tasks add column if not exists text_count integer;

-- 확인 — photo_count, text_count 두 줄이 나오면 성공입니다.
select column_name as "추가된 칸"
from information_schema.columns
where table_schema = 'public' and table_name = 'review_tasks'
  and column_name in ('photo_count', 'text_count');

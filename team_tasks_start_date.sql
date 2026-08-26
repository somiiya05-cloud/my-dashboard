-- 할일 관리에 시작일 컬럼 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table team_tasks add column if not exists start_date date;

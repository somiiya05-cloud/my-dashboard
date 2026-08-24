-- 할일 관리(일별 업무일지) 표 확장을 위한 컬럼 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table team_tasks add column if not exists category text;
alter table team_tasks add column if not exists detail text;
alter table team_tasks add column if not exists result_note text;
alter table team_tasks add column if not exists followup text;

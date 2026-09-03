-- 할일 목록에 "번호" 컬럼 추가 (입력하면 그 번호 순으로 자동 정렬됨)
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table team_tasks add column if not exists seq_no integer;

-- 할일 관리: 완료 처리 전 1차/2차 컨펌 체크박스 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table team_tasks add column if not exists confirm_1 boolean not null default false;
alter table team_tasks add column if not exists confirm_2 boolean not null default false;

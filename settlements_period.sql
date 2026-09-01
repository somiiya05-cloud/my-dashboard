-- 정산 테이블에 공동구매/수출 기간(시작일·종료일) 컬럼 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table settlements add column if not exists period_start date;
alter table settlements add column if not exists period_end date;

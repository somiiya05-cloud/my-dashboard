-- 정산 목록: 수금액 컬럼 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table settlements add column if not exists collected_amount numeric;

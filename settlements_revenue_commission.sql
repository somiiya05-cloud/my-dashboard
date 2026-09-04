-- 정산 목록: 정산액을 매출/수수료로 분리
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table settlements add column if not exists revenue numeric;
alter table settlements add column if not exists commission_rate numeric;
alter table settlements drop column if exists amount;

-- 기존 메모 내용은 요청에 따라 전부 비움
update settlements set memo = null;

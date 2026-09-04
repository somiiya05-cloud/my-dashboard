-- 정산 목록: 수수료를 %(비율)에서 원(금액) 단위로 변경
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table settlements rename column commission_rate to commission_amount;

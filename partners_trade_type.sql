-- 거래처 목록에 "구분"(수출 / B2B) 컬럼 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table partners add column if not exists trade_type text not null default '수출';

alter table partners drop constraint if exists partners_trade_type_check;
alter table partners add constraint partners_trade_type_check check (trade_type in ('수출', 'B2B'));

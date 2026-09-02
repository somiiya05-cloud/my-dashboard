-- 거래처 유형을 "바이어" 단일값으로 정리 (공급업체 유형 폐지)
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

update partners set type = '바이어' where type = '공급업체';
alter table partners alter column type set default '바이어';

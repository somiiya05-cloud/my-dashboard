-- 행사를 어느 달 실적으로 셀지 직접 정하는 칸입니다.
-- 구글시트 "이혜원_외부몰 행사 분석"의 맨 왼쪽 월 칸과 같은 역할입니다.
-- 비워두면 진행일정 시작일이 속한 달로 셉니다(지금까지 쓰던 방식).
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table promo_events add column if not exists month text; -- 'YYYY-MM'

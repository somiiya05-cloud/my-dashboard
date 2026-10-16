-- 팀 일정에 "끝나는 날" 넣기 (기간 일정)
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 유관부서 프로젝트처럼 며칠에 걸치는 일정을 달력에 띠로 길게 보이게 하려면
-- 시작일(event_date) 말고 끝나는 날이 필요합니다.
-- 비어 있으면 하루짜리 일정으로 봅니다.
--
-- 여러 번 실행해도 안전합니다.

alter table team_events add column if not exists end_date date;

-- 확인
select kind as "종류", event_date as "시작", end_date as "끝", title as "내용", who as "담당"
from team_events
order by event_date desc
limit 20;

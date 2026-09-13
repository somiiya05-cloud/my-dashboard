-- 전휘원 할일 관리에 "업무 기준"을 저장할 칸을 추가합니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 업무 기준과 업무 목적은 서로 다른 내용이라 칸을 나눠 저장합니다.
--   · criteria (업무 기준) → 업무명을 누르면 나옵니다.
--                            예) "메타 광고비만 60만원 사용 시 카페침투 진행"
--   · purpose  (업무 목적) → "업무목적" 버튼을 누르면 나옵니다.
--
-- 둘 다 업무명(title) 기준으로 저장되므로 날짜가 바뀌어도 그대로 따라옵니다.
-- 여러 번 실행해도 안전합니다.

alter table team_task_purposes add column if not exists criteria text;

-- 확인 — 아래 결과가 2줄(criteria, purpose) 나오면 성공입니다.
select column_name as "칸 이름", data_type as "형식"
from information_schema.columns
where table_schema = 'public'
  and table_name = 'team_task_purposes'
  and column_name in ('criteria', 'purpose')
order by column_name;

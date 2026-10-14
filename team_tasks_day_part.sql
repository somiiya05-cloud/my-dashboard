-- 업무를 오전 / 오후로 나누기
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 윤효선 할일 관리의 「하루 보기」 화면이 쓰는 칸입니다.
-- 값은 '오전' · '오후' 둘 중 하나이고, 안 정했으면 비어 있습니다(시간 미정).
--
-- 전휘원 쪽은 category 가 '오전 필수업무' / '오후 필수업무' 라 이 칸이 없어도 나뉩니다.
-- 그래서 전휘원 업무는 건드리지 않습니다.
--
-- 여러 번 실행해도 안전합니다.

alter table team_tasks add column if not exists day_part text;

-- 전휘원 루틴은 이미 category 로 나뉘어 있으니, 같은 값을 이 칸에도 채워 둡니다.
-- (나중에 두 화면이 같은 칸을 보게 되더라도 어긋나지 않게)
update team_tasks set day_part = '오전' where category = '오전 필수업무' and day_part is null;
update team_tasks set day_part = '오후' where category = '오후 필수업무' and day_part is null;

-- 확인
select coalesce(day_part, '(미정)') as "때", count(*) as "건수"
from team_tasks
group by 1
order by 1;

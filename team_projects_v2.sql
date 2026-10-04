-- 프로젝트형 업무 — 대분류 · 매출 영향 칸 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- (team_projects.sql 을 먼저 실행한 뒤에 이 파일을 실행해주세요)
--
-- 왜 더하나:
--   · category       업무를 7개 대분류로 묶어 봅니다
--                    (이커머스 판매채널계획 / 공동구매 관리 / B2B / 수출 /
--                     광고 관리 / 대만 시딩 / 큐텐)
--   · revenue_impact 매출에 바로 영향을 주는 건인지. 요약의 "매출 영향 업무"가 이걸 셉니다.
--
-- 상태값도 바뀌었습니다: 검토중 → 내부 검토.
-- 이미 "검토중"으로 넣어둔 줄이 있으면 아래 3)에서 같이 바꿉니다.
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 칸 추가
-- ---------------------------------------------------------------------------
alter table team_projects add column if not exists category text;
alter table team_projects add column if not exists revenue_impact boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2) 대분류로 자주 찾게 되므로 색인 하나
-- ---------------------------------------------------------------------------
create index if not exists team_projects_category_idx on team_projects (owner, category);

-- ---------------------------------------------------------------------------
-- 3) 예전 상태값 정리
-- ---------------------------------------------------------------------------
update team_projects set status = '내부 검토' where status = '검토중';

-- ---------------------------------------------------------------------------
-- 4) 확인
-- ---------------------------------------------------------------------------
select category as "대분류", name as "프로젝트", status as "상태",
       next_action as "다음 액션", next_action_due as "마감일",
       progress as "진척률", revenue_impact as "매출 영향"
from team_projects
where archived_at is null
order by category nulls last, next_action_due nulls last;

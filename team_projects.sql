-- 프로젝트형 업무 (윤효선 할일 관리 화면)
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 왜 만드나:
--   할일 관리는 "오늘 체크하는 업무" 구조라, 몇 달을 끌고 가는 건에는 맞지 않습니다.
--   그런 건은 완료/미완료보다 지금 어느 단계인지, 다음에 뭘 해야 하는지,
--   무엇 때문에 멈춰 있는지가 보여야 합니다. 그래서 따로 둡니다.
--
--   화면에서는 프로젝트 전체를 오늘 할 일로 올리지 않고, 프로젝트마다
--   "다음 액션" 한 줄만 오늘 할 일 맨 위에 자동으로 보여줍니다.
--
-- 하위 업무는 새로 입력하지 않습니다 — 할일 관리의 구분(category)이 프로젝트 이름과
-- 같으면 그 업무들을 하위 업무로 끌어와 보여줍니다. 다른 이름을 쓰려면
-- task_category 에 적어두면 그 구분을 끌어옵니다.
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 프로젝트
-- ---------------------------------------------------------------------------
create table if not exists team_projects (
  id bigserial primary key,
  owner text not null,                       -- 담당자
  name text not null,                        -- 프로젝트명
  purpose text,                              -- 프로젝트 목적
  stage text,                                -- 현재 단계
  next_action text,                          -- 다음 액션
  next_action_due date,                      -- 다음 액션 마감일
  status text not null default '기획중',      -- 기획중/진행중/검토중/외부 대기/병목/완료/보류
  blocker text,                              -- 대기·병목 사유
  progress int not null default 0,           -- 진척률 0~100
  lead_memo text,                            -- 파트장 메모
  links text,                                -- 관련 링크 (한 줄에 하나)
  next_meeting date,                         -- 다음 회의/보고 예정일
  task_category text,                        -- 하위 업무를 끌어올 구분 이름 (비우면 프로젝트명)
  sort_no int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz                    -- 치운 프로젝트 (지우지 않고 숨김)
);

create index if not exists team_projects_owner_idx on team_projects (owner, archived_at);

-- ---------------------------------------------------------------------------
-- 2) 프로젝트 히스토리 — 언제 무엇을 했는지 한 줄씩 쌓입니다
-- ---------------------------------------------------------------------------
create table if not exists team_project_notes (
  id bigserial primary key,
  project_id bigint not null references team_projects(id) on delete cascade,
  body text not null,
  author text,
  created_at timestamptz not null default now()
);

create index if not exists team_project_notes_pid_idx on team_project_notes (project_id, created_at);

-- ---------------------------------------------------------------------------
-- 3) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 표들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table team_projects enable row level security;
alter table team_project_notes enable row level security;

drop policy if exists "public read access" on team_projects;
drop policy if exists "public insert access" on team_projects;
drop policy if exists "public update access" on team_projects;
drop policy if exists "public delete access" on team_projects;

create policy "public read access" on team_projects for select using (true);
create policy "public insert access" on team_projects for insert with check (true);
create policy "public update access" on team_projects for update using (true);
create policy "public delete access" on team_projects for delete using (true);

drop policy if exists "public read access" on team_project_notes;
drop policy if exists "public insert access" on team_project_notes;
drop policy if exists "public update access" on team_project_notes;
drop policy if exists "public delete access" on team_project_notes;

create policy "public read access" on team_project_notes for select using (true);
create policy "public insert access" on team_project_notes for insert with check (true);
create policy "public update access" on team_project_notes for update using (true);
create policy "public delete access" on team_project_notes for delete using (true);

-- ---------------------------------------------------------------------------
-- 4) 확인 — 등록된 프로젝트가 나옵니다 (처음에는 비어 있습니다).
-- ---------------------------------------------------------------------------
select name as "프로젝트", status as "상태", stage as "현재 단계",
       next_action as "다음 액션", next_action_due as "마감일", progress as "진척률"
from team_projects
where archived_at is null
order by updated_at desc;

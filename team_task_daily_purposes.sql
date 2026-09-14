-- 전휘원 할일 관리의 "업무 목적"을 날짜별로 저장하는 테이블
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 왜 만드나:
--   원래 업무 목적은 team_task_purposes(업무명 1행)에 저장했습니다. 그래서 한 번 적으면
--   다음 날에도 같은 내용이 그대로 따라 나왔습니다. 목적은 "그날 이 업무를 왜 하는지"를
--   적는 칸이라, 날짜가 바뀌면 비어 있어야 하고 전날 적은 내용은 전날 날짜에 남아야 합니다.
--
-- 역할 분담:
--   · team_task_purposes.criteria  → 업무 기준. 날짜와 무관한 고정 규칙이라 그대로 둡니다.
--   · team_task_daily_purposes     → 업무 목적. (업무명 + 날짜) 조합으로 1행.
--   · team_task_purposes.purpose   → 더 이상 쓰지 않습니다. 아래 3)에서 날짜별 표로 옮깁니다.
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 테이블
-- ---------------------------------------------------------------------------
create table if not exists team_task_daily_purposes (
  id bigserial primary key,
  title text not null,
  due_date date not null,
  purpose text,
  updated_at timestamptz not null default now(),
  unique (title, due_date)
);

-- ---------------------------------------------------------------------------
-- 2) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 테이블들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table team_task_daily_purposes enable row level security;

drop policy if exists "public read access" on team_task_daily_purposes;
drop policy if exists "public insert access" on team_task_daily_purposes;
drop policy if exists "public update access" on team_task_daily_purposes;

create policy "public read access" on team_task_daily_purposes for select using (true);
create policy "public insert access" on team_task_daily_purposes for insert with check (true);
create policy "public update access" on team_task_daily_purposes for update using (true);

-- ---------------------------------------------------------------------------
-- 3) 이미 적어둔 업무 목적 옮기기 (한 번만 옮겨지고, 다시 실행해도 덮어쓰지 않습니다)
--    "마지막으로 저장한 날(한국 시간)"을 그 목적이 적힌 날짜로 봅니다.
-- ---------------------------------------------------------------------------
insert into team_task_daily_purposes (title, due_date, purpose, updated_at)
select title,
       (updated_at at time zone 'Asia/Seoul')::date as due_date,
       purpose,
       updated_at
from team_task_purposes
where purpose is not null and btrim(purpose) <> ''
on conflict (title, due_date) do nothing;

-- ---------------------------------------------------------------------------
-- 4) 확인 — 옮겨진 내용이 날짜와 함께 나옵니다.
-- ---------------------------------------------------------------------------
select due_date as "날짜", title as "업무명", purpose as "업무 목적"
from team_task_daily_purposes
order by due_date desc, title;

-- 팀 캘린더 일정 (회의 · 외근)
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 왜 따로 두나:
--   주간회의·외근 같은 건 "할 일"이 아니라 일정입니다. 할일 표(team_tasks)에 넣으면
--   체크를 안 했다고 "체크 누락"에 잡히고, 담당자 화면 목록에도 섞여 들어갑니다.
--   그래서 일정만 담는 표를 따로 둡니다.
--
-- 종류: 주간회의 / 외근 / 유관부서 미팅 / 팀 회의 / 월말회의 / 기타
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 표
-- ---------------------------------------------------------------------------
create table if not exists team_events (
  id bigserial primary key,
  event_date date not null,
  kind text not null,                -- 주간회의 · 외근 · 유관부서 미팅 · 팀 회의 · 월말회의 · 기타
  title text,                        -- 상세 내용 (선택)
  who text,                          -- 담당자 (비우면 팀 전체)
  created_at timestamptz not null default now()
);

create index if not exists team_events_date_idx on team_events (event_date);

-- ---------------------------------------------------------------------------
-- 2) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 표들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table team_events enable row level security;

drop policy if exists "public read access" on team_events;
drop policy if exists "public insert access" on team_events;
drop policy if exists "public update access" on team_events;
drop policy if exists "public delete access" on team_events;

create policy "public read access" on team_events for select using (true);
create policy "public insert access" on team_events for insert with check (true);
create policy "public update access" on team_events for update using (true);
create policy "public delete access" on team_events for delete using (true);

-- ---------------------------------------------------------------------------
-- 3) 확인
-- ---------------------------------------------------------------------------
select event_date as "날짜", kind as "종류", who as "담당자", title as "내용"
from team_events
order by event_date desc;

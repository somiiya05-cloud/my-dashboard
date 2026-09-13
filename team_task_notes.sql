-- 전휘원 할일 관리 "상세보기"의 업무 목적 · 파트장 코멘트 · 담당자 답글 저장용 테이블
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 이 파일 내용을 실행하세요.
--
-- 원래 브라우저 localStorage에 저장하던 내용을 DB로 옮긴 것입니다.
-- DB에 저장해야 파트장이 남긴 코멘트를 담당자가 자기 브라우저에서 볼 수 있습니다.
--
-- 저장 기준을 둘로 나눈 이유:
--   · 업무 목적  → 업무명(title) 기준. 루틴 업무는 매일 새 행으로 만들어지므로
--                  task_id로 저장하면 목적을 매일 다시 써야 합니다.
--   · 코멘트/답글 → task_id 기준. 그날 그 업무에 대한 이야기라 날짜별로 남아야 합니다.

-- 업무 1건(그날의 행)에 달리는 파트장 코멘트와 담당자 답글
create table if not exists team_task_notes (
  task_id bigint primary key references team_tasks(id) on delete cascade,
  lead_comment text,
  staff_reply text,
  updated_at timestamptz not null default now()
);

-- 업무명별 "이 업무를 왜 하는가". 날짜가 달라도 같은 업무면 그대로 따라옵니다.
create table if not exists team_task_purposes (
  title text primary key,
  purpose text,
  updated_at timestamptz not null default now()
);

alter table team_task_notes enable row level security;
alter table team_task_purposes enable row level security;

-- 대시보드는 publishable(anon) 키로 접속하므로 다른 테이블들과 같은 방식으로 열어둡니다.
create policy "public read access" on team_task_notes for select using (true);
create policy "public insert access" on team_task_notes for insert with check (true);
create policy "public update access" on team_task_notes for update using (true);

create policy "public read access" on team_task_purposes for select using (true);
create policy "public insert access" on team_task_purposes for insert with check (true);
create policy "public update access" on team_task_purposes for update using (true);

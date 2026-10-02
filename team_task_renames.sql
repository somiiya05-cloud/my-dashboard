-- 할일 관리에서 "업무명을 바꾼 내역"을 남기는 표
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 왜 만드나:
--   「이어가기」로 며칠에 걸쳐 하는 업무는 날마다 줄이 따로 있고, 그 줄들을 한 업무로
--   묶는 열쇠가 (담당자 + 업무명)입니다. 담당자 댓글도 이 묶음을 따라 어제 것이
--   오늘 줄에 같이 보입니다.
--
--   그런데 지난 기록은 그때 쓰던 이름 그대로 남아야 하므로, 이름을 바꿔도 지난 날짜
--   줄은 옛 이름으로 둡니다. 그러면 이름이 서로 달라져 묶음이 끊기고, 어제까지 적어둔
--   댓글이 사라진 것처럼 보입니다.
--
--   그래서 "옛 이름 ↔ 새 이름"을 여기에 한 줄 남겨두고, 화면에서는 이 둘을 같은
--   업무로 봅니다. 지난 기록의 이름은 그대로 두면서 댓글은 계속 이어집니다.
--
-- 이름을 여러 번 바꿔도(A → B → C) 줄이 하나씩 쌓이고, 화면은 셋을 한 묶음으로 봅니다.
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 표
-- ---------------------------------------------------------------------------
create table if not exists team_task_renames (
  id bigserial primary key,
  assignee text not null,
  old_title text not null,
  new_title text not null,
  renamed_at timestamptz not null default now(),
  unique (assignee, old_title, new_title)
);

-- ---------------------------------------------------------------------------
-- 2) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 표들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table team_task_renames enable row level security;

drop policy if exists "public read access" on team_task_renames;
drop policy if exists "public insert access" on team_task_renames;
drop policy if exists "public update access" on team_task_renames;

create policy "public read access" on team_task_renames for select using (true);
create policy "public insert access" on team_task_renames for insert with check (true);
create policy "public update access" on team_task_renames for update using (true);

-- ---------------------------------------------------------------------------
-- 3) 확인 — 지금까지 바꾼 내역이 나옵니다 (처음에는 비어 있습니다).
-- ---------------------------------------------------------------------------
select assignee as "담당자", old_title as "옛 이름", new_title as "새 이름", renamed_at as "바꾼 때"
from team_task_renames
order by renamed_at desc;

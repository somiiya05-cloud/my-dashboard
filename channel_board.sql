-- 채널별 운영 보드 (노션 보드처럼 카드를 끌어 옮기는 화면)
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- (channel_targets.sql 을 먼저 실행한 뒤에 이 파일을 실행해주세요)
--
-- 채널마다 칸이 하나씩 생기고, 그 안에 업무 카드를 자유롭게 적고 옮깁니다.
-- 칸 목록은 channel_targets 의 채널을 그대로 씁니다 (따로 관리하지 않습니다).
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 표
-- ---------------------------------------------------------------------------
create table if not exists channel_board (
  id bigserial primary key,
  channel text not null,                 -- 어느 칸에 있는지
  body text not null default '',         -- 카드 내용
  owner text,                            -- 담당 (선택)
  due_date date,                         -- 마감일 (선택)
  done boolean not null default false,   -- 끝낸 카드
  sort_no int not null default 0,        -- 칸 안에서의 차례
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists channel_board_ch_idx on channel_board (channel, sort_no);

-- ---------------------------------------------------------------------------
-- 2) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 표들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table channel_board enable row level security;

drop policy if exists "public read access" on channel_board;
drop policy if exists "public insert access" on channel_board;
drop policy if exists "public update access" on channel_board;
drop policy if exists "public delete access" on channel_board;

create policy "public read access" on channel_board for select using (true);
create policy "public insert access" on channel_board for insert with check (true);
create policy "public update access" on channel_board for update using (true);
create policy "public delete access" on channel_board for delete using (true);

-- ---------------------------------------------------------------------------
-- 3) 확인
-- ---------------------------------------------------------------------------
select channel as "채널", body as "내용", owner as "담당", due_date as "마감일", done as "완료"
from channel_board
order by channel, sort_no;

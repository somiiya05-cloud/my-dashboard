-- 채널별 매출 계획 트래커
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 「채널별 매출 계획 수립」 프로젝트를 누르면 열리는 화면이 쓰는 표입니다.
-- 몰마다 한 줄씩, 달마다 따로 기록합니다 (쿠팡 · 스마트스토어 · 톡딜 · 컬리 · 오픈마켓 …).
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 표 — (달 + 채널) 조합으로 한 줄
-- ---------------------------------------------------------------------------
create table if not exists channel_targets (
  id bigserial primary key,
  month text not null,                      -- 'YYYY-MM'
  channel text not null,                    -- 쿠팡 · 스마트스토어 · 톡딜 …
  target_amount bigint not null default 0,  -- 그 달 목표 매출
  action text,                              -- 운영 액션
  owner text,                               -- 담당
  status text not null default '계획',       -- 계획 · 진행중 · 완료 · 보류
  memo text,
  sort_no int not null default 0,
  updated_at timestamptz not null default now(),
  unique (month, channel)
);

create index if not exists channel_targets_month_idx on channel_targets (month, sort_no);

-- ---------------------------------------------------------------------------
-- 2) 프로젝트에 "트래커" 표시 칸 — 이 칸이 채워진 프로젝트 카드에만 [트래커] 버튼이 붙습니다
-- ---------------------------------------------------------------------------
alter table team_projects add column if not exists tracker text;
update team_projects set tracker = 'channel' where name = '채널별 매출 계획 수립';

-- ---------------------------------------------------------------------------
-- 3) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 표들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table channel_targets enable row level security;

drop policy if exists "public read access" on channel_targets;
drop policy if exists "public insert access" on channel_targets;
drop policy if exists "public update access" on channel_targets;
drop policy if exists "public delete access" on channel_targets;

create policy "public read access" on channel_targets for select using (true);
create policy "public insert access" on channel_targets for insert with check (true);
create policy "public update access" on channel_targets for update using (true);
create policy "public delete access" on channel_targets for delete using (true);

-- ---------------------------------------------------------------------------
-- 4) 확인
-- ---------------------------------------------------------------------------
select month as "달", channel as "채널", target_amount as "목표 매출",
       action as "운영 액션", owner as "담당", status as "상태"
from channel_targets
order by month desc, sort_no;

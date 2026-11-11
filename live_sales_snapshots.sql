-- 실시간 매출 시각별 스냅숏 (2026-11-11)
-- 감시 프로그램(sales.py watch)이 10시·14시·18시에 4개 몰을 받고, 그 순간의 몰별 누적 매출을 여기 한 줄씩 남긴다.
-- live-sales.html 「매출 목표 점검」의 10시·14시·18시 칸이 오늘 값과 지난 7일 같은 시각 평균을 여기서 읽는다.
-- Supabase SQL Editor 에서 한 번 실행.
create table if not exists live_sales_snapshots (
  date      date        not null,
  slot      smallint    not null,          -- 10 / 14 / 18
  mall      text        not null,
  amount    numeric     not null default 0,
  orders    int,
  ok        boolean     not null default true,   -- 그 몰을 이번에 제대로 받았는지(실패면 직전 저장값을 적음)
  taken_at  timestamptz not null default now(),
  primary key (date, slot, mall)
);
alter table live_sales_snapshots enable row level security;
drop policy if exists "public all" on live_sales_snapshots;
create policy "public all" on live_sales_snapshots for all using (true) with check (true);

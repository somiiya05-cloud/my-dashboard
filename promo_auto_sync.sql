-- 프로모션 일정에 등록한 외부몰 행사를, 프로모션 매출 화면을 열 때 자동으로 끌어오게 합니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

-- 1) 어느 일정에서 온 행사인지 기억해 둡니다. 직접 만든 행사는 비어 있습니다.
alter table promo_events add column if not exists mall_event_id bigint;

create unique index if not exists promo_events_mall_event_id_key
  on promo_events(mall_event_id) where mall_event_id is not null;

-- 2) 프로모션 매출에서 지운 일정 행사는 다시 끌어오지 않습니다.
--    (안 그러면 지워도 화면을 열 때마다 되살아납니다.)
create table if not exists promo_ignored_mall_events (
  mall_event_id bigint primary key,
  ignored_at timestamptz not null default now()
);

alter table promo_ignored_mall_events enable row level security;

create policy "public read access" on promo_ignored_mall_events for select using (true);
create policy "public insert access" on promo_ignored_mall_events for insert with check (true);
create policy "public delete access" on promo_ignored_mall_events for delete using (true);

-- 3) 이미 넣어둔 행사들을 일정과 이어 붙입니다(기획전명 + 시작일이 같은 것).
with upd as (
  update promo_events p
     set mall_event_id = m.id
    from mall_events m
   where p.mall_event_id is null
     and p.title = m.title
     and p.start_date = m.start_date
  returning 1
)
select count(*) as 이어붙인_행사 from upd;

-- 4) 스마트스토어 행사는 매출에서 빼기로 했으니 자동으로 들어오지 않게 막아둡니다.
with ins as (
  insert into promo_ignored_mall_events (mall_event_id)
  select id from mall_events where mall like '%스마트스토어%'
  on conflict (mall_event_id) do nothing
  returning 1
)
select count(*) as 자동수집_제외 from ins;

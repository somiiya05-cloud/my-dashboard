-- 지금 켜져 있는 메타 광고 목록 — api/sync-meta-ads.js 가 매일 브랜드 계정마다 통째로 바꿔 넣는다.
-- 실시간 매출(live-sales.html) 쿠팡 탭이 광고·캠페인 이름을 상품 묶기 규칙(live_item_rules)으로 맞춰
-- 상품명 왼쪽에 「메타」 뱃지를 붙인다(11/12).
-- Supabase SQL Editor 에서 한 번 실행.
create table if not exists meta_active_ads (
  ad_id text primary key,
  channel text not null,            -- '메타 코드니처' 처럼 ad_performance 와 같은 채널명
  ad_name text,
  adset_name text,
  campaign_name text,
  spend_7d numeric not null default 0,   -- 최근 7일 광고비(원, VAT 별도)
  synced_at timestamptz not null default now()
);
create index if not exists meta_active_ads_channel_idx on meta_active_ads(channel);

alter table meta_active_ads enable row level security;
drop policy if exists "public read" on meta_active_ads;
create policy "public read" on meta_active_ads for select using (true);

-- API 가 새 표를 바로 알아보게 표 목록을 다시 읽힌다(안 하면 'Could not find the table' 404 가 날 수 있음)
notify pgrst, 'reload schema';

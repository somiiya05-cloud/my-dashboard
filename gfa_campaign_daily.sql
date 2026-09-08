-- 네이버 GFA(디스플레이 광고) 캠페인×날짜 단위 성과를 저장합니다.
-- GFA는 공식 API가 없어 엑셀 리포트를 업로드하는데, 그 리포트가 실제로는
-- 캠페인×날짜 단위라서(월 합계로 뭉개지 않고) 그대로 살려서 저장합니다.
-- ad-marketing-dashboard의 uploadGfaDailyReport()가 씁니다.
-- 기존 ad_performance_daily(SA용)와는 완전히 분리된 테이블입니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists gfa_campaign_daily (
  id bigint generated always as identity primary key,
  date date not null,
  channel text not null,
  campaign text not null,
  campaign_purpose text,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions bigint not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (date, channel, campaign)
);

alter table gfa_campaign_daily enable row level security;

create policy "public read access" on gfa_campaign_daily for select using (true);

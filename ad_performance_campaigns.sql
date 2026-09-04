-- 마케팅대시보드 브랜드별 페이지의 "캠페인별 성과" 표에 쓰이는 테이블
-- ad_performance(월 · 채널 합계)와 별도로, 같은 월 · 채널 안에서 캠페인 단위로 더
-- 잘게 쪼갠 데이터를 저장합니다. api/sync-naver-ads.js가 service role(secret) key로 씁니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists ad_performance_campaigns (
  id bigint generated always as identity primary key,
  month text not null,
  channel text not null,
  campaign text not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions bigint not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (month, channel, campaign)
);

alter table ad_performance_campaigns enable row level security;

create policy "public read access" on ad_performance_campaigns for select using (true);

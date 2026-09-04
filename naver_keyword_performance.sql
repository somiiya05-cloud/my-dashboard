-- 마케팅대시보드 브랜드별 페이지의 "낭비 키워드" 표에 쓰이는 테이블
-- 캠페인/광고그룹/키워드 단위로 월간 성과를 저장합니다.
-- api/sync-naver-keywords.js가 service role(secret) key로 씁니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists naver_keyword_performance (
  id bigint generated always as identity primary key,
  month text not null,
  channel text not null,
  campaign text not null,
  adgroup text not null,
  keyword text not null,
  keyword_id text not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions bigint not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (month, keyword_id)
);

alter table naver_keyword_performance enable row level security;

create policy "public read access" on naver_keyword_performance for select using (true);

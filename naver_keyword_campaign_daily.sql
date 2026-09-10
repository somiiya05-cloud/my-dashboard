-- 네이버 SA(검색광고) 캠페인·키워드 성과를 "일 단위"로 저장하는 테이블 두 개.
-- 기존 naver_keyword_performance / ad_performance_campaigns(ad_type=SA)는 월 합계만
-- 저장해서 상세 성과(캠페인/키워드/낭비 키워드) 화면을 월 단위로만 볼 수 있었다.
-- 네이버 API 호출 비용은 "조회 기간 길이"가 아니라 "id 개수"로 매겨지기 때문에,
-- 월 전체를 한 번에 조회하나 하루만 조회하나 API 호출량은 같다 — 그래서 매일
-- "어제 하루"만 별도로 조회해서 날짜별로 쌓으면, 지금과 같은 호출량으로 일별
-- 데이터를 얻을 수 있다(GFA 페이지와 같은 방식).
-- sync-naver-keywords.js의 mode=daily 가 씁니다.
-- 기존 월간 테이블은 그대로 두고 건드리지 않습니다(이 두 테이블은 완전히 별개, 추가 전용).
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists naver_keyword_performance_daily (
  id bigint generated always as identity primary key,
  date date not null,
  channel text not null,
  campaign text not null,
  adgroup text not null,
  keyword text not null,
  keyword_id text not null,
  landing_url text,
  sales_channel text,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions bigint not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (date, keyword_id)
);
alter table naver_keyword_performance_daily enable row level security;
-- 동기화는 Vercel 서버리스 함수가 서비스 롤 키로 서버사이드에서만 쓰므로(브라우저 업로드 없음)
-- insert/update 정책은 필요 없고, 대시보드가 anon 키로 읽을 select 정책만 열면 된다.
create policy "public read access" on naver_keyword_performance_daily for select using (true);

create table if not exists naver_campaign_performance_daily (
  id bigint generated always as identity primary key,
  date date not null,
  channel text not null,
  campaign text not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  conversions bigint not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (date, channel, campaign)
);
alter table naver_campaign_performance_daily enable row level security;
create policy "public read access" on naver_campaign_performance_daily for select using (true);

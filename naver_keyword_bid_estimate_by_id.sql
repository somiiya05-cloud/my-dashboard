-- 네이버 순위별 예상 입찰가를 "우리 키워드 ID" 기준으로 받아 저장한다 (2026-09-13).
-- 키워드 글자 기준(naver_keyword_bid_estimate)은 시장 평균이라 우리 광고의 품질지수를 모른다 —
-- 대조해 보니 추정 순위가 실제와 1위 이내로 맞는 게 절반(47%)뿐이었다(옷얼룩제거제: 추정 4위, 실제 더 위).
-- POST /estimate/average-position-bid/id 는 그 키워드의 품질지수를 반영한다. 단, 키워드를 가진 광고 계정으로
-- 요청해야 해서 키워드 성과 표에 계정 칸(account_id)을 같이 둔다.
--   naver_keyword_performance(_daily).account_id : sync-naver-keywords.js 가 채운다('1' | '2')
--   naver_keyword_bid_estimate_by_id               : sync-naver-bid-estimates.js ?by=id 가 채운다
-- 전부 추가만 한다(기존 칸·표·데이터는 그대로). 두 파일을 배포하기 "전에" 먼저 실행하세요.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table naver_keyword_performance_daily add column if not exists account_id text;
alter table naver_keyword_performance add column if not exists account_id text;

create table if not exists naver_keyword_bid_estimate_by_id (
  id bigint generated always as identity primary key,
  date date not null,
  device text not null,          -- 'MOBILE' | 'PC'
  keyword_id text not null,      -- nccKeywordId
  keyword text,                  -- 보기 편하라고 같이 둠
  position int not null,         -- 1 ~ 5
  bid integer,                   -- 우리 키워드를 그 순위에 올리는 데 필요한 예상 입찰가(원)
  updated_at timestamptz not null default now(),
  unique (date, device, keyword_id, position)
);
alter table naver_keyword_bid_estimate_by_id enable row level security;
create policy "public read access" on naver_keyword_bid_estimate_by_id for select using (true);

notify pgrst, 'reload schema';

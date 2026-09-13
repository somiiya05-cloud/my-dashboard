-- 네이버 파워링크 「순위별 예상 입찰가」를 날마다 저장한다 (2026-09-13).
-- 대시보드 키워드 표의 「예상 순위」 칸이 쓴다 — 지금 입찰가와 권장 입찰가로 각각 몇 위쯤 되는지.
--   네이버 API: POST /estimate/average-position-bid/keyword  (키워드 · 기기 · 순위 → 그 순위에 필요한 입찰가)
--   키워드 "글자" 기준 시장 추정치라 캠페인·계정과 무관하다(같은 키워드면 하나만 저장).
--   실제 순위는 품질지수에 따라 달라질 수 있다.
-- sync-naver-bid-estimates.js 가 채운다. 그 파일을 배포하기 "전에" 먼저 실행하세요.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists naver_keyword_bid_estimate (
  id bigint generated always as identity primary key,
  date date not null,
  device text not null,          -- 'MOBILE' | 'PC'
  keyword text not null,
  position int not null,         -- 1 ~ 5
  bid integer,                   -- 그 순위에 필요한 예상 입찰가(원)
  updated_at timestamptz not null default now(),
  unique (date, device, keyword, position)
);
alter table naver_keyword_bid_estimate enable row level security;
-- 동기화는 서비스 롤 키로 서버에서만 쓰므로 select 정책만 연다(대시보드가 anon 키로 읽음).
drop policy if exists "public read access" on naver_keyword_bid_estimate;
create policy "public read access" on naver_keyword_bid_estimate for select using (true);

notify pgrst, 'reload schema';

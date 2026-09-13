-- 네이버 키워드 입찰가·평균 노출 순위를 키워드 성과 표에 같이 저장한다 (2026-09-13).
-- 대시보드 키워드 표의 「현재 입찰가 · 평균 순위 · 권장 입찰가」 칸이 쓴다.
--   bid_amt       : 동기화하던 그 시점의 실제 입찰가(원). 키워드가 광고그룹 입찰가를 따르면
--                   광고그룹 입찰가를 넣는다. 날짜별로 쌓이므로 입찰가를 바꾼 뒤 효과도 볼 수 있다.
--   use_group_bid : true 면 광고그룹 입찰가를 쓰는 키워드 — 이 키워드만 바꾸려면
--                   네이버 광고관리자에서 키워드 입찰가를 따로 지정해야 한다.
--   avg_rank      : 네이버 통계의 평균 노출 순위(avgRnk). 1 에 가까울수록 위.
-- 셋 다 비어 있어도 되는 칸이라 기존 행·기존 동기화에는 영향이 없다.
-- sync-naver-keywords.js 가 이 칸을 채우므로, 그 파일을 배포하기 "전에" 먼저 실행하세요
-- (칸이 없으면 upsert 가 알 수 없는 칸이라며 실패합니다).
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table naver_keyword_performance_daily
  add column if not exists bid_amt integer,
  add column if not exists use_group_bid boolean,
  add column if not exists avg_rank numeric;

alter table naver_keyword_performance
  add column if not exists bid_amt integer,
  add column if not exists use_group_bid boolean,
  add column if not exists avg_rank numeric;

-- API(PostgREST)가 새 칸을 바로 알아보게 스키마 캐시를 새로 읽힌다.
notify pgrst, 'reload schema';

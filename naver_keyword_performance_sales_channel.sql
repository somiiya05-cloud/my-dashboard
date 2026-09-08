-- naver_keyword_performance에 랜딩페이지 URL/판매채널(자사몰·스마트스토어) 컬럼을 추가합니다.
-- 네이버 검색광고는 랜딩 URL이 키워드가 아니라 광고그룹의 소재(광고) 단위로 설정되므로,
-- 같은 광고그룹에 속한 키워드는 모두 같은 값을 갖습니다(광고그룹의 대표 소재 1건 기준).
-- api/sync-naver-keywords.js가 채웁니다. Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table naver_keyword_performance
  add column if not exists landing_url text,
  add column if not exists sales_channel text;

-- 히든링크(비밀링크) 가격 — 자사몰 검수가 상품 페이지에서 읽어 넣습니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--
--   · price            : 상품 페이지의 판매가(product:sale_price:amount). 외부몰 판매가 '히든가' 칸과
--                        공구 가격표 손익 짜기의 '자사몰 히든가'가 이 값을 씁니다.
--   · price_checked_at : 마지막으로 읽은 시각

alter table mall_hidden_links add column if not exists price numeric;
alter table mall_hidden_links add column if not exists price_checked_at timestamptz;

select column_name from information_schema.columns
where table_name = 'mall_hidden_links' and column_name in ('price', 'price_checked_at');

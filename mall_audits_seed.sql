-- 자사몰 검수 초기 데이터입니다. mall_audits.sql 을 먼저 실행한 뒤 이 파일을 실행하세요.
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
--   · mall_sites        : 크롬 북마크 "자사몰" 폴더에 있던 9개 몰 (전부 카페24)
--   · mall_hidden_links : 2026-09-15 전수 탐색(2,179건 조회)으로 찾은,
--                         지금 정상적으로 숨어 있는 상품 174건
--                         (사이트맵에는 없는데 상세페이지는 열리는 상품 = 링크를 아는 사람만 들어옴)
--
-- 이 목록이 "원래 숨어 있어야 하는 기준"이 됩니다.
-- 앞으로 매일 검수하면서 이 중 하나라도 공개 목록에 뜨면 노출 사고로 알립니다.
--
-- 여러 번 실행해도 안전합니다(중복이 쌓이지 않습니다).


-- ── 검수 대상 자사몰 9곳 ────────────────────────────────────────────────
insert into mall_sites (brand, url, platform, sort_order) values
  ('빠이러스',         'https://byerus.com',        'cafe24', 1),
  ('글로리핏',         'https://gloryfit.co.kr',    'cafe24', 2),
  ('잠비에',           'https://zamvie.com',        'cafe24', 3),
  ('코드니처',         'https://codenit.co.kr',     'cafe24', 4),
  ('미니멀룸',         'https://minimalroom.co.kr', 'cafe24', 5),
  ('라이프스타일마트', 'https://lifestylemart.kr',  'cafe24', 6),
  ('멜루션',           'https://mellution.com',     'cafe24', 7),
  ('그로우뮤즈',       'https://growmuse.kr',       'cafe24', 8),
  ('명퉤',             'https://mtwey.com',         'cafe24', 9)
on conflict (brand) do update
  set url = excluded.url, platform = excluded.platform, sort_order = excluded.sort_order;


-- ── 지금 숨어 있는 히든링크 174건 ───────────────────────────────────────
-- 몰별로 상품번호만 쉼표로 묶어 두고, 아래에서 한 줄씩 풀어 넣습니다.
-- (글로리핏은 히든 상품이 하나도 없어서 목록에 없습니다)
insert into mall_hidden_links (brand, product_code, url, memo)
select
  t.brand,
  c.code,
  'https://' || t.host || '/product/detail.html?product_no=' || c.code,
  '최초 전수탐색 2026-09-15'
from (values
  ('빠이러스',         'byerus.com',        '21,29,32,34,35,37,40,42,45'),
  ('잠비에',           'zamvie.com',        '17,21,22,29,33'),
  ('코드니처',         'codenit.co.kr',     '44,45,46,47,48,49,50,51,52,53,76,77,78,79,82,83,86,87,88,89,90,92,96,98,99,101,102,103,107,109,110,112,113,114,116'),
  ('미니멀룸',         'minimalroom.co.kr', '25,26,27,32,42,45,46,47,48,51,85,88,89,90,96,98,99,102,114,115,116,119,120,121,122,123,126,128,134,135,142,144,145,146,147,148,149,151,153,154,155,156,159,160,161,162,163,164,165,166,167'),
  ('라이프스타일마트', 'lifestylemart.kr',  '867,1103,1106,1388,1390,1400,1404,1406,1409,1412,1414,1418,1428,1429,1433,1435,1436,1437,1438,1439,1443,1444,1446,1448,1451,1455,1464,1465,1469,1470,1476'),
  ('멜루션',           'mellution.com',     '41'),
  ('그로우뮤즈',       'growmuse.kr',       '1,2,3,4,5,6,7,8,9,10,11,12,13,17,19,20,22,23,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44'),
  ('명퉤',             'mtwey.com',         '27,48,51,63')
) as t(brand, host, codes),
lateral unnest(string_to_array(t.codes, ',')) as c(code)
on conflict (brand, product_code) do nothing;


-- 확인 — 몰 9곳과 히든링크 174건이 나오면 성공입니다.
select
  (select count(*) from mall_sites where is_active) as "검수 대상 몰",
  (select count(*) from mall_hidden_links where is_active) as "등록된 히든링크";

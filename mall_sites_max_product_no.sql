-- 자사몰 검수: "지금까지 본 가장 큰 상품번호"를 몰마다 기억해 두는 칸입니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 왜 필요한가
--   새 상품코드는 늘 기존 최대 번호보다 위에 생기므로, 그 위쪽만 확인해 찾습니다.
--   그런데 기준이 되는 "알던 최대 번호"를 직전 검수의 공개 상품 목록에서 뽑으면,
--   상품을 미진열로 숨기는 순간 그 번호가 목록에서 빠지면서 기준이 뒤로 물러납니다.
--   그러면 이미 알고 있던 상품이 "새 코드"로 다시 잡힙니다.
--   (실제로 멜루션 47번을 숨긴 다음 날 그런 일이 있었습니다)
--
--   그래서 한 번 본 최대 번호는 절대 내려가지 않게 여기에 따로 적어 둡니다.

alter table mall_sites add column if not exists max_product_no integer not null default 0;

-- 지금까지 쌓인 기록에서 몰별 최대 번호를 채워 넣습니다.
-- 공개 상품(products)뿐 아니라 미진열로 잡혔던 신규 상품(new_products)까지 봐야 합니다.
-- 미진열 상품은 사이트맵에 없어서 products 에는 안 들어 있기 때문입니다.
-- (앞으로는 검수할 때마다 scripts/mall-audit.js 가 알아서 올려 둡니다)
with seen as (
  select a.brand, max((p ->> 'product_no')::int) as no
  from mall_audits a, lateral jsonb_array_elements(a.products) as p
  where jsonb_typeof(a.products) = 'array'
  group by a.brand
  union all
  select a.brand, max((p ->> 'product_no')::int) as no
  from mall_audits a, lateral jsonb_array_elements(a.new_products) as p
  where jsonb_typeof(a.new_products) = 'array'
  group by a.brand
  union all
  select brand, max(product_code::int) as no
  from mall_hidden_links
  where product_code ~ '^[0-9]+$'
  group by brand
)
update mall_sites s
set max_product_no = greatest(s.max_product_no, x.no)
from (select brand, max(no) as no from seen group by brand) x
where s.brand = x.brand;

-- 확인 — 몰별로 기억해 둔 최대 번호가 나옵니다.
select brand as "브랜드", max_product_no as "지금까지 본 최대 상품번호"
from mall_sites
order by sort_order;

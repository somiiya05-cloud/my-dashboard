-- 네이버 GFA 광고 소재(이미지) 정보. 외부 광고 리포트(cpc.html)의 'GFA 소재별 성과' 카드가 씁니다.
-- 소재별 일 성과(노출·클릭·광고비)는 cpc_ad_rows 에 mall='GFA', adgroup=광고그룹, product=소재 이름으로 들어가고,
-- 여기에는 그 소재의 이미지·문구·연결 상품만 둡니다. 외부광고수집기(collector.py fetch_gfa)가 채웁니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists gfa_creatives (
  creative_no bigint primary key,      -- 광고관리자의 실제 소재 번호(realCreativeNo)
  name text not null,
  campaign text,
  ad_set text,
  message text,                        -- 소재 문구
  image_url text,
  link_url text,                       -- 클릭하면 가는 주소(스마트스토어 상품)
  product_no text,                     -- link_url 의 스마트스토어 상품번호
  activated boolean,
  updated_at timestamptz not null default now()
);

alter table gfa_creatives enable row level security;
drop policy if exists "public all" on gfa_creatives;
create policy "public all" on gfa_creatives for all using (true) with check (true);

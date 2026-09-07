-- 네이버 광고를 SA(검색광고 자동연동) / GFA / 파워링크로 구분해서 하나의 대시보드에서
-- 보기 위한 마이그레이션. ad_performance_campaigns(캠페인별 성과) 테이블에 ad_type 컬럼을
-- 추가하고, 같은 캠페인명이 다른 구분으로 들어와도 충돌하지 않도록 unique 제약을 넓힙니다.
-- 또한 대시보드(ad-marketing-dashboard)에서 GFA/파워링크 원본 파일을 직접 업로드할 수
-- 있도록 insert/update 권한을 엽니다(기존에는 select만 가능했습니다).
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table ad_performance_campaigns add column if not exists ad_type text not null default 'SA';

-- 기존 unique(month, channel, campaign) 제약을 unique(month, channel, ad_type, campaign)으로 교체합니다.
-- 제약 이름이 환경마다 다를 수 있어 이름을 직접 찾아서 지웁니다.
do $$
declare
  cons text;
begin
  select conname into cons
  from pg_constraint
  where conrelid = 'ad_performance_campaigns'::regclass
    and contype = 'u';
  if cons is not null then
    execute format('alter table ad_performance_campaigns drop constraint %I', cons);
  end if;
end $$;

alter table ad_performance_campaigns
  add constraint ad_performance_campaigns_month_channel_ad_type_campaign_key
  unique (month, channel, ad_type, campaign);

create policy "public insert access" on ad_performance_campaigns for insert with check (true);
create policy "public update access" on ad_performance_campaigns for update using (true);

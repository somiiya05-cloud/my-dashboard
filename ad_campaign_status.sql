-- 외부 광고 리포트(cpc.html)의 캠페인 운영 상태(운영 중 / 중단)
-- C:\외부광고수집기 가 매일 네이버 광고·카카오모먼트에서 지금 상태를 받아 덮어씁니다.
-- 리포트는 이걸로 "운영 중만" 보기와, 중단 캠페인에 예산 추천을 하지 않는 데 씁니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists ad_campaign_status (
  id bigint generated always as identity primary key,
  mall text not null,            -- cpc_ad_rows.mall 과 같은 이름 (네이버 ADVoost / 카카오모먼트 ...)
  campaign text not null,        -- cpc_ad_rows.campaign 과 같은 이름
  active boolean not null,       -- 광고 관리자에서 켜져 있으면 true
  status text not null default '', -- 광고 관리자 원래 상태값 (ENABLED, PAUSED, ON, OFF ...)
  updated_at timestamptz not null default now(),
  unique (mall, campaign)
);

alter table ad_campaign_status enable row level security;

create policy "public read access" on ad_campaign_status for select using (true);
create policy "public insert access" on ad_campaign_status for insert with check (true);
create policy "public update access" on ad_campaign_status for update using (true);
create policy "public delete access" on ad_campaign_status for delete using (true);

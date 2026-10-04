-- 오픈마켓 CPC 광고 리포트(cpc.html)용 테이블
-- 쿠팡·11번가·G마켓 등 광고센터 보고서를 올리면 일자·몰·캠페인·광고그룹·상품·키워드 단위로
-- 합쳐서 저장합니다. 팀원 누구나 같은 데이터를 보도록 브라우저가 아니라 여기에 둡니다.
-- 같은 몰·같은 날짜를 다시 올리면 화면이 그 날짜 줄을 지우고 새로 넣습니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

create table if not exists cpc_ad_rows (
  id bigint generated always as identity primary key,
  date date not null,
  mall text not null,
  campaign text not null default '',
  adgroup text not null default '',
  product text not null default '',
  keyword text not null default '',   -- 키워드 열이 없는 보고서는 '' / 쿠팡 '-'는 '(비검색 영역)'
  imp bigint not null default 0,
  clk bigint not null default 0,
  cost numeric not null default 0,
  conv numeric not null default 0,
  rev numeric not null default 0,
  uploaded_at timestamptz not null default now()
);

create index if not exists cpc_ad_rows_mall_date_idx on cpc_ad_rows(mall, date);
create index if not exists cpc_ad_rows_date_idx on cpc_ad_rows(date);

alter table cpc_ad_rows enable row level security;

create policy "public read access" on cpc_ad_rows for select using (true);
create policy "public insert access" on cpc_ad_rows for insert with check (true);
create policy "public delete access" on cpc_ad_rows for delete using (true);

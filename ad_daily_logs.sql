-- 광고 채널 운영 일지
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 윤효선 할일 관리의 「광고 채널 운영 관리」 카드에서 [운영 일지 열기] 로 들어오는 화면이 쓰는 표입니다.
-- 그날 광고 쪽에서 무슨 일을 했는지 한 줄씩 적습니다.
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 표
-- ---------------------------------------------------------------------------
create table if not exists ad_daily_logs (
  id bigserial primary key,
  log_date date not null default current_date,  -- 일자
  media text,            -- 매체    예) 네이버 · 메타 · 쿠팡 · 카카오 · 구글
  agency text,           -- 대행사
  work_type text not null default '기타',  -- 소재 교체 · 예산 조정 · 캠페인 생성 · 일시중지·종료 · 성과 확인 · 대행사 커뮤니케이션 · 세팅 점검 · 기타
  title text not null default '',          -- 한 일
  memo text,             -- 결과 · 메모
  sort_no int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_daily_logs_date_idx on ad_daily_logs (log_date desc, sort_no);

-- ---------------------------------------------------------------------------
-- 2) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 표들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table ad_daily_logs enable row level security;

drop policy if exists "public read access" on ad_daily_logs;
drop policy if exists "public insert access" on ad_daily_logs;
drop policy if exists "public update access" on ad_daily_logs;
drop policy if exists "public delete access" on ad_daily_logs;

create policy "public read access" on ad_daily_logs for select using (true);
create policy "public insert access" on ad_daily_logs for insert with check (true);
create policy "public update access" on ad_daily_logs for update using (true);
create policy "public delete access" on ad_daily_logs for delete using (true);

-- ---------------------------------------------------------------------------
-- 3) 「광고 채널 운영 관리」 카드에 [운영 일지 열기] 버튼 달기
-- ---------------------------------------------------------------------------
update team_projects set tracker = 'ads' where name = '광고 채널 운영 관리';

-- ---------------------------------------------------------------------------
-- 4) 확인
-- ---------------------------------------------------------------------------
select log_date as "일자", media as "매체", agency as "대행사",
       work_type as "구분", title as "한 일", memo as "메모"
from ad_daily_logs
order by log_date desc, sort_no;

select name as "프로젝트", tracker as "열리는 화면"
from team_projects where tracker is not null order by id;

-- 시딩 일정(인플루언서 매니저 동기화) 테이블 — 영업팀 워크스페이스 "프로모션 > 일정" 캘린더용
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.
--
-- 이 테이블은 api/sync-groupbuy-schedule.js 가 service role(secret) key로만 쓰고,
-- 화면은 이 앱의 다른 테이블과 동일하게 anon 키로 읽기만 합니다(로그인 없음).

create table if not exists seeding_schedule (
  id text primary key,
  brand_name text,
  brand_company text,
  brand_product text,
  influencer_name text,
  upload_date date not null,
  upload_end date,
  draft_date date,
  status text,
  status_color text,
  synced_at timestamptz not null default now()
);

alter table seeding_schedule enable row level security;

create policy "public read access" on seeding_schedule for select using (true);

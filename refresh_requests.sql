-- 대시보드 "새로고침" 버튼이 사무실 PC에 수집을 요청하기 위한 테이블 (우체통 역할)
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.
--
-- 흐름:
--   1) 대시보드에서 새로고침을 누르면 여기에 status='pending' 한 줄이 들어갑니다
--   2) 사무실 PC의 감시 프로그램(watch.js)이 20초마다 확인하다가 이 줄을 발견하면
--      status='running' 으로 바꾸고 쿠팡 수집을 시작합니다
--   3) 끝나면 status='done'(또는 'failed')과 message 를 기록합니다
--   4) 대시보드는 이 줄을 지켜보다가 done 이 되면 최신 데이터를 다시 읽어옵니다

create table if not exists refresh_requests (
  id bigint generated always as identity primary key,
  source text default 'dashboard',              -- 누가 요청했는지
  status text not null default 'pending',       -- pending | running | done | failed
  message text,                                 -- 완료/실패 사유 (화면에 그대로 보여줍니다)
  requested_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists refresh_requests_pending_idx
  on refresh_requests (status, requested_at);

alter table refresh_requests enable row level security;

-- 대시보드(브라우저)는 요청을 넣고 상태를 읽어야 합니다.
-- 상태를 바꾸는 것은 사무실 PC의 감시 프로그램이 secret 키로만 합니다(RLS 우회).
create policy "public read access" on refresh_requests for select using (true);
create policy "public insert access" on refresh_requests for insert with check (true);

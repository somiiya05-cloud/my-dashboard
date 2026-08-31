-- 공구 일정에 팀 메모(로컬 전용, 동기화로 덮어써지지 않음) 컬럼 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.

alter table groupbuy_schedule add column if not exists memo text;

-- 지금까지는 읽기만 가능했는데, 메모를 저장하려면 업데이트 권한이 필요합니다.
-- (동기화 작업은 service role key로 RLS를 우회하므로 이 정책과 무관하게 계속 동작합니다)
create policy "public update access" on groupbuy_schedule for update using (true);

-- 런칭 건수 자동 집계(메일 연동)를 위해 launch_post_counts에 컬럼 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.
-- (launch_post_counts.sql을 먼저 실행한 뒤에 이 파일을 실행해주세요)
--
-- manual  : 담당자가 +/- 로 직접 건수를 조정한 날에는 true가 됩니다.
--           자동 동기화는 이 값이 true인 행을 건너뛰므로, 직접 정한 숫자가 덮이지 않습니다.
--           행은 날짜별로 새로 생기니 다음 날이면 다시 자동 집계로 돌아갑니다.
-- synced_at : 메일 동기화가 마지막으로 이 행을 갱신한 시각.

alter table launch_post_counts add column if not exists manual boolean not null default false;
alter table launch_post_counts add column if not exists synced_at timestamptz;

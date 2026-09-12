-- "SCM팀 미출 메일 확인" 업무 옆 배지를 위해 launch_post_counts에 컬럼 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.
-- (launch_post_counts.sql, launch_post_counts_auto.sql 을 먼저 실행한 뒤에 이 파일을 실행해주세요)
--
-- 이 테이블은 원래 "런칭" 건수만 담았지만, (담당자, 날짜)당 1행이라는 구조가
-- 메일 알림 배지 전반에 그대로 맞아서 SCM 미출 메일 도착 여부도 여기에 함께 둡니다.
-- 테이블 이름은 기존 데이터/코드 호환 때문에 그대로 둡니다.
--
-- scm_mail_count   : 오늘 도착한 SCM 미출 현황 메일 통수 (0이면 아직 안 옴)
-- scm_mail_subject : 그 메일 제목 원문. 배지에 표시할 날짜(예: 9/11)를 여기서 뽑고,
--                    마우스를 올렸을 때 전체 제목을 보여주는 데도 씁니다.

alter table launch_post_counts add column if not exists scm_mail_count integer not null default 0;
alter table launch_post_counts add column if not exists scm_mail_subject text;

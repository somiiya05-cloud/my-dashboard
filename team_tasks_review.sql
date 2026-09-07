-- 할일 관리: 팀원 완료 처리와 파트장 검수를 구분하기 위한 하루 마감/이관 컬럼 추가
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.
--
-- status 컬럼은 이미 자유 텍스트라 '검수대기'/'확인완료' 값을 그대로 저장할 수 있어
-- 별도 컬럼/타입 변경이 필요 없습니다. 여기서는 하루 마감(이관) 시점을 기록할
-- archived_at 컬럼만 추가합니다. null이면 "현재 업무", 값이 있으면 "업무 히스토리로
-- 이관된 업무"입니다.

alter table team_tasks add column if not exists archived_at timestamptz;

-- (선택) 기존에 '완료'로 저장된 업무를 새 상태값인 '확인완료'로 정리하고 싶다면 아래 UPDATE를
-- 실행하세요. 실행하지 않아도 화면에서는 '완료'를 '확인완료'로 자동 인식해서 보여주므로
-- 데이터가 깨지거나 사라지지 않습니다 — 원할 때 언제 실행해도 안전합니다.
-- update team_tasks set status = '확인완료' where status = '완료';

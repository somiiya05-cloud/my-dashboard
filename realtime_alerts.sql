-- 전휘원 할일 관리의 "계산서 발행" 배지와 "공동구매 정산" 배너를
-- 즉시(실시간) 반영하기 위한 설정입니다.
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 아래 두 표에 변경이 생기면 대시보드가 바로 알림을 받습니다.
--   · partner_deals : 거래 건의 진행 단계가 "입금 완료"로 바뀔 때
--   · settlements   : 공동구매 정산이 "완료"로 바뀔 때
--
-- 이미 등록돼 있으면 "relation is already member of publication" 오류가 나는데,
-- 아래처럼 감싸두면 그 경우에도 그냥 넘어갑니다. 여러 번 실행해도 안전합니다.

do $$
begin
  begin
    alter publication supabase_realtime add table partner_deals;
  exception when duplicate_object then
    raise notice 'partner_deals 는 이미 실시간 발행에 등록돼 있습니다.';
  end;

  begin
    alter publication supabase_realtime add table settlements;
  exception when duplicate_object then
    raise notice 'settlements 는 이미 실시간 발행에 등록돼 있습니다.';
  end;
end $$;

-- 확인 — 아래 결과에 두 표가 모두 나오면 성공입니다.
select tablename as "실시간 발행 중인 표"
from pg_publication_tables
where pubname = 'supabase_realtime'
  and tablename in ('partner_deals', 'settlements')
order by tablename;

-- 채널별 운영 보드에 "달" 칸 더하기
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- (channel_board.sql 을 먼저 실행한 뒤에 이 파일을 실행해주세요)
--
-- 보드를 왼쪽 채널 × 위쪽 세 달(10 · 11 · 12월) 격자로 바꾸면서,
-- 카드가 "어느 채널의 어느 달" 칸에 있는지 적어둘 자리가 필요해졌습니다.
--
-- 여러 번 실행해도 안전합니다.

alter table channel_board add column if not exists month text;   -- 'YYYY-MM'

create index if not exists channel_board_cell_idx on channel_board (channel, month, sort_no);

-- 달이 비어 있는(예전에 만든) 카드는 이번 달 칸으로 보냅니다.
update channel_board
set month = to_char((now() at time zone 'Asia/Seoul')::date, 'YYYY-MM')
where month is null;

select channel as "채널", month as "달", body as "내용", owner as "담당", due_date as "마감일"
from channel_board
order by channel, month, sort_no;

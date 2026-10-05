-- 판매기획 플로우 트래커
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 「채널별 매출 계획 수립」 프로젝트에서 [트래커 열기] 로 들어오는 화면이 쓰는 표입니다.
-- 세로축은 판매채널, 가로축은 진행 단계이고, 기획안 하나가 카드 한 장입니다.
-- 카드끼리 "다음 스텝"으로 이어 붙이면 화면에 화살표로 그려집니다.
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 표
-- ---------------------------------------------------------------------------
create table if not exists channel_plans (
  id bigserial primary key,
  channel text not null,                      -- 쿠팡 · 스마트스토어 · 컬리 · 오픈마켓 · 카카오 · 자사몰 · 오늘의집/토스
  stage text not null default '기획 후보',     -- 기획 후보 → 채널 협의 → 조건 확정 → 세팅 요청 → 오픈 대기 → 진행중 → 결과 분석 → 재진행/종료
  title text not null default '',             -- 기획명
  brand text,                                 -- 브랜드
  owner text,                                 -- 담당자
  status text not null default '기획중',       -- 기획중 · 협의중 · 준비중 · 진행중 · 분석중 · 대기 · 완료 · 보류
  blocker text,                               -- 병목 사유 (적으면 카드에 빨간 라벨)
  next_step text,                             -- 다음 스텝 (글로 적는 경우)
  next_id bigint references channel_plans(id) on delete set null,  -- 다음 스텝으로 이어지는 카드
  start_date date,
  end_date date,
  sort_no int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists channel_plans_cell_idx on channel_plans (channel, stage, sort_no);

-- ---------------------------------------------------------------------------
-- 2) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 표들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table channel_plans enable row level security;

drop policy if exists "public read access" on channel_plans;
drop policy if exists "public insert access" on channel_plans;
drop policy if exists "public update access" on channel_plans;
drop policy if exists "public delete access" on channel_plans;

create policy "public read access" on channel_plans for select using (true);
create policy "public insert access" on channel_plans for insert with check (true);
create policy "public update access" on channel_plans for update using (true);
create policy "public delete access" on channel_plans for delete using (true);

-- ---------------------------------------------------------------------------
-- 3) 확인
-- ---------------------------------------------------------------------------
select channel as "채널", stage as "단계", brand as "브랜드", title as "기획명",
       status as "상태", blocker as "병목", start_date as "시작", end_date as "종료"
from channel_plans
order by channel, stage, sort_no;

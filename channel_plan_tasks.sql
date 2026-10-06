-- 판매기획 플로우 — 유관부서 진행 작업 (하위 작업)
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 기획 카드 한 장(channel_plans) 안에 들어가는 세부 업무입니다.
-- 리뷰 작업 · 상세페이지 수정 · 배너 요청 · 광고 세팅처럼
-- 다른 부서에 넘겨 둔 일을 여기에 적습니다.
-- 별도 메인 카드를 만들지 않고, 기획 카드 안에서만 관리합니다.
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 표
-- ---------------------------------------------------------------------------
create table if not exists channel_plan_tasks (
  id bigserial primary key,
  plan_id bigint not null references channel_plans(id) on delete cascade,  -- 기획 카드가 지워지면 같이 지워집니다
  title text not null default '',       -- 작업명   예) 리뷰 작업
  dept text,                            -- 담당부서 예) CX팀
  owner text,                           -- 담당자
  request_date date,                    -- 요청일
  due_date date,                        -- 완료 예정일
  status text not null default '요청 전',  -- 요청 전 · 요청 완료 · 유관부서 진행중 · 확인 필요 · 완료 · 지연
  next_check_date date,                 -- 다음 확인일
  memo text,                            -- 메모
  blocking boolean not null default false,  -- 켜면 "이 작업 때문에 다음 단계로 못 넘어감" → 카드 앞면에 병목으로 뜹니다
  sort_no int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists channel_plan_tasks_plan_idx on channel_plan_tasks (plan_id, sort_no);

-- ---------------------------------------------------------------------------
-- 2) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 표들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table channel_plan_tasks enable row level security;

drop policy if exists "public read access" on channel_plan_tasks;
drop policy if exists "public insert access" on channel_plan_tasks;
drop policy if exists "public update access" on channel_plan_tasks;
drop policy if exists "public delete access" on channel_plan_tasks;

create policy "public read access" on channel_plan_tasks for select using (true);
create policy "public insert access" on channel_plan_tasks for insert with check (true);
create policy "public update access" on channel_plan_tasks for update using (true);
create policy "public delete access" on channel_plan_tasks for delete using (true);

-- ---------------------------------------------------------------------------
-- 3) 확인
-- ---------------------------------------------------------------------------
select p.channel as "채널", p.title as "기획명",
       t.title as "작업명", t.dept as "담당부서", t.owner as "담당자",
       t.status as "상태", t.due_date as "완료 예정", t.next_check_date as "다음 확인",
       case when t.blocking then 'O' else '' end as "다음 단계 막음"
from channel_plan_tasks t
join channel_plans p on p.id = t.plan_id
order by p.channel, p.id, t.sort_no;

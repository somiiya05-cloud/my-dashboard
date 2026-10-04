-- 영업팀 공지사항
-- Supabase 프로젝트 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--
-- 팀 대시보드 맨 위의 "★ 영업팀 공지사항 ★" 을 누르면 뜨는 팝업에 들어갈 내용입니다.
-- 업무가 아니라 팀에 알리는 글이라 할일 표와 섞지 않고 따로 둡니다.
--
-- 여러 번 실행해도 안전합니다.

-- ---------------------------------------------------------------------------
-- 1) 표
-- ---------------------------------------------------------------------------
create table if not exists team_notices (
  id bigserial primary key,
  body text not null,
  author text default '대표',
  pinned boolean not null default false,   -- 위로 고정할 공지
  created_at timestamptz not null default now()
);

create index if not exists team_notices_created_idx on team_notices (created_at desc);

-- ---------------------------------------------------------------------------
-- 2) 접근 권한 (대시보드는 publishable/anon 키로 접속 → 다른 표들과 같은 방식)
-- ---------------------------------------------------------------------------
alter table team_notices enable row level security;

drop policy if exists "public read access" on team_notices;
drop policy if exists "public insert access" on team_notices;
drop policy if exists "public update access" on team_notices;
drop policy if exists "public delete access" on team_notices;

create policy "public read access" on team_notices for select using (true);
create policy "public insert access" on team_notices for insert with check (true);
create policy "public update access" on team_notices for update using (true);
create policy "public delete access" on team_notices for delete using (true);

-- ---------------------------------------------------------------------------
-- 3) 확인
-- ---------------------------------------------------------------------------
select id, body as "공지", author as "작성자", pinned as "고정", created_at as "올린 때"
from team_notices
order by pinned desc, created_at desc;

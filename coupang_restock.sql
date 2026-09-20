-- 쿠팡 로켓그로스 재입고 타임라인 데이터를 저장할 테이블
-- Supabase 프로젝트 대시보드 > SQL Editor 에서 실행하세요.
--
-- 이 테이블은 바탕화면의 로컬 도구(coupang-dashboard-tool)가 쿠팡 윙 화면을 읽어서 채웁니다.
-- 쿠팡 윙은 로그인된 실제 브라우저가 있어야만 열리기 때문에 Vercel 크론으로는 수집할 수 없고,
-- 로컬 도구가 service_role 키로 여기에 upsert 합니다.
-- 대시보드(index.html)는 이 테이블을 읽기만 합니다.

create table if not exists coupang_restock (
  option_id text primary key,          -- 쿠팡 옵션ID
  label text,                          -- 상품명 (예: 코드니처 베개 2중 압축 세탁망, 그린+화이트)
  filter text,                         -- 어느 타일에서 잡혔는지: 품절 / 품절임박
  last_7d numeric,                     -- 지난 7일 판매량
  last_30d numeric,                    -- 지난 30일 판매량
  available_days text,                 -- 판매가능 일수 (예: "5일") — 권장입고일 계산에 사용
  available numeric,                   -- 판매가능재고 수량
  incoming numeric,                    -- 입고중 수량 (0이면 "입고 신청 필요")
  recommend text,                      -- 입고권장수량
  arrival_date text,                   -- 입고관리에서 찾은 도착예정일 (예: "9월 22일")
  arrival_cancelled boolean,           -- 그 입고건이 취소 상태면 true → 화면에 "확인필요" 표시
  synced_at timestamptz default now()  -- 이 행을 수집한 시각
);

alter table coupang_restock enable row level security;

-- 대시보드는 읽기만 합니다. 쓰기는 로컬 도구가 service_role 키로 하므로
-- (service_role 은 RLS 를 우회) 별도의 insert/update 정책을 열어두지 않습니다.
create policy "public read access" on coupang_restock for select using (true);

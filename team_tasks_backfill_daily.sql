-- 전휘원 오전/오후 필수업무를 오늘부터 14일 뒤까지(총 15일) 채웁니다.
-- api/refresh-daily-tasks.js 의 DAILY_TASKS 목록에서 자동 생성했습니다 (크론과 동일한 규칙).
--   · weekdays 가 있으면 그 요일에만  (0=일 ~ 6=토)
--   · month_day_from 이 있으면 매월 그 날짜부터 말일까지만
-- 이미 있는 항목(같은 담당자·제목·날짜, 미이관)은 건너뜁니다. 여러 번 실행해도 안전합니다.
--
-- ⚠️ 먼저 아래 [1] 미리보기를 실행해 건수를 확인한 뒤 [2] 를 실행하세요.

WITH days AS (
  -- Supabase 서버는 UTC라서 서울 기준 오늘을 따로 구합니다.
  SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date + i) AS d
  FROM generate_series(0, 14) AS i
),
tasks (title, category, detail, weekdays, month_day_from) AS (
  VALUES
    ('카카오 명퉤 오행염주 일자수정', '오전 필수업무', NULL::text, NULL::int[], NULL::int),
    ('공동구매 발주서 전달 (scm팀)', '오전 필수업무', NULL::text, NULL::int[], NULL::int),
    ('광고보고 / 매출마감', '오전 필수업무', NULL::text, NULL::int[], NULL::int),
    ('올리브영 발주서 마감', '오후 필수업무', NULL::text, ARRAY[3,4]::int[], NULL::int),
    ('올리브영 매출 보고', '오후 필수업무', NULL::text, ARRAY[3,4]::int[], NULL::int),
    ('올리브영 재고 확인', '오후 필수업무', NULL::text, ARRAY[3,4]::int[], NULL::int),
    ('네이버 SA / nkiss2152 (법인)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 SA / selfdiylab (법인)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 SA / seldilab (법인)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 GFA / 미니멀룸스토어 (법인)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 GFA / selflow (지점)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 쇼핑 파트너센터', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('SA 광고세팅', '오후 필수업무', '그룹:신제품 광고세팅'::text, NULL::int[], NULL::int),
    ('파워링크 세팅', '오후 필수업무', '그룹:신제품 광고세팅'::text, NULL::int[], NULL::int),
    ('GFA 세팅', '오후 필수업무', '그룹:신제품 광고세팅'::text, NULL::int[], NULL::int),
    ('카페침투 세팅', '오후 필수업무', '그룹:신제품 광고세팅'::text, NULL::int[], NULL::int),
    ('쿠팡 재고 입고', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('쿠팡 뱃지 확인', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('리뷰 작업 요청 (cx팀)', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('SCM팀 미출 메일 확인', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('이지어드민 연동(scm팀)', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('다우게시판 공유', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('B2B 세금계산서 발행', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('해외/수출 영세율 계산서 발행', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('올리브영 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('파스토 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('자사몰 광고보고서 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('쿠팡 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('오프하우스 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('메타 광고비 및 매출 회계팀 공유', '오후 필수업무', NULL::text, NULL::int[], 23::int)
),
wanted AS (
  SELECT t.title, t.category, t.detail, d.d AS due_date
  FROM days d
  CROSS JOIN tasks t
  WHERE (t.weekdays IS NULL OR EXTRACT(DOW FROM d.d)::int = ANY (t.weekdays))
    AND (t.month_day_from IS NULL OR EXTRACT(DAY FROM d.d)::int >= t.month_day_from)
)
-- [1] 미리보기 — 날짜별로 몇 건이 새로 들어갈지 확인합니다.
SELECT w.due_date, count(*) AS "새로 생길 건수"
FROM wanted w
WHERE NOT EXISTS (
  SELECT 1 FROM team_tasks t
  WHERE t.assignee = '전휘원'
    AND t.title = w.title
    AND t.due_date = w.due_date
    AND t.archived_at IS NULL
)
GROUP BY w.due_date
ORDER BY w.due_date;


-- ===========================================================================
-- [2] 실제 등록 — 위 미리보기 건수가 맞으면 아래 블록만 선택해서 실행하세요.
-- ===========================================================================

WITH days AS (
  SELECT ((now() AT TIME ZONE 'Asia/Seoul')::date + i) AS d
  FROM generate_series(0, 14) AS i
),
tasks (title, category, detail, weekdays, month_day_from) AS (
  VALUES
    ('카카오 명퉤 오행염주 일자수정', '오전 필수업무', NULL::text, NULL::int[], NULL::int),
    ('공동구매 발주서 전달 (scm팀)', '오전 필수업무', NULL::text, NULL::int[], NULL::int),
    ('광고보고 / 매출마감', '오전 필수업무', NULL::text, NULL::int[], NULL::int),
    ('올리브영 발주서 마감', '오후 필수업무', NULL::text, ARRAY[3,4]::int[], NULL::int),
    ('올리브영 매출 보고', '오후 필수업무', NULL::text, ARRAY[3,4]::int[], NULL::int),
    ('올리브영 재고 확인', '오후 필수업무', NULL::text, ARRAY[3,4]::int[], NULL::int),
    ('네이버 SA / nkiss2152 (법인)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 SA / selfdiylab (법인)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 SA / seldilab (법인)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 GFA / 미니멀룸스토어 (법인)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 GFA / selflow (지점)', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('네이버 쇼핑 파트너센터', '오후 필수업무', NULL::text, ARRAY[4]::int[], NULL::int),
    ('SA 광고세팅', '오후 필수업무', '그룹:신제품 광고세팅'::text, NULL::int[], NULL::int),
    ('파워링크 세팅', '오후 필수업무', '그룹:신제품 광고세팅'::text, NULL::int[], NULL::int),
    ('GFA 세팅', '오후 필수업무', '그룹:신제품 광고세팅'::text, NULL::int[], NULL::int),
    ('카페침투 세팅', '오후 필수업무', '그룹:신제품 광고세팅'::text, NULL::int[], NULL::int),
    ('쿠팡 재고 입고', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('쿠팡 뱃지 확인', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('리뷰 작업 요청 (cx팀)', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('SCM팀 미출 메일 확인', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('이지어드민 연동(scm팀)', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('다우게시판 공유', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('B2B 세금계산서 발행', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('해외/수출 영세율 계산서 발행', '오후 필수업무', NULL::text, NULL::int[], NULL::int),
    ('올리브영 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('파스토 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('자사몰 광고보고서 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('쿠팡 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('오프하우스 월마감', '오후 필수업무', NULL::text, NULL::int[], 23::int),
    ('메타 광고비 및 매출 회계팀 공유', '오후 필수업무', NULL::text, NULL::int[], 23::int)
),
wanted AS (
  SELECT t.title, t.category, t.detail, d.d AS due_date
  FROM days d
  CROSS JOIN tasks t
  WHERE (t.weekdays IS NULL OR EXTRACT(DOW FROM d.d)::int = ANY (t.weekdays))
    AND (t.month_day_from IS NULL OR EXTRACT(DAY FROM d.d)::int >= t.month_day_from)
)
INSERT INTO team_tasks (title, category, detail, assignee, status, priority, due_date)
SELECT w.title, w.category, w.detail, '전휘원', '할일', '보통', w.due_date
FROM wanted w
WHERE NOT EXISTS (
  SELECT 1 FROM team_tasks t
  WHERE t.assignee = '전휘원'
    AND t.title = w.title
    AND t.due_date = w.due_date
    AND t.archived_at IS NULL
);

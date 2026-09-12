// 전휘원의 "오전 필수업무"/"오후 필수업무"(할일 관리 상단 체크리스트) 항목을
// 매일 새로 등록하는 Vercel 서버리스 함수입니다. 어제 남은 항목은 이관(archived)
// 처리하고, 오늘 날짜로 정해진 10개 항목을 다시 등록합니다(이미 있으면 건너뜀).
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "refresh-daily-tasks.js" 로 저장하세요.
//    최종 경로: api/refresh-daily-tasks.js
//
// 필요한 Vercel 환경변수 (다른 sync 함수들과 동일):
//   SUPABASE_SERVICE_ROLE_KEY - Supabase 프로젝트 설정 → API → service_role 키
//   CRON_SECRET               - 임의의 랜덤 문자열(16자 이상). Vercel Cron이 자동으로
//                               Authorization: Bearer <CRON_SECRET> 헤더를 붙여서 호출해줍니다.
//
// vercel.json의 crons 배열에 이 경로를 등록해두면 매일 자동 실행됩니다.
//
// 수동 테스트 방법 (터미널에서):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" \
//        "https://내주소.vercel.app/api/refresh-daily-tasks"

const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const ASSIGNEE = '전휘원';
const CATEGORIES = ['오전 필수업무', '오후 필수업무'];

// 매일 반복되는 고정 업무(오전 3개 + 오후 10개)와, 특정 요일/기간에만 생기는 업무.
// weekdays를 지정하면 그 요일에만 등록됩니다 (0=일 ~ 6=토). 예: [3,4] = 수·목.
// monthDayFrom을 지정하면 매월 그 날짜부터 말일까지만 등록됩니다. 예: 23 = 23일~말일.
// 여기 목록을 바꾸면 다음 실행부터 반영됩니다.
const DAILY_TASKS = [
  { title: '카카오 명퉤 오행염주 일자수정', category: '오전 필수업무' },
  { title: '공동구매 발주서 전달 (scm팀)', category: '오전 필수업무' },
  { title: '광고보고 / 매출마감', category: '오전 필수업무' },
  // 수·목에만 생기는 올리브영 업무 (오후 업무 맨 위에 표시)
  { title: '올리브영 발주서 마감', category: '오후 필수업무', weekdays: [3, 4] },
  { title: '올리브영 매출 보고', category: '오후 필수업무', weekdays: [3, 4] },
  { title: '올리브영 재고 확인', category: '오후 필수업무', weekdays: [3, 4] },
  // 목요일에만 생기는 광고비 충전 6건 (화면에서 "광고비 충전" 그룹으로 묶임)
  { title: '네이버 SA / nkiss2152 (법인)', category: '오후 필수업무', weekdays: [4] },
  { title: '네이버 SA / selfdiylab (법인)', category: '오후 필수업무', weekdays: [4] },
  { title: '네이버 SA / seldilab (법인)', category: '오후 필수업무', weekdays: [4] },
  { title: '네이버 GFA / 미니멀룸스토어 (법인)', category: '오후 필수업무', weekdays: [4] },
  { title: '네이버 GFA / selflow (지점)', category: '오후 필수업무', weekdays: [4] },
  { title: '네이버 쇼핑 파트너센터', category: '오후 필수업무', weekdays: [4] },
  { title: 'SA 광고세팅', category: '오후 필수업무', detail: '그룹:신제품 광고세팅' },
  { title: '파워링크 세팅', category: '오후 필수업무', detail: '그룹:신제품 광고세팅' },
  { title: 'GFA 세팅', category: '오후 필수업무', detail: '그룹:신제품 광고세팅' },
  { title: '카페침투 세팅', category: '오후 필수업무', detail: '그룹:신제품 광고세팅' },
  { title: '쿠팡 재고 입고', category: '오후 필수업무' },
  { title: '쿠팡 뱃지 확인', category: '오후 필수업무' },
  { title: '리뷰 작업 요청 (cx팀)', category: '오후 필수업무' },
  { title: 'SCM팀 미출 메일 확인', category: '오후 필수업무' },
  { title: '이지어드민 연동(scm팀)', category: '오후 필수업무' },
  { title: '다우게시판 공유', category: '오후 필수업무' },
  // 매월 23일~말일에만 생기는 월마감 업무 (화면에서 "월마감" 그룹으로 묶임)
  { title: '올리브영 월마감', category: '오후 필수업무', monthDayFrom: 23 },
  { title: '파스토 월마감', category: '오후 필수업무', monthDayFrom: 23 },
  { title: '자사몰 광고보고서 월마감', category: '오후 필수업무', monthDayFrom: 23 },
  { title: '쿠팡 월마감', category: '오후 필수업무', monthDayFrom: 23 },
  { title: '오프하우스 월마감', category: '오후 필수업무', monthDayFrom: 23 },
  { title: '메타 광고비 및 매출 회계팀 공유', category: '오후 필수업무', monthDayFrom: 23 }
];

function todayInSeoul() {
  // Asia/Seoul은 연중 UTC+9 고정(서머타임 없음)이라 en-CA 로케일로 바로 YYYY-MM-DD를 얻습니다.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

// 서울 기준 요일 (0=일 ~ 6=토). 위에서 구한 날짜 문자열을 UTC 자정으로 읽어 시차 영향을 없앱니다.
function weekdayInSeoul(today) {
  return new Date(today + 'T00:00:00Z').getUTCDay();
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceKey) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: 'SUPABASE_SERVICE_ROLE_KEY 가 설정돼 있는지 확인하세요.'
    });
  }

  const headers = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json'
  };

  const today = todayInSeoul();
  const nowIso = new Date().toISOString();
  const categoryFilter = CATEGORIES.map((c) => encodeURIComponent(c)).join(',');

  // 1) 어제 이전 날짜에 남아있는 오전/오후 필수업무는 이관 처리
  const archiveRes = await fetch(
    `${SUPABASE_URL}/rest/v1/team_tasks` +
      `?category=in.(${categoryFilter})` +
      `&assignee=eq.${encodeURIComponent(ASSIGNEE)}` +
      `&archived_at=is.null` +
      `&due_date=lt.${today}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify({ archived_at: nowIso })
    }
  );
  if (!archiveRes.ok) {
    const errText = await archiveRes.text();
    return res.status(500).json({ error: 'archive_failed', detail: errText });
  }
  const archived = await archiveRes.json();

  // 2) 오늘 날짜로 이미 등록된 항목 확인 (중복 등록 방지)
  const existingRes = await fetch(
    `${SUPABASE_URL}/rest/v1/team_tasks` +
      `?category=in.(${categoryFilter})` +
      `&assignee=eq.${encodeURIComponent(ASSIGNEE)}` +
      `&archived_at=is.null` +
      `&due_date=eq.${today}` +
      `&select=title`,
    { headers }
  );
  if (!existingRes.ok) {
    const errText = await existingRes.text();
    return res.status(500).json({ error: 'existing_check_failed', detail: errText });
  }
  const existingTitles = new Set((await existingRes.json()).map((r) => r.title));

  // 오늘 등록할 업무만 추림 (weekdays/monthDayFrom가 없으면 매일 등록)
  const weekday = weekdayInSeoul(today);
  const monthDay = Number(today.slice(8, 10));
  const todaysTasks = DAILY_TASKS.filter(
    (t) =>
      (!t.weekdays || t.weekdays.includes(weekday)) &&
      (!t.monthDayFrom || monthDay >= t.monthDayFrom)
  );

  const missingTasks = todaysTasks.filter((t) => !existingTitles.has(t.title));

  let inserted = [];
  if (missingTasks.length > 0) {
    const rows = missingTasks.map(({ title, category, detail }) => ({
      title,
      category,
      detail: detail || null,
      assignee: ASSIGNEE,
      status: '할일',
      priority: '보통',
      due_date: today
    }));
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/team_tasks`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(rows)
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      return res.status(500).json({ error: 'insert_failed', detail: errText });
    }
    inserted = await insertRes.json();
  }

  return res.status(200).json({
    today,
    weekday,
    month_day: monthDay,
    archived_count: archived.length,
    inserted_count: inserted.length,
    inserted_titles: missingTasks.map((t) => t.title),
    skipped_titles: todaysTasks.filter((t) => existingTitles.has(t.title)).map((t) => t.title)
  });
};

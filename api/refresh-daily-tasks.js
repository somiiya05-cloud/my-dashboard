// 전휘원의 "데일리업무"(할일 관리 상단 체크리스트) 항목을 매일 새로 등록하는
// Vercel 서버리스 함수입니다. 어제 남은 데일리업무는 이관(archived) 처리하고,
// 오늘 날짜로 정해진 10개 항목을 다시 등록합니다(이미 있으면 건너뜀).
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
const CATEGORY = '데일리업무';

// 매일 반복되는 10개 고정 업무. 여기 목록을 바꾸면 다음 실행부터 반영됩니다.
const DAILY_TASK_TITLES = [
  '카카오 명퉤 오행염주 일자수정',
  '공동구매 발주서 취합 후 전달(w/scm)',
  '광고보고 / 매출마감',
  '쿠팡 로켓그로스 재고 입고',
  '쿠팡 로켓그로스 뱃지 확인',
  '쿠팡 상품등록 후 리뷰 작업 진행 (w.CX팀장님)',
  'SCM팀 미출 메일 확인',
  '외부몰 입점 후에 이지어드민 연동 공유(w/scm)',
  '신제품 런칭 시, SA / 파워링크 /gfa & 카페침투 진행',
  '상품등록 후 게시판 공유'
];

function todayInSeoul() {
  // Asia/Seoul은 연중 UTC+9 고정(서머타임 없음)이라 en-CA 로케일로 바로 YYYY-MM-DD를 얻습니다.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
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

  // 1) 어제 이전 날짜에 남아있는 데일리업무는 이관 처리
  const archiveRes = await fetch(
    `${SUPABASE_URL}/rest/v1/team_tasks` +
      `?category=eq.${encodeURIComponent(CATEGORY)}` +
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
      `?category=eq.${encodeURIComponent(CATEGORY)}` +
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

  const missingTitles = DAILY_TASK_TITLES.filter((t) => !existingTitles.has(t));

  let inserted = [];
  if (missingTitles.length > 0) {
    const rows = missingTitles.map((title) => ({
      title,
      assignee: ASSIGNEE,
      category: CATEGORY,
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
    archived_count: archived.length,
    inserted_count: inserted.length,
    inserted_titles: missingTitles,
    skipped_titles: DAILY_TASK_TITLES.filter((t) => existingTitles.has(t))
  });
};

// 전휘원의 한 주(월~금) 할일 관리를 정리해 Supabase의 weekly_task_reports 표에 넣는 스크립트입니다.
// 대시보드의 "주간 리포트" 화면이 이 값을 읽습니다.
//
// ⚠️ Vercel 서버리스 함수가 아니라 GitHub Actions 안에서 직접 돕니다.
//    Vercel 무료 플랜은 배포당 함수가 12개까지인데 이미 12개를 다 쓰고 있어서,
//    여기에 함수를 하나 더 넣으면 배포 자체가 실패합니다.
//    실행: .github/workflows/weekly-task-report.yml (매주 금요일 19:10 KST)
//
// 담는 내용
//   · summary : 완료율 (전체 / 일자별 / 그룹별)
//   · special : 긴급 업무 · 직접 추가한 업무
//   · notes   : 업무 목적이나 댓글이 오간 업무
//
// 수동 실행: node scripts/weekly-task-report.js
//   WEEK_OF=2026-09-14  특정 주를 다시 뽑을 때 (그 날짜가 속한 주)
//   DRY_RUN=1           저장하지 않고 결과만 출력

const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY
  || 'sb_publishable_uE-8s2DbZBUSs0z1uQ-nIA_za2Ah3uT';
const ASSIGNEE = process.env.REPORT_ASSIGNEE || '전휘원';
const DRY_RUN = !!process.env.DRY_RUN;

// 루틴 업무 목록은 매일 업무를 만드는 쪽과 같은 것을 씁니다.
// 여기서 따로 베껴 두면 한쪽만 바뀌었을 때 "직접 추가한 업무"가 잘못 잡힙니다.
const { DAILY_TASKS } = require('../api/refresh-daily-tasks.js');
const ROUTINE_TITLES = new Set((DAILY_TASKS || []).map((t) => t.title));

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
};

function seoulToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// 그 날짜가 속한 주의 월요일. (일요일은 그 전 주로 봅니다 — 월~금이 한 주라서)
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay();              // 0=일 ~ 6=토
  const back = dow === 0 ? 6 : dow - 1;   // 일요일이면 6일 전이 월요일
  return addDays(dateStr, -back);
}

async function get(path) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers });
  if (!res.ok) throw new Error(path.split('?')[0] + ' 조회 실패: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}

// 업무 하나가 "끝난 것"인지. 화면의 2단계 확인과 같은 기준입니다.
const isStaffDone = (s) => s === '검수대기' || s === '확인완료';
const isLeadDone = (s) => s === '확인완료';

async function main() {
  const base = process.env.WEEK_OF || seoulToday();
  const weekStart = mondayOf(base);
  const weekEnd = addDays(weekStart, 4);   // 월~금

  const tasks = await get(
    'team_tasks?select=id,title,category,detail,status,priority,due_date' +
    '&assignee=eq.' + encodeURIComponent(ASSIGNEE) +
    '&due_date=gte.' + weekStart +
    '&due_date=lte.' + weekEnd +
    '&order=due_date.asc'
  );

  if (!tasks.length) {
    console.log(`${weekStart} ~ ${weekEnd} 사이에 ${ASSIGNEE}의 업무가 없습니다.`);
    return;
  }

  // ---- 완료율 ----
  const total = tasks.length;
  const done = tasks.filter((t) => isLeadDone(t.status)).length;
  const staffOnly = tasks.filter((t) => isStaffDone(t.status) && !isLeadDone(t.status)).length;

  const byDate = {};
  const byGroup = {};
  tasks.forEach((t) => {
    const d = t.due_date;
    byDate[d] = byDate[d] || { total: 0, done: 0 };
    byDate[d].total++;
    if (isLeadDone(t.status)) byDate[d].done++;

    // detail 이 "그룹:이름" 이면 그 그룹으로, 아니면 오전/오후로 묶습니다.
    const m = /^그룹:(.+)$/.exec(t.detail || '');
    const g = m ? m[1].trim() : (t.category || '기타');
    byGroup[g] = byGroup[g] || { total: 0, done: 0 };
    byGroup[g].total++;
    if (isLeadDone(t.status)) byGroup[g].done++;
  });

  const summary = {
    전체: { 건수: total, 완료: done, 담당자만완료: staffOnly },
    일자별: Object.entries(byDate).sort().map(([날짜, v]) => ({ 날짜, ...v })),
    그룹별: Object.entries(byGroup).sort((a, b) => b[1].total - a[1].total).map(([그룹, v]) => ({ 그룹, ...v })),
  };

  // ---- 긴급 · 직접 추가한 업무 ----
  const asItem = (t) => ({
    id: t.id, 업무: t.title, 날짜: t.due_date, 상태: t.status,
    완료: isLeadDone(t.status) ? '확인완료' : (isStaffDone(t.status) ? '담당자 완료' : '미완료'),
  });
  const special = {
    긴급: tasks.filter((t) => t.priority === '높음').map(asItem),
    직접추가: tasks.filter((t) => !ROUTINE_TITLES.has(t.title)).map(asItem),
  };

  // ---- 업무 목적 · 댓글 ----
  const titles = [...new Set(tasks.map((t) => t.title))];
  const ids = tasks.map((t) => t.id);

  const purposes = await get(
    'team_task_daily_purposes?select=title,due_date,purpose' +
    '&due_date=gte.' + weekStart + '&due_date=lte.' + weekEnd
  );
  const comments = await get(
    'team_task_comments?select=task_id,author,body,created_at' +
    '&task_id=in.(' + ids.join(',') + ')&order=created_at.asc'
  );

  const purposeOf = new Map();
  purposes.forEach((p) => {
    if (p.purpose && p.purpose.trim()) purposeOf.set(p.title + '|' + p.due_date, p.purpose.trim());
  });
  const commentsOf = new Map();
  comments.forEach((c) => {
    if (!commentsOf.has(c.task_id)) commentsOf.set(c.task_id, []);
    commentsOf.get(c.task_id).push({ 글쓴이: c.author, 내용: (c.body || '').trim(), 시각: c.created_at });
  });

  const notes = tasks
    .map((t) => {
      const purpose = purposeOf.get(t.title + '|' + t.due_date) || '';
      const list = commentsOf.get(t.id) || [];
      if (!purpose && !list.length) return null;
      return { id: t.id, 업무: t.title, 날짜: t.due_date, 업무목적: purpose, 댓글: list };
    })
    .filter(Boolean);

  const row = {
    assignee: ASSIGNEE,
    week_start: weekStart,
    week_end: weekEnd,
    total_count: total,
    done_count: done,
    summary,
    special,
    notes,
  };

  console.log(`${weekStart} ~ ${weekEnd} · ${ASSIGNEE}`);
  console.log(`  전체 ${total}건 / 확인완료 ${done}건 (${Math.round((done / total) * 100)}%) / 담당자만 완료 ${staffOnly}건`);
  console.log(`  긴급 ${special.긴급.length}건 · 직접 추가 ${special.직접추가.length}건 · 목적·댓글 있는 업무 ${notes.length}건`);

  if (DRY_RUN) {
    console.log('DRY_RUN=1 이라 저장하지 않았습니다.');
    return;
  }

  // 같은 주를 다시 발행하면 덮어씁니다.
  const res = await fetch(SUPABASE_URL + '/rest/v1/weekly_task_reports?on_conflict=assignee,week_start', {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify([row]),
  });
  if (!res.ok) throw new Error('저장 실패: ' + res.status + ' ' + (await res.text()).slice(0, 300));
  const saved = await res.json();
  console.log('저장했습니다. id =', saved[0] && saved[0].id);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

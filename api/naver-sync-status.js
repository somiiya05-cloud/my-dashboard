// 대시보드의 "동기화 상태" 판이 호출하는 조회 전용 엔드포인트입니다.
// api/trigger-naver-sync.js 가 띄우는 그 워크플로 3개의 최근 실행 결과를 그대로 돌려줍니다.
//
// 왜 필요한가: 「지금 동기화」를 눌러도 화면이 안 변하면 (1) 동기화가 아예 실패한 건지
// (2) 성공했는데 값이 원래 그대로인 건지 구분할 방법이 없었습니다. 실제로 2026-09-10 이후
// 일별 키워드 동기화가 네이버 API 429 로 15번 연속 실패하고 있었는데 화면에는 아무 표시도
// 없었습니다. 이제 그 이력을 대시보드에서 바로 봅니다.
//
// ⚠️ 배치 위치: api/naver-sync-status.js
// 필요한 Vercel 환경변수: GITHUB_DISPATCH_TOKEN (trigger-naver-sync 와 같은 것을 씁니다.
//   fine-grained token, Repository access: my-dashboard, Permissions: Actions = Read and write)

const GITHUB_OWNER = 'somiiya05-cloud';
const GITHUB_REPO = 'my-dashboard';

// trigger-naver-sync.js 의 WORKFLOWS 와 같게 유지하세요.
const WORKFLOWS = [
  { file: 'ping-naver-ads-sync.yml', label: '광고비·매출 (채널별)' },
  { file: 'ping-naver-keywords-sync.yml', label: '캠페인·키워드 (월 단위)' },
  { file: 'ping-naver-keywords-daily-sync.yml', label: '캠페인·키워드 (일 단위)' }
];

const RUNS_PER_WORKFLOW = 5;

const ALLOWED_ORIGINS = [
  'https://ad-marketing-dashboard.vercel.app',
  'https://my-dashboard-three-fawn.vercel.app'
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function fetchRuns(workflow, token) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/`
    + `${workflow.file}/runs?per_page=${RUNS_PER_WORKFLOW}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { workflow: workflow.file, label: workflow.label, error: `${res.status} ${detail.slice(0, 200)}` };
  }
  const data = await res.json();
  const runs = (data.workflow_runs || []).map((r) => ({
    id: r.id,
    // status: queued / in_progress / completed, conclusion: success / failure / cancelled ...
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // 버튼으로 띄운 건지 스케줄로 돈 건지 구분 (workflow_dispatch / schedule)
    event: r.event,
    url: r.html_url
  }));
  return { workflow: workflow.file, label: workflow.label, runs };
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'missing_env_vars', detail: 'GITHUB_DISPATCH_TOKEN 이 설정돼 있는지 확인하세요.' });
  }

  try {
    const workflows = await Promise.all(WORKFLOWS.map((w) => fetchRuns(w, token)));
    // 브라우저·CDN이 오래 들고 있으면 "지금 막 돌린 것"이 안 보이므로 짧게만 캐시합니다.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ fetchedAt: new Date().toISOString(), workflows });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

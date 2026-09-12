// 대시보드의 "지금 동기화" 버튼이 호출하는 엔드포인트입니다.
// GitHub Actions를 수동으로 "Run workflow" 누르는 것과 정확히 같은 일을
// 코드로 대신 해줍니다 — 계정2 6조각 샤딩 등 이미 검증된 로직을 그대로
// 재사용하기 위해, 여기서 직접 동기화를 돌리지 않고 아래 워크플로들을 트리거만 합니다:
//   - ping-naver-ads-sync.yml (채널별 광고비, 월/일 단위)
//   - ping-naver-keywords-sync.yml (캠페인·키워드, 월 단위 — 낭비 키워드 등)
//   - ping-naver-keywords-daily-sync.yml (캠페인·키워드, 일 단위 — 상세 성과의 "하루전/3일" 등에 씀,
//     스케줄이 채널별 동기화보다 늦어서 "하루전"을 눌러도 캠페인 성과가 비어 보이는 경우 이걸로 즉시 채움)
// 버튼을 누르면 즉시 응답이 오고, 실제 동기화는 평소처럼 GitHub Actions에서
// 1~2분 정도 걸려 완료됩니다(브라우저는 기다리지 않습니다).
//
// ⚠️ 배치 위치: api/trigger-naver-sync.js
// 필요한 Vercel 환경변수: GITHUB_DISPATCH_TOKEN
//   github.com/settings/tokens 에서 fine-grained token 발급 (Repository access:
//   my-dashboard 하나만, Permissions: Actions = Read and write) 후 등록하세요.
//
// 대시보드(ad-marketing-dashboard.vercel.app)가 다른 Vercel 프로젝트라 브라우저에서
// 크로스 오리진으로 호출합니다. 아래 ALLOWED_ORIGINS에 허용할 주소를 등록하세요.

const GITHUB_OWNER = 'somiiya05-cloud';
const GITHUB_REPO = 'my-dashboard';
// 버튼은 "오늘치를 지금 당겨오는" 용도입니다 (2026-09-12 변경).
//  - ping-naver-ads-sync: 입력 없이 = 이번 달. 오늘치 광고비·매출이 여기서 들어옵니다.
//  - ping-naver-keywords-daily-sync: from=to=오늘. 예전엔 입력을 안 줘서 "어제"만 받았고,
//    그래서 「오늘」 탭의 상세 성과(캠페인·키워드)가 늘 비어 있었습니다.
//  - ping-naver-keywords-sync(월 단위)는 버튼에서 뺐습니다. 같은 키워드 목록을 처음부터
//    다시 훑는 무거운 작업인데다 위 일별과 concurrency 그룹이 같아서 큐에서 기다리느라
//    버튼 한 번에 342초까지 걸렸습니다. 이건 매일 05:00(UTC) 스케줄로 계속 돕니다.
const WORKFLOWS = [
  { file: 'ping-naver-ads-sync.yml' },
  { file: 'ping-naver-keywords-daily-sync.yml', todayRange: true }
];

// 워크플로 안에서는 TZ=Asia/Seoul 로 날짜를 잡습니다. 여기(Vercel)는 UTC 라 9시간 더해서 맞춥니다.
function seoulToday() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
const ALLOWED_ORIGINS = [
  'https://ad-marketing-dashboard.vercel.app',
  'https://my-dashboard-three-fawn.vercel.app'
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function dispatchWorkflow(workflow, token) {
  const body = { ref: 'main' };
  if (workflow.todayRange) {
    const today = seoulToday();
    body.inputs = { from: today, to: today };
  }
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflow.file}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify(body)
    }
  );
  if (res.ok) return { workflow: workflow.file, ok: true };
  const detail = await res.text().catch(() => '');
  return { workflow: workflow.file, ok: false, status: res.status, detail };
}

module.exports = async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'missing_env_vars', detail: 'GITHUB_DISPATCH_TOKEN 이 설정돼 있는지 확인하세요.' });
  }

  try {
    const results = await Promise.all(WORKFLOWS.map((w) => dispatchWorkflow(w, token)));
    const date = seoulToday();
    const allOk = results.every((r) => r.ok);
    return res.status(allOk ? 200 : 502).json({ triggered: allOk, date, results });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

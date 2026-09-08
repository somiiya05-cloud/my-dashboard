// 대시보드의 "지금 동기화" 버튼이 호출하는 엔드포인트입니다.
// GitHub Actions를 수동으로 "Run workflow" 누르는 것과 정확히 같은 일을
// 코드로 대신 해줍니다 — 계정2 4조각 샤딩 등 이미 검증된 로직을 그대로
// 재사용하기 위해, 여기서 직접 동기화를 돌리지 않고 두 워크플로
// (ping-naver-ads-sync.yml, ping-naver-keywords-sync.yml)를 트리거만 합니다.
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
const WORKFLOWS = ['ping-naver-ads-sync.yml', 'ping-naver-keywords-sync.yml'];
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
  const res = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({ ref: 'main' })
    }
  );
  if (res.ok) return { workflow, ok: true };
  const detail = await res.text().catch(() => '');
  return { workflow, ok: false, status: res.status, detail };
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
    const allOk = results.every((r) => r.ok);
    return res.status(allOk ? 200 : 502).json({ triggered: allOk, results });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

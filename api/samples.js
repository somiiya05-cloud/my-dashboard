// "샘플연동" 화면이 쓰는 구글시트 연동 엔드포인트 3개를 하나로 합친 Vercel 서버리스 함수입니다.
// (원래 get-sample-product-list.js / get-sample-requests.js / add-sample-request.js 였습니다)
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "samples.js" 로 저장하세요.
//    최종 경로: api/samples.js
//
// 왜 합쳤나: Vercel Hobby 플랜은 배포당 서버리스 함수가 12개로 제한되는데,
// api 폴더의 .js 파일이 전부 함수로 잡혀 한도를 넘기면 배포 자체가 실패합니다.
// 셋 다 같은 구글시트를 쓰고 화면 한 곳(샘플연동)에서만 호출해서 묶기 좋았습니다.
//
// 사용법 (?action= 으로 구분):
//   GET  /api/samples?action=product-list  → { products: [...] }  상품명 자동완성용 목록
//   GET  /api/samples?action=requests      → { rows: [...] }      샘플 출고 요청 전체
//   POST /api/samples?action=add           → { ok: true, no: n }  새 요청 한 건 추가
//
// 필요한 Vercel 환경변수 (requests/add 에만 필요. product-list는 공개 CSV라 인증 불필요):
//   GOOGLE_OAUTH_CLIENT_ID     - OAuth 클라이언트 ID (Google Cloud Console > API 및 서비스 > 사용자 인증 정보)
//   GOOGLE_OAUTH_CLIENT_SECRET - 그 클라이언트의 보안 비밀번호
//   GOOGLE_OAUTH_REFRESH_TOKEN - 시트 편집 권한이 있는 구글 계정으로 발급받은 리프레시 토큰

const SPREADSHEET_ID = '1wG0zBTGreD_ClMiSz-iJBplgCMjQPTD7xIdV3jfMqFA';
const SHEET_NAME = '2026';
const PRODUCT_LIST_GID = '438432251'; // "상품리스트NEW" 탭

async function getAccessToken(clientId, clientSecret, refreshToken) {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    throw new Error('google_token_error: ' + JSON.stringify(tokenJson));
  }
  return tokenJson.access_token;
}

function googleEnv(res) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    res.status(500).json({
      error: 'missing_env_vars',
      detail: 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN 환경변수가 아직 설정되지 않았습니다.',
    });
    return null;
  }
  return { clientId, clientSecret, refreshToken };
}

function parseCsvLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // 값이 콤마를 포함해 큰따옴표로 감싸진 경우만 벗겨냅니다(한 열짜리 시트라 콤마 자체는 분리하지 않음).
      if (line.startsWith('"') && line.endsWith('"')) {
        return line.slice(1, -1).replace(/""/g, '"');
      }
      return line;
    });
}

// 이 시트는 링크가 있는 사람은 볼 수 있게 공유돼 있어서,
// 별도의 구글 인증 없이 공개 CSV 내보내기 URL로 바로 읽어옵니다(읽기 전용).
async function handleProductList(req, res) {
  const csvRes = await fetch(
    `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${PRODUCT_LIST_GID}`
  );
  if (!csvRes.ok) {
    const errText = await csvRes.text();
    return res.status(500).json({ error: 'sheet_read_error', detail: errText });
  }
  const lines = parseCsvLines(await csvRes.text());
  const products = lines.slice(1).filter(Boolean); // 첫 줄("상품명" 헤더) 제외

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  return res.status(200).json({ products });
}

async function handleRequests(req, res) {
  const env = googleEnv(res);
  if (!env) return;

  const accessToken = await getAccessToken(env.clientId, env.clientSecret, env.refreshToken);
  const dataRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A2:P`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!dataRes.ok) {
    const errText = await dataRes.text();
    return res.status(500).json({ error: 'sheets_read_error', detail: errText });
  }
  const dataJson = await dataRes.json();
  const rows = (dataJson.values || []).filter((row) => row.some((cell) => cell));

  return res.status(200).json({ rows });
}

async function handleAdd(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const env = googleEnv(res);
  if (!env) return;

  const body = req.body || {};
  const requester = String(body.requester || '').trim();
  const productOption = String(body.productOption || '').trim();
  if (!requester || !productOption) {
    return res.status(400).json({ error: 'missing_fields', detail: '요청자와 상품명/옵션은 필수입니다.' });
  }

  const accessToken = await getAccessToken(env.clientId, env.clientSecret, env.refreshToken);

  // 시트 중간에 번호만 있고 나머지가 비어있는 행(예전 테스트 잔재 등)이 있으면
  // append가 그 다음 빈 줄로 밀려 들어가면서 앞의 빈 줄이 계속 남아있게 됩니다.
  // 그래서 "번호"가 아니라 "요청자(B열)가 실제로 채워진 마지막 행"을 기준으로 다음 행을 정하고,
  // append 대신 그 정확한 행 번호에 직접 써서 중간의 빈 줄부터 순서대로 채워지게 합니다.
  const colBRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!B:B`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!colBRes.ok) {
    const errText = await colBRes.text();
    return res.status(500).json({ error: 'sheets_read_error', detail: errText });
  }
  const colBValues = (await colBRes.json()).values || [];
  let lastFilledRow = 1; // 1행은 헤더
  for (let i = colBValues.length - 1; i >= 1; i--) {
    if (colBValues[i] && String(colBValues[i][0] || '').trim()) { lastFilledRow = i + 1; break; }
  }

  const colARes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A${lastFilledRow}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!colARes.ok) {
    const errText = await colARes.text();
    return res.status(500).json({ error: 'sheets_read_error', detail: errText });
  }
  const colAValues = (await colARes.json()).values || [];
  const lastNo = lastFilledRow > 1 ? (Number(colAValues[0] && colAValues[0][0]) || 0) : 0;
  const nextNo = lastNo + 1;
  const targetRow = lastFilledRow + 1;

  const requestDate = new Date().toISOString().slice(0, 10);
  const row = [
    nextNo,
    requester,
    requestDate,
    body.desiredDate || '',
    productOption,
    body.quantity || '',
    body.recipientName || '',
    body.recipientPhone || '',
    body.recipientAddress || '',
    body.purpose || '',
    body.note || '',
    '진행전',
    '', '', '', '',
  ];

  const updateRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A${targetRow}:P${targetRow}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    }
  );
  if (!updateRes.ok) {
    const errText = await updateRes.text();
    return res.status(500).json({ error: 'sheets_write_error', detail: errText });
  }

  return res.status(200).json({ ok: true, no: nextNo });
}

const ACTIONS = {
  'product-list': handleProductList,
  requests: handleRequests,
  add: handleAdd,
};

module.exports = async function handler(req, res) {
  const action = (req.query && req.query.action) || '';
  const run = ACTIONS[action];
  if (!run) {
    return res.status(400).json({
      error: 'unknown_action',
      detail: `action은 ${Object.keys(ACTIONS).join(' / ')} 중 하나여야 합니다.`,
    });
  }
  try {
    return await run(req, res);
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

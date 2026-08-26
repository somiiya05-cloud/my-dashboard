// 대시보드의 "샘플연동" 화면에서 등록한 샘플 출고 요청을
// 구글시트 "[기획팀] 샘플 출고 요청 리스트"에 새 행으로 추가하는 Vercel 서버리스 함수입니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "add-sample-request.js" 로 저장하세요.
//    최종 경로: api/add-sample-request.js
//
// 필요한 Vercel 환경변수:
//   GOOGLE_OAUTH_CLIENT_ID     - OAuth 클라이언트 ID (Google Cloud Console > API 및 서비스 > 사용자 인증 정보)
//   GOOGLE_OAUTH_CLIENT_SECRET - 그 클라이언트의 보안 비밀번호
//   GOOGLE_OAUTH_REFRESH_TOKEN - 시트 편집 권한이 있는 구글 계정으로 한 번 로그인해서 발급받은 리프레시 토큰
//
// 이 방식은 실제 구글 계정(시트 편집 권한을 이미 가진 계정)의 권한을 위임받아 쓰는 방식이라
// 서비스 계정과 달리 시트를 별도로 공유해줄 필요가 없습니다.
// 세 환경변수가 없으면 이 함수는 오류를 반환합니다(설정 전까지는 사용할 수 없음을 안내).

const SPREADSHEET_ID = '1wG0zBTGreD_ClMiSz-iJBplgCMjQPTD7xIdV3jfMqFA';
const SHEET_NAME = '2026';

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN 환경변수가 아직 설정되지 않았습니다.',
    });
  }

  const body = req.body || {};
  const requester = String(body.requester || '').trim();
  const productOption = String(body.productOption || '').trim();
  if (!requester || !productOption) {
    return res.status(400).json({ error: 'missing_fields', detail: '요청자와 상품명/옵션은 필수입니다.' });
  }

  try {
    const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

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
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

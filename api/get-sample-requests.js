// 구글시트 "[기획팀] 샘플 출고 요청 리스트"의 전체 데이터를 읽어와
// 대시보드의 "샘플연동" 화면 목록에 보여주기 위한 Vercel 서버리스 함수입니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "get-sample-requests.js" 로 저장하세요.
//    최종 경로: api/get-sample-requests.js
//
// api/add-sample-request.js 와 동일한 환경변수를 사용합니다:
//   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN

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
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: 'GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN 환경변수가 아직 설정되지 않았습니다.',
    });
  }

  try {
    const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

    const dataRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A2:P`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!dataRes.ok) {
      const errText = await dataRes.text();
      return res.status(500).json({ error: 'sheets_read_error', detail: errText });
    }
    const dataJson = await dataRes.json();
    const rows = (dataJson.values || []).filter(row => row.some(cell => cell));

    return res.status(200).json({ rows });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

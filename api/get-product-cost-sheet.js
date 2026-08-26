// 구글시트 "25년]아이템운영리스트_기획팀대표계정"의 "상품리스트" 탭 전체를 읽어와
// 원가 대시보드 동기화(신규 상품 찾기)에 사용하기 위한 Vercel 서버리스 함수입니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "get-product-cost-sheet.js" 로 저장하세요.
//    최종 경로: api/get-product-cost-sheet.js
//
// api/add-sample-request.js 와 동일한 환경변수를 사용합니다:
//   GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN
//
// 시트 컬럼 순서 (A~T, 1~2행은 헤더):
// A 상품코드, B 바코드, C 브랜드, D 상품명, E 사이즈, F 색상, G 마킹, H 시즌, I 상태,
// J MOQ, K 결제정보, L 메모, M 단가(위안), N 원화(원가), O (미사용), P 판매가, Q 배수, R 물류지, S 택배사, T 택배비

const SPREADSHEET_ID = '1WhL6nu-P40BU_ZSbQQWVK-XqTw1YqtHCSpkrw3KUC0M';
const SHEET_NAME = '상품리스트';

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
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A3:T`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!dataRes.ok) {
      const errText = await dataRes.text();
      return res.status(500).json({ error: 'sheets_read_error', detail: errText });
    }
    const dataJson = await dataRes.json();
    const rows = (dataJson.values || []).filter(row => row[0]);

    return res.status(200).json({ rows });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

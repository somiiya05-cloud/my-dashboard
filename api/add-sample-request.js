// 대시보드의 "샘플연동" 화면에서 등록한 샘플 출고 요청을
// 구글시트 "[기획팀] 샘플 출고 요청 리스트"에 새 행으로 추가하는 Vercel 서버리스 함수입니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "add-sample-request.js" 로 저장하세요.
//    최종 경로: api/add-sample-request.js
//
// 필요한 Vercel 환경변수:
//   GOOGLE_SERVICE_ACCOUNT_EMAIL       - 구글 클라우드 서비스 계정 이메일
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY - 그 서비스 계정의 비공개 키(private_key, PEM 형식 그대로)
//
// 이 서비스 계정 이메일을 대상 구글시트에 "편집자"로 공유해줘야 합니다.
// 두 환경변수가 없으면 이 함수는 오류를 반환합니다(설정 전까지는 사용할 수 없음을 안내).

const crypto = require('crypto');

const SPREADSHEET_ID = '1wG0zBTGreD_ClMiSz-iJBplgCMjQPTD7xIdV3jfMqFA';
const SHEET_NAME = '2026';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
  const jwt = `${unsigned}.${base64url(signature)}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
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

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!clientEmail || !privateKeyRaw) {
    return res.status(500).json({
      error: 'missing_env_vars',
      detail: 'GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY 환경변수가 아직 설정되지 않았습니다.',
    });
  }
  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  const body = req.body || {};
  const requester = String(body.requester || '').trim();
  const productOption = String(body.productOption || '').trim();
  if (!requester || !productOption) {
    return res.status(400).json({ error: 'missing_fields', detail: '요청자와 상품명/옵션은 필수입니다.' });
  }

  try {
    const accessToken = await getAccessToken(clientEmail, privateKey);

    // 마지막 NO. 값을 읽어서 다음 번호를 계산합니다.
    const colARes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A:A`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!colARes.ok) {
      const errText = await colARes.text();
      return res.status(500).json({ error: 'sheets_read_error', detail: errText });
    }
    const colAJson = await colARes.json();
    const colAValues = colAJson.values || [];
    const lastRow = colAValues[colAValues.length - 1];
    const lastNo = (colAValues.length > 1 && lastRow) ? Number(lastRow[0]) || 0 : 0;
    const nextNo = lastNo + 1;

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

    const appendRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A:P:append?valueInputOption=USER_ENTERED`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [row] }),
      }
    );
    if (!appendRes.ok) {
      const errText = await appendRes.text();
      return res.status(500).json({ error: 'sheets_append_error', detail: errText });
    }

    return res.status(200).json({ ok: true, no: nextNo });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

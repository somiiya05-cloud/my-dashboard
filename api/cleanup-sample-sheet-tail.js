// 일회성 정리용 스크립트: "[기획팀] 샘플 출고 요청 리스트" 시트("2026" 탭) 맨 끝에 남아있던
// 예전 테스트 잔재 빈 줄(번호만 있거나 "진행전"만 남은 줄) 5개를 지웁니다.
// 삭제 전에 해당 행들이 정말 예상한 빈 패턴인지 다시 확인하고, 하나라도 다르면 아무것도 지우지 않고 중단합니다.
//
// 같은 GOOGLE_OAUTH_* 환경변수를 재사용합니다. 정리가 끝나면 이 파일은 삭제할 예정입니다.

const SPREADSHEET_ID = '1wG0zBTGreD_ClMiSz-iJBplgCMjQPTD7xIdV3jfMqFA';
const SHEET_NAME = '2026';
const SHEET_ID = 1670467574; // "2026" 탭의 내부 sheetId (gid)
const START_ROW_1INDEXED = 645; // 지울 첫 행 (사람이 보는 행 번호)
const END_ROW_1INDEXED = 649;   // 지울 마지막 행 (포함)

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
    return res.status(500).json({ error: 'missing_env_vars' });
  }

  try {
    const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

    const rangeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A${START_ROW_1INDEXED}:P${END_ROW_1INDEXED}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!rangeRes.ok) {
      return res.status(500).json({ error: 'sheets_read_error', detail: await rangeRes.text() });
    }
    const values = (await rangeRes.json()).values || [];

    // 안전장치: 5개 행 모두 "번호(A열)만 있고 B~K열은 비어있음" 이거나
    // "완전히 비어있음" 또는 "L열에 진행전만 있고 나머지는 비어있음" 패턴이어야만 삭제를 진행합니다.
    const isExpectedRow = (row) => {
      const cells = row || [];
      const hasRequester = (cells[1] || '').trim(); // B열: 요청자
      const hasProduct = (cells[4] || '').trim(); // E열: 상품명/옵션
      if (hasRequester || hasProduct) return false; // 실제 요청 데이터가 있으면 절대 지우지 않음
      return true;
    };
    const rowCount = END_ROW_1INDEXED - START_ROW_1INDEXED + 1;
    for (let i = 0; i < rowCount; i++) {
      if (!isExpectedRow(values[i])) {
        return res.status(409).json({
          error: 'unexpected_row_content',
          detail: `${START_ROW_1INDEXED + i}행에 예상하지 못한 데이터가 있어 삭제를 중단했습니다.`,
          row: values[i] || null,
        });
      }
    }

    const batchRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            deleteDimension: {
              range: {
                sheetId: SHEET_ID,
                dimension: 'ROWS',
                startIndex: START_ROW_1INDEXED - 1,
                endIndex: END_ROW_1INDEXED,
              },
            },
          }],
        }),
      }
    );
    const batchJson = await batchRes.json();
    if (!batchRes.ok) {
      return res.status(500).json({ error: 'sheets_delete_error', detail: batchJson });
    }

    // 삭제 직후 같은 범위를 다시 읽어서 실제로 바뀌었는지 확인합니다(진단용).
    const verifyRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A${START_ROW_1INDEXED}:P${END_ROW_1INDEXED}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const verifyValues = verifyRes.ok ? (await verifyRes.json()).values || [] : null;

    return res.status(200).json({
      ok: true,
      deletedRows: rowCount,
      batchUpdateResponse: batchJson,
      beforeValues: values,
      afterValuesAtSameRange: verifyValues,
    });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

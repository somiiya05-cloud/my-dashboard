// 일회성 정리용 스크립트: "[기획팀] 샘플 출고 요청 리스트" 시트("2026" 탭) 맨 끝에 남아있던
// 예전 테스트 잔재 빈 줄(번호만 있거나 "진행전"만 남은 줄)을 지웁니다.
//
// 고정된 행 번호 대신, 라이브 데이터에서 "요청자(B열)가 실제로 채워진 마지막 행"을 직접 찾아서
// 그 다음 행부터 시트의 진짜 마지막 행까지를 삭제 대상으로 삼습니다(구글시트 공개 CSV 내보내기는
// 캐시가 걸려 실제 행 번호와 어긋날 수 있어 쓰지 않습니다).
// 삭제 전 대상 행들에 요청자/상품명이 하나라도 있으면 즉시 중단합니다.
//
// 같은 GOOGLE_OAUTH_* 환경변수를 재사용합니다. 정리가 끝나면 이 파일은 삭제할 예정입니다.

const SPREADSHEET_ID = '1wG0zBTGreD_ClMiSz-iJBplgCMjQPTD7xIdV3jfMqFA';
const SHEET_NAME = '2026';
const SHEET_ID = 1670467574; // "2026" 탭의 내부 sheetId (gid)

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
    const headers = { Authorization: `Bearer ${accessToken}` };

    const [colARes, colBRes, colERes, colLRes] = await Promise.all([
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!A:A`, { headers }),
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!B:B`, { headers }),
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!E:E`, { headers }),
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(SHEET_NAME)}!L:L`, { headers }),
    ]);
    if (!colARes.ok || !colBRes.ok || !colERes.ok || !colLRes.ok) {
      return res.status(500).json({ error: 'sheets_read_error' });
    }
    const colA = (await colARes.json()).values || [];
    const colB = (await colBRes.json()).values || [];
    const colE = (await colERes.json()).values || [];
    const colL = (await colLRes.json()).values || [];

    const totalRows = Math.max(colA.length, colB.length, colE.length, colL.length);

    // 요청자(B열)가 실제로 채워진 마지막 행(1-indexed)을 찾습니다. 1행은 헤더.
    let lastFilledRow = 1;
    for (let i = totalRows - 1; i >= 1; i--) {
      if (colB[i] && String(colB[i][0] || '').trim()) { lastFilledRow = i + 1; break; }
    }

    if (totalRows <= lastFilledRow) {
      return res.status(200).json({ ok: true, deletedRows: 0, detail: '정리할 빈 줄이 없습니다.', lastFilledRow, totalRows });
    }

    // lastFilledRow 다음 행부터 시트 끝까지가 삭제 대상. 안전장치로 그 구간에
    // 요청자(B) 또는 상품명(E)이 하나라도 있으면 중단합니다.
    for (let i = lastFilledRow; i < totalRows; i++) {
      const b = (colB[i] && colB[i][0]) || '';
      const e = (colE[i] && colE[i][0]) || '';
      if (String(b).trim() || String(e).trim()) {
        return res.status(409).json({
          error: 'unexpected_row_content',
          detail: `${i + 1}행에 요청자/상품명이 있어 삭제를 중단했습니다.`,
          row: i + 1, requester: b, product: e,
        });
      }
    }

    const startRow1Indexed = lastFilledRow + 1;
    const endRow1Indexed = totalRows;
    const rowCount = endRow1Indexed - startRow1Indexed + 1;

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
                startIndex: startRow1Indexed - 1,
                endIndex: endRow1Indexed,
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

    return res.status(200).json({
      ok: true,
      deletedRows: rowCount,
      deletedRange: `${startRow1Indexed}~${endRow1Indexed}`,
      lastFilledRow,
      totalRowsBefore: totalRows,
    });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

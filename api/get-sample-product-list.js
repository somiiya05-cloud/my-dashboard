// 구글시트 "[기획팀] 샘플 출고 요청 리스트"의 "상품리스트NEW" 탭(상품명/옵션 드롭다운의 원본 목록)을
// 그대로 읽어와서, 대시보드 "샘플연동" 등록 폼의 상품명 검색 자동완성에 쓰기 위한 Vercel 서버리스 함수입니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "get-sample-product-list.js" 로 저장하세요.
//    최종 경로: api/get-sample-product-list.js
//
// 이 시트는 링크가 있는 사람은 볼 수 있게 공유돼 있어서, add-sample-request.js와 달리
// 별도의 구글 인증(OAuth) 없이 공개 CSV 내보내기 URL로 바로 읽어옵니다(읽기 전용).

const SPREADSHEET_ID = '1wG0zBTGreD_ClMiSz-iJBplgCMjQPTD7xIdV3jfMqFA';
const PRODUCT_LIST_GID = '438432251'; // "상품리스트NEW" 탭

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

module.exports = async function handler(req, res) {
  try {
    const csvRes = await fetch(
      `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${PRODUCT_LIST_GID}`
    );
    if (!csvRes.ok) {
      const errText = await csvRes.text();
      return res.status(500).json({ error: 'sheet_read_error', detail: errText });
    }
    const text = await csvRes.text();
    const lines = parseCsvLines(text);
    const products = lines.slice(1).filter(Boolean); // 첫 줄("상품명" 헤더) 제외

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ products });
  } catch (err) {
    return res.status(500).json({ error: 'unexpected_error', detail: String(err) });
  }
};

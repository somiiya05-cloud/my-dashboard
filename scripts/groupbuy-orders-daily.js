// 공구 주문 적재 — 매일 자동 실행용
//
// 일 매출마감 NAS 폴더에서 최근 파일을 읽어 groupbuy_order_lines 에 쌓습니다.
// 대시보드 > 프로모션 > 공구 정산 계산의 누적 매출이 이 값을 씁니다.
//
// ⚠️ NAS(172.30.1.100)는 사내망이라 GitHub Actions 에서는 못 닿습니다.
//    그래서 이 PC 의 작업 스케줄러로 돌립니다.
//    등록: node scripts/groupbuy-orders-schedule.js
//
// 이번 달과 지난달 폴더를 함께 봅니다. 월이 바뀌어도 지난달 마지막 날 파일을 놓치지 않게요.
// 실제로 읽는 것은 최근 GB_DAYS 일(기본 14) 안의 파일뿐이고, 같은 파일을 다시 읽어도
// 줄이 늘지 않습니다(주문번호·옵션·주문일·줄번호로 묶습니다).
//
// 수동 실행: node scripts/groupbuy-orders-daily.js
//   DRY_RUN=1  저장하지 않고 무엇이 들어갈지만 출력

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BASE = '\\\\172.30.1.100\\영업팀\\01. 팀자료\\01. 보고자료\\02. 日 매출마감';

function monthDir(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return path.join(BASE, String(y), `${y}.${m}`);
}

const now = new Date();
const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
const dirs = [monthDir(prev), monthDir(now)].filter((d) => {
  try { return fs.statSync(d).isDirectory(); } catch (e) { return false; }
});

console.log(`[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] 공구 주문 적재 시작`);
if (!dirs.length) {
  console.error('NAS 폴더를 찾지 못했습니다. 사내망에 연결돼 있는지 확인해주세요.');
  console.error('  ' + monthDir(now));
  process.exit(1);
}
dirs.forEach((d) => console.log('  폴더: ' + d));

try {
  execFileSync(process.execPath, [path.join(__dirname, 'groupbuy-orders-sync.js'), ...dirs],
    { stdio: 'inherit', env: process.env });
  console.log('끝.');
} catch (e) {
  console.error('적재 중 실패했습니다.');
  process.exit(1);
}

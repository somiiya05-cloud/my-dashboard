// 매출DB / 확장주문검색 파일에서 공구 주문줄만 골라 Supabase 의 groupbuy_order_lines 에 쌓습니다.
// 대시보드 > 프로모션 > 공구 정산 계산 의 "쌓아둔 주문 불러오기" 가 이 값을 읽습니다.
//
// ⚠️ Vercel 서버리스 함수가 아니라 여기서 직접 돕니다.
//    Vercel 무료 플랜은 배포당 함수가 12개까지인데 이미 12개를 다 쓰고 있어서,
//    함수를 하나 더 넣으면 배포 자체가 실패합니다.
//
// 왜 필요한가:
//   정산할 때마다 주문 파일을 다시 받아 올리는 대신, 매일 보는 매출DB 를 올릴 때
//   공구 주문만 쌓아 둡니다. 그러면 정산 시점에는 공구만 고르면 됩니다.
//   sales_transactions 는 건드리지 않습니다 — 그 표에는 캠페인(어느 인플루언서 공구인지)과
//   옵션 칸이 없어 수수료를 계산할 수 없습니다.
//
// 실행: node scripts/groupbuy-orders-sync.js "C:/.../260921_매출DB.xlsx"
//   DRY_RUN=1  저장하지 않고 무엇이 들어갈지만 출력
//
// 받는 파일
//   · .xlsx                     매출DB
//   · .xls (속은 HTML <table>)  이지어드민 확장주문검색 내보내기
//   · .csv
//
// 같은 파일을 다시 돌려도 줄이 늘지 않습니다(주문번호·옵션·주문일·줄번호로 묶습니다).
// 나중에 취소로 바뀐 건은 다시 돌리면 덮어써집니다.

const fs = require('fs');
const zlib = require('zlib');

const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY
  || 'sb_publishable_uE-8s2DbZBUSs0z1uQ-nIA_za2Ah3uT';
const DRY_RUN = !!process.env.DRY_RUN;

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json'
};

// ---- 칸 이름 후보. 판매처마다 조금씩 달라 먼저 찾히는 것을 씁니다. ----
const COL = {
  campaign: ['판매처 상품명', '판매처상품명', '기획전명', '캠페인'],
  vendor:   ['판매처', '판매채널', '채널'],
  product:  ['상품명', '제품명'],
  option:   ['판매처 옵션', '판매처옵션', '옵션명', '옵션'],
  amount:   ['판매가', '판매금액', '결제금액', '금액'],
  qty:      ['주문수량', '수량'],
  date:     ['주문일', '주문일자', '결제일'],
  no:       ['주문번호'],
  status:   ['CS', '주문상태', '상태']
};

// 대시보드(index.html 의 gbFeeOptionKey)와 글자 하나까지 같아야 합니다.
// 여기서 만든 키로 저장하고 대시보드가 그 키로 찾기 때문입니다.
// '+' 는 일부러 남깁니다 — 없애면 "1+1 (20ea)" 와 "11 (20ea)" 가 같은 키가 됩니다.
function normKey(s) {
  return String(s || '')
    .replace(/^\s*옵션\s*=\s*/, '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣+]/g, '');
}

function parseDate(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  // 엑셀 일련번호 (기준일 1899-12-30)
  const n = Number(s);
  if (Number.isFinite(n) && n > 20000 && n < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

const num = (v) => {
  const n = Number(String(v == null ? '' : v).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

// ---- zip 읽기 (xlsx 는 zip 입니다. 외부 패키지를 쓰지 않으려고 직접 풉니다) ----
function unzip(buf) {
  const files = {};
  // 중앙 디렉터리 끝(EOCD) 을 뒤에서부터 찾습니다.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip 구조를 읽지 못했습니다 (xlsx 가 맞는지 확인해주세요)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // 로컬 헤더에서 실제 데이터 시작 위치를 다시 계산합니다(extra 길이가 다를 수 있습니다).
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + compSize);
    files[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return files;
}

function xmlUnescape(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)));
}

function colIndex(ref) {
  const m = ref.match(/^([A-Z]+)/);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(buf) {
  const zip = unzip(buf);
  const shared = [];
  const ssName = Object.keys(zip).find((n) => /sharedStrings\.xml$/i.test(n));
  if (ssName) {
    const ss = zip[ssName].toString('utf8');
    for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      let t = '';
      for (const tm of si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) t += tm[1];
      shared.push(xmlUnescape(t));
    }
  }
  // 시트가 여럿이면 주문 칸이 있는 것을 찾을 때까지 넘깁니다.
  const sheets = Object.keys(zip).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)).sort();
  for (const name of sheets) {
    const xml = zip[name].toString('utf8');
    const grid = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      // 자기닫힘 셀(<c r="C5" s="16"/>)과 값이 있는 셀을 함께 봅니다.
      // [^>]* 를 탐욕적으로 쓰면 "/>" 의 슬래시까지 먹어 뒷 셀 값을 끌어옵니다.
      // 그러면 칸이 통째로 밀려 다른 칸 값이 들어옵니다(실제로 그랬습니다).
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cm[1] || '', inner = cm[2] || '';
        const ref = (attrs.match(/r="([A-Z]+\d+)"/) || [])[1];
        if (!ref) continue;
        const t = (attrs.match(/t="([^"]+)"/) || [])[1];
        const vm = inner.match(/<v>([\s\S]*?)<\/v>/);
        let val = '';
        if (t === 's' && vm) val = shared[Number(vm[1])] || '';
        else if (t === 'inlineStr') {
          let s = '';
          for (const tm of inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) s += tm[1];
          val = xmlUnescape(s);
        } else if (vm) val = xmlUnescape(vm[1]);
        cells[colIndex(ref)] = val;
      }
      grid.push(cells);
    }
    const rows = gridToRows(grid);
    if (rows) return rows;
  }
  return null;
}

// 이지어드민 확장주문검색은 확장자만 .xls 이고 속은 HTML <table> 입니다.
function readHtmlTable(text) {
  const strip = (s) => xmlUnescape(
    s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ')
  ).trim();
  let best = null;
  for (const tm of text.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const grid = [];
    for (const rm of tm[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rm[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => strip(c[1]));
      if (cells.length) grid.push(cells);
    }
    if (!best || grid.length > best.length) best = grid;
  }
  return best ? gridToRows(best) : null;
}

function readCsv(text) {
  const grid = text.split(/\r?\n/).filter((l) => l.trim()).map((line) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  });
  return gridToRows(grid);
}

// 머리글이 1행에 없는 파일(위에 제목 줄이 붙은 경우)도 있어 위에서부터 훑어 찾습니다.
function gridToRows(grid) {
  const hit = (cells, names) => cells.some((c) => names.includes(c));
  let h = -1;
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const cells = (grid[i] || []).map((c) => String(c == null ? '' : c).trim());
    if (hit(cells, COL.option) && hit(cells, COL.amount)) { h = i; break; }
  }
  if (h < 0) return null;
  const head = grid[h].map((c) => String(c == null ? '' : c).trim());
  return grid.slice(h + 1).map((r) => {
    const o = {};
    head.forEach((k, i) => { if (k) o[k] = r[i] == null ? '' : String(r[i]).trim(); });
    return o;
  });
}

function pick(row, names) {
  for (const n of names) if (row[n] !== undefined && String(row[n]).trim() !== '') return row[n];
  return '';
}

function readFile(path) {
  const buf = fs.readFileSync(path);
  const head = buf.subarray(0, 4096).toString('utf8').toLowerCase();
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);           // PK.. = zip = xlsx
  if (/<table|<html|<meta|<!doctype/.test(head)) return readHtmlTable(buf.toString('utf8'));
  return readCsv(buf.toString('utf8'));
}

// 폴더를 주면 그 안의 매출 파일을 모두 돌립니다. 날짜별 자동 실행이 한 줄로 끝나게 하려고요.
// 이름 앞의 날짜(20260921_일매출.xlsx)가 최근 GB_DAYS 일(기본 14) 안인 것만 봅니다.
// 오래된 파일까지 매일 다시 읽을 이유가 없습니다. 다시 돌려도 줄이 늘지는 않습니다.
function expandPaths(args) {
  const out = [];
  const days = Number(process.env.GB_DAYS || 14);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10).replace(/-/g, '');
  for (const p of args) {
    let stat = null;
    try { stat = fs.statSync(p); } catch (e) { console.error('없는 경로라 건너뜁니다: ' + p); continue; }
    if (!stat.isDirectory()) { out.push(p); continue; }
    fs.readdirSync(p)
      .filter((n) => /\.(xlsx|xls|csv)$/i.test(n) && !n.startsWith('~$'))
      .sort()
      .forEach((n) => {
        // 20260918-0920_일매출.xlsx 처럼 여러 날짜가 붙은 파일은 앞 날짜로 봅니다.
        const m = n.match(/(\d{8})/);
        if (m && m[1] < since) return;
        out.push(p.replace(/[\\/]$/, '') + '/' + n);
      });
  }
  return out;
}

async function main() {
  const paths = expandPaths(process.argv.slice(2));
  if (!paths.length) {
    console.error('파일이나 폴더 경로를 넣어주세요.\n  node scripts/groupbuy-orders-sync.js "C:/.../260921_매출DB.xlsx"\n  node scripts/groupbuy-orders-sync.js "//172.30.1.100/영업팀/.../2026.09"');
    process.exit(1);
  }
  if (paths.length > 1) {
    // 여러 개면 하나씩 이 스크립트를 다시 돌립니다. 파일마다 결과를 따로 보여 주려고요.
    const { execFileSync } = require('child_process');
    let fail = 0;
    for (const p of paths) {
      console.log('\n────────── ' + p.split(/[\\/]/).pop());
      try {
        execFileSync(process.execPath, [__filename, p], { stdio: 'inherit', env: process.env });
      } catch (e) { fail++; console.error('  ↑ 실패'); }
    }
    console.log(`\n전체 ${paths.length}개 중 ${paths.length - fail}개 성공` + (fail ? `, ${fail}개 실패` : ''));
    process.exit(fail ? 1 : 0);
  }
  const path = paths[0];
  const rows = readFile(path);
  if (!rows) {
    console.error('주문 내역을 찾지 못했습니다. "판매처 옵션"(또는 옵션명)과 "판매가" 칸이 있어야 합니다.');
    process.exit(1);
  }
  console.log(`읽은 줄: ${rows.length}`);

  // 공구 주문만, 그중에서도 영업팀 건만 남깁니다.
  //
  // 매출DB 는 판매처가 "공동구매(영업팀)" / "공동구매(컨텐츠팀)" 으로 갈려 있어 팀을 가릴 수
  // 있습니다. 컨텐츠팀 공구(헬룸·마마홈 등)는 영업팀이 정산하는 건이 아니라 담지 않습니다.
  // 기획전명으로는 가릴 수 없습니다 — "코드니처x마마홈 세정서버" 처럼 공동구매라는 말이
  // 없는 컨텐츠팀 건도, "코드니처 X  헬룸 공동구매" 처럼 있는 건도 있습니다.
  //
  // 확장주문검색 내보내기는 판매처가 전부 "코드니처" 라 팀을 알 수 없습니다. 그때는
  // 기획전명으로 공구만 고르고, 팀이 섞일 수 있다고 알립니다.
  const TEAM = process.env.GB_TEAM || '영업팀';
  // 정산 직전에 한 공구만 새로 고칠 때 씁니다.
  //   GB_ONLY=데이원 node scripts/groupbuy-orders-sync.js "<확장주문검색 파일>"
  // 일별 적재는 그날 찍힌 상태라, 나중에 생긴 취소를 모릅니다(9/5 주문이 9/10 에 취소돼도
  // 9/5 파일에는 "정상" 으로 남아 있습니다). 확장주문검색은 내보낸 시점의 상태라 이걸로
  // 덮어써야 맞습니다. 다만 그 파일에는 팀 정보가 없어 컨텐츠팀까지 들어오므로,
  // 공구를 지정해 그 공구만 건드립니다.
  const ONLY = process.env.GB_ONLY || '';
  if (ONLY) console.log(`"${ONLY}" 가 든 공구만 갱신합니다.`);
  const hasTeam = rows.some((r) => /공동구매/.test(String(pick(r, COL.vendor) || '')));
  if (hasTeam) {
    console.log(`공구 고르는 기준: 판매처 = 공동구매(${TEAM})`);
  } else {
    console.log('공구 고르는 기준: 기획전명 (이 파일에는 판매처에 팀이 없어 영업팀/컨텐츠팀이 섞입니다)');
  }

  const seq = new Map();
  const payload = [];
  const otherTeam = new Map();
  const skipped = { 공구아님: 0, 다른팀: 0, 판매가0: 0, 주문일없음: 0 };
  for (const r of rows) {
    const campaign = String(pick(r, COL.campaign) || '').trim();
    const vendor = String(pick(r, COL.vendor) || '').trim();
    if (ONLY && !campaign.includes(ONLY)) { skipped.공구아님++; continue; }
    if (hasTeam) {
      if (!/공동구매/.test(vendor)) { skipped.공구아님++; continue; }
      if (!vendor.includes(TEAM)) {
        skipped.다른팀++;
        otherTeam.set(campaign, (otherTeam.get(campaign) || 0) + 1);
        continue;
      }
    } else if (!/공동구매|공구/.test(campaign)) { skipped.공구아님++; continue; }
    const option = String(pick(r, COL.option) || '').trim();
    const amount = num(pick(r, COL.amount));
    // 세트 상품은 구성품마다 한 줄씩 들어오고 둘째 줄부터 판매가가 0 입니다.
    // 그 줄까지 담으면 같은 주문을 두 번 세게 되므로 판매가가 있는 줄만 담습니다.
    if (!option || amount <= 0) { skipped.판매가0++; continue; }
    const date = parseDate(pick(r, COL.date));
    if (!date) { skipped.주문일없음++; continue; }
    const optionKey = normKey(option);
    const orderNo = String(pick(r, COL.no) || '').trim();
    const g = [orderNo, optionKey, date].join('|');
    const n = (seq.get(g) || 0) + 1;
    seq.set(g, n);
    const qty = num(pick(r, COL.qty)) || 1;
    payload.push({
      campaign, campaign_key: normKey(campaign),
      order_no: orderNo, order_date: date,
      vendor: String(pick(r, COL.vendor) || '').trim() || null,
      product_name: String(pick(r, COL.product) || '').trim() || null,
      option_name: option.replace(/^\s*옵션\s*=\s*/, ''), option_key: optionKey,
      qty, amount, cs_status: String(pick(r, COL.status) || '').trim() || null,
      line_seq: n, updated_at: new Date().toISOString()
    });
  }

  const byCampaign = {};
  payload.forEach((x) => {
    const c = byCampaign[x.campaign] = byCampaign[x.campaign] || { n: 0, amt: 0 };
    c.n++; c.amt += x.amount;
  });
  console.log(`담을 공구 주문: ${payload.length}줄 · 공구 ${Object.keys(byCampaign).length}개`);
  Object.entries(byCampaign).sort((a, b) => b[1].amt - a[1].amt).forEach(([k, v]) =>
    console.log(`  ${String(v.n).padStart(5)}줄  ${String(v.amt.toLocaleString()).padStart(12)}원  ${k}`));
  console.log(`건너뛴 줄: 공구아님 ${skipped.공구아님} · 다른 팀 ${skipped.다른팀} · 판매가0/옵션없음 ${skipped.판매가0} · 주문일없음 ${skipped.주문일없음}`);
  if (otherTeam.size) {
    console.log(`  ${TEAM} 이 아니라 뺀 공구: ` +
      [...otherTeam.entries()].map(([k, v]) => `${k}(${v}줄)`).join(', '));
  }

  if (!payload.length) return;
  if (DRY_RUN) { console.log('\nDRY_RUN=1 이라 저장하지 않았습니다.'); return; }

  // 한 번에 다 보내면 요청이 너무 커져 나눠 보냅니다.
  const url = `${SUPABASE_URL}/rest/v1/groupbuy_order_lines`
    + '?on_conflict=order_no,option_key,order_date,line_seq';
  let done = 0;
  for (let i = 0; i < payload.length; i += 500) {
    const chunk = payload.slice(i, i + 500);
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk)
    });
    if (!res.ok) {
      console.error(`저장 실패 (${res.status}): ${await res.text()}`);
      console.error('groupbuy_order_lines.sql 을 Supabase SQL Editor 에서 실행했는지 확인해주세요.');
      process.exit(1);
    }
    done += chunk.length;
    process.stdout.write(`\r저장 중... ${done} / ${payload.length}`);
  }
  console.log(`\n완료 — ${done}줄 저장했습니다.`);
}

main().catch((err) => { console.error(err); process.exit(1); });

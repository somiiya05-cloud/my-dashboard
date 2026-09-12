// 다우오피스 메일함(IMAP)에서 오늘 받은 게시판 알림 메일 중 제목에 "런칭"이 들어간
// 건수를 세어 Supabase의 launch_post_counts 테이블에 저장하는 Vercel 서버리스 함수입니다.
// 대시보드의 "신제품 광고세팅" 옆 빨간 배지가 이 값을 읽습니다.
//
// ⚠️ 배치 위치: GitHub 저장소 최상위의 "api" 폴더 안에 "sync-launch-posts.js" 로 저장하세요.
//    최종 경로: api/sync-launch-posts.js
//
// 다우오피스 OpenAPI에는 게시판 조회 기능이 없어서, 게시판 구독 알림 메일을 대신 읽습니다.
//
// 필요한 Vercel 환경변수:
//   SUPABASE_SERVICE_ROLE_KEY - Supabase 프로젝트 설정 → API → service_role 키
//   CRON_SECRET               - 다른 sync 함수와 같은 값
//   DAOU_MAIL_USER            - 다우오피스 메일 주소 (예: hong@selfdiylab.com)
//   DAOU_MAIL_PASSWORD        - 그 계정의 비밀번호 (앱 전용 비밀번호가 있으면 그쪽을 권장)
// 선택 환경변수:
//   DAOU_IMAP_HOST            - 기본값 imap.daouoffice.com
//   DAOU_LAUNCH_KEYWORD       - 기본값 "런칭". 제목에 이 단어가 들어간 메일만 셉니다.
//   DAOU_MAIL_FROM            - 발신자 주소에 이 문자열이 들어간 메일만 셉니다(오검출 방지, 선택).
//   DAOU_MAIL_BOX             - 기본값 INBOX
//
// 메일 계정 정보가 없으면 아무 것도 하지 않고 "no_credentials"만 돌려주므로,
// 환경변수를 넣기 전에 미리 배포해두어도 안전합니다.
//
// 수동 테스트 (터미널에서):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" "https://내주소.vercel.app/api/sync-launch-posts"
// 제목 형태를 확인하고 싶을 때 (오늘 받은 메일 제목을 그대로 돌려줍니다. 저장은 하지 않음):
//   curl -H "Authorization: Bearer <CRON_SECRET 값>" "https://내주소.vercel.app/api/sync-launch-posts?debug=1"

const tls = require('tls');

const SUPABASE_URL = 'https://fwsszzjfjktliredmjcn.supabase.co';
const ASSIGNEE = '전휘원';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function todayInSeoul() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

// IMAP SEARCH SINCE 가 요구하는 "12-Sep-2026" 형식
function toImapDate(ymd) {
  const [y, m, d] = ymd.split('-');
  return `${Number(d)}-${MONTHS[Number(m) - 1]}-${y}`;
}

// IMAP 문자열 인자는 큰따옴표로 감싸고 \ 와 " 를 이스케이프합니다.
function imapQuote(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// 메일 제목의 =?UTF-8?B?....?= 같은 MIME 인코딩 조각을 실제 글자로 되돌립니다.
// 한글 메일은 UTF-8 또는 EUC-KR(=CP949)로 인코딩돼 오는 경우가 둘 다 있습니다.
function decodeMimeWords(raw) {
  // 인접한 인코딩 조각 사이의 공백은 규격상 무시해야 합니다.
  const joined = String(raw).replace(/\?=\s+=\?/g, '?==?');
  return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset, enc, text) => {
    try {
      let bytes;
      if (enc.toUpperCase() === 'B') {
        bytes = Buffer.from(text, 'base64');
      } else {
        const unescaped = text
          .replace(/_/g, ' ')
          .replace(/=([0-9A-Fa-f]{2})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)));
        bytes = Buffer.from(unescaped, 'binary');
      }
      const cs = charset.toLowerCase().replace(/^ks_c_5601-1987$/, 'euc-kr');
      return new TextDecoder(cs).decode(bytes);
    } catch (e) {
      return whole; // 모르는 charset이면 원문 그대로 둡니다.
    }
  });
}

// 헤더 블록에서 접힌 줄(다음 줄이 공백으로 시작)까지 합쳐 특정 헤더 값을 모두 뽑습니다.
function extractHeader(block, name) {
  const lines = block.split(/\r?\n/);
  const values = [];
  const head = name.toLowerCase() + ':';
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().startsWith(head)) {
      let value = lines[i].slice(head.length).trim();
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
        value += ' ' + lines[++i].trim();
      }
      values.push(value);
    }
  }
  return values;
}

// 의존성 없이 쓰는 최소 IMAP 클라이언트 — 명령을 보내고 태그 응답까지 모아서 돌려줍니다.
function imapConnect({ host, port, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let pending = null;
    let greeted = false;
    let tagNo = 0;

    const socket = tls.connect({ host, port, servername: host });
    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);

    const api = {
      send(command, label) {
        return new Promise((ok, fail) => {
          const tag = 'a' + ++tagNo;
          pending = { tag, ok, fail, label: label || command.split(' ')[0] };
          buffer = '';
          socket.write(tag + ' ' + command + '\r\n');
        });
      },
      close() {
        try { socket.end(); } catch (e) { /* 이미 닫힘 */ }
      }
    };

    socket.on('data', (chunk) => {
      buffer += chunk;
      if (!greeted) {
        if (buffer.includes('\r\n')) { greeted = true; buffer = ''; resolve(api); }
        return;
      }
      if (!pending) return;
      const done = buffer.match(new RegExp('^' + pending.tag + ' (OK|NO|BAD)([^\\r\\n]*)', 'm'));
      if (!done) return;
      const body = buffer;
      const p = pending;
      pending = null;
      buffer = '';
      if (done[1] === 'OK') p.ok(body);
      else p.fail(new Error(`IMAP ${p.label} 실패: ${done[1]}${done[2]}`));
    });

    socket.on('timeout', () => {
      const err = new Error('IMAP 응답 시간 초과');
      socket.destroy();
      if (pending) { pending.fail(err); pending = null; } else reject(err);
    });

    socket.on('error', (err) => {
      if (pending) { pending.fail(err); pending = null; } else reject(err);
    });
  });
}

async function fetchTodaySubjects({ host, port, user, password, mailbox, timeoutMs }) {
  const client = await imapConnect({ host, port, timeoutMs });
  try {
    await client.send(`LOGIN ${imapQuote(user)} ${imapQuote(password)}`, 'LOGIN');
    await client.send(`SELECT ${imapQuote(mailbox)}`, 'SELECT');

    const searchRes = await client.send(`SEARCH SINCE ${toImapDate(todayInSeoul())}`, 'SEARCH');
    const searchLine = (searchRes.match(/^\* SEARCH([^\r\n]*)/m) || [])[1] || '';
    const ids = searchLine.trim().split(/\s+/).filter(Boolean);
    if (!ids.length) return [];

    // 제목·발신자·날짜 헤더만 받아옵니다. PEEK이라 읽음 표시가 바뀌지 않습니다.
    const fetchRes = await client.send(
      `FETCH ${ids.join(',')} (BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])`,
      'FETCH'
    );

    // 응답 전체에서 Subject/From 쌍을 메시지 단위로 끊어 읽습니다.
    return fetchRes
      .split(/^\* \d+ FETCH /m)
      .slice(1)
      .map((block) => ({
        subject: decodeMimeWords((extractHeader(block, 'Subject')[0] || '').trim()),
        from: decodeMimeWords((extractHeader(block, 'From')[0] || '').trim()),
        date: (extractHeader(block, 'Date')[0] || '').trim()
      }))
      .filter((m) => m.subject || m.from);
  } finally {
    try { await client.send('LOGOUT', 'LOGOUT'); } catch (e) { /* 무시 */ }
    client.close();
  }
}

module.exports = async function handler(req, res) {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const user = process.env.DAOU_MAIL_USER;
  const password = process.env.DAOU_MAIL_PASSWORD;
  if (!user || !password) {
    return res.status(200).json({
      skipped: 'no_credentials',
      detail: 'DAOU_MAIL_USER / DAOU_MAIL_PASSWORD 환경변수가 설정되면 동작합니다.'
    });
  }

  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseServiceKey) {
    return res.status(500).json({ error: 'missing_env_vars', detail: 'SUPABASE_SERVICE_ROLE_KEY 확인 필요' });
  }

  const host = process.env.DAOU_IMAP_HOST || 'imap.daouoffice.com';
  const mailbox = process.env.DAOU_MAIL_BOX || 'INBOX';
  const keyword = process.env.DAOU_LAUNCH_KEYWORD || '런칭';
  const fromFilter = process.env.DAOU_MAIL_FROM || '';
  const today = todayInSeoul();

  let messages;
  try {
    messages = await fetchTodaySubjects({ host, port: 993, user, password, mailbox, timeoutMs: 30000 });
  } catch (err) {
    return res.status(502).json({ error: 'imap_failed', detail: String(err.message || err) });
  }

  const scoped = fromFilter ? messages.filter((m) => m.from.includes(fromFilter)) : messages;
  const matched = scoped.filter((m) => m.subject.includes(keyword));

  // 제목 형태를 눈으로 확인하려고 부를 때는 저장하지 않고 목록만 돌려줍니다.
  if (req.query && (req.query.debug === '1' || req.query.debug === 'true')) {
    return res.status(200).json({
      today,
      keyword,
      from_filter: fromFilter || null,
      total_today: messages.length,
      matched_count: matched.length,
      subjects: messages.map((m) => ({ subject: m.subject, from: m.from, date: m.date }))
    });
  }

  // 담당자가 그날 +/- 로 직접 정한 값(manual=true)은 덮어쓰지 않습니다.
  const headers = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
    'Content-Type': 'application/json'
  };
  const rowRes = await fetch(
    `${SUPABASE_URL}/rest/v1/launch_post_counts` +
      `?assignee=eq.${encodeURIComponent(ASSIGNEE)}&check_date=eq.${today}&select=id,count,manual`,
    { headers }
  );
  if (!rowRes.ok) {
    return res.status(500).json({ error: 'lookup_failed', detail: await rowRes.text() });
  }
  const existing = (await rowRes.json())[0];

  if (existing && existing.manual) {
    return res.status(200).json({
      today,
      matched_count: matched.length,
      skipped: 'manual_override',
      detail: `담당자가 직접 ${existing.count}건으로 정해둔 날이라 덮어쓰지 않았습니다.`
    });
  }

  const payload = { count: matched.length, synced_at: new Date().toISOString() };
  const writeRes = existing
    ? await fetch(`${SUPABASE_URL}/rest/v1/launch_post_counts?id=eq.${existing.id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      })
    : await fetch(`${SUPABASE_URL}/rest/v1/launch_post_counts`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ assignee: ASSIGNEE, check_date: today, ...payload })
      });
  if (!writeRes.ok) {
    return res.status(500).json({ error: 'write_failed', detail: await writeRes.text() });
  }

  return res.status(200).json({
    today,
    keyword,
    total_today: messages.length,
    matched_count: matched.length,
    matched_subjects: matched.map((m) => m.subject)
  });
};

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

// 폴더 이름은 IMAP 규격상 modified UTF-7로 오기 때문에(한글 폴더는 "&xxx-" 형태)
// 사람이 읽을 수 있게 되돌립니다.
function decodeModifiedUtf7(name) {
  return String(name).replace(/&([^-]*)-/g, (whole, chunk) => {
    if (chunk === '') return '&';
    try {
      const buf = Buffer.from(chunk.replace(/,/g, '/'), 'base64');
      let out = '';
      for (let i = 0; i + 1 < buf.length; i += 2) out += String.fromCharCode(buf.readUInt16BE(i));
      return out;
    } catch (e) {
      return whole;
    }
  });
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

// 메일함 목록을 돌려줍니다. 게시판 알림이 INBOX가 아닌 별도 폴더로 오는 경우
// 어느 폴더를 봐야 하는지 찾기 위해 씁니다.
async function listMailboxes(client) {
  const res = await client.send('LIST "" "*"', 'LIST');
  return res
    .split(/\r?\n/)
    .filter((line) => line.startsWith('* LIST'))
    .map((line) => {
      const quoted = line.match(/"([^"]*)"\s*$/);
      const bare = line.match(/\s([^\s"]+)\s*$/);
      return decodeModifiedUtf7(quoted ? quoted[1] : bare ? bare[1] : '');
    })
    .filter(Boolean);
}

// 최근 메일의 제목/발신자/날짜를 읽어옵니다. PEEK이라 읽음 표시는 바뀌지 않습니다.
// 이 서버(DOPMAIL)는 SEARCH SINCE 가 제대로 걸리지 않는 경우가 있어서,
// 검색 결과와 별개로 "가장 최근 N통"을 직접 집어오는 경로를 함께 둡니다.
async function fetchRecentMessages({ host, port, user, password, mailbox, timeoutMs, since, limit }) {
  const client = await imapConnect({ host, port, timeoutMs });
  try {
    await client.send(`LOGIN ${imapQuote(user)} ${imapQuote(password)}`, 'LOGIN');
    const mailboxes = await listMailboxes(client);

    const selectRes = await client.send(`SELECT ${imapQuote(mailbox)}`, 'SELECT');
    const total = Number((selectRes.match(/^\* (\d+) EXISTS/m) || [])[1] || 0);

    let ids = [];
    let searchWorked = false;
    if (total > 0) {
      // 날짜는 큰따옴표로 감싸야 받아주는 서버가 있어 그렇게 보냅니다.
      try {
        const searchRes = await client.send(`SEARCH SINCE ${imapQuote(since)}`, 'SEARCH');
        const line = (searchRes.match(/^\* SEARCH([^\r\n]*)/m) || [])[1] || '';
        ids = line.trim().split(/\s+/).filter(Boolean);
        // 전체 통수와 같으면 조건이 안 먹은 것으로 보고 최근 N통만 다시 집습니다.
        searchWorked = ids.length > 0 && ids.length < total;
      } catch (e) {
        ids = [];
      }
      if (!searchWorked) {
        const from = Math.max(1, total - limit + 1);
        ids = [`${from}:${total}`];
      }
    }
    if (!ids.length) return { messages: [], mailboxes, total, searchWorked };

    const fetchRes = await client.send(
      `FETCH ${ids.join(',')} (BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])`,
      'FETCH'
    );

    // 응답 전체에서 메시지 단위로 끊어 헤더를 읽습니다.
    const messages = fetchRes
      .split(/^\* \d+ FETCH /m)
      .slice(1)
      .map((block) => ({
        subject: decodeMimeWords((extractHeader(block, 'Subject')[0] || '').trim()),
        from: decodeMimeWords((extractHeader(block, 'From')[0] || '').trim()),
        date: (extractHeader(block, 'Date')[0] || '').trim()
      }))
      .filter((m) => m.subject || m.from);

    return { messages, mailboxes, total, searchWorked };
  } finally {
    try { await client.send('LOGOUT', 'LOGOUT'); } catch (e) { /* 무시 */ }
    client.close();
  }
}

// 메일 헤더의 Date를 서울 기준 YYYY-MM-DD로. 못 읽으면 null.
function mailDateInSeoul(dateHeader) {
  const t = Date.parse(dateHeader);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
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

  const query = req.query || {};
  const host = process.env.DAOU_IMAP_HOST || 'imap.daouoffice.com';
  // ?mailbox= 로 다른 폴더를 바로 시험해볼 수 있게 합니다(게시판 알림 폴더 찾기용).
  const mailbox = query.mailbox || process.env.DAOU_MAIL_BOX || 'INBOX';
  const keyword = process.env.DAOU_LAUNCH_KEYWORD || '런칭';
  const fromFilter = process.env.DAOU_MAIL_FROM || '';
  const today = todayInSeoul();
  const isDebug = query.debug === '1' || query.debug === 'true';

  let result;
  try {
    result = await fetchRecentMessages({
      host, port: 993, user, password, mailbox, timeoutMs: 30000,
      since: toImapDate(today),
      limit: isDebug ? 30 : 80
    });
  } catch (err) {
    return res.status(502).json({ error: 'imap_failed', detail: String(err.message || err), mailbox });
  }

  // 서버가 SEARCH SINCE 를 무시할 수 있으므로, 메일 헤더의 날짜로 한 번 더 오늘 것만 거릅니다.
  const todayMessages = result.messages.filter((m) => mailDateInSeoul(m.date) === today);
  const scoped = fromFilter ? todayMessages.filter((m) => m.from.includes(fromFilter)) : todayMessages;
  const matched = scoped.filter((m) => m.subject.includes(keyword));

  // 제목 형태와 폴더 구성을 눈으로 확인하려고 부를 때는 저장하지 않고 목록만 돌려줍니다.
  if (isDebug) {
    return res.status(200).json({
      today,
      keyword,
      mailbox,
      from_filter: fromFilter || null,
      mailbox_total: result.total,
      search_since_worked: result.searchWorked,
      fetched: result.messages.length,
      today_count: todayMessages.length,
      matched_count: matched.length,
      mailboxes: result.mailboxes,
      recent: result.messages.slice(-30).map((m) => ({ subject: m.subject, from: m.from, date: m.date }))
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
    mailbox,
    today_count: todayMessages.length,
    matched_count: matched.length,
    matched_subjects: matched.map((m) => m.subject)
  });
};

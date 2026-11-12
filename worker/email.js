

// Staff links in emails always point at the main address.
export const SITE = 'https://mariamcoffeeshop.com';
export const ADMIN_EMAIL = 'admin@mariamcoffeeshop.com';
export const appUrl = (origin) => (/workers\.dev$|mariamcoffeeshop\.com$/.test(new URL(origin).hostname) ? SITE : origin) + '/management';
// Email through Resend (https://resend.com).
// The API key comes from the RESEND_API_KEY secret, or from Settings (stored in the database, never sent back).
// Resend only delivers to other people once a domain is verified there; until then the "from" address
// must be onboarding@resend.dev and mail reaches only the Resend account's own address.
//
//   GET/PUT /api/email-settings     owner: status, key, from address
//   POST    /api/email-test         owner: test email to yourself
//   POST    /api/schedule-email     manager: each barista gets their shifts for a week
//   POST    /api/send-login         owner / manager: a new person's sign-in details

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = (d) => `${DAYS[new Date(d + 'T00:00:00Z').getUTCDay()]} ${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const addDays = (date, n) => new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function config(env, h, db) {
  const saved = (await h.getSetting(db, 'email')) || {};
  return { key: env.RESEND_API_KEY || saved.key || null, from: saved.from || env.EMAIL_FROM || 'Mariam Coffee <onboarding@resend.dev>', fromSecret: !!env.RESEND_API_KEY };
}

async function send(cfg, { to, subject, html, text }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: cfg.from, to: [to], subject, html, text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = body?.message || `HTTP ${res.status}`;
    if (/verify a domain|testing emails|own email address/i.test(m)) throw new Error('Resend can only send to your own address until a domain is verified in Resend (see Settings → Email).');
    throw new Error(m);
  }
  return body.id;
}

const layout = (title, inner, siteUrl) => `<!doctype html><html><body style="margin:0;background:#f6f4f1;font-family:Arial,Helvetica,sans-serif;color:#0b0b0b">
<div style="max-width:520px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #e3e0da;border-radius:12px;padding:20px">
<div style="font-size:13px;color:#6b4226;font-weight:bold;letter-spacing:.02em">MARIAM COFFEE</div>
<h1 style="font-size:20px;margin:6px 0 14px">${esc(title)}</h1>${inner}
<p style="margin:20px 0 0"><a href="${esc(siteUrl)}" style="display:inline-block;background:#6b4226;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:bold">Open the staff website</a></p>
</div></div></body></html>`;

/** Welcome email with the sign-in details. Throws with a readable message if it cannot be sent. */
export async function sendWelcome(env, h, u, password, origin) {
  const cfg = await config(env, h, env.DB);
  if (!cfg.key) throw new Error('Email is not set up (Settings → Email).');
  if (!u.email) throw new Error('No email address.');
  const site = appUrl(origin) + '/staff';
  const first = u.name.split(' ')[0];
  const roles = String(u.roles || '').split(',');
  const what = roles.length === 1 && roles[0] === 'barista'
    ? 'On this website you see your shifts and clock in when you arrive and clock out when you leave. Clocking in only works inside the café, so allow the website to use your location.'
    : 'Use this website for your work at Mariam Coffee.';
  const text = `Hi ${first},\n\nWelcome to Mariam Coffee! Your account for the staff website is ready.\n\n${what}\n\nWebsite: ${site}\nUsername: ${u.username}\nPassword: ${password}\n\nThe first time you sign in, you will be asked to choose your own password.\nTip: add the website to your phone's home screen so it opens like an app.\n\nMariam Coffee`;
  const html = layout('Welcome to Mariam Coffee', `<p>Hi ${esc(first)},</p><p>Your account for the staff website is ready. ${esc(what)}</p>
    <table style="font-size:15px;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#52514e">Username</td><td style="font-weight:bold">${esc(u.username)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#52514e">Password</td><td style="font-weight:bold">${esc(password)}</td></tr></table>
    <p style="color:#52514e;font-size:13px">The first time you sign in, you will be asked to choose your own password. Tip: add the website to your phone’s home screen so it opens like an app.</p>`, site);
  await send(cfg, { to: u.email, subject: 'Welcome to Mariam Coffee: your staff account', text, html });
  await h.audit(env.DB, null, 'account.email', { username: u.username, welcome: true });
}

export async function handleEmail({ head, request, env, me, h }) {
  const db = env.DB;
  const site = appUrl(new URL(request.url).origin) + '/staff';
  if (head === 'email-settings') {
    h.need(me, 'owner');
    const cfg = await config(env, h, db);
    if (request.method === 'GET') {
      let domains = null, domainsError = null;
      if (cfg.key) {
        try {
          const r = await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${cfg.key}` } });
          const b = await r.json().catch(() => ({}));
          if (r.ok) domains = (b.data || []).map((d) => ({ name: d.name, status: d.status }));
          else domainsError = b?.message || `HTTP ${r.status}`;
        } catch (e) { domainsError = String(e.message || e); }
      }
      return h.json({ configured: !!cfg.key, fromSecret: cfg.fromSecret, keyEnd: cfg.key ? cfg.key.slice(-4) : null, from: cfg.from, domains, domainsError });
    }
    const b = await h.body(request);
    const saved = (await h.getSetting(db, 'email')) || {};
    if (b.key != null) {
      const k = String(b.key).trim();
      if (k && !/^re_[A-Za-z0-9_]{10,}$/.test(k)) h.fail(400, 'That does not look like a Resend API key (it starts with re_).');
      saved.key = k || null;
    }
    if (b.from != null) {
      const f = h.str(b.from, 120);
      if (f && !/<?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?\s*$/.test(f)) h.fail(400, 'The “from” address is not valid, e.g. Mariam Coffee <team@mariamcoffee.com>.');
      saved.from = f || null;
    }
    await h.setSetting(db, 'email', saved);
    await h.audit(db, me, 'settings.email', { key: b.key != null ? 'changed' : 'kept', from: saved.from });
    return h.json({ ok: true });
  }

  const cfg = await config(env, h, db);
  if (!cfg.key) h.fail(501, 'Email is not set up yet. The owner can add the Resend API key in Settings → Email.');

  // Sending domain in Resend (owner): GET status + DNS records, POST {action:'add'|'verify', name}
  if (head === 'email-domain') {
    h.need(me, 'owner');
    const R = (path, init = {}) => fetch('https://api.resend.com' + path, { ...init, headers: { authorization: `Bearer ${cfg.key}`, 'content-type': 'application/json' } })
      .then(async (r) => { const b = await r.json().catch(() => ({})); if (!r.ok) h.fail(502, b?.message || `Resend: HTTP ${r.status}`); return b; });
    const b = request.method === 'POST' ? await h.body(request) : {};
    const name = String(b.name || new URL(request.url).searchParams.get('name') || 'mariamcoffeeshop.com').toLowerCase();
    let d = ((await R('/domains')).data || []).find((x) => x.name === name);
    if (b.action === 'add' && !d) d = await R('/domains', { method: 'POST', body: JSON.stringify({ name, region: 'eu-west-1' }) });
    if (!d) return h.json({ name, exists: false });
    if (b.action === 'verify') await R(`/domains/${d.id}/verify`, { method: 'POST' });
    const full = await R(`/domains/${d.id}`);
    return h.json({ name, exists: true, status: full.status, records: (full.records || []).map((x) => ({ record: x.record, type: x.type, name: x.name, value: x.value, priority: x.priority, status: x.status })) });
  }

  // "We moved" announcement (owner): everyone with an email gets the new link and their username.
  // People who never chose a password get a fresh invitation link instead.
  if (head === 'announce-move') {
    h.need(me, 'owner');
    const b = await h.body(request);
    const ids = Array.isArray(b.user_ids) ? new Set(b.user_ids.map(Number)) : null;
    const { results } = await db.prepare('SELECT * FROM users WHERE active = 1').all();
    const out = { sent: [], invited: [], noEmail: [], failed: [] };
    const origin = new URL(request.url).origin;
    const site = appUrl(origin) + '/staff';
    for (const u of results) {
      if (ids && !ids.has(u.id)) continue;
      if (!u.email) { out.noEmail.push(u.name); continue; }
      try {
        if (u.must_change) { await sendInvite(env, h, u, origin); out.invited.push(u.name); }
        else {
          const first = u.name.split(' ')[0];
          const html = layout('Mariam Coffee has a new address', `<p>Hi ${esc(first)},</p>
            <p>The Mariam Coffee staff website has moved to a new address. Your username and password stay the same; you only need to sign in once more.</p>
            <p>New address: <a href="${esc(site)}"><b>${esc(site)}</b></a><br>Your username: <b>${esc(u.username)}</b></p>
            <p style="color:#52514e;font-size:13px">Forgot your password? Tap “Forgot your password?” on the sign-in page. Tip: add the new address to your phone’s home screen and remove the old one.</p>
            <p style="color:#52514e;font-size:13px">Our new website for customers: <a href="https://mariamcoffeeshop.com">mariamcoffeeshop.com</a></p>
            ${arabic(`<h2 style="font-size:18px;margin:0 0 8px">عنوان جديد لموقع مريم كافيه</h2><p>مرحباً ${esc(first)}،</p>
            <p>انتقل موقع موظفي مريم كافيه إلى عنوان جديد. يبقى اسم المستخدم وكلمة المرور كما هما، فقط سجّل الدخول مرة واحدة من جديد.</p>
            <p>العنوان الجديد: <a href="${esc(site)}" dir="ltr"><b>${esc(site)}</b></a><br>اسم المستخدم: <b dir="ltr">${esc(u.username)}</b></p>
            <p style="color:#52514e;font-size:13px">نسيت كلمة المرور؟ اضغط «نسيت كلمة المرور؟» في صفحة الدخول. أضف العنوان الجديد إلى الشاشة الرئيسية في هاتفك واحذف القديم.</p>`)}`, site);
          const text = `Hi ${first},\n\nThe Mariam Coffee staff website has moved. Your username and password stay the same; sign in once more at the new address:\n${site}\nUsername: ${u.username}\n\nCustomer website: https://mariamcoffeeshop.com\n\n---\nانتقل موقع موظفي مريم كافيه إلى عنوان جديد: ${site}\nاسم المستخدم: ${u.username}`;
          await send(cfg, { to: u.email, subject: 'Mariam Coffee: new website address / عنوان جديد', html, text });
          out.sent.push(u.name);
        }
      } catch (e) { out.failed.push({ name: u.name, error: e.message }); }
      await sleep(600);
    }
    await h.audit(db, me, 'account.announce', { sent: out.sent.length, invited: out.invited.length, failed: out.failed.length });
    return h.json(out);
  }

  if (head === 'email-test') {
    h.need(me, 'owner');
    if (!me.email) h.fail(400, 'Your account has no email address. Add it in Team first.');
    try {
      await send(cfg, { to: me.email, subject: 'Mariam Coffee: test email', text: `It works. Emails from the staff website reach you.\n\n${site}`,
        html: layout('Test email', '<p>It works. Emails from the staff website reach you.</p>', site) });
    } catch (e) { h.fail(502, e.message); }
    return h.json({ ok: true, to: me.email });
  }

  if (head === 'schedule-email') {
    h.need(me, 'manager');
    const b = await h.body(request);
    if (!h.isDate(b.week)) h.fail(400, 'Choose a week.');
    const end = addDays(b.week, 6);
    const { results: shifts } = await db.prepare('SELECT * FROM shifts WHERE date >= ? AND date <= ? ORDER BY date, start').bind(b.week, end).all();
    const { results: people } = await db.prepare("SELECT id, name, email FROM users WHERE active = 1 AND (',' || roles || ',') LIKE '%,barista,%'").all();
    const only = Array.isArray(b.user_ids) && b.user_ids.length ? new Set(b.user_ids.map(Number)) : null;
    const out = { sent: [], noEmail: [], noShifts: [], failed: [] };
    for (const p of people) {
      if (only && !only.has(p.id)) continue;
      const mine = shifts.filter((s) => s.user_id === p.id);
      if (!p.email) { out.noEmail.push(p.name); continue; }
      const first = p.name.split(' ')[0];
      const lines = mine.map((s) => `${nice(s.date)}: ${s.start}–${s.end}${s.note && !s.note.startsWith('auto ·') ? ` (${s.note})` : ''}`);
      const title = `Your shifts, week of ${nice(b.week)}`;
      const text = `Hi ${first},\n\n${mine.length ? `Your shifts for the week of ${nice(b.week)}:\n\n${lines.join('\n')}` : `You have no shifts in the week of ${nice(b.week)}.`}\n\nPlease clock in and out on the staff website: ${site}\n\nMariam Coffee`;
      const rows = mine.map((s) => `<tr><td style="padding:6px 10px 6px 0;font-weight:bold">${esc(nice(s.date))}</td><td style="padding:6px 0">${esc(s.start)}–${esc(s.end)}${s.note && !s.note.startsWith('auto ·') ? ` <span style="color:#7a7873">(${esc(s.note)})</span>` : ''}</td></tr>`).join('');
      const html = layout(title, `<p>Hi ${esc(first)},</p>${mine.length ? `<table style="border-collapse:collapse;font-size:15px">${rows}</table>` : '<p>You have no shifts this week.</p>'}<p style="color:#52514e;font-size:13px">Please clock in when you arrive and clock out when you leave.</p>`, site);
      try { await send(cfg, { to: p.email, subject: title, text, html }); out.sent.push(p.name); if (!mine.length) out.noShifts.push(p.name); } catch (e) { out.failed.push({ name: p.name, error: e.message }); }
      await sleep(600); // Resend allows about 2 emails a second
    }
    await h.audit(db, me, 'schedule.email', { week: b.week, sent: out.sent.length, failed: out.failed.length });
    return h.json(out);
  }

  if (head === 'invite') {
    // owner: anyone; manager: baristas. Each person gets their username and a link to choose a password.
    h.need(me, 'manager');
    const b = await h.body(request);
    const { results } = await db.prepare('SELECT * FROM users WHERE active = 1').all();
    const ids = Array.isArray(b.user_ids) ? new Set(b.user_ids.map(Number)) : null;
    const out = { sent: [], noEmail: [], failed: [], skipped: [] };
    for (const u of results) {
      if (ids ? !ids.has(u.id) : u.id === me.id) continue;
      const roles = (u.roles || '').split(',');
      if (!h.isOwner(me) && !roles.every((r) => r === 'barista')) { out.skipped.push(u.name); continue; }
      if (!u.email) { out.noEmail.push(u.name); continue; }
      try { await sendInvite(env, h, u, new URL(request.url).origin); out.sent.push(u.name); } catch (e) { out.failed.push({ name: u.name, error: e.message }); }
      await sleep(600);
    }
    await h.audit(db, me, 'account.invite', { sent: out.sent.length, failed: out.failed.length });
    return h.json(out);
  }

  if (head === 'send-login') {
    h.need(me, 'manager');
    const b = await h.body(request);
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(Number(b.user_id)).first();
    if (!u) h.fail(404, 'That account does not exist.');
    const roles = (u.roles || '').split(',');
    if (!h.isOwner(me) && !roles.every((r) => r === 'barista')) h.fail(403, 'Only the owner can send this for that account.');
    if (!u.email) h.fail(400, 'This person has no email address. Add it with Edit.');
    if (!b.password) h.fail(400, 'The password is needed for the email.');
    try { await sendWelcome(env, h, u, b.password, new URL(request.url).origin); } catch (e) { h.fail(502, e.message); }
    await h.audit(db, me, 'account.email', { username: u.username });
    return h.json({ ok: true, to: u.email });
  }
  return h.fail(404, 'Not found');
}

/** One plain notification to several addresses. Never throws: returns { sent, failed }. */
export async function sendMany(env, h, to, subject, text) {
  const out = { sent: 0, failed: [] };
  try {
    const cfg = await config(env, h, env.DB);
    if (!cfg.key) return { sent: 0, failed: ['Email is not set up.'] };
    const html = layout(subject.replace(/^Mariam Coffee: /, ''), text.split('\n\n').map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join(''), SITE + '/management/staff');
    for (const addr of to) {
      try { await send(cfg, { to: addr, subject, html, text }); out.sent++; } catch (e) { out.failed.push(`${addr}: ${e.message}`); }
      await sleep(300);
    }
  } catch (e) { out.failed.push(e.message); }
  return out;
}

/** A short notification email. Never throws: returns { ok, error }. */
export async function notify(env, h, origin, user, subject, text, html) {
  try {
    if (!user?.email) return { ok: false, error: 'No email address.' };
    const cfg = await config(env, h, env.DB);
    if (!cfg.key) return { ok: false, error: 'Email is not set up.' };
    const site = appUrl(origin) + '/staff';
    const first = (user.name || '').split(' ')[0];
    await send(cfg, { to: user.email, subject: `Mariam Coffee: ${subject}`, text: `Hi ${first},\n\n${text}\n\n${site}`,
      html: html || layout(subject, `<p>Hi ${esc(first)},</p><p>${esc(text)}</p>`, site) });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export const EMAIL_ROUTES = ['email-settings', 'email-test', 'schedule-email', 'send-login', 'invite', 'email-domain', 'announce-move'];
export const PUBLIC_EMAIL_ROUTES = ['password-forgot', 'password-reset'];

// ---------- password links (invitation: 7 days, reset: 1 hour) ----------
const DAY_MS = 86400000;
async function makeLink(db, h, userId, kind) {
  const token = h.newToken();
  const life = kind === 'invite' ? 7 * DAY_MS : DAY_MS / 24;
  await db.batch([
    db.prepare('DELETE FROM password_links WHERE expires < ? OR (user_id = ? AND kind = ?)').bind(Date.now(), userId, kind),
    db.prepare('INSERT INTO password_links (token, user_id, expires, kind) VALUES (?, ?, ?, ?)').bind(token, userId, Date.now() + life, kind),
  ]);
  return token;
}
const button = (href, label) => `<p style="margin:16px 0"><a href="${esc(href)}" style="display:inline-block;background:#6b4226;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">${esc(label)}</a></p>`;
const arabic = (inner) => `<div dir="rtl" lang="ar" style="border-top:1px solid #e3e0da;margin-top:20px;padding-top:16px;font-family:Tahoma,Arial,sans-serif;text-align:right">${inner}</div>`;

/** Invitation: username + a link to choose a password (English and Arabic). */
async function sendInvite(env, h, u, origin) {
  const cfg = await config(env, h, env.DB);
  if (!cfg.key) throw new Error('Email is not set up (Settings → Email).');
  if (!u.email) throw new Error('No email address.');
  const token = await makeLink(env.DB, h, u.id, 'invite');
  const link = `${appUrl(origin)}/staff?set=${token}`;
  const site = `${appUrl(origin)}/staff`;
  const first = u.name.split(' ')[0];
  const barista = String(u.roles || '').split(',').every((r) => r === 'barista');
  const en = barista
    ? 'On the staff website you see your shifts and clock in when you arrive and clock out when you leave. Clocking in only works inside the café, so allow the website to use your location.'
    : 'Use the staff website for your work at Mariam Coffee.';
  const ar = barista
    ? 'من خلال موقع الموظفين ترى ورديّاتك وتسجّل الحضور عند وصولك والانصراف عند مغادرتك. يعمل تسجيل الحضور داخل المقهى فقط، لذا اسمح للموقع باستخدام موقعك.'
    : 'استخدم موقع الموظفين لعملك في مريم كافيه.';
  const html = layout('Welcome to Mariam Coffee', `<p>Hi ${esc(first)},</p><p>You are invited to the Mariam Coffee staff website. ${esc(en)}</p>
    <p>Your username: <b>${esc(u.username)}</b></p><p>Choose your password with this button (the link works for 7 days):</p>${button(link, 'Choose my password')}
    <p style="color:#52514e;font-size:13px">After that, sign in at <a href="${esc(site)}">${esc(site)}</a>. Tip: add it to your phone’s home screen.</p>
    ${arabic(`<h2 style="font-size:18px;margin:0 0 8px">أهلاً بك في مريم كافيه</h2><p>مرحباً ${esc(first)}،</p><p>تمت دعوتك إلى موقع موظفي مريم كافيه. ${esc(ar)}</p>
    <p>اسم المستخدم: <b dir="ltr">${esc(u.username)}</b></p><p>اختر كلمة المرور من خلال هذا الزر (الرابط صالح لمدة 7 أيام):</p>${button(link, 'اختيار كلمة المرور')}
    <p style="color:#52514e;font-size:13px">بعد ذلك سجّل الدخول من <a href="${esc(site)}" dir="ltr">${esc(site)}</a>. يمكنك إضافة الموقع إلى الشاشة الرئيسية في هاتفك.</p>`)}`, site);
  const text = `Hi ${first},\n\nYou are invited to the Mariam Coffee staff website. ${en}\n\nUsername: ${u.username}\nChoose your password (link works for 7 days): ${link}\nThen sign in at ${site}\n\n---\nمرحباً ${first}، تمت دعوتك إلى موقع موظفي مريم كافيه.\nاسم المستخدم: ${u.username}\nاختر كلمة المرور (الرابط صالح لمدة 7 أيام): ${link}`;
  await send(cfg, { to: u.email, subject: 'Welcome to Mariam Coffee / أهلاً بك في مريم كافيه', html, text });
}

/** Forgotten password and the links from the emails: no sign-in needed. */
export async function handlePublicEmail({ head, request, env, h }) {
  const db = env.DB;
  const b = await h.body(request);
  if (head === 'password-forgot') {
    const who = h.str(b.who, 120).toLowerCase();
    if (!who) h.fail(400, 'Enter your username or email address.');
    const u = await db.prepare('SELECT * FROM users WHERE active = 1 AND (username = ? OR LOWER(email) = ?)').bind(who, who).first();
    // the answer is the same whether or not the account exists
    const generic = { ok: true, message: 'If an account with an email address matches, a link to choose a new password has been sent. Ask your manager if you have no email address on your account.' };
    if (!u || !u.email) { await new Promise((r) => setTimeout(r, 300)); return h.json(generic); }
    const cfg = await config(env, h, db);
    if (!cfg.key) h.fail(503, 'Email is not set up on this website. Ask the owner or your manager to reset your password.');
    const token = await makeLink(db, h, u.id, 'reset');
    const origin = new URL(request.url).origin;
    const link = `${appUrl(origin)}/staff?reset=${token}`;
    const first = u.name.split(' ')[0];
    const html = layout('Choose a new password', `<p>Hi ${esc(first)},</p><p>Someone asked to reset the password of your Mariam Coffee account (<b>${esc(u.username)}</b>). The link works for 1 hour.</p>${button(link, 'Choose a new password')}
      <p style="color:#52514e;font-size:13px">If it was not you, ignore this email; your password stays the same.</p>
      ${arabic(`<p>مرحباً ${esc(first)}،</p><p>طلب أحدهم إعادة تعيين كلمة المرور لحسابك في مريم كافيه (<b dir="ltr">${esc(u.username)}</b>). الرابط صالح لمدة ساعة واحدة.</p>${button(link, 'اختيار كلمة مرور جديدة')}
      <p style="color:#52514e;font-size:13px">إذا لم تطلب ذلك، تجاهل هذه الرسالة وستبقى كلمة المرور كما هي.</p>`)}`, appUrl(origin) + '/staff');
    try {
      await send(cfg, { to: u.email, subject: 'Mariam Coffee: choose a new password / كلمة مرور جديدة', html, text: `Hi ${first},\n\nChoose a new password for ${u.username} (link works for 1 hour): ${link}\n\nIf it was not you, ignore this email.` });
    } catch (e) { h.fail(502, 'The email could not be sent. Ask your manager to reset your password.'); }
    await h.audit(db, u, 'account.reset-requested', { username: u.username });
    return h.json(generic);
  }
  if (head === 'password-reset') {
    const token = h.str(b.token, 100);
    const row = token ? await db.prepare('SELECT * FROM password_links WHERE token = ? AND expires > ?').bind(token, Date.now()).first() : null;
    if (!row) h.fail(400, 'This link has expired or was already used. Ask for a new one.');
    const u = await db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').bind(row.user_id).first();
    if (!u) h.fail(400, 'This account is no longer active.');
    if (b.check) return h.json({ ok: true, username: u.username, name: u.name, kind: row.kind });
    if (!b.password || String(b.password).length < 6) h.fail(400, 'The password needs at least 6 characters.');
    await db.batch([
      db.prepare('UPDATE users SET pass = ?, must_change = 0 WHERE id = ?').bind(await h.hashPassword(String(b.password)), u.id),
      db.prepare('DELETE FROM password_links WHERE user_id = ?').bind(u.id),
      db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
    ]);
    await h.audit(db, u, 'account.password', row.kind === 'invite' ? 'Chose a password from the invitation' : 'Reset the password from the email link');
    return h.json({ ok: true, username: u.username });
  }
  return h.fail(404, 'Not found');
}

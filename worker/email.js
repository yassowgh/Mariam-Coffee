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

export async function handleEmail({ head, request, env, me, h }) {
  const db = env.DB;
  const site = new URL(request.url).origin + '/staff';
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

  if (head === 'send-login') {
    h.need(me, 'manager');
    const b = await h.body(request);
    const u = await db.prepare('SELECT * FROM users WHERE id = ?').bind(Number(b.user_id)).first();
    if (!u) h.fail(404, 'That account does not exist.');
    const roles = (u.roles || '').split(',');
    if (!h.isOwner(me) && !roles.every((r) => r === 'barista')) h.fail(403, 'Only the owner can send this for that account.');
    if (!u.email) h.fail(400, 'This person has no email address. Add it with Edit.');
    if (!b.password) h.fail(400, 'The password is needed for the email.');
    const first = u.name.split(' ')[0];
    const text = `Hi ${first},\n\nYour account for the Mariam Coffee staff website is ready.\n\nWebsite: ${site}\nUsername: ${u.username}\nPassword: ${b.password}\n\nThe first time you sign in, you will be asked to choose your own password.\n\nMariam Coffee`;
    const html = layout('Your Mariam Coffee account', `<p>Hi ${esc(first)},</p><p>Your account for the staff website is ready.</p>
      <table style="font-size:15px;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#52514e">Username</td><td style="font-weight:bold">${esc(u.username)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#52514e">Password</td><td style="font-weight:bold">${esc(b.password)}</td></tr></table>
      <p style="color:#52514e;font-size:13px">The first time you sign in, you will be asked to choose your own password.</p>`, site);
    try { await send(cfg, { to: u.email, subject: 'Your Mariam Coffee account', text, html }); } catch (e) { h.fail(502, e.message); }
    await h.audit(db, me, 'account.email', { username: u.username });
    return h.json({ ok: true, to: u.email });
  }
  return h.fail(404, 'Not found');
}

export const EMAIL_ROUTES = ['email-settings', 'email-test', 'schedule-email', 'send-login'];

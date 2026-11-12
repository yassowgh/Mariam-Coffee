// Shift swaps and payroll month close.
//
// Shift swap: a barista asks to give a shift to a colleague (or to anyone). The colleague accepts,
// then a manager approves and the shift moves. Emails go out when email is set up.
//   GET   /api/swaps               barista: their own; manager: all open and recent
//   GET   /api/swaps/colleagues    the active baristas (to choose from)
//   POST  /api/swaps               { shift_id, to_user (or none = anyone), note }
//   PATCH /api/swaps/:id           { action: accept | decline | cancel | approve | reject }
//
// Payroll: owner / accountant close a month; the figures are kept as they were (locked).
//   GET    /api/payroll?month=     the closed month, or { closed: false }
//   POST   /api/payroll            { month, rows }       close
//   DELETE /api/payroll?month=     reopen (owner)
//   POST   /api/payroll/email      { month, user_id, html, text }  email one payslip

export const TEAM_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS swaps (id INTEGER PRIMARY KEY AUTOINCREMENT, shift_id INTEGER NOT NULL, from_user INTEGER NOT NULL,
    to_user INTEGER, status TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL, accepted_by INTEGER, decided_by INTEGER, decided_at TEXT, reason TEXT)`,
  `CREATE TABLE IF NOT EXISTS payroll (month TEXT PRIMARY KEY, data TEXT NOT NULL, closed_by INTEGER, closed_at TEXT NOT NULL)`,
];
export const TEAM_ROUTES = ['swaps', 'payroll'];

const SELECT = `SELECT w.*, s.date, s.start, s.end, s.user_id AS shift_user, fu.name AS from_name, tu.name AS to_name, au.name AS accepted_name, du.name AS decided_name
  FROM swaps w JOIN shifts s ON s.id = w.shift_id JOIN users fu ON fu.id = w.from_user LEFT JOIN users tu ON tu.id = w.to_user
  LEFT JOIN users au ON au.id = w.accepted_by LEFT JOIN users du ON du.id = w.decided_by`;

export async function handleTeam({ head, sub, request, env, me, h, notify }) {
  const db = env.DB;
  const url = new URL(request.url);
  const roles = (me.roles || '').split(',');
  const isManager = h.has(me, 'manager');

  if (head === 'swaps') {
    h.need(me, 'barista', 'manager');
    if (request.method === 'GET' && sub === 'colleagues') {
      const { results } = await db.prepare("SELECT id, name FROM users WHERE active = 1 AND (',' || roles || ',') LIKE '%,barista,%' ORDER BY name").all();
      return h.json({ people: results.filter((p) => p.id !== me.id) });
    }
    if (request.method === 'GET') {
      const since = h.localParts().date;
      const { results } = isManager
        ? await db.prepare(`${SELECT} WHERE w.status IN ('asked','accepted') OR w.created_at >= ? ORDER BY w.id DESC LIMIT 100`).bind(new Date(Date.now() - 21 * 86400000).toISOString()).all()
        : await db.prepare(`${SELECT} WHERE (w.from_user = ? OR w.to_user = ? OR w.accepted_by = ? OR (w.to_user IS NULL AND w.status = 'asked' AND s.date >= ?)) ORDER BY w.id DESC LIMIT 50`).bind(me.id, me.id, me.id, since).all();
      return h.json({ swaps: results, me: me.id });
    }
    if (request.method === 'POST' && !sub) {
      const b = await h.body(request);
      const shift = await db.prepare('SELECT * FROM shifts WHERE id = ?').bind(Number(b.shift_id)).first();
      if (!shift) h.fail(404, 'That shift does not exist.');
      if (shift.user_id !== me.id) h.fail(403, 'You can only ask to swap your own shifts.');
      if (shift.date < h.localParts().date) h.fail(400, 'That shift is in the past.');
      const open = await db.prepare("SELECT id FROM swaps WHERE shift_id = ? AND status IN ('asked','accepted')").bind(shift.id).first();
      if (open) h.fail(400, 'There is already an open swap request for this shift.');
      let to = null;
      if (b.to_user) {
        const t = await db.prepare("SELECT id, name, email, roles, active FROM users WHERE id = ?").bind(Number(b.to_user)).first();
        if (!t || !t.active || !(t.roles || '').split(',').includes('barista') || t.id === me.id) h.fail(400, 'Choose a colleague.');
        to = t;
      }
      const r = await db.prepare('INSERT INTO swaps (shift_id, from_user, to_user, status, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(shift.id, me.id, to ? to.id : null, 'asked', h.str(b.note, 200), h.nowIso()).run();
      await h.audit(db, me, 'swap.ask', { id: r.meta.last_row_id, shift: shift.id, to: to?.id ?? 'anyone' });
      const when = `${shift.date} ${shift.start}–${shift.end}`;
      if (to) await notify(to, `${me.name} asks you to take a shift`, `${me.name} would like you to take their shift on ${when}.${b.note ? ` Note: ${h.str(b.note, 200)}` : ''} Open the staff website to accept or decline.`);
      return h.json({ ok: true, id: r.meta.last_row_id });
    }
    const id = Number(sub);
    const w = id ? await db.prepare(`${SELECT} WHERE w.id = ?`).bind(id).first() : null;
    if (!w) h.fail(404, 'That request does not exist.');
    if (request.method === 'PATCH') {
      const { action } = await h.body(request);
      const when = `${w.date} ${w.start}–${w.end}`;
      const decide = async (status, extra = {}) => {
        await db.prepare('UPDATE swaps SET status = ?, decided_by = COALESCE(?, decided_by), decided_at = COALESCE(?, decided_at), accepted_by = COALESCE(?, accepted_by), reason = COALESCE(?, reason) WHERE id = ?')
          .bind(status, extra.decided ? me.id : null, extra.decided ? h.nowIso() : null, extra.accepted ?? null, extra.reason ?? null, id).run();
        await h.audit(db, me, `swap.${action}`, { id });
      };
      const user = async (uid) => db.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(uid).first();
      if (action === 'cancel') {
        if (w.from_user !== me.id && !isManager) h.fail(403, 'Only the person who asked can cancel.');
        if (!['asked', 'accepted'].includes(w.status)) h.fail(400, 'This request is already closed.');
        await decide('cancelled');
        return h.json({ ok: true });
      }
      if (action === 'accept' || action === 'decline') {
        if (!roles.includes('barista')) h.fail(403, 'Only a barista can accept a shift.');
        if (w.status !== 'asked') h.fail(400, 'This request is no longer open.');
        if (w.to_user && w.to_user !== me.id) h.fail(403, 'This request was sent to someone else.');
        if (w.from_user === me.id) h.fail(400, 'You cannot accept your own request.');
        if (action === 'decline') {
          if (!w.to_user) h.fail(400, 'Requests to anyone cannot be declined; just leave them.');
          await decide('declined');
          await notify(await user(w.from_user), 'Shift swap declined', `${me.name} cannot take your shift on ${when}.`);
          return h.json({ ok: true });
        }
        const clash = await db.prepare('SELECT id FROM shifts WHERE user_id = ? AND date = ?').bind(me.id, w.date).first();
        if (clash) h.fail(400, 'You already have a shift that day.');
        await decide('accepted', { accepted: me.id });
        await notify(await user(w.from_user), 'Shift swap accepted', `${me.name} accepted your shift on ${when}. A manager still has to approve it.`);
        const { results: managers } = await db.prepare("SELECT id, name, email FROM users WHERE active = 1 AND ((',' || roles || ',') LIKE '%,manager,%' OR (',' || roles || ',') LIKE '%,owner,%')").all();
        for (const m of managers) await notify(m, 'Shift swap to approve', `${w.from_name} gives the shift on ${when} to ${me.name}. Approve or reject it on the Schedule page.`);
        return h.json({ ok: true });
      }
      if (action === 'approve' || action === 'reject') {
        if (!isManager) h.fail(403, 'Only a manager can approve.');
        if (w.status !== 'accepted') h.fail(400, 'The colleague has not accepted yet.');
        if (action === 'reject') {
          await decide('rejected', { decided: true });
          for (const uid of [w.from_user, w.accepted_by]) await notify(await user(uid), 'Shift swap not approved', `The manager did not approve the swap of the shift on ${when}. The shift stays with ${w.from_name}.`);
          return h.json({ ok: true });
        }
        const shift = await db.prepare('SELECT * FROM shifts WHERE id = ?').bind(w.shift_id).first();
        if (!shift || shift.user_id !== w.from_user) h.fail(400, 'The shift was changed in the meantime; the swap cannot be applied.');
        await db.batch([
          db.prepare('UPDATE shifts SET user_id = ?, note = ? WHERE id = ?').bind(w.accepted_by, `swap from ${w.from_name}`.slice(0, 120), shift.id),
          db.prepare("UPDATE swaps SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?").bind(me.id, h.nowIso(), id),
        ]);
        await h.audit(db, me, 'swap.approve', { id, shift: shift.id, to: w.accepted_by });
        for (const uid of [w.from_user, w.accepted_by]) await notify(await user(uid), 'Shift swap approved', `The shift on ${when} now belongs to ${w.accepted_name}.`);
        return h.json({ ok: true });
      }
      h.fail(400, 'Unknown action.');
    }
    h.fail(405, 'Not allowed.');
  }

  if (head === 'payroll') {
    h.need(me, 'accountant');
    if (sub === 'email' && request.method === 'POST') {
      const b = await h.body(request);
      const u = await db.prepare('SELECT id, name, email FROM users WHERE id = ?').bind(Number(b.user_id)).first();
      if (!u?.email) h.fail(400, 'This person has no email address.');
      const sent = await notify(u, `Payslip ${b.month}`, String(b.text || ''), String(b.html || ''), true);
      if (!sent.ok) h.fail(502, sent.error || 'The email could not be sent.');
      await h.audit(db, me, 'payroll.payslip.email', { month: b.month, user: u.id });
      return h.json({ ok: true, to: u.email });
    }
    const month = url.searchParams.get('month');
    if (request.method === 'GET') {
      if (!h.isMonth(month)) h.fail(400, 'Choose a month.');
      const row = await db.prepare('SELECT p.*, u.name AS closed_name FROM payroll p LEFT JOIN users u ON u.id = p.closed_by WHERE month = ?').bind(month).first();
      return h.json(row ? { closed: true, month, rows: JSON.parse(row.data), closed_by: row.closed_name, closed_at: row.closed_at } : { closed: false, month });
    }
    if (request.method === 'POST') {
      const b = await h.body(request);
      if (!h.isMonth(b.month) || !Array.isArray(b.rows)) h.fail(400, 'Missing month or figures.');
      const exists = await db.prepare('SELECT month FROM payroll WHERE month = ?').bind(b.month).first();
      if (exists) h.fail(400, 'This month is already closed. Reopen it first (owner).');
      await db.prepare('INSERT INTO payroll (month, data, closed_by, closed_at) VALUES (?, ?, ?, ?)').bind(b.month, JSON.stringify(b.rows).slice(0, 500000), me.id, h.nowIso()).run();
      await h.audit(db, me, 'payroll.close', { month: b.month, people: b.rows.length });
      return h.json({ ok: true });
    }
    if (request.method === 'DELETE') {
      if (!h.isOwner(me)) h.fail(403, 'Only the owner can reopen a closed month.');
      if (!h.isMonth(month)) h.fail(400, 'Choose a month.');
      await db.prepare('DELETE FROM payroll WHERE month = ?').bind(month).run();
      await h.audit(db, me, 'payroll.reopen', { month });
      return h.json({ ok: true });
    }
    h.fail(405, 'Not allowed.');
  }
  return h.fail(404, 'Not found');
}

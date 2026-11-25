import { useEffect, useRef, useState } from 'react';
import { api, hasRole } from '../lib/api.js';
import { longDate } from '../format.js';
import { kvkkText } from '../lib/kvkk.js';

const LANGS = [['ar', 'العربية'], ['tr', 'Türkçe'], ['en', 'English']];
const LANG_NAME = Object.fromEntries(LANGS);
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Customers: find by mobile number, register, count orders, hand out gifts; managers see the list and set the rules. */
export default function Customers({ user }) {
  const manager = hasRole(user, 'manager');
  const [tab, setTab] = useState('counter');
  return (
    <div className="stack">
      {manager && (
        <nav className="fin-tabs" role="tablist" aria-label="Customers">
          {[['counter', 'At the counter'], ['list', 'All customers'], ['rules', 'Levels & gifts']].map(([k, l]) => <button key={k} role="tab" className={'btn' + (tab === k ? ' primary' : '')} aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </nav>
      )}
      {tab === 'counter' && <Counter manager={manager} />}
      {tab === 'list' && manager && <AllCustomers />}
      {tab === 'rules' && manager && <Rules />}
    </div>
  );
}

function Counter({ manager }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null); // { customers, exact, normalized }
  const [cur, setCur] = useState(null);
  const [adding, setAdding] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const input = useRef(null);
  const reset = () => { setQ(''); setRes(null); setCur(null); setAdding(null); setMsg(null); input.current?.focus(); };

  async function search(e) {
    e?.preventDefault();
    if (searching) return;
    setMsg(null); setCur(null); setAdding(null); setRes(null); setSearching(true);
    try {
      const r = await api('customers?q=' + encodeURIComponent(q));
      setRes(r);
      if (r.exact) open(r.exact);
      else if (r.customers.length === 1 && q.replace(/\D/g, '').length <= 6) open(r.customers[0].id);
      else if (!r.customers.length && r.normalized) setAdding({ phone: q });
    } catch (x) { setMsg({ ok: false, text: x.message }); }
    setSearching(false);
  }
  async function open(id) {
    try { const r = await api('customers/' + id); setCur(r.customer); setAdding(null); } catch (x) { setMsg({ ok: false, text: x.message }); }
  }
  async function act(path, body, ok) {
    setBusy(true); setMsg(null);
    try {
      const r = await api(path, { method: 'POST', body: body || {} });
      if (r.blocked) setMsg({ ok: false, text: r.message, force: r.canForce });
      else {
        setCur(r.customer);
        const earned = (r.earned || []).map((g) => g.gift);
        setMsg({ ok: true, text: [ok, r.levelUp ? `New level: ${r.levelUp}!` : '', earned.length ? `Gift earned: ${earned.join(' + ')}` : ''].filter(Boolean).join(' '), gift: earned.length > 0 });
      }
    } catch (x) { setMsg({ ok: false, text: x.message }); }
    setBusy(false);
  }

  return (
    <>
      <form className="card cust-find" onSubmit={search}>
        <h2>Customer</h2>
        <p className="muted" style={{ margin: '2px 0 10px' }}>Type the mobile number, its last 4 digits, or any part of it (5 digits or more).</p>
        <div className="cust-row">
          <input ref={input} className="cust-phone" type="tel" inputMode="tel" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} placeholder="0555 123 45 67" aria-label="Mobile number" autoFocus />
          <button className="btn primary" disabled={searching || q.replace(/\D/g, '').length < 4}>{searching ? 'Searching…' : 'Find'}</button>
          {(res || cur || adding) && <button type="button" className="btn ghost" onClick={reset}>Next customer</button>}
        </div>
        {searching && <div className="cust-searching" role="status" aria-live="polite"><span className="spin" aria-hidden="true" /> Searching…</div>}
        {msg && <div className={'banner ' + (msg.ok ? (msg.gift ? 'warn' : 'ok') : 'bad')} role="status" style={{ marginTop: 10 }}>
          <span>{msg.gift && '🎁 '}{msg.text}</span>
          {msg.force && cur && <button type="button" className="btn small" onClick={() => act(`customers/${cur.id}/order`, { force: true }, 'Order counted.')}>Count anyway</button>}
        </div>}
      </form>

      {res && !cur && !adding && (
        <div className="card">
          {res.customers.length ? (
            <><h3 style={{ margin: '0 0 8px', fontSize: 15 }}>Found</h3>
              <ul className="cust-list">{res.customers.map((c) => <li key={c.id}><button className="linklike" onClick={() => open(c.id)}><b>{c.name || 'No name'}</b> · {c.phone} · {c.level} · {c.orders} orders</button></li>)}</ul>
              {res.normalized && <button className="btn" onClick={() => setAdding({ phone: q })}>Register {res.normalized} as a new customer</button>}</>
          ) : res.normalized ? null : <p className="muted" style={{ margin: 0 }}>No customer found with “{q}”. To register a new one, type the full mobile number.</p>}
        </div>
      )}

      {adding && <Register legalName={res?.settings?.legalName} phone={adding.phone} onCancel={() => setAdding(null)} onDone={(r) => { setCur(r.customer); setAdding(null); const e = (r.earned || []).map((g) => g.gift); setMsg({ ok: true, text: `Registered${r.customer.orders ? ' and this order counted' : ''}.${e.length ? ` Gift earned: ${e.join(' + ')}` : ''}`, gift: e.length > 0 }); }} />}

      {cur && <CustomerCard c={cur} manager={manager} busy={busy} legalName={res?.settings?.legalName}
        onOrder={() => act(`customers/${cur.id}/order`, {}, 'Order counted.')}
        onUndo={() => { if (confirm('Remove the last counted order?')) act(`customers/${cur.id}/undo`, {}, 'Last order removed.'); }}
        onGive={(g) => act(`customer-gifts/${g.id}`, {}, `Gift given: ${g.gift}.`)}
        onBirthday={() => act(`customers/${cur.id}/birthday`, {}, 'Birthday gift given. 🎂')}
        onSaved={(c) => { setCur(c); setMsg({ ok: true, text: 'Saved.' }); }}
        onDeleted={() => { reset(); setMsg({ ok: true, text: 'Customer deleted.' }); }} />}
    </>
  );
}

function Register({ phone, onCancel, onDone, initial, id, legalName }) {
  const [v, setV] = useState({ phone: initial?.phone || phone || '', name: initial?.name || '', lang: initial?.lang || '', offers: initial ? initial.offers : null, kvkk: !!initial?.kvkk_at, bd: initial?.birth?.slice(3) || '', bm: initial?.birth?.slice(0, 2) || '', countOrder: true });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const edit = !!id;
  async function save(e) {
    e.preventDefault();
    setErr('');
    if (!v.lang) { setErr('Choose the language.'); return; }
    if (v.offers == null) { setErr('Choose whether they accept special offers.'); return; }
    if (!v.kvkk) { setErr('Read the privacy notice to the customer and tick that they agree.'); return; }
    if ((v.bd && !v.bm) || (!v.bd && v.bm)) { setErr('Birthday: choose both day and month, or neither.'); return; }
    setBusy(true);
    try {
      const body = { phone: v.phone, name: v.name, lang: v.lang, offers: v.offers, kvkk: v.kvkk, birth: v.bd && v.bm ? `${v.bm}-${v.bd}` : '' };
      const r = edit ? await api(`customers/${id}`, { method: 'PATCH', body }) : await api('customers', { method: 'POST', body: { ...body, countOrder: v.countOrder } });
      onDone(r);
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  return (
    <form className="card" onSubmit={save}>
      <h2 style={{ marginBottom: 10 }}>{edit ? 'Edit customer' : 'New customer'}</h2>
      <div className="form-grid">
        <label className="field"><span>Mobile number *</span><input type="tel" inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} required /></label>
        <label className="field"><span>Name (optional)</span><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} maxLength={80} /></label>
      </div>
      <fieldset className="cust-choice"><legend>Language *</legend>
        {LANGS.map(([k, l]) => <label key={k} className={v.lang === k ? 'on' : ''}><input type="radio" name="lang" checked={v.lang === k} onChange={() => setV({ ...v, lang: k })} /> {l}</label>)}
      </fieldset>
      <fieldset className="cust-choice"><legend>Accepts special offers (WhatsApp / SMS) *</legend>
        <label className={v.offers === true ? 'on' : ''}><input type="radio" name="offers" checked={v.offers === true} onChange={() => setV({ ...v, offers: true })} /> Yes</label>
        <label className={v.offers === false ? 'on' : ''}><input type="radio" name="offers" checked={v.offers === false} onChange={() => setV({ ...v, offers: false })} /> No</label>
      </fieldset>
      <fieldset className="cust-choice"><legend>Birthday (optional)</legend>
        <select value={v.bd} onChange={(e) => setV({ ...v, bd: e.target.value })} aria-label="Day"><option value="">Day</option>{DAYS.map((d) => <option key={d} value={d}>{Number(d)}</option>)}</select>
        <select value={v.bm} onChange={(e) => setV({ ...v, bm: e.target.value })} aria-label="Month"><option value="">Month</option>{MONTHS.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}</select>
      </fieldset>
      <Kvkk lang={v.lang} name={legalName} checked={v.kvkk} locked={!!initial?.kvkk_at} onChange={(x) => setV({ ...v, kvkk: x })} />
      {!edit && <label className="check" style={{ display: 'flex', gap: 6, margin: '10px 0' }}><input type="checkbox" checked={v.countOrder} onChange={(e) => setV({ ...v, countOrder: e.target.checked })} /> Count this visit as their first order</label>}
      {err && <div className="banner bad" role="alert"><span>{err}</span></div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : edit ? 'Save' : 'Register'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** The KVKK notice in the customer's language, and the required agreement. */
function Kvkk({ lang, name, checked, locked, onChange }) {
  const [other, setOther] = useState('');
  const show = other || lang || 'tr';
  const k = kvkkText(show, name);
  return (
    <div className="kvkk">
      <div className="kvkk-head"><b>{k.title}</b>
        <span className="seg" role="group" aria-label="Notice language">{[['ar', 'ع'], ['tr', 'TR'], ['en', 'EN']].map(([c, l]) => <button type="button" key={c} aria-pressed={show === c} onClick={() => setOther(c)}>{l}</button>)}</span>
      </div>
      <p dir={show === 'ar' ? 'rtl' : 'ltr'} lang={show}>{k.text}</p>
      {locked ? <p className="muted" style={{ margin: 0 }}>✓ Consent already recorded.</p> : (
        <label className="kvkk-agree" dir={show === 'ar' ? 'rtl' : 'ltr'}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} required /> <span>{k.agree}</span></label>
      )}
    </div>
  );
}

function CustomerCard({ c, manager, busy, legalName, onOrder, onUndo, onGive, onBirthday, onSaved, onDeleted }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <Register id={c.id} legalName={legalName} initial={{ phone: c.phone.startsWith('•') ? '' : c.phone, name: c.name, lang: c.lang, offers: c.offers, birth: c.birth, kvkk_at: c.kvkk_at }} onCancel={() => setEditing(false)} onDone={(r) => { setEditing(false); onSaved(r.customer); }} />;
  const pct = c.nextGiftIn != null && c.everyN ? Math.round(((c.everyN - c.nextGiftIn) / c.everyN) * 100) : 0;
  async function del() {
    if (!confirm(`Delete ${c.name || c.phone} and all their orders and gifts?`)) return;
    try { await api(`customers/${c.id}`, { method: 'DELETE' }); onDeleted(); } catch (x) { alert(x.message); }
  }
  return (
    <div className="card cust-card">
      <div className="cust-head">
        <div>
          <h2>{c.name || 'Customer'} <span className={'pill lvl-' + c.level.toLowerCase()}>{c.level}</span></h2>
          <p className="muted" style={{ margin: 0 }}><span dir="ltr">{c.phone}</span> · {LANG_NAME[c.lang]} · offers: {c.offers ? 'yes' : 'no'}{c.kvkk_at ? ` · KVKK ✓ ${longDate(c.kvkk_at.slice(0, 10))}` : ''}{c.birth ? ` · birthday ${Number(c.birth.slice(3))} ${MONTHS[Number(c.birth.slice(0, 2)) - 1]}` : ''}</p>
        </div>
        <div className="cust-count"><b>{c.orders}</b><span>orders</span></div>
      </div>
      {!c.kvkk_at && <div className="banner bad" style={{ display: 'flex' }}><span>No KVKK consent recorded for this customer. Read them the privacy notice.</span><button className="btn small" onClick={() => setEditing(true)}>Record consent</button></div>}
      {c.birthdayGift && <div className="banner warn" style={{ display: 'flex' }}><span>🎂 Birthday week! Gift: <b>{c.birthdayGift}</b></span><button className="btn small primary" disabled={busy} onClick={onBirthday}>Give birthday gift</button></div>}
      {c.pending.length > 0 && (
        <div className="cust-gifts">
          <b>🎁 Gifts to give</b>
          {c.pending.map((g) => <div key={g.id} className="cust-gift"><span>{g.gift} <small className="muted">({g.kind === 'level' ? 'new level' : `order ${g.at_order}`})</small></span><button className="btn small primary" disabled={busy} onClick={() => onGive(g)}>Given ✓</button></div>)}
        </div>
      )}
      {c.nextGiftIn != null && <div className="cust-progress"><div style={{ width: pct + '%' }} /><span>{c.nextGiftIn === 0 ? 'Gift on this order' : `${c.nextGiftIn} more order${c.nextGiftIn === 1 ? '' : 's'} to: ${c.everyGift}`}{c.nextLevel ? ` · ${c.nextLevel.in} to ${c.nextLevel.name}` : ''}</span></div>}
      <div className="cust-actions">
        <button className="btn primary cust-plus" disabled={busy} onClick={onOrder}>＋1 order</button>
        <button className="btn ghost" disabled={busy || !c.orders} onClick={onUndo}>Undo last order</button>
        <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>
        {manager && <button className="btn ghost" onClick={del}>Delete</button>}
      </div>
      {c.history?.length > 0 && <details style={{ marginTop: 10 }}><summary style={{ cursor: 'pointer' }}>Last orders</summary>
        <ul className="cust-list">{c.history.slice(0, 15).map((o, i) => <li key={i}>{new Date(o.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}{o.by ? ` · ${o.by}` : ''}</li>)}</ul></details>}
    </div>
  );
}

function AllCustomers() {
  const [rows, setRows] = useState(null);
  const [stats, setStats] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const load = (qq = '') => api('customers' + (qq ? '?q=' + encodeURIComponent(qq) : '')).then((r) => setRows(r.customers)).catch(() => setRows([]));
  useEffect(() => { load(); api('customers-stats').then(setStats).catch(() => {}); }, []);
  const list = (rows || []).filter((c) => filter === 'all' || (filter === 'offers' ? c.offers : filter === 'gifts' ? c.pending.length : c.lang === filter));
  return (
    <>
      {stats && <div className="kpis">
        {[['Customers', stats.customers], ['Accept offers', stats.offers], ['New this week', stats.newWeek], ['Orders counted this week', stats.ordersWeek], ['Came back (2+ orders)', stats.returning], ['Gifts given (30 days)', stats.giftsMonth], ['Gifts waiting', stats.giftsWaiting]].map(([l, v]) => <div key={l} className="card kpi"><div className="label">{l}</div><div className="value">{v}</div></div>)}
      </div>}
      <div className="card">
        <div className="card-head"><div><h2>All customers</h2><p>Newest activity first.</p></div>
          <a className="btn" href={import.meta.env.BASE_URL + 'api/customers-export'}>⬇ Export (accept offers, CSV)</a></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <form onSubmit={(e) => { e.preventDefault(); load(q); }} style={{ display: 'flex', gap: 6 }}><input className="inv-search" style={{ margin: 0 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or number…" /><button className="btn">Search</button></form>
          <div className="seg" role="group" aria-label="Filter">{[['all', 'All'], ['offers', 'Accept offers'], ['gifts', 'Gift waiting'], ['ar', 'Arabic'], ['tr', 'Turkish'], ['en', 'English']].map(([k, l]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
        </div>
        {!rows ? <p className="muted">Loading…</p> : !list.length ? <p className="muted">No customers yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Mobile</th><th>Language</th><th>Offers</th><th className="r">Orders</th><th>Level</th><th>Gifts waiting</th><th>Last order</th><th /></tr></thead>
            <tbody>{list.map((c) => {
              const wa = c.phone.replace(/\D/g, '');
              return (
                <tr key={c.id}>
                  <td>{c.name || '–'}</td><td dir="ltr">{c.phone}</td><td>{LANG_NAME[c.lang]}</td><td>{c.offers ? 'Yes' : 'No'}</td>
                  <td className="r num">{c.orders}</td><td>{c.level}</td><td>{c.pending.map((g) => g.gift).join(', ') || '–'}</td>
                  <td>{c.last_order_at ? longDate(c.last_order_at.slice(0, 10)) : '–'}</td>
                  <td>{c.offers && wa && <a className="btn small ghost" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">WhatsApp</a>}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function Rules() {
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { api('loyalty-settings').then((r) => setS(r.settings)).catch((e) => setMsg({ ok: false, text: e.message })); }, []);
  if (!s) return <div className="card"><p className="muted">{msg?.text || 'Loading…'}</p></div>;
  const setLvl = (i, patch) => setS({ ...s, levels: s.levels.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  async function save() {
    try { const r = await api('loyalty-settings', { method: 'PUT', body: s }); setS(r.settings); setMsg({ ok: true, text: 'Saved. The new rules apply to the next orders.' }); } catch (x) { setMsg({ ok: false, text: x.message }); }
  }
  return (
    <div className="card">
      <div className="card-head"><div><h2>Levels & gifts</h2><p>Managers and the owner can change these. Changes apply to orders counted from now on.</p></div></div>
      <h3 style={{ fontSize: 15 }}>Levels (by total orders)</h3>
      {s.levels.map((l, i) => (
        <div key={i} className="recipe-line">
          <input style={{ width: 130, textAlign: 'start' }} value={l.name} onChange={(e) => setLvl(i, { name: e.target.value })} aria-label="Level name" />
          <span className="muted">from</span>
          <input inputMode="numeric" value={l.min} onChange={(e) => setLvl(i, { min: e.target.value })} aria-label="From orders" disabled={i === 0} />
          <span className="muted">orders · gift when reached:</span>
          <input style={{ width: 260, textAlign: 'start' }} value={l.gift || ''} onChange={(e) => setLvl(i, { gift: e.target.value })} placeholder="(none)" aria-label="Gift" />
          {i > 0 && <button className="btn small ghost" onClick={() => setS({ ...s, levels: s.levels.filter((_, j) => j !== i) })} aria-label="Remove level">✕</button>}
        </div>
      ))}
      <button className="btn small" onClick={() => setS({ ...s, levels: [...s.levels, { name: 'New level', min: (Number(s.levels[s.levels.length - 1]?.min) || 0) + 20, gift: '' }] })}>＋ Add a level</button>
      <h3 style={{ fontSize: 15, marginTop: 16 }}>Gift every few orders</h3>
      <div className="recipe-line"><span className="muted">Every</span><input inputMode="numeric" value={s.every.n} onChange={(e) => setS({ ...s, every: { ...s.every, n: e.target.value } })} aria-label="Every N orders" /><span className="muted">orders:</span><input style={{ width: 260, textAlign: 'start' }} value={s.every.gift} onChange={(e) => setS({ ...s, every: { ...s.every, gift: e.target.value } })} aria-label="Gift" /></div>
      <h3 style={{ fontSize: 15, marginTop: 16 }}>Birthday</h3>
      <div className="recipe-line">
        <label className="check" style={{ display: 'inline-flex', gap: 6 }}><input type="checkbox" checked={s.birthday.on} onChange={(e) => setS({ ...s, birthday: { ...s.birthday, on: e.target.checked } })} /> Birthday gift</label>
        <input style={{ width: 260, textAlign: 'start' }} value={s.birthday.gift} onChange={(e) => setS({ ...s, birthday: { ...s.birthday, gift: e.target.value } })} aria-label="Birthday gift" />
        <span className="muted">within</span><input inputMode="numeric" value={s.birthday.days} onChange={(e) => setS({ ...s, birthday: { ...s.birthday, days: e.target.value } })} aria-label="Days" /><span className="muted">days of the birthday</span>
      </div>
      <h3 style={{ fontSize: 15, marginTop: 16 }}>Business name in the privacy notice (KVKK)</h3>
      <div className="recipe-line"><input style={{ width: 360, textAlign: 'start' }} value={s.legalName || ''} onChange={(e) => setS({ ...s, legalName: e.target.value })} placeholder="e.g. Mariam Coffee (company legal name)" aria-label="Business name" /><span className="muted">the data controller named in the notice</span></div>
      <h3 style={{ fontSize: 15, marginTop: 16 }}>Stop double counting</h3>
      <div className="recipe-line"><span className="muted">Count at most one order every</span><input inputMode="decimal" value={s.cooldownHours} onChange={(e) => setS({ ...s, cooldownHours: e.target.value })} aria-label="Hours" /><span className="muted">hours per customer (a manager can still count more)</span></div>
      <div style={{ marginTop: 14 }}><button className="btn primary" onClick={save}>Save rules</button></div>
      {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} style={{ marginTop: 10 }}><span>{msg.text}</span></div>}
    </div>
  );
}

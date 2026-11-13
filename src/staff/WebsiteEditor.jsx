import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, EXTRAS, ITEMS } from '../../site/src/menu.js';
import { T } from '../../site/src/text.js';

const LANGS = [['en', 'English'], ['ar', 'العربية'], ['tr', 'Türkçe']];
const clone = (x) => JSON.parse(JSON.stringify(x));
const SITE = 'https://mariamcoffeeshop.com';

async function call(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
  return body;
}

/** Shrinks a photo in the browser before upload (keeps the site fast). PNG stays PNG (logos with transparency). */
async function shrink(file, maxW) {
  const keepPng = file.type === 'image/png';
  const bmp = await createImageBitmap(file);
  const w = Math.min(maxW, bmp.width);
  const h = Math.round((bmp.height * w) / bmp.width);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const type = keepPng ? 'image/png' : 'image/jpeg';
  return new Promise((res) => c.toBlob(res, type, 0.82));
}
async function upload(file, maxW) {
  const blob = await shrink(file, maxW);
  const r = await call('/api/media', { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
  return r.url;
}

/** Owner: edit the texts, menu and photos of mariamcoffeeshop.com and the table page (/t/). */
export default function WebsiteEditor() {
  const [content, setContent] = useState(null);
  const [tab, setTab] = useState('texts');
  const [msg, setMsg] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { call('/api/content').then((r) => setContent(r.content || {})).catch((e) => setMsg({ ok: false, text: e.message })); }, []);
  const change = (fn) => { setContent((c) => { const n = clone(c); fn(n); return n; }); setDirty(true); setMsg(null); };

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const { updatedAt, updatedBy, ...rest } = content;
      const r = await call('/api/content', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: rest }) });
      setContent(r.content); setDirty(false);
      setMsg({ ok: true, text: 'Saved. The website shows it within about 20 seconds.' });
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setSaving(false); }
  }

  if (!content) return <div className="card">{msg ? <div className="error">{msg.text}</div> : <p className="muted" style={{ margin: 0 }}>Loading…</p>}</div>;
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div><h2>Website</h2><p>Edit the texts, menu and photos of <a href={SITE} target="_blank" rel="noreferrer">mariamcoffeeshop.com</a> and the table QR page <a href={SITE + '/t/'} target="_blank" rel="noreferrer">/t/</a>. Prices always come from the till.</p></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {dirty && <span className="pill warn">Not saved</span>}
            <button className="btn primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
        {msg && <div className={'banner ' + (msg.ok ? 'ok' : 'bad')} role="status" style={{ margin: 0 }}><span>{msg.text}</span></div>}
        {content.updatedAt && <p className="faint" style={{ fontSize: 12.5, margin: '8px 0 0' }}>Last saved {new Date(content.updatedAt).toLocaleString()}{content.updatedBy ? ` by ${content.updatedBy}` : ''}.</p>}
      </div>
      <nav className="chips sub-tabs" aria-label="Website">
        {[['texts', 'Texts'], ['links', 'Links'], ['menu', 'Menu'], ['photos', 'Photos']].map(([k, l]) => <button key={k} className="chip" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      {tab === 'texts' && <Texts content={content} change={change} />}
      {tab === 'links' && <Links content={content} change={change} />}
      {tab === 'menu' && <MenuEditor content={content} change={change} setMsg={setMsg} />}
      {tab === 'photos' && <Photos content={content} change={change} setMsg={setMsg} />}
      {dirty && <div className="save-bar"><span>You have unsaved changes.</span><button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>}
    </div>
  );
}

// ---------------------------------------------------------------- texts
const GROUPS = [
  ['Table QR page (/t/)', (k) => k.startsWith('tbl.') || k === 'menu.title' || k === 'menu.note'],
  ['Website: top and favourites', (k) => /^(nav|hero|sig)\./.test(k)],
  ['Website: menu, about, gallery, visit, footer', (k) => /^(menu|about|gal|visit|foot)\./.test(k)],
];
function Texts({ content, change }) {
  const [q, setQ] = useState('');
  const keys = Object.keys(T).filter((k) => !k.startsWith('nf.'));
  const val = (k, i) => content.text?.[k]?.[i] ?? T[k][i] ?? '';
  const set = (k, i, v) => change((c) => {
    c.text = c.text || {};
    const cur = c.text[k] ? [...c.text[k]] : [...T[k]];
    cur[i] = v;
    if (cur.every((x, j) => (x || '') === (T[k][j] || ''))) delete c.text[k]; else c.text[k] = cur;
  });
  const match = (k) => !q || [k, ...T[k], ...(content.text?.[k] || [])].some((x) => String(x || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="card"><label className="field"><span>Find a text</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Welcome, menu, hours" /></label></div>
      {GROUPS.map(([title, test]) => {
        const list = keys.filter((k) => test(k) && match(k));
        if (!list.length) return null;
        return (
          <div className="card" key={title}>
            <div className="card-head"><div><h2>{title}</h2></div></div>
            <div className="stack" style={{ gap: 14 }}>
              {list.map((k) => {
                const edited = !!content.text?.[k];
                const long = T[k][0].length > 70;
                return (
                  <div key={k} className="text-edit">
                    <div className="text-edit-head"><b>{T[k][0].slice(0, 60)}{T[k][0].length > 60 ? '…' : ''}</b>{edited && <><span className="pill ok">edited</span><button className="btn small ghost" onClick={() => change((c) => { delete c.text[k]; })}>Back to original</button></>}</div>
                    <div className="form-grid three">
                      {LANGS.map(([l, label], i) => (
                        <label key={l} className="field"><span>{label}</span>
                          {long ? <textarea rows={3} dir={l === 'ar' ? 'rtl' : 'ltr'} value={val(k, i)} onChange={(e) => set(k, i, e.target.value)} />
                            : <input dir={l === 'ar' ? 'rtl' : 'ltr'} value={val(k, i)} onChange={(e) => set(k, i, e.target.value)} />}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- links
const LINKS = [
  ['google', 'Google review link', 'https://g.page/r/CWSMLS5rSzlAEBE/review', 'The “Review us on Google” button on the table page and in the website footer. In Google Business Profile: “Ask for reviews” → copy the link.'],
  ['instagram', 'Instagram link', 'https://www.instagram.com/mariamcoffee.tr/', 'The “Follow us on Instagram” button on the table page and in the website footer.'],
  ['instaName', 'Instagram name shown on the button', '@mariamcoffee.tr', 'The small text under “Follow us on Instagram”.'],
];
function Links({ content, change }) {
  const val = (k) => content.links?.[k] ?? '';
  const set = (k, v) => change((c) => { c.links = { ...(c.links || {}) }; if (v) c.links[k] = v; else delete c.links[k]; });
  const bad = (k) => k !== 'instaName' && val(k) && !/^https:\/\/\S+$/i.test(val(k));
  return (
    <div className="card">
      <div className="card-head"><div><h2>Links</h2><p>Where the buttons on the table QR page (/t/) and the website footer go. Leave a box empty to use the original.</p></div></div>
      <div className="stack" style={{ gap: 14 }}>
        {LINKS.map(([k, label, def, help]) => (
          <div key={k} className="text-edit">
            <label className="field"><span><b>{label}</b></span>
              <input value={val(k)} placeholder={def} onChange={(e) => set(k, e.target.value.trim())} aria-invalid={bad(k) || undefined} dir="ltr" />
            </label>
            <small className="muted">{help}</small>
            {bad(k) && <div><small style={{ color: 'var(--bad-text)' }}>The link must start with https://</small></div>}
            <div style={{ marginTop: 6 }}><a className="btn small ghost" href={val(k) && !bad(k) && k !== 'instaName' ? val(k) : k !== 'instaName' ? def : undefined} target="_blank" rel="noreferrer" hidden={k === 'instaName'}>Test the link ↗</a></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- menu
const ICONS = ['cup', 'cezve', 'iced', 'glass', 'cake', 'croissant', 'combo', 'bag', 'gift'];
const defaultMenu = () => ({ categories: clone(CATEGORIES), items: clone(ITEMS), extras: clone(EXTRAS) });

function MenuEditor({ content, change, setMsg }) {
  const menu = content.menu?.items ? content.menu : null;
  const m = menu || defaultMenu();
  const [cat, setCat] = useState(m.categories[0]?.id);
  const [pos, setPos] = useState(null); // live POS prices + names
  const [adding, setAdding] = useState('');
  useEffect(() => { fetch('/api/menu').then((r) => r.json()).then((d) => setPos(d.prices || {})).catch(() => setPos({})); }, []);
  // every change works on a full copy of the menu, so the built-in one is copied on the first edit
  const edit = (fn) => change((c) => { if (!c.menu?.items) c.menu = defaultMenu(); fn(c.menu); });
  const list = cat === '__extras' ? m.extras : m.items.filter((x) => x.cat === cat);
  const used = new Set([...m.items, ...m.extras].map((x) => String(x.id)));
  const posChoices = useMemo(() => (pos ? Object.entries(pos).filter(([id, v]) => !used.has(id) && v.a !== false && v.n && (!adding || v.n.toLowerCase().includes(adding.toLowerCase()))).slice(0, 30) : []), [pos, adding, m]);
  const arr = (mm) => (cat === '__extras' ? mm.extras : mm.items);
  const idx = (mm, x) => arr(mm).findIndex((y) => String(y.id) === String(x.id));

  function move(x, d) {
    edit((mm) => {
      const a = arr(mm);
      const same = a.map((y, i) => [y, i]).filter(([y]) => cat === '__extras' || y.cat === cat);
      const k = same.findIndex(([y]) => String(y.id) === String(x.id));
      const other = same[k + d];
      if (!other) return;
      const i = same[k][1], j = other[1];
      [a[i], a[j]] = [a[j], a[i]];
    });
  }
  const setItem = (x, patch) => edit((mm) => { const a = arr(mm); Object.assign(a[idx(mm, x)], patch); });
  async function photo(x, file) {
    try { const url = await upload(file, 480); setItem(x, { img: url }); } catch (e) { setMsg({ ok: false, text: e.message }); }
  }
  function addPos(id, v) {
    edit((mm) => {
      const item = { id: Number(id), cat: cat === '__extras' ? 'extra' : cat, p: v.p, name: [v.n, v.n, v.n] };
      (cat === '__extras' ? mm.extras : mm.items).push(item);
    });
    setAdding('');
  }
  function addCustom() {
    const name = prompt('Name of the new item (English):');
    if (!name) return;
    const p = Number(String(prompt('Price in TL (it is not in the till, so type it here):') || '').replace(',', '.'));
    edit((mm) => (cat === '__extras' ? mm.extras : mm.items).push({ id: 'c' + Date.now().toString(36), cat: cat === '__extras' ? 'extra' : cat, p: Number.isFinite(p) ? p : 0, name: [name, name, name] }));
  }
  function addSection() {
    const name = prompt('Name of the new section (English):');
    if (!name) return;
    const id = 's' + Date.now().toString(36);
    edit((mm) => mm.categories.push({ id, icon: 'cup', name: [name, name, name] }));
    setCat(id);
  }
  const c = m.categories.find((x) => x.id === cat);
  const setCatField = (patch) => edit((mm) => Object.assign(mm.categories.find((x) => x.id === cat), patch));
  function moveCat(d) {
    edit((mm) => { const i = mm.categories.findIndex((x) => x.id === cat); const j = i + d; if (j < 0 || j >= mm.categories.length) return; [mm.categories[i], mm.categories[j]] = [mm.categories[j], mm.categories[i]]; });
  }

  return (
    <>
      <div className="card">
        <div className="card-head"><div><h2>Menu sections</h2><p>Choose a section to edit its items. The same menu shows on the website and on the table page.</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={addSection}>＋ New section</button>
            {menu && <button className="btn ghost" onClick={() => { if (confirm('Throw away all menu changes and use the original menu?')) change((cc) => { delete cc.menu; }); }}>Back to original menu</button>}
          </div></div>
        <div className="chips" style={{ flexWrap: 'wrap' }}>
          {m.categories.map((x) => <button key={x.id} className="chip" aria-pressed={cat === x.id} onClick={() => setCat(x.id)}>{x.name[0]}{x.hidden ? ' (hidden)' : ''}</button>)}
          <button className="chip" aria-pressed={cat === '__extras'} onClick={() => setCat('__extras')}>Extras (under drinks)</button>
        </div>
      </div>

      {c && (
        <div className="card">
          <div className="card-head"><div><h2>Section: {c.name[0]}</h2></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn small" onClick={() => moveCat(-1)}>↑ Earlier</button><button className="btn small" onClick={() => moveCat(1)}>↓ Later</button>
              <button className="btn small ghost" onClick={() => setCatField({ hidden: !c.hidden })}>{c.hidden ? 'Show section' : 'Hide section'}</button>
            </div></div>
          <div className="form-grid three">
            {LANGS.map(([l, label], i) => <label key={l} className="field"><span>Name · {label}</span><input dir={l === 'ar' ? 'rtl' : 'ltr'} value={c.name[i] || ''} onChange={(e) => { const n = [...c.name]; n[i] = e.target.value; setCatField({ name: n }); }} /></label>)}
            <label className="field"><span>Icon</span><select value={c.icon} onChange={(e) => setCatField({ icon: e.target.value })}>{ICONS.map((ic) => <option key={ic}>{ic}</option>)}</select></label>
            <label className="field check-field"><input type="checkbox" checked={c.extras ?? ['coffee', 'turkish', 'iced', 'fresh'].includes(c.id)} onChange={(e) => setCatField({ extras: e.target.checked })} /> <span>Show “Extras” under this section</span></label>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><div><h2>Items{c ? ` in ${c.name[0]}` : ' · Extras'}</h2><p>Names and descriptions in three languages, a photo, the order, or hide an item. Items from the till take their price from the till.</p></div></div>
        <div className="stack" style={{ gap: 12 }}>
          {list.map((x) => {
            const isPos = typeof x.id === 'number' || /^\d+$/.test(String(x.id));
            const live = isPos && pos ? pos[x.id] : null;
            return (
              <div key={x.id} className={'menu-edit' + (x.hidden ? ' is-hidden' : '')}>
                <div className="menu-edit-img">
                  {x.img ? <img src={x.img} alt="" /> : <span className="faint">No photo</span>}
                  <label className="btn small">{x.img ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && photo(x, e.target.files[0])} /></label>
                  {x.img && <button className="btn small ghost" onClick={() => setItem(x, { img: undefined })}>Remove photo</button>}
                </div>
                <div className="menu-edit-body">
                  <div className="form-grid three">
                    {LANGS.map(([l, label], i) => <label key={l} className="field"><span>Name · {label}</span><input dir={l === 'ar' ? 'rtl' : 'ltr'} value={x.name[i] || ''} onChange={(e) => { const n = [...x.name]; n[i] = e.target.value; setItem(x, { name: n }); }} /></label>)}
                    {LANGS.map(([l, label], i) => <label key={l} className="field"><span>Description · {label} (optional)</span><input dir={l === 'ar' ? 'rtl' : 'ltr'} value={x.d?.[i] || ''} onChange={(e) => { const n = [...(x.d || ['', '', ''])]; n[i] = e.target.value; setItem(x, { d: n.some(Boolean) ? n : undefined }); }} /></label>)}
                  </div>
                  <div className="menu-edit-foot">
                    <span className="muted" style={{ fontSize: 13 }}>
                      {isPos ? <>Till item #{x.id} · price <b>{live ? `${live.p} TL` : `${x.p} TL (not found in the latest till upload: hidden on the site)`}</b></> : <>Own item · price <input className="cell-input" style={{ width: 80 }} inputMode="decimal" value={x.p ?? ''} onChange={(e) => setItem(x, { p: Number(String(e.target.value).replace(',', '.')) || 0 })} /> TL</>}
                    </span>
                    {cat !== '__extras' && <select className="cell-input" value={x.cat} onChange={(e) => setItem(x, { cat: e.target.value })} aria-label="Section">{m.categories.map((cc) => <option key={cc.id} value={cc.id}>{cc.name[0]}</option>)}</select>}
                    <button className="btn small" onClick={() => move(x, -1)} aria-label="Move up">↑</button>
                    <button className="btn small" onClick={() => move(x, 1)} aria-label="Move down">↓</button>
                    <button className="btn small ghost" onClick={() => setItem(x, { hidden: !x.hidden })}>{x.hidden ? 'Show' : 'Hide'}</button>
                    {!isPos && <button className="btn small ghost" onClick={() => { if (confirm('Delete this item?')) edit((mm) => { const a = arr(mm); a.splice(idx(mm, x), 1); }); }}>Delete</button>}
                  </div>
                </div>
              </div>
            );
          })}
          {!list.length && <p className="muted">No items in this section yet.</p>}
        </div>
        <div className="add-box">
          <label className="field"><span>Add an item from the till (price follows the till)</span><input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Type to search the till items…" /></label>
          {adding && <ul className="pos-pick">{posChoices.map(([id, v]) => <li key={id}><button className="linklike" onClick={() => addPos(id, v)}>{v.n}</button> <span className="faint">#{id} · {v.p} TL</span></li>)}{!posChoices.length && <li className="faint">No till item matches (or it is already on the menu).</li>}</ul>}
          <button className="btn small" onClick={addCustom}>＋ Add an item that is not in the till</button>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- photos
const SLOTS = [
  ['hero', 'Website · big top photo', '/brand/hero-1000.webp', 2000],
  ['about', 'Website · “About” photo', '/photos/lounge-640.webp', 1280],
  ['visit', 'Website · “Visit us” photo (before the map)', '/photos/front-640.webp', 1280],
  ['sig1', 'Website · favourite 1 (instead of the drawing)', null, 640],
  ['sig2', 'Website · favourite 2 (instead of the drawing)', null, 640],
  ['sig3', 'Website · favourite 3 (instead of the drawing)', null, 640],
  ['tableLogo', 'Table page · logo', '/brand/logo-round-cream.svg', 600],
  ['tableBg', 'Table page · background photo (optional)', null, 1600],
];
const DEFAULT_GALLERY = [
  ['mural', 'gal.mural'], ['front', 'gal.front'], ['horse', 'gal.horse'], ['lounge', 'gal.lounge'], ['counter', 'gal.counter'],
].map(([n, k]) => ({ src: `/photos/${n}-640.webp`, full: `/photos/${n}-1920.webp`, caption: [...T[k]] }));

function Photos({ content, change, setMsg }) {
  const [busy, setBusy] = useState('');
  async function setSlot(slot, file, maxW) {
    setBusy(slot);
    try { const url = await upload(file, maxW); change((c) => { c.images = { ...(c.images || {}), [slot]: url }; }); } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); }
  }
  const gallery = content.gallery || DEFAULT_GALLERY;
  const editG = (fn) => change((c) => { if (!Array.isArray(c.gallery)) c.gallery = clone(DEFAULT_GALLERY); fn(c.gallery); });
  async function addGallery(files) {
    setBusy('gallery');
    try {
      for (const f of files) {
        const [src, full] = await Promise.all([upload(f, 640), upload(f, 1600)]);
        editG((g) => g.push({ src, full, caption: ['', '', ''] }));
      }
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(''); }
  }
  return (
    <>
      <div className="card">
        <div className="card-head"><div><h2>Page photos</h2><p>Photos are made smaller on this device before they are uploaded, so the website stays fast.</p></div></div>
        <div className="slot-grid">
          {SLOTS.map(([slot, label, def, maxW]) => {
            const cur = content.images?.[slot];
            return (
              <div key={slot} className="slot">
                <div className="slot-img" style={slot === 'tableLogo' ? { background: '#2F6B59' } : undefined}>{cur || def ? <img src={cur || def} alt="" /> : <span className="faint">Drawing (default)</span>}</div>
                <b>{label}</b>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <label className="btn small">{busy === slot ? 'Uploading…' : cur ? 'Replace' : 'Upload'}<input type="file" accept="image/*" hidden disabled={!!busy} onChange={(e) => e.target.files[0] && setSlot(slot, e.target.files[0], maxW)} /></label>
                  {cur && <button className="btn small ghost" onClick={() => change((c) => { delete c.images[slot]; })}>Back to original</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><div><h2>Gallery (“Inside Mariam”)</h2><p>Add, remove or reorder photos and write their captions. The first photo is shown big.</p></div>
          <div style={{ display: 'flex', gap: 8 }}>
            <label className="btn primary">{busy === 'gallery' ? 'Uploading…' : '＋ Add photos'}<input type="file" accept="image/*" multiple hidden disabled={!!busy} onChange={(e) => e.target.files.length && addGallery([...e.target.files])} /></label>
            {content.gallery && <button className="btn ghost" onClick={() => { if (confirm('Use the original 5 photos again?')) change((c) => { delete c.gallery; }); }}>Back to original</button>}
          </div></div>
        <div className="stack" style={{ gap: 12 }}>
          {gallery.map((g, i) => (
            <div key={g.src + i} className="menu-edit">
              <div className="menu-edit-img"><img src={g.src} alt="" /></div>
              <div className="menu-edit-body">
                <div className="form-grid three">
                  {LANGS.map(([l, label], j) => <label key={l} className="field"><span>Caption · {label}</span><input dir={l === 'ar' ? 'rtl' : 'ltr'} value={g.caption?.[j] || ''} onChange={(e) => editG((gg) => { gg[i].caption = [...(gg[i].caption || ['', '', ''])]; gg[i].caption[j] = e.target.value; })} /></label>)}
                </div>
                <div className="menu-edit-foot">
                  <button className="btn small" disabled={i === 0} onClick={() => editG((gg) => { [gg[i - 1], gg[i]] = [gg[i], gg[i - 1]]; })}>↑</button>
                  <button className="btn small" disabled={i === gallery.length - 1} onClick={() => editG((gg) => { [gg[i + 1], gg[i]] = [gg[i], gg[i + 1]]; })}>↓</button>
                  <button className="btn small ghost" onClick={() => { if (confirm('Remove this photo from the gallery?')) editG((gg) => gg.splice(i, 1)); }}>Remove</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

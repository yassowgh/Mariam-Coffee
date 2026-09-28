import { useRef, useState } from 'react';

// Recursively read dropped folders (Chrome/Edge/Safari/Firefox support webkitGetAsEntry).
async function filesFromDrop(dt) {
  const items = [...(dt.items || [])];
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  async function walk(entry, path) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      Object.defineProperty(file, 'webkitRelativePath', { value: path + file.name });
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const e of batch) await walk(e, path + entry.name + '/');
      } while (batch.length);
    }
  }
  for (const e of entries) await walk(e, '');
  return out;
}

export default function Upload({ onFiles: onFilesRaw, error, saved, onCancel, canSave }) {
  const [over, setOver] = useState(false);
  const [save, setSave] = useState(!!canSave);
  const [password, setPassword] = useState('');
  const [needPw, setNeedPw] = useState(false);
  const onFiles = (files) => {
    if (save && !password) { setNeedPw(true); return; }
    onFilesRaw(files, { save, password });
  };
  const fileRef = useRef(null);
  const dirRef = useRef(null);

  return (
    <div className="upload">
      <div
        className={'drop' + (over ? ' over' : '')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault();
          setOver(false);
          const files = await filesFromDrop(e.dataTransfer);
          if (files.length) onFiles(files);
        }}
      >
        <h2>{saved ? 'Update the sales data' : 'Load your sales database'}</h2>
        {saved && (
          <p className="faint" style={{ margin: '0 0 8px', fontSize: 12.5 }}>
            Currently saved: {saved.name || 'data'} ({saved.from} – {saved.to}), uploaded {new Date(saved.uploadedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        )}
        <p className="muted" style={{ margin: 0 }}>
          Drop the ASEAL database folder, its <b>.DB</b> files, or one <b>.zip</b> / <b>.rar</b> archive here. You can add the product cost sheet (<b>.xlsx</b>) too, or on its own.
        </p>
        <div className="save-box">
          <label className="check">
            <input type="checkbox" checked={save} onChange={(e) => { setSave(e.target.checked); setNeedPw(false); }} />
            Save for everyone (replaces the saved data)
          </label>
          {save && (
            <label className="field">
              <span>Upload password</span>
              <input id="upload-password" type="password" autoComplete="current-password" value={password}
                onChange={(e) => { setPassword(e.target.value); setNeedPw(false); }}
                aria-invalid={needPw} style={needPw ? { borderColor: 'var(--bad)' } : undefined} />
              {needPw && <span style={{ color: 'var(--bad-text)', fontWeight: 500 }}>Enter the password first, or untick “Save”.</span>}
            </label>
          )}
          {!save && <span className="faint" style={{ fontSize: 12.5 }}>The files are shown only in this browser and not saved.</span>}
        </div>
        <div className="actions">
          <button className="btn primary" onClick={() => fileRef.current.click()}>Choose files or archive</button>
          <button className="btn" onClick={() => dirRef.current.click()}>Choose a folder</button>
          {onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
        </div>
        <input ref={fileRef} type="file" multiple accept=".db,.DB,.zip,.rar,.xlsx"
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); }} />
        <input ref={dirRef} type="file" webkitdirectory="" directory=""
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); }} />
        <p className="faint" style={{ margin: '16px 0 0', fontSize: 12.5 }}>
          🔒 Files are read in this browser. When “Save” is ticked, only the sales tables are stored on the website so it opens with this data next time.
        </p>
      </div>
      {error && <div className="error" role="alert"><b>Could not load the data.</b><br />{error}</div>}
      <div className="help card" style={{ marginTop: 16 }}>
        <b style={{ color: 'var(--text)' }}>Which files are used</b>
        <ul>
          <li><b>Invoices.DB</b> + <b>StockTransDetails.DB</b>: the accounting books (primary source, includes on-account invoices).</li>
          <li><b>CROldInvoices.DB</b> + <b>CROldDetails.DB</b>: cash-register history, used for dates before the accounting books start.</li>
          <li><b>Items.DB</b> (product names) and <b>CRInvoices.DB</b> (open tables) are optional.</li>
        </ul>
        Other files in the folder or archive are ignored. You can include several year folders in one ZIP.
      </div>
    </div>
  );
}

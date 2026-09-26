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

export default function Upload({ onFiles, error }) {
  const [over, setOver] = useState(false);
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
        <h2>Load your sales database</h2>
        <p className="muted" style={{ margin: 0 }}>
          Drop the ASEAL database folder, its <b>.DB</b> files, or one <b>.zip</b> / <b>.rar</b> archive here.
        </p>
        <div className="actions">
          <button className="btn primary" onClick={() => fileRef.current.click()}>Choose files or archive</button>
          <button className="btn" onClick={() => dirRef.current.click()}>Choose a folder</button>
        </div>
        <input ref={fileRef} type="file" multiple accept=".db,.DB,.zip,.rar"
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); }} />
        <input ref={dirRef} type="file" webkitdirectory="" directory=""
          onChange={(e) => { const f = [...e.target.files]; e.target.value = ''; if (f.length) onFiles(f); }} />
        <p className="faint" style={{ margin: '16px 0 0', fontSize: 12.5 }}>
          🔒 Files are processed entirely in this browser tab. Nothing is uploaded or saved.
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

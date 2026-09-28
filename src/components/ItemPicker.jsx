import { useId, useMemo, useState } from 'react';

/** Type-to-search product box; calls onPick(itemId) when a product name is chosen. */
export default function ItemPicker({ model, onPick, label = 'Track an item', compact }) {
  const listId = useId();
  const [text, setText] = useState('');
  const byName = useMemo(() => {
    const m = new Map();
    for (const p of model.products.values()) if (p.id !== -1) m.set(p.name, p.id);
    return m;
  }, [model.products]);
  const names = useMemo(() => [...byName.keys()].sort((a, b) => a.localeCompare(b)), [byName]);

  function choose(v) {
    setText(v);
    if (byName.has(v)) { onPick(byName.get(v)); setText(''); }
  }

  return (
    <label className="field" style={{ minWidth: compact ? 180 : 240, flex: compact ? '0 1 220px' : undefined }}>
      <span>{label}</span>
      <input type="search" list={listId} value={text} placeholder="Type a product name…"
        onChange={(e) => choose(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          const q = text.trim().toLowerCase();
          if (!q) return;
          const hit = names.find((n) => n.toLowerCase() === q) || names.find((n) => n.toLowerCase().includes(q));
          if (hit) choose(hit);
        }} />
      <datalist id={listId}>{names.map((n) => <option key={n} value={n} />)}</datalist>
    </label>
  );
}

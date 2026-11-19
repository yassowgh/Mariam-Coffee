import { useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Ask the AI a question about the figures on the page. It answers only from `context` (sent as JSON).
 * lang: 'en' | 'ar' (labels); the answer follows the language of the question.
 */
export default function AskAI({ context, notes, suggestions = [], lang = 'en', title }) {
  const ar = lang === 'ar';
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [chat, setChat] = useState([]); // [{ q, a, by }]

  async function ask(question) {
    const text = String(question || q).trim();
    if (!text || busy) return;
    setBusy(true); setErr('');
    try {
      const r = await api('finance-ask', { method: 'POST', body: { question: text, context, notes, history: chat.map(({ q: qq, a }) => ({ q: qq, a })) } });
      setChat((c) => [...c, { q: text, a: r.answer, by: r.by }]);
      setQ('');
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <div className="card ask-ai no-print" dir={ar ? 'rtl' : 'ltr'}>
      <div className="card-head"><div>
        <h2>{title || (ar ? '💬 اسأل عن هذه الأرقام' : '💬 Ask about these figures')}</h2>
        <p>{ar ? 'اكتب سؤالك بالعربية أو الإنجليزية. يجيب الذكاء الاصطناعي من الأرقام المعروضة هنا فقط، وقد يخطئ: تحقّق من الأرقام المهمة.' : 'Type a question in English or Arabic. The AI answers only from the figures shown here, and can make mistakes: check important numbers.'}</p>
      </div></div>
      {chat.length > 0 && (
        <div className="ask-list">
          {chat.map((c, i) => (
            <div key={i} className="ask-item">
              <div className="ask-q">{c.q}</div>
              <div className="ask-a" dir="auto">{c.a}</div>
              <small className="muted">{c.by}</small>
            </div>
          ))}
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="ask-sugg">
          {suggestions.map((s) => <button key={s} className="btn small ghost" disabled={busy} onClick={() => ask(s)}>{s}</button>)}
        </div>
      )}
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={600} dir="auto"
          placeholder={ar ? 'مثال: ما أكبر مصروف في أكتوبر؟' : 'e.g. What was my biggest cost in October?'} aria-label={ar ? 'سؤالك' : 'Your question'} />
        <button className="btn primary" disabled={busy || !q.trim()}>{busy ? (ar ? 'يفكّر…' : 'Thinking…') : (ar ? 'اسأل' : 'Ask')}</button>
      </form>
      {err && <div className="banner bad" role="alert" style={{ marginTop: 8 }}><span>{err}</span></div>}
    </div>
  );
}

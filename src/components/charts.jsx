import { useEffect, useMemo, useRef, useState } from 'react';
import { compact } from '../format.js';

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// round tick step (1, 2, 5 × 10^n) so axis labels are clean numbers
function niceStep(range, count = 4) {
  if (range <= 0) return 1;
  const raw = range / count;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function Tooltip({ x, y, title, rows }) {
  return (
    <div className="tooltip" style={{ left: x, top: y }}>
      <div className="t">{title}</div>
      {rows.map(([k, v, color]) => (
        <div className="row" key={k}>
          <span>{color && <i style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color, marginRight: 6 }} />}{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

/**
 * Bars (value) with an optional line (avg) on the same scale.
 * data: [{ key, label, value, line?, ghost?, parts?: {seriesKey: v}, title, rows: [[k,v]] }]
 * series: optional [{ key, label, color }] -> bars are stacked from `parts` in this order
 * ghost: a lighter bar behind the value (e.g. run rate of an unfinished month)
 */
export function BarLineChart({ data, height = 240, lineLabel, barLabel, ghostLabel, series, yFmt = compact, onBarClick, highlightKey }) {
  const lineColor = series ? 'var(--text)' : 'var(--series-2)';
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 60, r: 12, t: 12, b: 28 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const maxV = Math.max(0, ...data.map((d) => Math.max(d.value, d.line ?? 0, d.ghost ?? 0)));
  const minV = Math.min(0, ...data.map((d) => d.value));
  const stepV = niceStep(maxV - minV);
  const max = Math.max(stepV, Math.ceil(maxV / stepV) * stepV);
  const min = Math.floor(minV / stepV) * stepV;
  const tickVals = [];
  for (let v = min; v <= max + stepV / 2; v += stepV) tickVals.push(v);
  const y = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const step = iw / Math.max(1, data.length);
  const gap = data.length > 60 ? 1 : 2;
  const bw = Math.max(1, step - gap);
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(iw / 56)));
  const linePts = data.map((d, i) => (d.line == null ? null : [pad.l + i * step + step / 2, y(d.line)]));
  let path = '';
  linePts.forEach((p, i) => { if (p) path += `${path && linePts[i - 1] ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`; });

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.floor((px - pad.l) / step);
    setHover(i >= 0 && i < data.length ? i : null);
  }
  const h = hover != null ? data[hover] : null;
  return (
    <div className="chart" ref={ref}>
      {(lineLabel || barLabel || series || ghostLabel) && (
        <div className="legend" style={{ marginBottom: 6 }}>
          {series
            ? series.map((sr) => <span key={sr.key}><i className="bar" style={{ background: sr.color }} />{sr.label}</span>)
            : barLabel && <span><i className="bar" style={{ background: 'var(--series-1)' }} />{barLabel}</span>}
          {ghostLabel && <span><i className="bar" style={{ background: 'var(--series-1-soft)' }} />{ghostLabel}</span>}
          {lineLabel && <span><i style={{ background: lineColor }} />{lineLabel}</span>}
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={barLabel || 'chart'}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onClick={() => h && onBarClick?.(h)} style={{ cursor: onBarClick ? 'pointer' : 'default' }}>
        {tickVals.map((v) => {
          return (
            <g key={v}>
              <line className="gridline" x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} />
              <text x={pad.l - 6} y={y(v) + 4} textAnchor="end">{yFmt(v)}</text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = pad.l + i * step + gap / 2;
          const top = y(Math.max(0, d.value));
          const hgt = Math.abs(y(d.value) - y(0));
          const r = Math.min(4, bw / 2, hgt);
          const neg = d.value < 0;
          const active = hover === i || highlightKey === d.key;
          const op = hover == null || active ? 1 : 0.55;
          const ghost = d.ghost != null && d.ghost > d.value ? (
            <path d={roundedBar(x, y(d.ghost), bw, y(0) - y(d.ghost), Math.min(4, bw / 2), false)} fill="var(--series-1-soft)" opacity={op} />
          ) : null;
          if (series && d.parts && !neg) {
            // stacked segments, bottom-up, 2px surface gap between them, rounded top only
            const segs = [];
            let base = 0;
            const visible = series.filter((sr) => (d.parts[sr.key] || 0) > 0);
            visible.forEach((sr, si) => {
              const v = d.parts[sr.key];
              const y0 = y(base), y1 = y(base + v);
              const isTop = si === visible.length - 1;
              const hh = Math.max(0, y0 - y1 - (isTop ? 0 : 2));
              segs.push(<path key={sr.key} d={isTop ? roundedBar(x, y1, bw, hh, Math.min(4, bw / 2, hh), false) : `M${x},${y1 + 2}h${bw}v${hh}h${-bw}z`} fill={sr.color} opacity={op} />);
              base += v;
            });
            return <g key={d.key}>{ghost}{segs}</g>;
          }
          const fill = neg ? 'var(--bad)' : 'var(--series-1)';
          return (
            <g key={d.key}>{ghost}
              <path d={roundedBar(x, top, bw, hgt, r, neg)} fill={fill} opacity={op} />
            </g>
          );
        })}
        <line className="axis" x1={pad.l} x2={width - pad.r} y1={y(0)} y2={y(0)} />
        {path && <path d={path} fill="none" stroke={lineColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
        {data.map((d, i) => (i % labelEvery === 0 ? (
          <text key={'l' + d.key} x={pad.l + i * step + step / 2} y={height - 8} textAnchor="middle">{d.label}</text>
        ) : null))}
        {h && <line x1={pad.l + hover * step + step / 2} x2={pad.l + hover * step + step / 2} y1={pad.t} y2={pad.t + ih} stroke="var(--text-3)" strokeWidth="1" />}
        {h && linePts[hover] && <circle cx={linePts[hover][0]} cy={linePts[hover][1]} r="4" fill={lineColor} stroke="var(--surface)" strokeWidth="2" />}
      </svg>
      {h && (
        <Tooltip x={Math.min(Math.max(((pad.l + hover * step + step / 2) / width) * 100, 12), 88) + '%'}
          y={(Math.min(y(Math.max(d0(h.value), h.line ?? 0)), pad.t + ih) / height) * 100 + '%'} title={h.title} rows={h.rows} />
      )}
    </div>
  );
}
const d0 = (v) => Math.max(0, v);

function roundedBar(x, top, w, h, r, neg) {
  if (h <= 0) return '';
  if (neg) {
    return `M${x},${top}h${w}v${h - r}q0,${r} ${-r},${r}h${-(w - 2 * r)}q${-r},0 ${-r},${-r}z`;
  }
  return `M${x},${top + h}v${-(h - r)}q0,${-r} ${r},${-r}h${w - 2 * r}q${r},0 ${r},${r}v${h - r}z`;
}

/** Weekday x hour heatmap. cells: [{dow, hour, amount, orders}], rows ordered by `dows`, cols by `hours`. */
export function Heatmap({ cells, dows, dowLabels, hours, fmt, subFmt }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...cells.map((c) => c.amount));
  const lookup = useMemo(() => new Map(cells.map((c) => [c.dow * 24 + c.hour, c])), [cells]);
  const steps = 7;
  const level = (v) => (v <= 0 ? 0 : Math.min(steps, Math.ceil((v / max) * steps)));
  return (
    <div className="chart" style={{ overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `36px repeat(${hours.length}, minmax(18px, 1fr))`, gap: 2, minWidth: 36 + hours.length * 20 }}
        onMouseLeave={() => setHover(null)}>
        <div />
        {hours.map((h) => <div key={'h' + h} style={{ fontSize: 10.5, color: 'var(--text-3)', textAlign: 'center' }}>{h % 2 === 0 ? String(h).padStart(2, '0') : ''}</div>)}
        {dows.map((d, ri) => (
          <HeatRow key={d} d={d} label={dowLabels[ri]} hours={hours} lookup={lookup} level={level} setHover={setHover} hover={hover} />
        ))}
      </div>
      <div className="heat-scale">
        <span>Less</span>
        {Array.from({ length: steps + 1 }, (_, i) => <span key={i} className="sw" style={{ background: `var(--seq-${i})` }} />)}
        <span>More</span>
        {hover && (
          <span style={{ marginLeft: 'auto', color: 'var(--text)' }}>
            <b>{dowLabels[dows.indexOf(hover.dow)]} {String(hover.hour).padStart(2, '0')}:00</b> · avg {fmt(hover.amount)} · {subFmt(hover.orders)} orders
          </span>
        )}
      </div>
    </div>
  );
}
function HeatRow({ d, label, hours, lookup, level, setHover, hover }) {
  return (
    <>
      <div style={{ fontSize: 11.5, color: 'var(--text-2)', alignSelf: 'center' }}>{label}</div>
      {hours.map((h) => {
        const c = lookup.get(d * 24 + h) || { dow: d, hour: h, amount: 0, orders: 0 };
        const on = hover && hover.dow === d && hover.hour === h;
        return (
          <div key={h} onMouseEnter={() => setHover(c)} onClick={() => setHover(c)}
            title={`${label} ${String(h).padStart(2, '0')}:00`}
            style={{ height: 22, borderRadius: 3, background: `var(--seq-${level(c.amount)})`, outline: on ? '2px solid var(--text)' : 'none', outlineOffset: -1 }} />
        );
      })}
    </>
  );
}

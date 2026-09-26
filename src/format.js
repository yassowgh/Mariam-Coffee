const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export const money = (v) => (v == null ? '–' : '₺' + nf0.format(Math.round(v)));
export const money2 = (v) => (v == null ? '–' : '₺' + nf2.format(v));
export const int = (v) => (v == null ? '–' : nf0.format(v));
export const dec1 = (v) => (v == null ? '–' : nf1.format(v));
export const pct = (v, digits = 1) => (v == null || !Number.isFinite(v) ? '–' : (v * 100).toFixed(digits) + '%');
export const signedPct = (v) => (v == null || !Number.isFinite(v) ? '–' : (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%');
export const signedMoney = (v) => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + '₺' + nf0.format(Math.abs(Math.round(v))));
export const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return '₺' + nf1.format(v / 1e6) + 'M';
  if (a >= 1e4) return '₺' + nf0.format(v / 1e3) + 'k';
  if (a >= 1e3) return '₺' + nf1.format(v / 1e3) + 'k';
  return '₺' + nf0.format(v);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const shortDate = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
export const longDate = (iso) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
export const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
export const hourRange = (h) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
export const timeLabel = (minute) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

// Line drawings for menu items that have no photo yet (same style as art.js: stroke = currentColor,
// .fill = brand brown). Keys are POS item numbers. A real photo set in the Website editor replaces them.
import { ART } from './art.js';

const svg = (body) => `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const steam = (x1, x2) => `<path d="M${x1} 30c-4-6 4-8 0-14M${x2} 30c-4-6 4-8 0-14"/>`;

// Turkish coffee cup (fincan) on a saucer with a glass of water; `pod` adds a cardamom pod
const turkish = (pod, two) => svg(`
  <path d="M26 58h34v14a17 17 0 0 1-34 0z"/>
  <path d="M60 62h4a6 6 0 0 1 0 12h-5"/>
  <path class="fill" d="M29 62h28v9a14 14 0 0 1-28 0z" stroke="none"/>
  <path d="M16 92h54"/>
  ${steam(38, 48)}
  <path d="M80 44h22l-3 52H83z"/><path d="M82 62h18"/>
  ${pod ? '<ellipse cx="58" cy="104" rx="9" ry="4.5" transform="rotate(-18 58 104)"/><path d="M50 106l17-5"/>' : ''}
  ${two ? '<path d="M8 74h6M8 66h4"/>' : ''}`);

const tallGlass = (fillTop, straw = true) => svg(`
  <path d="M38 22h44l-6 82H44z"/>
  <path class="fill" d="M${40 + (fillTop - 22) * 0.07} ${fillTop}h${40 - (fillTop - 22) * 0.14}l-4.6 ${100 - fillTop}H45.6z" stroke="none" opacity=".75"/>
  <rect x="47" y="34" width="12" height="12" rx="2.5"/><rect x="61" y="44" width="11" height="11" rx="2.5"/><rect x="50" y="52" width="10" height="10" rx="2.5"/>
  ${straw ? '<path d="M68 22l10-16h12"/>' : ''}`);

const slice = (top, extra = '') => svg(`
  <path d="M14 70l66-30 26 16v26H14z"/>
  <path d="M14 70v12h92V70"/><path d="M14 70h92"/>
  ${top}${extra}`);

export const ITEM_ART = {
  // Turkish tea in a tulip glass on a saucer
  19: svg(`
    <path d="M44 28h32c0 10-8 16-8 26s10 18 10 30a18 18 0 0 1-18 14 18 18 0 0 1-18-14c0-12 10-20 10-30s-8-16-8-26z"/>
    <path class="fill" d="M51.5 60h17c3 6 9 13 9 24a15 15 0 0 1-17.5 11.5A15 15 0 0 1 42.5 84c0-11 6-18 9-24z" stroke="none"/>
    <path d="M26 104h68"/><path d="M34 98h52"/>
    <path d="M86 40l12-8M90 50h12"/>`),
  // caffè latte with latte art
  7: svg(`
    <path d="M22 52h64v14a32 32 0 0 1-64 0z"/>
    <path d="M86 58h6a10 10 0 0 1 0 20h-8"/>
    <ellipse cx="54" cy="52" rx="32" ry="7"/>
    <path class="fill" d="M54 50c-3-4-10-2-8 3 1 3 5 5 8 7 3-2 7-4 8-7 2-5-5-7-8-3z" stroke="none"/>
    <path d="M14 104h80"/>${steam(44, 62)}`),
  // cappuccino: foam dome
  6: svg(`
    <path d="M22 56h64v12a32 32 0 0 1-64 0z"/>
    <path d="M86 60h6a10 10 0 0 1 0 20h-8"/>
    <path d="M24 56c2-14 16-18 30-18s28 4 30 18"/>
    <path d="M40 46c4 2 8 2 12 0M58 44c4 2 8 2 12 0"/>
    <path d="M14 104h80"/>`),
  // flat white: smaller cup with a rosetta
  10: svg(`
    <path d="M30 56h52v12a26 26 0 0 1-52 0z"/>
    <path d="M82 60h5a9 9 0 0 1 0 18h-7"/>
    <ellipse cx="56" cy="56" rx="26" ry="6"/>
    <path class="fill" d="M56 52c-8 0-12 2-12 4h24c0-2-4-4-12-4z" stroke="none"/>
    <path d="M56 51v10"/>
    <path d="M22 102h68"/>${steam(48, 62)}`),
  // americano: tall mug
  11: svg(`
    <path d="M30 34h50v58a8 8 0 0 1-8 8H38a8 8 0 0 1-8-8z"/>
    <path d="M80 46h8a10 10 0 0 1 0 20h-8"/>
    <path class="fill" d="M34 44h42v46a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6z" stroke="none" opacity=".85"/>
    <path d="M47 24c-4-6 4-8 0-14M62 24c-4-6 4-8 0-14"/>`),
  // double espresso: small cup, two shots
  3: svg(`
    <path d="M36 56h40v10a20 20 0 0 1-40 0z"/>
    <path d="M76 60h4a7 7 0 0 1 0 14h-5"/>
    <path class="fill" d="M39 60h34v6a17 17 0 0 1-34 0z" stroke="none"/>
    <path d="M26 98h60"/>${steam(50, 62)}`),
  // filter coffee: pour-over dripper on a mug
  18: svg(`
    <path d="M34 22h52l-16 26H50z"/><path d="M42 48h36"/>
    <path d="M60 52v8"/>
    <path d="M30 62h60v24a14 14 0 0 1-14 14H44a14 14 0 0 1-14-14z"/>
    <path class="fill" d="M34 72h52v14a10 10 0 0 1-10 10H44a10 10 0 0 1-10-10z" stroke="none"/>
    <path d="M90 68h4a9 9 0 0 1 0 18h-4"/>`),
  // iced latte: layered milk and coffee over ice
  33: svg(`
    <path d="M38 22h44l-6 82H44z"/>
    <path class="fill" d="M41.6 62h36.8l-3.4 40H45z" stroke="none" opacity=".55"/>
    <path d="M40 50h40"/>
    <rect x="47" y="30" width="12" height="12" rx="2.5"/><rect x="61" y="40" width="11" height="11" rx="2.5"/>
    <path d="M68 22l10-16h12"/>`),
  // iced americano
  163: tallGlass(34),
  // Mariam green tea: cup with tea bag and leaf
  24: svg(`
    <path d="M24 54h60v12a30 30 0 0 1-60 0z"/>
    <path d="M84 58h6a10 10 0 0 1 0 20h-8"/>
    <path d="M66 54V28"/><rect x="60" y="18" width="12" height="12" rx="2"/>
    <path d="M30 40c4-14 18-16 24-14-2 10-12 18-24 14z"/><path d="M30 40l18-10"/>
    <path d="M16 102h76"/>`),
  // cookie with chocolate chips
  140: svg(`
    <path d="M60 18a42 42 0 1 0 40 30 10 10 0 0 1-12-12 10 10 0 0 1-10-14 30 30 0 0 0-18-4z"/>
    <circle class="fill" cx="44" cy="48" r="5" stroke="none"/><circle class="fill" cx="66" cy="62" r="5.5" stroke="none"/>
    <circle class="fill" cx="46" cy="76" r="4.5" stroke="none"/><circle class="fill" cx="76" cy="84" r="4.5" stroke="none"/>
    <circle class="fill" cx="58" cy="94" r="3.5" stroke="none"/>`),
  // blueberry cheesecake
  139: slice('<path class="fill" d="M14 82h92v8H14z" stroke="none"/>', '<circle cx="50" cy="52" r="5"/><circle cx="62" cy="48" r="5"/><circle cx="74" cy="44" r="5"/><circle cx="58" cy="58" r="4.5"/><circle cx="70" cy="54" r="4.5"/>'),
  // San Sebastián cheesecake: burnt top, creamy inside
  45: svg(`
    <path class="fill" d="M14 70l66-30 26 16-92 14z" stroke="none"/>
    <path d="M14 70l66-30 26 16v28H14z"/><path d="M14 70h92"/>
    <path d="M24 80c8 4 16-2 24 2s16-2 24 2 16-2 26 1"/>
    <path d="M14 98h92"/>`),
  // chocolate cake: layers
  191: slice('<path class="fill" d="M14 74h92v6H14zM14 86h92v6H14z" stroke="none"/>', '<path d="M80 40v-10M80 30c-3-4 3-6 0-10"/>'),
  // apple pie: lattice slice
  43: svg(`
    <path d="M14 76l66-34 26 18v24H14z"/><path d="M14 76h92"/><path d="M14 76v8"/>
    <path d="M30 70l36-6M48 60l40-4M60 50l22 18M44 66l10-18"/>
    <path d="M14 94h92"/>`),
  // honey cake: layers with a drip
  837: svg(`
    <path d="M14 66l66-28 26 16v32H14z"/><path d="M14 66h92"/>
    <path d="M14 76h92M14 86h92"/>
    <path class="fill" d="M80 38l26 16v6c-2 3-4 3-5 0-2 4-5 4-6 0l-15-9z" stroke="none"/>
    <path d="M14 98h92"/>`),
  // salep: mug with cinnamon
  112: svg(`
    <path d="M28 48h56v28a28 28 0 0 1-56 0z"/>
    <path d="M84 56h6a10 10 0 0 1 0 20h-7"/>
    <ellipse cx="56" cy="48" rx="28" ry="6"/>
    <circle class="fill" cx="48" cy="48" r="1.8" stroke="none"/><circle class="fill" cx="58" cy="46" r="1.8" stroke="none"/><circle class="fill" cx="64" cy="50" r="1.8" stroke="none"/><circle class="fill" cx="52" cy="51" r="1.6" stroke="none"/>
    <path d="M70 46l14-30M75 47l14-30"/>
    <path d="M20 108h72"/>`),
  // mojito: glass with lime, mint and a straw
  35: svg(`
    <path d="M34 26h52l-8 78H42z"/>
    <path d="M38 50h44"/>
    <circle cx="80" cy="30" r="12"/><path d="M80 18v24M68 30h24M72 22l16 16M88 22L72 38"/>
    <path d="M48 74c6-10 16-10 20-6-4 8-14 10-20 6z"/><path d="M52 88c6-8 14-6 16-2-4 6-12 6-16 2z"/>
    <path d="M58 26l-6-20h-8"/>`),
  // soda with lime
  114: svg(`
    <path d="M38 26h44l-6 78H44z"/>
    <circle cx="54" cy="66" r="2.5"/><circle cx="64" cy="80" r="2"/><circle cx="58" cy="90" r="2.5"/><circle cx="66" cy="56" r="2"/>
    <path d="M44 26a14 14 0 0 1 28 0z"/><path d="M58 26V14"/>`),
  // Mariam Turkish coffee, 250 g bag
  55: svg(`
    <path d="M34 30h52l4 76H30z"/>
    <path d="M34 30l6-12h40l6 12"/><path d="M40 18h40"/>
    <path class="fill" d="M42 56h36v28H42z" stroke="none" opacity=".85"/>
    <path d="M48 70c4-6 8-6 12 0s8 6 12 0"/>`),
};
// one drawing for related items
ITEM_ART[13] = turkish(true);
ITEM_ART[14] = turkish(false);
ITEM_ART[15] = turkish(true, true);
ITEM_ART[16] = turkish(false, true);
ITEM_ART[202] = ART.karak;
ITEM_ART[864] = tallGlass(40);
ITEM_ART[53] = ART.maamoul;
ITEM_ART[208] = ART.maamoul;
ITEM_ART[98] = ART.gift;

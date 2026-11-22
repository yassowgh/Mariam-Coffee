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

// ---------------------------------------------------------------- the rest of the menu, from shared shapes
const S = (body) => svg(body);
const saucer = '<path d="M14 102h80"/>';
const cupBase = (deco = '', fill = true, top = 56) => S(`
  <path d="M22 ${top}h64v${66 - top + 4}a32 32 0 0 1-64 0z"/>
  <path d="M86 ${top + 4}h6a10 10 0 0 1 0 20h-8"/>
  ${fill ? `<path class="fill" d="M26 ${top + 8}h56v${62 - top}a28 28 0 0 1-56 0z" stroke="none"/>` : ''}
  ${saucer}${deco}`);
const smallCup = (deco = '', fillTop = 60) => S(`
  <path d="M36 56h40v10a20 20 0 0 1-40 0z"/>
  <path d="M76 60h4a7 7 0 0 1 0 14h-5"/>
  <path class="fill" d="M39 ${fillTop}h34v6a17 17 0 0 1-34 0z" stroke="none"/>
  <path d="M26 98h60"/>${deco}`);
const glassCup = (deco = '', fillTop = 56) => S(`
  <path d="M38 40h44l-4 56H42z"/>
  <path class="fill" d="M${39 + (fillTop - 40) * 0.07} ${fillTop}h${42 - (fillTop - 40) * 0.14}l-${3.4 - (fillTop - 40) * 0.03} ${92 - fillTop}H43z" stroke="none"/>
  <path d="M28 102h64"/>${deco}`);
const tall = (deco = '', fillTop = 40, ice = true, straw = true) => S(`
  <path d="M38 22h44l-6 82H44z"/>
  <path class="fill" d="M${40 + (fillTop - 22) * 0.07} ${fillTop}h${40 - (fillTop - 22) * 0.14}l-4.6 ${100 - fillTop}H45.6z" stroke="none" opacity=".7"/>
  ${ice ? '<rect x="47" y="46" width="11" height="11" rx="2.5"/><rect x="61" y="54" width="10" height="10" rx="2.5"/>' : ''}
  ${straw ? '<path d="M68 22l10-16h12"/>' : ''}${deco}`);
const cream = '<path d="M38 22c0-10 8-14 12-12 2-6 14-6 16 0 6-2 14 2 16 12z"/>';
const boba = '<circle class="fill" cx="50" cy="96" r="3.4" stroke="none"/><circle class="fill" cx="58" cy="98" r="3.4" stroke="none"/><circle class="fill" cx="66" cy="96" r="3.4" stroke="none"/><circle class="fill" cx="54" cy="90" r="3.4" stroke="none"/><circle class="fill" cx="63" cy="89" r="3.4" stroke="none"/>';
const juice = (garnish = '', bubbles = false) => S(`
  <path d="M38 26h44l-6 78H44z"/>
  <path class="fill" d="M40.6 42h38.8l-4.8 60H45.4z" stroke="none" opacity=".55"/>
  ${bubbles ? '<circle cx="54" cy="70" r="2.4"/><circle cx="66" cy="82" r="2"/><circle cx="58" cy="92" r="2.4"/><circle cx="68" cy="60" r="2"/>' : ''}
  <path d="M66 26l8-18h10"/>${garnish}`);
const citrus = (cx, cy, r = 11) => `<circle cx="${cx}" cy="${cy}" r="${r}"/><path d="M${cx} ${cy - r}v${2 * r}M${cx - r} ${cy}h${2 * r}M${cx - r * 0.7} ${cy - r * 0.7}l${r * 1.4} ${r * 1.4}M${cx + r * 0.7} ${cy - r * 0.7}l-${r * 1.4} ${r * 1.4}"/>`;
const teaCup = (deco = '') => S(`
  <path d="M24 54h60v12a30 30 0 0 1-60 0z"/>
  <path d="M84 58h6a10 10 0 0 1 0 20h-8"/>
  <path class="fill" d="M28 62h52v4a26 26 0 0 1-52 0z" stroke="none" opacity=".6"/>
  <path d="M16 102h76"/>${deco}`);
const bag = (label = '', bean = false) => S(`
  <path d="M34 30h52l4 76H30z"/><path d="M34 30l6-12h40l6 12"/><path d="M40 18h40"/>
  <path class="fill" d="M42 56h36v28H42z" stroke="none" opacity=".85"/>
  ${bean ? '<ellipse cx="60" cy="70" rx="7" ry="10" stroke="#FCF8F4"/><path d="M60 61c-3 6 3 12 0 18" stroke="#FCF8F4"/>' : `<path d="M48 70c4-6 8-6 12 0s8 6 12 0" stroke="#FCF8F4"/>`}${label}`);
const sl = (layers = '', top = '', extra = '') => S(`
  <path d="M14 70l66-30 26 16v28H14z"/><path d="M14 70h92"/><path d="M14 84h92"/>
  ${layers}${top}${extra}`);
const layer = (y, h = 5) => `<path class="fill" d="M14 ${y}h92v${h}H14z" stroke="none"/>`;
const cupcake = (top) => S(`
  <path d="M34 62h52l-8 40H42z"/><path d="M44 62l2 40M56 62v40M68 62l-2 40M78 62l-2 40"/>
  ${top}`);
const croissant = (filling = '') => S(`
  <path d="M14 76c8-24 30-38 46-38s38 14 46 38c-10 6-20 4-26-2-6 8-34 8-40 0-6 6-16 8-26 2z"/>
  <path d="M42 46l6 28M78 46l-6 28M60 38v38"/>${filling}`);
const combo = (side) => S(`
  <path d="M14 52h38v14a19 19 0 0 1-38 0z"/><path d="M52 56h4a7 7 0 0 1 0 14h-5"/>
  <path class="fill" d="M17 58h32v8a16 16 0 0 1-32 0z" stroke="none"/>
  <path d="M10 92h48"/>${side}`);
const sideSlice = '<path d="M62 96l34-18 14 9v13H62z"/><path d="M62 96h48"/>';
const mug = (big = false) => S(`
  <path d="M${big ? 26 : 32} ${big ? 30 : 38}h${big ? 56 : 46}v${big ? 66 : 56}a8 8 0 0 1-8 8H${big ? 34 : 40}a8 8 0 0 1-8-8z"/>
  <path d="M${big ? 82 : 78} ${big ? 44 : 50}h8a12 12 0 0 1 0 24h-8"/>
  <path d="M${big ? 42 : 46} ${big ? 62 : 66}c6-8 12-8 18 0" /><circle cx="${big ? 54 : 55}" cy="${big ? 54 : 58}" r="3"/>`);

Object.assign(ITEM_ART, {
  2: smallCup(steam(50, 62)),
  4: smallCup('<ellipse cx="56" cy="58" rx="8" ry="3" fill="#FCF8F4"/>' + steam(50, 62)),
  5: glassCup('<path d="M40 50h40"/>', 62),
  8: cupBase('<path d="M64 36l20-24M68 38l20-24"/>' + '<circle class="fill" cx="46" cy="58" r="1.6" stroke="none"/><circle class="fill" cx="54" cy="56" r="1.6" stroke="none"/>', false),
  17: cupBase('<path d="M30 54c6-6 12 4 18-2s12 4 18-2 10 2 14 0"/>' + steam(44, 62), true, 58),
  167: cupBase('<path d="M30 52l8 6 8-6 8 6 8-6 8 6 8-6"/>', false),
  164: S('<path d="M30 56h60l-8 44H38z"/><path d="M38 56c0-14 10-20 22-20s22 6 22 20"/><path class="fill" d="M44 80h32l-3 16H47z" stroke="none"/><path d="M84 30l-14 18"/><path d="M20 104h80"/>'),
  12: cupBase('<circle cx="44" cy="52" r="5"/><circle cx="56" cy="50" r="5"/><circle cx="66" cy="53" r="5"/>' + steam(48, 64)),
  172: S('<path d="M20 58h34v14a17 17 0 0 1-34 0z"/><path class="fill" d="M23 62h28v9a14 14 0 0 1-28 0z" stroke="none"/><path d="M12 92h50"/><path d="M70 74h36l-4 28H74z"/><path d="M78 74c0-10 8-16 10-16"/><path d="M92 46l-8 24"/>' + steam(32, 42)),
  171: teaCup(steam(46, 62)),
  22: teaCup(citrus(36, 34, 10) + '<path d="M66 40c4-4 10-4 14 0-2 6-10 6-14 0z"/>'),
  23: teaCup('<path d="M60 52l18-38M65 53l18-38"/>' + steam(40, 50)),
  20: teaCup('<circle cx="40" cy="32" r="5"/><path d="M40 20v6M40 38v6M28 32h6M46 32h6M32 24l4 4M44 36l4 4M48 24l-4 4M32 40l4-4"/>'),
  156: teaCup('<path d="M66 54V28"/><rect x="60" y="18" width="12" height="12" rx="2"/><path d="M30 40c6-10 14-12 18-10-2 8-10 12-18 10z"/>'),
  155: teaCup('<path d="M40 16l-8 16h10l-6 14 16-20H42l6-10z"/>'),
  157: teaCup('<path d="M30 40c4-14 18-16 24-14-2 10-12 18-24 14z"/><path d="M30 40l18-10"/><path d="M60 40c4-10 14-12 18-10-2 8-10 12-18 10z"/>'),
  50: S('<path d="M22 58h76a38 38 0 0 1-76 0z"/><path class="fill" d="M28 62h64a32 30 0 0 1-64 0z" stroke="none" opacity=".45"/><path d="M84 20l-16 30M80 50c-4 4-12 4-14-2"/><path d="M16 104h88"/>'),
  32: tall(cream, 34, false),
  168: tall('<path d="M42 34l6 6 6-6 6 6 6-6 6 6 6-6"/>', 44),
  173: tall('', 32),
  199: tall('<path d="M38 46h44"/>', 30, true, false),
  30: tall('<path d="M40 34h40"/>', 36, true, true),
  26: tall(cream + '<path d="M50 14v-6"/>', 30, false),
  68: tall('<path d="M40 44h40"/>', 44),
  36: tall(boba, 50, false, true),
  28: tall(cream + '<circle cx="60" cy="8" r="4"/><path d="M60 4c2-4 6-4 8-2"/>', 30, false, false),
  42: juice(citrus(84, 28)),
  29: juice('', true),
  31: juice(boba, true),
  862: juice('<path d="M86 22c-6 0-10 6-6 10 4-2 6 2 6 6 4-2 8-2 8-6s-2-10-8-10z"/>' + '<circle cx="54" cy="58" r="3"/><circle cx="64" cy="66" r="3"/>'),
  863: juice('<path d="M86 22c-6 0-10 6-6 10 4-2 6 2 6 6 4-2 8-2 8-6s-2-10-8-10z"/>' + '<rect x="52" y="58" width="9" height="9" rx="2"/>'),
  34: juice('<path d="M42 26c4-8 32-8 36 0"/>'),
  147: juice('<path d="M80 18c10-2 18 6 14 16-8 4-18-2-14-16z"/>'),
  146: juice('<circle cx="86" cy="26" r="11"/><circle cx="86" cy="26" r="4"/>'),
  176: juice('<path d="M84 16c-8 0-12 8-8 16l8 8 8-8c4-8 0-16-8-16z"/><path d="M80 14l4 4 4-4"/>'),
  67: juice(citrus(86, 26)),
  913: juice('<circle cx="86" cy="28" r="11"/><path d="M82 17l4-5 4 5"/><circle cx="83" cy="28" r="1.6"/><circle cx="89" cy="31" r="1.6"/><circle cx="87" cy="24" r="1.6"/>'),
  113: S('<path d="M48 18h24v10l6 10v62a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6V38l6-10z"/><path d="M42 54h36v28H42z"/><circle cx="56" cy="66" r="2.4"/><circle cx="64" cy="72" r="2"/>'),
  6009: S('<path d="M40 26h40v74a6 6 0 0 1-6 6H46a6 6 0 0 1-6-6z"/><path d="M40 26c0-6 4-8 8-8h24c4 0 8 2 8 8"/><path d="M40 52h40M40 82h40"/><path d="M48 66c6-6 18 6 24 0"/>'),
  839: S('<path d="M44 20h32v82a4 4 0 0 1-4 4H48a4 4 0 0 1-4-4z"/><path d="M44 30h32M44 94h32"/><path d="M50 58l10-10 10 10-10 10z"/>'),
  54: S('<path d="M52 12h16v10l6 8v70a6 6 0 0 1-6 6H52a6 6 0 0 1-6-6V30l6-8z"/><path d="M46 50h28M46 80h28"/><path d="M56 62c2 4 6 4 8 0"/>'),
  123: sl(layer(76, 6), '<path class="fill" d="M14 70l66-30 26 16z" stroke="none"/>', '<path d="M40 54l8 6M56 48l8 6M72 42l8 6"/>'),
  193: sl(layer(76, 6), '', '<circle cx="56" cy="44" r="8"/><circle cx="56" cy="44" r="3"/>'),
  902: sl(layer(76, 6), '', '<rect x="46" y="44" width="9" height="9" rx="2"/><rect x="60" y="40" width="9" height="9" rx="2"/><rect x="72" y="46" width="8" height="8" rx="2"/>'),
  209: sl(layer(74, 4) + layer(80, 3), '<path class="fill" d="M14 70l66-30 26 16z" stroke="none" opacity=".6"/>'),
  141: sl('', '<path d="M40 56c4-6 10-6 14 0M60 48c4-6 10-6 14 0"/>', '<path d="M86 30l10-14M90 32l10-14"/>'),
  906: sl(layer(76, 4), '<path d="M46 50l10-4M50 56l10-4"/>', '<path d="M84 26l6 14M86 20l-2 8 6-4"/>'),
  903: sl('', '', citrus(88, 26, 9)),
  901: sl('<path class="fill" d="M24 76c10-6 20 6 30 0s20 6 30 0 14 4 20 2v4H24z" stroke="none" opacity=".8"/>'),
  884: sl(layer(76, 5), '<path d="M40 54c6 4 12-4 18 0s12-4 18 0"/>', '<circle cx="90" cy="30" r="4"/><circle cx="98" cy="38" r="3.4"/>'),
  143: sl(layer(76, 4), '', '<ellipse cx="88" cy="28" rx="6" ry="9"/><path d="M88 20c-3 5 3 11 0 16"/>'),
  621: sl(layer(76, 5), '', '<path d="M82 22c8-4 16 2 14 10-2 8-12 8-14 0z"/>'),
  125: S('<path d="M22 46l26-14 50 14v40l-26 14-50-14z"/><path d="M22 46l50 14 26-14M72 60v40"/><path class="fill" d="M24 49l48 13v36L24 85z" stroke="none" opacity=".85"/>'),
  46: S('<path d="M36 40h48l-6 58H42z"/><path class="fill" d="M38 58h44l-4.6 38H42.6z" stroke="none"/><path d="M38 40c2-10 12-14 22-14s20 4 22 14"/><circle cx="60" cy="20" r="4"/><path d="M26 104h68"/>'),
  186: cupcake('<path class="fill" d="M30 62c0-14 12-22 30-22s30 8 30 22z" stroke="none"/><path d="M30 62c0-14 12-22 30-22s30 8 30 22z"/><path d="M60 40v-8"/>'),
  188: cupcake('<path d="M30 62c0-14 12-22 30-22s30 8 30 22z"/><path d="M40 52l4-2M52 46l3 3M64 48l4-2M72 54l3 2M48 56l4 1"/>'),
  131: S('<circle cx="40" cy="74" r="14"/><circle cx="72" cy="70" r="16"/><circle cx="56" cy="92" r="12"/><path d="M68 64c4 4 8 4 10 0M36 70c4 4 8 4 10 0"/><path d="M18 106h84"/>'),
  198: S('<circle cx="40" cy="74" r="14"/><circle cx="72" cy="70" r="16"/><circle cx="56" cy="92" r="12"/><ellipse cx="40" cy="70" rx="3" ry="5"/><ellipse cx="72" cy="66" rx="3" ry="5"/><path d="M18 106h84"/>'),
  116: S('<rect x="18" y="40" width="38" height="38" rx="4" transform="rotate(-8 37 59)"/><rect x="58" y="50" width="40" height="40" rx="4" transform="rotate(8 78 70)"/><circle cx="34" cy="56" r="1.8"/><circle cx="42" cy="64" r="1.8"/><circle cx="72" cy="66" r="1.8"/><circle cx="82" cy="74" r="1.8"/><circle cx="76" cy="80" r="1.8"/>'),
  38: croissant('<path class="fill" d="M26 76h68v6H26z" stroke="none"/>'),
  39: croissant('<path d="M28 78l6 8M50 80l4 8M72 80l4 8"/>'),
  890: croissant('<path d="M28 78c10 6 54 6 64 0"/>'),
  892: croissant('<path d="M28 78c10 6 54 6 64 0"/><circle cx="60" cy="88" r="3"/>'),
  195: croissant(),
  885: S('<path d="M16 80l44-48 44 48z"/><path d="M16 80v10h88V80"/><path d="M24 76h72"/><path d="M30 70c8 4 16-4 24 0s16-4 24 0 10 2 12 0"/>'),
  302: S('<path d="M16 80l44-48 44 48z"/><path d="M16 80v10h88V80"/><path class="fill" d="M22 74h76v6H22z" stroke="none"/><path d="M40 74l4 8M62 74l4 8"/>'),
  304: combo('<path d="M62 92c4-14 14-22 22-22s18 8 22 22c-6 3-12 2-14-1-4 4-14 4-18 0-2 3-8 4-12 1z"/>'),
  866: combo('<path d="M64 74l18-8 22 8v20l-18 8-22-8z" class="fill" stroke="none" opacity=".85"/><path d="M64 74l18-8 22 8v20l-18 8-22-8z"/>'),
  867: combo('<circle cx="86" cy="86" r="18"/><circle class="fill" cx="80" cy="80" r="3" stroke="none"/><circle class="fill" cx="92" cy="88" r="3" stroke="none"/><circle class="fill" cx="82" cy="94" r="2.4" stroke="none"/>'),
  869: combo(sideSlice + '<path d="M72 88c3-4 7-4 10 0"/>'),
  870: combo(sideSlice + '<path class="fill" d="M62 96l34-18 14 9z" stroke="none" opacity=".6"/>'),
  868: combo('<path class="fill" d="M62 96l34-18 14 9z" stroke="none"/>' + sideSlice),
  56: bag(),
  61: bag('<path d="M54 92h12"/>'),
  62: bag('<path d="M54 92h12"/>'),
  66: bag('', true),
  57: bag('<path d="M50 40l10 12 10-12z"/>'),
  63: S('<path d="M26 60h30l-4 24H30z"/><path d="M24 60h34"/><path d="M64 46h30l-4 24H68z"/><path d="M62 46h34"/><path d="M50 82h30l-4 24H54z"/><path d="M48 82h34"/>'),
  64: bag('<circle cx="60" cy="96" r="5"/><path d="M57 92l3-4 3 4"/>'),
  65: bag('<path d="M54 92h12M56 96h8"/>'),
  110: ART.gift,
  9998: ART.gift,
  9999: ART.gift,
  89: mug(),
  604: mug(true),
  859: S('<path d="M34 30h52l-6 72H40z"/><path d="M44 56c6-8 26-8 32 0M48 70c4-6 20-6 24 0"/><path d="M28 104h64"/>'),
  88: S('<rect x="42" y="18" width="36" height="10" rx="3"/><path d="M44 28h32v72a6 6 0 0 1-6 6H50a6 6 0 0 1-6-6z"/><path d="M44 46h32M52 66c4-6 12-6 16 0"/>'),
  95: ART.cezve,
  75: S('<path d="M26 44h68l-6 60H32z"/><path d="M44 44c0-20 32-20 32 0"/><path d="M42 72l6-6 6 6 6-6 6 6 6-6 6 6M42 82l6-6 6 6 6-6 6 6 6-6 6 6"/>'),
  882: S('<path d="M40 22l-24 14 10 18 12-6v52h44V48l12 6 10-18-24-14c-2 8-10 12-20 12s-18-4-20-12z"/><path d="M46 70l6-6 6 6 6-6 6 6"/>'),
  872: S('<rect x="26" y="40" width="68" height="44" rx="8"/><path d="M26 54h68"/><circle cx="80" cy="68" r="4"/>'),
  76: S('<rect x="18" y="34" width="84" height="54" rx="8"/><path d="M18 50h84"/><path d="M78 62h24v14H78z"/><circle cx="86" cy="69" r="3"/>'),
  82: S('<rect x="34" y="28" width="52" height="68" rx="4"/><path d="M42 28v68"/><path d="M52 52h24M52 62h24"/>'),
  81: S('<rect x="28" y="18" width="64" height="86" rx="4"/><path d="M38 18v86"/><path d="M50 48h30M50 60h30M50 72h22"/>'),
  414: S('<circle cx="60" cy="64" r="38"/><circle cx="60" cy="64" r="28"/><path d="M50 64l10-10 10 10-10 10z"/>'),
  83: S('<circle cx="60" cy="60" r="30"/><circle cx="60" cy="60" r="20"/><path d="M52 60l8-8 8 8-8 8z"/><path d="M60 90v12"/>'),
  80: S('<rect x="24" y="30" width="50" height="50" rx="8" transform="rotate(-8 49 55)"/><path d="M54 84l26-26"/><rect x="52" y="48" width="44" height="44" rx="8" transform="rotate(10 74 70)"/><path d="M64 70c4-6 12-6 16 0"/>'),
  79: S('<rect x="24" y="36" width="72" height="48" rx="6"/><path d="M24 52h72M24 68h72"/><path class="fill" d="M24 36l26 24-26 24z" stroke="none"/>'),
  107: S('<path d="M44 40h32l-4 50H48z"/><path class="fill" d="M46.4 62h27.2l-2.3 26H48.7z" stroke="none"/><path d="M36 100h48"/>'),
  108: S('<path d="M42 34h36l-2 8 6 6-4 56H42z"/><path d="M78 42l10-6"/><path d="M46 60h30"/>'),
  115: S('<path d="M52 14h16v14l8 10v62a6 6 0 0 1-6 6H50a6 6 0 0 1-6-6V38l8-10z"/><path d="M68 14l10-6"/><path d="M44 56h32v26H44z"/>'),
  120: S('<rect x="34" y="26" width="52" height="76" rx="4"/><path d="M34 44h52M34 62h52M34 80h52M60 26v76"/>'),
  109: S('<path d="M38 40h44v52a10 10 0 0 1-10 10H48a10 10 0 0 1-10-10z"/><path d="M34 32h52v8H34z"/><path class="fill" d="M42 60h36v32a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6z" stroke="none" opacity=".7"/><path d="M84 20v24M80 32h8"/>'),
  40: S('<path d="M30 92c-4-30 14-52 40-58-2 28-14 48-40 58z"/><path d="M30 92c10-18 22-32 38-46"/><path d="M56 96c2-22 18-36 38-36-4 20-18 34-38 36z"/><path d="M56 96c10-12 20-22 34-30"/>'),
});

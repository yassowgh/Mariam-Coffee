// Line illustrations in the brand style (drawn as SVG, stroke = currentColor, accent = cream/green via CSS).
const svg = (body, vb = '0 0 120 120') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ART = {
  // big illustrations for the favourites cards
  cezve: svg(`
    <path d="M30 52h44l-6 40a8 8 0 0 1-8 7H44a8 8 0 0 1-8-7z"/>
    <path d="M74 58l30-12"/>
    <path d="M28 52h48"/>
    <path class="fill" d="M33 60h38l-4.2 28a6 6 0 0 1-6 5H43.2a6 6 0 0 1-6-5z" stroke="none"/>
    <path d="M44 40c-4-6 4-8 0-15M56 40c-4-6 4-8 0-15M68 40c-4-6 4-8 0-15"/>
    <circle cx="90" cy="94" r="3"/><circle cx="98" cy="88" r="2.4"/><circle cx="96" cy="99" r="2"/>`),
  karak: svg(`
    <path d="M32 44h50v26a25 25 0 0 1-25 25 25 25 0 0 1-25-25z"/>
    <path d="M82 52h6a10 10 0 0 1 0 20h-7"/>
    <path class="fill" d="M36 52h42v18a21 21 0 0 1-21 21 21 21 0 0 1-21-21z" stroke="none"/>
    <path d="M24 102h68"/>
    <path d="M47 36c-4-6 4-9 0-16M60 36c-4-6 4-9 0-16"/>
    <path d="M96 30l4-6M102 36l7-2M92 24l-1-7"/>`),
  maamoul: svg(`
    <ellipse cx="60" cy="88" rx="44" ry="10"/>
    <path class="fill" d="M30 82c0-16 13-26 30-26s30 10 30 26z" stroke="none"/>
    <path d="M30 82c0-16 13-26 30-26s30 10 30 26z"/>
    <path d="M42 80c2-10 6-16 9-18M60 80V60M78 80c-2-10-6-16-9-18"/>
    <path d="M51 70l4 4M65 70l-4 4"/>
    <path d="M76 40l12-12M84 44l14-6M70 34l2-14"/>`),
  // small category icons
  cup: svg(`<path d="M28 46h56v20a28 28 0 0 1-56 0z"/><path d="M84 54h6a10 10 0 0 1 0 20h-8"/><path d="M48 36c-4-6 4-8 0-14M64 36c-4-6 4-8 0-14"/><path d="M22 100h68"/>`),
  iced: svg(`<path d="M36 30h48l-6 70H42z"/><path d="M38 50h44"/><rect x="48" y="58" width="11" height="11" rx="2"/><rect x="62" y="66" width="10" height="10" rx="2"/><path d="M66 30l8-18h12"/>`),
  glass: svg(`<path d="M36 24h48l-8 76H44z"/><path d="M40 56h40"/><circle cx="54" cy="72" r="3"/><circle cx="66" cy="84" r="2.5"/><circle cx="62" cy="66" r="2"/><path d="M76 24c6-10 14-12 22-10-2 8-8 14-18 14"/>`),
  cake: svg(`<path d="M22 86l60-34 18 12v28H22z"/><path d="M22 86v14h78V92"/><path d="M22 86h78"/><path d="M82 52v-8M82 44c-3-4 3-6 0-10"/><path d="M40 92h8M60 92h8"/>`),
  croissant: svg(`<path d="M18 74c8-24 30-38 42-38s34 14 42 38c-10 6-20 4-26-2-6 8-26 8-32 0-6 6-16 8-26 2z"/><path d="M44 46l6 26M76 46l-6 26M60 36v36"/>`),
  combo: svg(`<path d="M18 56h40v16a20 20 0 0 1-40 0z"/><path d="M58 62h4a7 7 0 0 1 0 14h-5"/><path d="M68 92l30-18 10 8v14H68z"/><path d="M68 92v6h40"/>`),
  bag: svg(`<path d="M34 36h52l6 64H28z"/><path d="M46 36v-8a14 14 0 0 1 28 0v8"/><path d="M50 62c4 6 16 6 20 0"/>`),
  gift: svg(`<path d="M30 46h60v22H30zM34 68h52v32H34z"/><path d="M60 46v54"/><path d="M60 46c-6-14-24-14-20-2 2 4 12 2 20 2zM60 46c6-14 24-14 20-2-2 4-12 2-20 2z"/>`),
};

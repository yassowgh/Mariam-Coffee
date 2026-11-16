// Copies the built-in OCR engine (Tesseract) and its language data (English, Turkish, Arabic) into the
// management app, so invoices can be read in the browser without any outside service or AI limit.
import { copyFileSync, mkdirSync } from 'node:fs';
const out = 'dist/management/ocr';
mkdirSync(out + '/lang', { recursive: true });
copyFileSync('node_modules/tesseract.js/dist/worker.min.js', out + '/worker.min.js');
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) copyFileSync('node_modules/tesseract.js-core/' + f, out + '/' + f);
for (const l of ['eng', 'tur', 'ara']) copyFileSync(`node_modules/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`, `${out}/lang/${l}.traineddata.gz`);
console.log('OCR files copied to', out);

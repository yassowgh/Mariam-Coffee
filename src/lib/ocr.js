// Built-in OCR (Tesseract, runs in this browser): free and unlimited. English, Turkish and Arabic.
// Files are served from our own site (/management/ocr/), nothing is sent anywhere to read the text.
let workerPromise = null;
const base = () => import.meta.env.BASE_URL + 'ocr/';

async function getWorker(progress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      const w = await createWorker(['tur', 'ara', 'eng'], 1, {
        workerPath: base() + 'worker.min.js',
        corePath: base(),
        langPath: base() + 'lang',
        gzip: true,
        logger: (m) => progress?.(m),
      });
      // automatic page layout, and keep the spaces between table columns (qty / price / total)
      await w.setParameters({ tessedit_pageseg_mode: '3', preserve_interword_spaces: '1' });
      return w;
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** Text of one or more images (data URLs). Returns { text, confidence 0–100 }. */
export async function ocrImages(images, progress) {
  const w = await getWorker(progress);
  let text = '', conf = 0;
  for (const img of images) {
    const { data } = await w.recognize(img);
    text += data.text + '\n';
    conf += data.confidence;
  }
  return { text: text.trim(), confidence: images.length ? conf / images.length : 0 };
}

// Reading the words inside a picture, so they can be selected and copied.
//
// A screenshot of an error message, a photo of a whiteboard, a receipt — the
// text in them is the reason they were kept, and until now it was the one
// thing in a note that could not be copied out of it. This is the Live Text
// idea from a phone camera roll: the picture stays a picture, and the words
// on it quietly become words.
//
// Everything runs here, on the machine, out of files inside the extension —
// see scripts/vendor-ocr.mjs for why nothing is fetched. Recognition is a
// second or two of a busy core, so it happens in a worker, one picture at a
// time, and the answer is kept: a picture's words are read once, ever.

import { IMAGES, META, getOne, put } from "./db.js";
// The ESM build ships one default export — the whole Tesseract namespace —
// rather than named ones.
import Tesseract from "./vendor/tesseract/tesseract.esm.js";

const { createWorker } = Tesseract;

// Both languages at once. Turkish is Latin, so English alone reads most of a
// Turkish note — but it reads "ı", "ğ" and "ş" wrong, which is exactly the
// text somebody would be copying out to fix.
const LANGS = "eng+tur";
const LSTM_ONLY = 1; // the modern engine; the legacy one is a second model to ship

const VENDOR = new URL("./vendor/tesseract/", import.meta.url).href;

// Under 96px there is nothing to read — an icon, a spacer, a signature.
const TOO_SMALL = 96;
// Tesseract reports a confidence per word. Below this they are usually
// speckle read as punctuation, and a stray "|" you cannot see but can select
// is worse than a gap.
const MIN_CONFIDENCE = 45;

const cacheKey = (imgId) => `ocr:${imgId}`;

let engine = null;

/**
 * The worker, started on first use.
 *
 * Nothing is loaded until somebody opens a picture: 7MB of model has no
 * business being read on a new tab that is only ever used to write a note.
 */
function start() {
  if (!engine) {
    engine = createWorker(LANGS, LSTM_ONLY, {
      // A classic worker from inside the extension. The default wraps the
      // script in a blob URL, which an extension page's CSP will not run.
      workerPath: `${VENDOR}worker.min.js`,
      workerBlobURL: false,
      // Named outright rather than as a directory, so the worker does not go
      // feature-detecting its way to a core we do not ship.
      corePath: `${VENDOR}tesseract-core-simd-lstm.js`,
      langPath: VENDOR,
    }).catch((err) => {
      engine = null; // a failed start should not poison every later attempt
      throw err;
    });
  }
  return engine;
}

// One picture at a time. Two recognitions in parallel is two copies of the
// model in memory competing for the same core, and the second one is always
// for a frame the reader has already moved on from.
let queue = Promise.resolve();

function enqueue(job) {
  const run = queue.then(job, job);
  // The chain must not break on a failed job, and must not hold the result.
  queue = run.then(() => {}, () => {});
  return run;
}

/**
 * The words in a stored image, as fractions of its size.
 *
 * Fractions rather than pixels because the only thing that ever reads them is
 * a layer laid over the picture at whatever size it is being shown.
 *
 * @returns { text, words: [{ t, x, y, w, h }] } or null if there are none.
 */
export async function textIn(imgId) {
  const cached = await getOne(META, cacheKey(imgId)).catch(() => null);
  if (cached) return cached.words.length ? cached : null;

  const record = await getOne(IMAGES, imgId).catch(() => null);
  if (!record || !record.blob) return null;

  const found = await enqueue(() => read(imgId, record.blob));
  return found && found.words.length ? found : null;
}

async function read(imgId, blob) {
  let size;
  try {
    const bitmap = await createImageBitmap(blob);
    size = { w: bitmap.width, h: bitmap.height };
    bitmap.close();
  } catch (err) {
    return null;
  }
  if (size.w < TOO_SMALL || size.h < TOO_SMALL) return null;

  let data;
  try {
    const worker = await start();
    ({ data } = await worker.recognize(blob, {}, { text: true, blocks: true }));
  } catch (err) {
    // A picture that cannot be read is not an error the board should hear
    // about: the gallery simply offers nothing, exactly as it did before.
    console.warn("Easy Note: could not read that image —", err);
    return null;
  }

  const words = [];
  // blocks -> paragraphs -> lines -> words, which is Tesseract's own idea of
  // the page. Only the words are wanted; the shape above them is the layout
  // of the picture, not of anything being copied out of it.
  (data.blocks || []).forEach((block) =>
    (block.paragraphs || []).forEach((paragraph) =>
      (paragraph.lines || []).forEach((line) =>
        (line.words || []).forEach((word) => {
          const text = (word.text || "").trim();
          if (!text || word.confidence < MIN_CONFIDENCE) return;
          const { x0, y0, x1, y1 } = word.bbox;
          words.push({
            t: text,
            x: x0 / size.w,
            y: y0 / size.h,
            w: (x1 - x0) / size.w,
            h: (y1 - y0) / size.h,
          });
        })
      )
    )
  );

  const found = { text: (data.text || "").trim(), words };
  // Kept even when empty: a picture with no writing on it should be asked
  // once and then left alone.
  await put(META, { id: cacheKey(imgId), ...found, at: Date.now() }).catch(() => {});
  return found;
}

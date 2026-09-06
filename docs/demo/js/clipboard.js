// Reading the clipboard without a paste gesture.
//
// A real paste carries its data with it and costs nothing. Asking for the
// clipboard cold — from a menu, or from ⌘P — goes through Chrome's own
// one-time permission prompt instead, so every caller has to be ready for
// "no": this returns null rather than throwing, and the caller decides what
// an empty clipboard means.

/**
 * @returns {Promise<{html: string, text: string, blobs: Blob[]} | null>}
 */
export async function readClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.read) return null;
  try {
    const items = await navigator.clipboard.read();
    const out = { html: "", text: "", blobs: [] };
    for (const item of items) {
      const image = item.types.find((t) => t.startsWith("image/"));
      if (image) out.blobs.push(await item.getType(image));
      if (item.types.includes("text/html")) out.html = await (await item.getType("text/html")).text();
      if (item.types.includes("text/plain")) out.text = await (await item.getType("text/plain")).text();
    }
    return out;
  } catch (err) {
    return null; // no permission, or nothing readable on the clipboard
  }
}

/** Whether there is anything in a clipboard reading worth pasting. */
export function hasContent(content) {
  return !!content && !!(content.html || content.text || content.blobs.length);
}

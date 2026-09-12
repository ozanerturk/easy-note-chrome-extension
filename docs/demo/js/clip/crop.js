// Where a selection drawn on the page lands in the captured image.
//
// Its own module because it is the one piece of the clipper that is pure
// arithmetic — and the one most likely to be wrong on a scaled display, where
// nothing about a half-pixel error is visible until the crop is off by a row.

/**
 * @param rect   the selection in viewport CSS pixels
 * @param scale  captured device pixels per CSS pixel
 * @param bounds the captured image's own {width, height}
 * @returns the crop in device pixels, or null if it holds nothing
 */
export function deviceRect(rect, scale, bounds) {
  // Round outwards so a half-pixel edge is included rather than shaved off,
  // then clamp: a selection can only ever describe pixels the capture holds.
  const left = Math.max(0, Math.floor(rect.x * scale));
  const top = Math.max(0, Math.floor(rect.y * scale));
  const right = Math.min(bounds.width, Math.ceil((rect.x + rect.width) * scale));
  const bottom = Math.min(bounds.height, Math.ceil((rect.y + rect.height) * scale));
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

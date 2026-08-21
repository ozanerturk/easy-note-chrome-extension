import { META, getOne, put } from "./db.js";

// One record holds every preference. Reading it into a cache first means a
// write for one setting cannot clobber another — which is exactly what
// happened when each setting put its own object.
let cache = { id: "prefs" };

export async function loadPrefs() {
  cache = (await getOne(META, "prefs")) || { id: "prefs" };
  return cache;
}

export function getPref(key, fallback = false) {
  return cache[key] ?? fallback;
}

export function setPref(key, value) {
  cache = { ...cache, id: "prefs", [key]: value };
  return put(META, cache).catch(() => {});
}

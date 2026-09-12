// Google sign-in via chrome.identity.
//
// getAuthToken only issues a token when the *running* extension's id matches
// the id registered against the OAuth client in Google Cloud Console. Unpacked
// builds derive their id from the folder path, so a manifest `key` is required
// to pin it — see docs/SYNC.md. Failures here are almost always that mismatch,
// so the error is surfaced verbatim rather than swallowed.

const IDENTITY = typeof chrome !== "undefined" && chrome.identity;

export function available() {
  return !!IDENTITY;
}

function raw(interactive) {
  return new Promise((resolve, reject) => {
    IDENTITY.getAuthToken({ interactive }, (token) => {
      const err = chrome.runtime.lastError;
      if (err || !token) return reject(new Error(err ? err.message : "no token"));
      resolve(token);
    });
  });
}

let cached = null;

export async function getToken({ interactive = false } = {}) {
  if (cached) return cached;
  if (!IDENTITY) throw new Error("chrome.identity unavailable");
  cached = await raw(interactive);
  return cached;
}

// Called when Drive answers 401: the cached token is stale, so drop it from
// Chrome's cache too or the next request gets the same dead token back.
export async function invalidate() {
  if (!cached) return;
  const token = cached;
  cached = null;
  await new Promise((resolve) => IDENTITY.removeCachedAuthToken({ token }, resolve));
}

export async function signIn() {
  await invalidate();
  cached = await raw(true);
  return cached;
}

export async function signOut() {
  const token = cached;
  cached = null;
  if (!token) return;
  await new Promise((resolve) => IDENTITY.removeCachedAuthToken({ token }, resolve));
  // Best effort: revoke so the next sign-in re-prompts for consent.
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: "POST",
    });
  } catch (e) {
    /* offline is fine; the local token is already gone */
  }
}

export async function signedIn() {
  try {
    await getToken({ interactive: false });
    return true;
  } catch (e) {
    return false;
  }
}

export async function profile() {
  const token = await getToken({ interactive: false });
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

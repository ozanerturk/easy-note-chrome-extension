// Minimal Drive v3 client scoped to appDataFolder — a hidden per-user folder
// that never appears in My Drive. Only the calls sync actually needs.

import { getToken, invalidate } from "./auth.js";

const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const SPACE = "appDataFolder";

// One retry on 401: tokens expire, and the cached one has to be dropped before
// asking for another or Chrome hands back the same dead token.
async function authed(url, init = {}, retry = true) {
  const token = await getToken({ interactive: false });
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 && retry) {
    await invalidate();
    return authed(url, init, false);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

export async function list() {
  const params = new URLSearchParams({
    spaces: SPACE,
    pageSize: "1000",
    fields: "files(id,name,modifiedTime,size)",
  });
  const res = await authed(`${FILES}?${params}`);
  const { files } = await res.json();
  return files || [];
}

export async function findByName(name) {
  const files = await list();
  return files.find((f) => f.name === name) || null;
}

export async function downloadText(fileId) {
  const res = await authed(`${FILES}/${fileId}?alt=media`);
  return res.text();
}

export async function downloadBlob(fileId) {
  const res = await authed(`${FILES}/${fileId}?alt=media`);
  return res.blob();
}

function multipart(metadata, blob) {
  const boundary = `en${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(metadata),
    `\r\n--${boundary}\r\nContent-Type: ${blob.type || "application/octet-stream"}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--\r\n`,
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

export async function upload({ fileId, name, blob }) {
  // A new file must declare the appDataFolder parent; an update must not.
  const metadata = fileId ? { name } : { name, parents: [SPACE] };
  const { body, contentType } = multipart(metadata, blob);
  const url = fileId
    ? `${UPLOAD}/${fileId}?uploadType=multipart&fields=id,modifiedTime`
    : `${UPLOAD}?uploadType=multipart&fields=id,modifiedTime`;
  const res = await authed(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  return res.json();
}

export function uploadJson({ fileId, name, data }) {
  return upload({
    fileId,
    name,
    blob: new Blob([JSON.stringify(data)], { type: "application/json" }),
  });
}

export async function remove(fileId) {
  await authed(`${FILES}/${fileId}`, { method: "DELETE" });
}

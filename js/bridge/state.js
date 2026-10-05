// What the bridge remembers, in one `meta` record — enabled, this profile's
// instance id, and the last status. The worker is the only writer: the page
// asks it to change things by message and hears back on a BroadcastChannel,
// so there is no cross-context write to race and no `storage` permission to
// ask for. (Not synced: only notes, pages and lists go to Drive, which is
// right — whether a device bridges is that device's business.)

import { META, openOnce, getOne, put } from "../db.js";

const ID = "bridge";
export const CHANNEL = "easynote-bridge";

export const STATUSES = ["off", "connecting", "connected", "auth_required", "unreachable"];

export async function readState() {
  await openOnce();
  return (await getOne(META, ID)) || { id: ID, enabled: false, status: "off" };
}

export async function writeState(fields) {
  const next = { ...(await readState()), ...fields, id: ID };
  await put(META, next);
  return next;
}

import type { DriveReader, DriveResult } from "../drive/reader.js";
import type { CallResult } from "./calls.js";
import * as offline from "../offline/tools.js";
import { OfflineError } from "../offline/tools.js";
import type { When } from "../shared/query.js";

type Live = { call(sub: string, tool: string, args: unknown): Promise<CallResult> };

const fail = (code: "NOT_CONNECTED" | "INTERNAL" | "NOT_FOUND", message: string): CallResult => ({ ok: false, error: { code, message } });

const NOT_CONNECTED =
  "Easy Note isn't connected. Ask the user to open Chrome and make sure 'Connect to Claude' is enabled in Easy Note settings.";

const MESSAGES: Record<Exclude<DriveResult["status"], "ok">, string> = {
  none: `${NOT_CONNECTED} The notes can't be read from Google Drive either: ask the user to remove and add the Easy Note connector in Claude once more, to allow that.`,
  reauth: `${NOT_CONNECTED} The access to Google Drive was removed: ask the user to remove and add the Easy Note connector in Claude once more.`,
  nodoc: "Easy Note isn't connected, and no synced notes were found in the user's Google Drive. Ask the user to open Easy Note signed in with Google so their notes sync.",
  error: "Easy Note isn't connected, and the notes couldn't be read from Google Drive just now. Try again in a moment.",
};

const stamp = (source: "browser" | "drive", asOf: number | null, result: unknown): CallResult => ({
  ok: true,
  data: { source, asOf: asOf ? new Date(asOf).toISOString() : null, result },
});

// Ask the open browser first — it is always the freshest. If there is none (or
// it did not answer) a read is answered from the user's own Drive instead, and
// says so, with when that copy was last written. Adding to the tray is never
// retried or redirected: it needs the browser, and doing it twice is worse than
// not doing it.
export function createRouter(deps: { hub: Live; drive?: DriveReader }) {
  return {
    async call(sub: string, tool: string, args: unknown): Promise<CallResult> {
      const live = await deps.hub.call(sub, tool, args);
      if (live.ok) return stamp("browser", null, live.data);

      const unreachable = live.error.code === "NOT_CONNECTED" || live.error.code === "TIMEOUT";
      if (!unreachable || tool === "capture" || !deps.drive) return live;

      const loaded = await deps.drive.load(sub);
      if (loaded.status !== "ok") return fail("NOT_CONNECTED", MESSAGES[loaded.status]);

      try {
        const a = args as Record<string, never>;
        let data: unknown;
        if (tool === "search_notes") data = offline.searchNotes(loaded.doc, a as never);
        else if (tool === "get_note") data = offline.getNote(loaded.doc, a as never);
        else if (tool === "list_reminders") data = offline.listReminders(loaded.doc, a as unknown as { when: When; timezone: string; limit: number });
        else return live;
        return stamp("drive", loaded.asOf, data);
      } catch (err) {
        if (err instanceof OfflineError) return fail(err.code, err.message);
        return fail("INTERNAL", "Couldn't read the notes.");
      }
    },
  };
}

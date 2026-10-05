import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import pino from "pino";

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "token", "authorization", "args", "data", "result", "text", "query",
      "*.token", "*.authorization", "*.args", "*.data", "*.result", "*.text", "*.query",
    ],
    censor: "[redacted]",
  },
});

// logs never carry the raw sub, only a short stable hash of it
export function hashSub(sub: string): string {
  return createHash("sha256").update(sub).digest("hex").slice(0, 12);
}

// method, path, status, duration — never bodies, headers or query strings
export function requestLog(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // originalUrl, since req.path is relative to wherever a router is mounted;
    // the query string is cut off — it carries OAuth state and codes
    const path = req.originalUrl.split("?")[0];
    log.info({ method: req.method, path, status: res.statusCode, ms: Math.round(ms) }, "request");
  });
  next();
}

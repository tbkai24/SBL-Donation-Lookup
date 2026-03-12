import type { VercelRequest, VercelResponse } from "@vercel/node";
import { lookupDonationByCode } from "./_lib/lookup";

type RateLimitEntry = {
  count: number;
  windowStart: number;
};

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

const globalRateLimitStore = globalThis as typeof globalThis & {
  __sblRateLimit?: Map<string, RateLimitEntry>;
};

if (!globalRateLimitStore.__sblRateLimit) {
  globalRateLimitStore.__sblRateLimit = new Map<string, RateLimitEntry>();
}

const rateLimit = globalRateLimitStore.__sblRateLimit;

function getClientIp(req: VercelRequest): string {
  const xff = req.headers["x-forwarded-for"];
  if (Array.isArray(xff) && xff.length > 0) {
    return String(xff[0]).split(",")[0].trim();
  }
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
}

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const hit = rateLimit.get(ip);
  if (!hit || now - hit.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimit.set(ip, { count: 1, windowStart: now });
    return false;
  }

  hit.count += 1;
  if (hit.count > RATE_LIMIT_MAX_REQUESTS) {
    return true;
  }
  return false;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, message: "Method not allowed.", records: [] });
  }

  if (isRateLimited(getClientIp(req))) {
    return res.status(429).json({ ok: false, message: "Too many requests. Please try again later.", records: [] });
  }

  const code = String(req.query.code || "").trim();
  if (!code) {
    return res.status(400).json({ ok: false, message: "Missing donation code.", records: [] });
  }

  try {
    const result = await lookupDonationByCode(code);
    return res.status(200).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lookup failed.";
    console.error("Lookup failed", error);
    return res.status(500).json({
      ok: false,
      message: process.env.NODE_ENV === "production" ? "Lookup service temporarily unavailable." : `Lookup failed: ${message}`,
      records: []
    });
  }
}

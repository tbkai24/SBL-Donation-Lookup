const { lookupDonationByCode } = require("./_lib/lookup");

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;

if (!global.__sblRateLimit) {
  global.__sblRateLimit = new Map();
}

const rateLimit = global.__sblRateLimit;

function getClientIp(req) {
  const headers = req.headers || {};
  const xff = headers["x-forwarded-for"];
  if (Array.isArray(xff) && xff.length > 0) {
    return String(xff[0]).split(",")[0].trim();
  }
  if (typeof xff === "string" && xff.trim()) {
    return xff.split(",")[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const hit = rateLimit.get(ip);
  if (!hit || now - hit.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimit.set(ip, { count: 1, windowStart: now });
    return false;
  }

  hit.count += 1;
  return hit.count > RATE_LIMIT_MAX_REQUESTS;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, message: "Method not allowed.", records: [] });
  }

  if (isRateLimited(getClientIp(req))) {
    return res.status(429).json({ ok: false, message: "Too many requests. Please try again later.", records: [] });
  }

  const query = req.query || {};
  const code = String(query.code || "").trim();
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
};


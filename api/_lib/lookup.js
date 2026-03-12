const CACHE_TTL_MS = 5 * 60 * 1000;

if (!global.__sblLookupCache) {
  global.__sblLookupCache = new Map();
}

const cache = global.__sblLookupCache;

function envList(name) {
  return String(process.env[name] || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getFromCache(code) {
  const hit = cache.get(code);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(code);
    return null;
  }
  return hit.value;
}

function setCache(code, value) {
  cache.set(code, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function formatDate(raw) {
  const value = String(raw || "").trim();
  const gvizMatch = value.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/);
  if (gvizMatch) {
    const year = Number(gvizMatch[1]);
    const month = Number(gvizMatch[2]) + 1;
    const day = Number(gvizMatch[3]);
    const mm = String(month).padStart(2, "0");
    const dd = String(day).padStart(2, "0");
    return `${year}-${mm}-${dd}`;
  }

  const ymd = value.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymd) {
    const year = ymd[1];
    const month = String(Number(ymd[2])).padStart(2, "0");
    const day = String(Number(ymd[3])).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return value;
}

function normalizeRecord(input) {
  return {
    sourceSpreadsheetId: String(input.sourceSpreadsheetId || input.spreadsheetId || "apps-script"),
    sourceSheet: String(input.sourceSheet || input.sheet || ""),
    fullname: String(input.fullname || input.name || ""),
    modeOfTransfer: String(input.modeOfTransfer || input.mode || ""),
    amount: String(input.amount || ""),
    dateOfTransfer: formatDate(String(input.dateOfTransfer || input.date || "")),
    refNo: String(input.refNo || input.referenceNo || input.reference || "")
  };
}

function buildResultFromUnknown(data) {
  if (!data || typeof data !== "object") return null;
  const obj = data;

  if (Array.isArray(obj.records)) {
    const records = obj.records.filter((x) => x && typeof x === "object").map(normalizeRecord);
    const ok = records.length > 0;
    return { ok, message: ok ? "Found." : String(obj.message || "No donation found with this code."), records };
  }

  if (Array.isArray(obj.data)) {
    const records = obj.data.filter((x) => x && typeof x === "object").map(normalizeRecord);
    const ok = records.length > 0;
    return { ok, message: ok ? "Found." : String(obj.message || "No donation found with this code."), records };
  }

  if (typeof obj.ok === "boolean" && typeof obj.message === "string" && Array.isArray(obj.records)) {
    const records = obj.records.filter((x) => x && typeof x === "object").map(normalizeRecord);
    return { ok: Boolean(obj.ok) && records.length > 0, message: obj.message, records };
  }

  return null;
}

async function lookupViaAppsScript(code) {
  const base = String(process.env.APPS_SCRIPT_URL || "").trim();
  if (!base) return null;

  const token = String(process.env.APPS_SCRIPT_TOKEN || "").trim();
  const url = new URL(base);
  url.searchParams.set("code", code);
  if (token) url.searchParams.set("token", token);

  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    throw new Error(`Apps Script lookup failed with HTTP ${response.status}.`);
  }

  const raw = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Apps Script response is not valid JSON.");
  }

  const result = buildResultFromUnknown(parsed);
  if (!result) {
    throw new Error("Apps Script response format is unsupported.");
  }

  return result;
}

function parseGvizJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Unexpected gviz response format.");
  }
  const payload = JSON.parse(text.slice(start, end + 1));
  const rows = (payload && payload.table && payload.table.rows) || [];
  return rows.map((row) => {
    const cells = (row && row.c) || [];
    return cells.map((cell) => String((cell && cell.v) ?? ""));
  });
}

async function fetchPublicRange(spreadsheetId, sheetName, rangeA1) {
  const url =
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq` +
    `?sheet=${encodeURIComponent(sheetName)}` +
    `&range=${encodeURIComponent(rangeA1)}` +
    `&tqx=out:json`;
  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return { rows: null, hadError: true };
    const text = await response.text();
    return { rows: parseGvizJson(text), hadError: false };
  } catch {
    return { rows: null, hadError: true };
  }
}

async function lookupDonationByCode(codeInput) {
  const code = String(codeInput || "").trim();
  if (!code) {
    return { ok: false, message: "Missing donation code.", records: [] };
  }

  const cached = getFromCache(code);
  if (cached) return cached;

  const viaAppsScript = await lookupViaAppsScript(code);
  if (viaAppsScript) {
    setCache(code, viaAppsScript);
    return viaAppsScript;
  }

  const spreadsheetIds = envList("SPREADSHEET_IDS");
  const sheetNames = envList("SHEET_NAMES");
  if (!spreadsheetIds.length || !sheetNames.length) {
    throw new Error("SPREADSHEET_IDS or SHEET_NAMES is not configured.");
  }

  const matches = [];
  let hadAnySourceError = false;
  let hadAtLeastOneReadableSheet = false;

  for (const spreadsheetId of spreadsheetIds) {
    const perSheetMatches = await Promise.all(
      sheetNames.map(async (sheetName) => {
        const { rows, hadError } = await fetchPublicRange(spreadsheetId, sheetName, "C2:O");
        const localMatches = [];
        if (hadError || !rows) {
          hadAnySourceError = true;
          return localMatches;
        }
        hadAtLeastOneReadableSheet = true;

        for (let r = 0; r < rows.length; r += 1) {
          const row = rows[r] || [];
          const rowCode = String(row[12] || "").trim();
          if (rowCode !== code) continue;

          localMatches.push({
            sourceSpreadsheetId: spreadsheetId,
            sourceSheet: sheetName,
            fullname: String(row[0] || ""),
            modeOfTransfer: String(row[3] || ""),
            amount: String(row[4] || ""),
            dateOfTransfer: formatDate(String(row[5] || "")),
            refNo: String(row[6] || "")
          });
        }
        return localMatches;
      })
    );

    for (const group of perSheetMatches) matches.push(...group);
  }

  if (!hadAtLeastOneReadableSheet && hadAnySourceError) {
    throw new Error("Lookup source is temporarily unavailable.");
  }

  const uniqueMap = new Map();
  for (const row of matches) {
    const key = [row.fullname, row.amount, row.dateOfTransfer, row.modeOfTransfer, row.refNo].join("|");
    if (!uniqueMap.has(key)) uniqueMap.set(key, row);
  }

  const uniqueRecords = Array.from(uniqueMap.values());
  const payload = uniqueRecords.length
    ? { ok: true, message: "Found.", records: uniqueRecords }
    : { ok: false, message: "No donation found with this code.", records: [] };

  setCache(code, payload);
  return payload;
}

module.exports = { lookupDonationByCode };


type DonationRecord = {
  sourceSpreadsheetId: string;
  sourceSheet: string;
  fullname: string;
  modeOfTransfer: string;
  amount: string;
  dateOfTransfer: string;
  refNo: string;
};

type LookupResult = {
  ok: boolean;
  message: string;
  records: DonationRecord[];
};

type CacheEntry = {
  value: LookupResult;
  expiresAt: number;
};

type RangeFetchResult = {
  rows: string[][] | null;
  hadError: boolean;
};

type UnknownRecord = Record<string, unknown>;

const CACHE_TTL_MS = 5 * 60 * 1000;
const globalCache = globalThis as typeof globalThis & {
  __sblLookupCache?: Map<string, CacheEntry>;
};

if (!globalCache.__sblLookupCache) {
  globalCache.__sblLookupCache = new Map<string, CacheEntry>();
}

const cache = globalCache.__sblLookupCache;

function envList(name: string): string[] {
  return (process.env[name] || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getFromCache(code: string): LookupResult | null {
  const hit = cache.get(code);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(code);
    return null;
  }
  return hit.value;
}

function setCache(code: string, value: LookupResult) {
  cache.set(code, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function normalizeRecord(input: UnknownRecord): DonationRecord {
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

function buildResultFromUnknown(data: unknown): LookupResult | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as UnknownRecord;

  if (Array.isArray(obj.records)) {
    const records = (obj.records as unknown[])
      .filter((x): x is UnknownRecord => Boolean(x) && typeof x === "object")
      .map(normalizeRecord);
    const ok = records.length > 0;
    return {
      ok,
      message: ok ? "Found." : String(obj.message || "No donation found with this code."),
      records
    };
  }

  if (Array.isArray(obj.data)) {
    const records = (obj.data as unknown[])
      .filter((x): x is UnknownRecord => Boolean(x) && typeof x === "object")
      .map(normalizeRecord);
    const ok = records.length > 0;
    return {
      ok,
      message: ok ? "Found." : String(obj.message || "No donation found with this code."),
      records
    };
  }

  if (
    typeof obj.ok === "boolean" &&
    typeof obj.message === "string" &&
    Array.isArray(obj.records)
  ) {
    const records = (obj.records as unknown[])
      .filter((x): x is UnknownRecord => Boolean(x) && typeof x === "object")
      .map(normalizeRecord);
    return { ok: Boolean(obj.ok) && records.length > 0, message: obj.message, records };
  }

  return null;
}

async function lookupViaAppsScript(code: string): Promise<LookupResult | null> {
  const base = String(process.env.APPS_SCRIPT_URL || "").trim();
  if (!base) return null;

  const token = String(process.env.APPS_SCRIPT_TOKEN || "").trim();
  const url = new URL(base);
  url.searchParams.set("code", code);
  if (token) {
    url.searchParams.set("token", token);
  }

  const response = await fetch(url.toString(), { method: "GET" });
  if (!response.ok) {
    throw new Error(`Apps Script lookup failed with HTTP ${response.status}.`);
  }

  const raw = await response.text();
  let parsed: unknown;
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

function formatDate(raw: string): string {
  const value = String(raw || "").trim();
  const gvizMatch = value.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})\)$/);
  if (gvizMatch) {
    const year = Number(gvizMatch[1]);
    const month = Number(gvizMatch[2]) + 1; // gviz month is zero-based
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

function parseGvizJson(text: string): string[][] {
  // Response format: google.visualization.Query.setResponse({...});
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Unexpected gviz response format.");
  }

  const payload = JSON.parse(text.slice(start, end + 1));
  const rows = payload?.table?.rows || [];
  return rows.map((row: { c?: Array<{ v?: unknown }> }) => {
    const cells = row?.c || [];
    return cells.map((cell) => String(cell?.v ?? ""));
  });
}

async function fetchPublicRange(
  spreadsheetId: string,
  sheetName: string,
  rangeA1: string
): Promise<RangeFetchResult> {
  const url =
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq` +
    `?sheet=${encodeURIComponent(sheetName)}` +
    `&range=${encodeURIComponent(rangeA1)}` +
    `&tqx=out:json`;

  try {
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
      return { rows: null, hadError: true };
    }

    const text = await response.text();
    return { rows: parseGvizJson(text), hadError: false };
  } catch {
    return { rows: null, hadError: true };
  }
}

export async function lookupDonationByCode(codeInput: string): Promise<LookupResult> {
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

  const matches: DonationRecord[] = [];
  let hadAnySourceError = false;
  let hadAtLeastOneReadableSheet = false;

  for (const spreadsheetId of spreadsheetIds) {
    const perSheetMatches = await Promise.all(
      sheetNames.map(async (sheetName) => {
        const { rows, hadError } = await fetchPublicRange(spreadsheetId, sheetName, "C2:O");
        const localMatches: DonationRecord[] = [];
        if (hadError || !rows) {
          hadAnySourceError = true;
          return localMatches;
        }
        hadAtLeastOneReadableSheet = true;

        for (let r = 0; r < rows.length; r++) {
          const row = rows[r] || [];
          // C..O range: donation code is column O (index 12 in this row slice).
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

    for (const group of perSheetMatches) {
      matches.push(...group);
    }
  }

  if (!hadAtLeastOneReadableSheet && hadAnySourceError) {
    throw new Error("Lookup source is temporarily unavailable.");
  }

  const uniqueMap = new Map<string, DonationRecord>();
  for (const row of matches) {
    const key = [
      row.fullname,
      row.amount,
      row.dateOfTransfer,
      row.modeOfTransfer,
      row.refNo
    ].join("|");
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, row);
    }
  }

  const uniqueRecords = Array.from(uniqueMap.values());
  const payload: LookupResult = uniqueRecords.length
    ? { ok: true, message: "Found.", records: uniqueRecords }
    : { ok: false, message: "No donation found with this code.", records: [] };

  setCache(code, payload);
  return payload;
}

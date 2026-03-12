import { KeyboardEvent, useRef, useState } from "react";

type DonationRecord = {
  sourceSpreadsheetId: string;
  sourceSheet: string;
  fullname: string;
  modeOfTransfer: string;
  amount: string;
  dateOfTransfer: string;
  refNo: string;
};

type LookupResponse = {
  ok: boolean;
  message: string;
  records: DonationRecord[];
};

const API_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");

export default function App() {
  const [donationCode, setDonationCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [records, setRecords] = useState<DonationRecord[]>([]);
  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const year = new Date().getFullYear();

  async function lookupDonation() {
    const code = donationCode.trim();
    if (!code) {
      setError("Please enter a donation code.");
      setRecords([]);
      return;
    }

    setLoading(true);
    setError("");
    setRecords([]);
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const base = API_BASE || "";
      const response = await fetch(`${base}/api/lookup?code=${encodeURIComponent(code)}`, {
        signal: controller.signal
      });
      const contentType = response.headers.get("content-type") || "";
      const rawBody = await response.text();
      let data: LookupResponse;

      try {
        data = JSON.parse(rawBody) as LookupResponse;
      } catch {
        const isHtml = rawBody.trim().startsWith("<");
        const hint = isHtml
          ? "API returned HTML instead of JSON. For local dev, run `npm run vercel:dev` for the API or set `VITE_API_BASE`."
          : "API response is not valid JSON.";
        throw new Error(`${hint} (status ${response.status}, content-type: ${contentType || "unknown"})`);
      }

      if (!response.ok) {
        throw new Error(data.message || `HTTP ${response.status}`);
      }
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (!data.ok) {
        setError(data.message || "No donation found with this code.");
        return;
      }

      setRecords(data.records);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(`Request failed: ${message}`);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }

  function handleEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      lookupDonation();
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <img
            src="https://pbs.twimg.com/profile_images/1895433493825638400/Q5VzuIET_400x400.jpg"
            alt="Solid Block Link Logo"
          />
          <span>Solid Block Link</span>
        </div>
      </header>

      <main className="main">
        <section className="card">
          <img
            className="hero"
            src="https://pbs.twimg.com/profile_images/1895433493825638400/Q5VzuIET_400x400.jpg"
            alt="Solid Block Link"
          />
          <h1>Donation Lookup</h1>
          <p className="subtext">Enter your donation code to view your verified contribution details.</p>

          <input
            type="text"
            value={donationCode}
            onChange={(e) => setDonationCode(e.target.value)}
            onKeyDown={handleEnter}
            placeholder="Enter your donation code"
          />
          <button type="button" onClick={lookupDonation}>
            Check Donation
          </button>

          {loading && <div className="notice">Checking...</div>}
          {!loading && error && <div className="error">{error}</div>}
          {!loading && records.length > 0 && (
            <div className="result">
              {records.map((r, idx) => (
                <div key={`${r.sourceSpreadsheetId}-${r.sourceSheet}-${r.refNo}-${idx}`}>
                  <strong>Name:</strong> {r.fullname}
                  <br />
                  <strong>Amount Donated:</strong> PHP {r.amount}
                  <br />
                  <strong>Date of Transfer:</strong> {r.dateOfTransfer}
                  <br />
                  <strong>Mode of Transfer:</strong> {r.modeOfTransfer}
                  <br />
                  <strong>Reference No.:</strong> {r.refNo}
                  <br />
                  {idx < records.length - 1 && <hr />}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>&copy; {year} Solid Block Link</p>
      </footer>
    </>
  );
}

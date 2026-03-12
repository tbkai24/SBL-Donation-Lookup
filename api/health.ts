export default function handler(_req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) {
  res.status(200).json({
    ok: true,
    message: "SBL Donation Lookup API is running."
  });
}

module.exports = function handler(_req, res) {
  res.status(200).json({
    ok: true,
    message: "SBL Donation Lookup API is running."
  });
};


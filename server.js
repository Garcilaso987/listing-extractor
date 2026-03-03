import express from "express";
import { extractListing } from "./extractor.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || ""; // si está vacío, no pide key

function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  const got = req.header("x-api-key");
  if (got && got === API_KEY) return next();
  return res.status(401).json({ error: "unauthorized", message: "API key inválida o faltante" });
}

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.post("/extract-listing", requireApiKey, async (req, res) => {
  const { url, timeoutMs = 30000, includeImages = true, includeRawText = false } = req.body || {};
  if (!url || typeof url !== "string") {
    return res.status(400).json({ error: "invalid_request", message: "Falta 'url' (string)" });
  }
  try {
    const result = await extractListing({ url, timeoutMs, includeImages, includeRawText });
    return res.json(result);
  } catch (e) {
    return res.status(500).json({ error: "internal_error", message: e?.message || "Error interno" });
  }
});

app.listen(PORT, () => console.log(`Listening on ${PORT}`));

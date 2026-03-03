import { chromium } from "playwright";

function detectSource(u) {
  const host = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
  if (host.includes("wallapop")) return "wallapop";
  if (host.includes("autoscout24")) return "autoscout24";
  if (host.includes("coches.net")) return "cochesnet";
  if (host.includes("milanuncios")) return "milanuncios";
  return "unknown";
}

async function getJsonLd(page) {
  const scripts = await page.$$eval('script[type="application/ld+json"]', els =>
    els.map(e => e.textContent || "")
  );
  const out = [];
  for (const txt of scripts) {
    try {
      const parsed = JSON.parse(txt);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {}
  }
  return out;
}

function toNumber(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function pickFirst(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && `${v}`.trim() !== "") return v;
  return undefined;
}

function normalizeFromJsonLd(jsonlds) {
  let product;
  for (const obj of jsonlds) {
    const t = obj?.["@type"];
    if (t === "Product" || t === "Vehicle" || t === "Car" || (Array.isArray(t) && t.some(x => ["Product","Vehicle","Car"].includes(x)))) {
      product = obj; break;
    }
  }
  if (!product) {
    for (const obj of jsonlds) {
      const g = obj?.["@graph"];
      if (Array.isArray(g)) {
        const found = g.find(x => ["Product","Vehicle","Car"].includes(x?.["@type"]));
        if (found) { product = found; break; }
      }
    }
  }

  const offer = product?.offers || product?.offer;
  const price = pickFirst(offer?.price, offer?.lowPrice, offer?.highPrice);
  const currency = pickFirst(offer?.priceCurrency, "EUR");

  const images = Array.isArray(product?.image) ? product.image : (product?.image ? [product.image] : undefined);

  return {
    title: pickFirst(product?.name),
    description: pickFirst(product?.description),
    images,
    price: price !== undefined ? { amount: toNumber(price), currency } : undefined
  };
}

async function fallbackText(page, includeImages) {
  const title = await page.title().catch(() => undefined);
  const rawText = await page.evaluate(() => (document.body?.innerText || "").trim()).catch(() => "");
  let priceFormatted;
  const m = rawText.match(/(\d{1,3}(\.\d{3})*|\d+)\s*€|€\s*(\d{1,3}(\.\d{3})*|\d+)/);
  if (m) priceFormatted = m[0].replace(/\s+/g, " ").trim();

  const images = includeImages
    ? await page.$$eval("img", imgs =>
        imgs.map(i => i.getAttribute("src") || i.getAttribute("data-src") || "")
            .filter(u => u && u.startsWith("http"))
            .slice(0, 20)
      ).catch(() => undefined)
    : undefined;

  return { title, rawText, priceFormatted, images };
}

export async function extractListing({ url, timeoutMs, includeImages, includeRawText }) {
  const source = detectSource(url);
  const extractedAt = new Date().toISOString();
  const warnings = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: "es-ES",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(1500);

    const jsonlds = await getJsonLd(page);
    const base = normalizeFromJsonLd(jsonlds);
    const fb = await fallbackText(page, includeImages);

    const listing = {
      title: pickFirst(base.title, fb.title),
      description: pickFirst(base.description),
      price: base.price?.amount ? { ...base.price, formatted: undefined } :
             (fb.priceFormatted ? { amount: toNumber(fb.priceFormatted), currency: "EUR", formatted: fb.priceFormatted } : undefined),
      images: includeImages ? pickFirst(base.images, fb.images) : undefined
    };

    const html = await page.content().catch(() => "");
    if (/captcha|recaptcha|access denied|robot/i.test(html)) {
      warnings.push("Posible bloqueo (captcha/anti-bot). Puede que falten datos.");
    }

    let status = "ok";
    if (!listing.title || !listing.price) status = "partial";
    if (!listing.title) warnings.push("No se pudo detectar el título.");
    if (!listing.price) warnings.push("No se pudo detectar el precio.");

    const out = { source, url, extractedAt, status, warnings, listing };
    if (includeRawText) out.rawText = fb.rawText || "";
    return out;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

// Team saves for the dashboard: list, open, save and delete shared datasets.
// Storage: Vercel Blob (connect a Blob store to the project; it sets BLOB_READ_WRITE_TOKEN).
// Access: TEAM_PASSCODE opens team data; TEAM_ADMIN_PASSCODE (optional) is needed to save or delete.
// If TEAM_ADMIN_PASSCODE is not set, TEAM_PASSCODE can also save and delete.
// Blob URLs are random and never sent to the browser; every read goes through this function.
const { put, list, del } = require("@vercel/blob");
const crypto = require("crypto");

const MAX_BODY = 4 * 1024 * 1024; // Vercel functions accept up to 4.5 MB per request
const ID_RE = /^[a-z0-9]{8,40}$/;

function same(a, b) {
  const x = crypto.createHash("sha256").update(String(a || "")).digest();
  const y = crypto.createHash("sha256").update(String(b || "")).digest();
  return crypto.timingSafeEqual(x, y);
}
function roleOf(req) {
  const key = String(req.headers["x-team-key"] || "");
  const view = process.env.TEAM_PASSCODE || "";
  const admin = process.env.TEAM_ADMIN_PASSCODE || view;
  if (!key) return null;
  if (admin && same(key, admin)) return "admin";
  if (view && same(key, view)) return "view";
  return null;
}
function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) { const e = new Error("This data is too large for one team save (over 4 MB compressed). Save a shorter date range."); e.status = 413; reject(e); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function listAll(prefix) {
  let out = [], cursor;
  do {
    const r = await list({ prefix, cursor, limit: 1000 });
    out = out.concat(r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  return out;
}
async function fetchBlob(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error("Storage read failed (" + r.status + ")");
  return r;
}
function cleanMeta(m) {
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  const files = m && typeof m.files === "object" && m.files !== null && JSON.stringify(m.files).length < 8000 ? m.files : {};
  const avail = m && m.avail && typeof m.avail === "object" ? { min: num(m.avail.min), max: num(m.avail.max) } : null;
  return {
    name: String((m && m.name) || "Team data").replace(/\s+/g, " ").trim().slice(0, 120) || "Team data",
    files,
    metaRows: num(m && m.metaRows),
    crmRows: num(m && m.crmRows),
    avail,
    enc: m && m.enc === "gz" ? "gz" : "json",
  };
}
async function removeId(id) {
  const blobs = (await listAll("team/data/" + id + "/")).concat(await listAll("team/meta/" + id + "/"));
  if (blobs.length) await del(blobs.map((b) => b.url));
}

module.exports = async function handler(req, res) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.TEAM_PASSCODE) {
      return send(res, 503, { setup: false, error: "Team saving is not set up on this site yet." });
    }
    const role = roleOf(req);
    if (!role) return send(res, 401, { error: "Wrong or missing team passcode." });
    const url = new URL(req.url, "http://localhost");
    const id = url.searchParams.get("id") || "";
    if (id && !ID_RE.test(id)) return send(res, 400, { error: "Bad id." });

    if (req.method === "GET" && url.searchParams.has("ping")) return send(res, 200, { ok: true, role });

    if (req.method === "GET" && !id) {
      const metas = await listAll("team/meta/");
      const items = await Promise.all(metas.map((b) => fetchBlob(b.url).then((r) => r.json()).catch(() => null)));
      const datasets = items.filter(Boolean).sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1));
      return send(res, 200, { role, datasets });
    }

    if (req.method === "GET" && id) {
      const blobs = await listAll("team/data/" + id + "/");
      if (!blobs.length) return send(res, 404, { error: "This team data no longer exists." });
      const r = await fetchBlob(blobs[0].url);
      const buf = Buffer.from(await r.arrayBuffer());
      res.statusCode = 200;
      res.setHeader("content-type", "application/octet-stream");
      res.setHeader("cache-control", "no-store");
      return res.end(buf);
    }

    if (req.method === "POST") {
      if (role !== "admin") return send(res, 403, { error: "This passcode can open team data but not save it." });
      let raw = {};
      try { raw = JSON.parse(Buffer.from(String(req.headers["x-meta"] || ""), "base64").toString("utf8") || "{}"); } catch (e) { return send(res, 400, { error: "Bad request." }); }
      const body = await readBody(req);
      if (!body.length) return send(res, 400, { error: "Nothing to save." });
      const newId = Date.now().toString(36) + crypto.randomBytes(5).toString("hex");
      const meta = Object.assign(cleanMeta(raw), { id: newId, savedAt: new Date().toISOString(), bytes: body.length });
      await put("team/data/" + newId + "/payload.bin", body, { access: "public", addRandomSuffix: true, contentType: "application/octet-stream" });
      await put("team/meta/" + newId + "/meta.json", JSON.stringify(meta), { access: "public", addRandomSuffix: true, contentType: "application/json" });
      if (raw.replaceId && ID_RE.test(raw.replaceId) && raw.replaceId !== newId) await removeId(raw.replaceId).catch(() => {});
      return send(res, 200, meta);
    }

    if (req.method === "DELETE" && id) {
      if (role !== "admin") return send(res, 403, { error: "This passcode can open team data but not delete it." });
      await removeId(id);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: "Method not allowed." });
  } catch (e) {
    console.error(e);
    return send(res, e.status || 500, { error: e.status ? e.message : "Server error: " + e.message });
  }
};

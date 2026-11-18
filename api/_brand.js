// Shared 3-level campaign -> brand resolver used across all API routes and background syncs.
// Priority:
//   1. S.campaignBrands[campaign.trim().toLowerCase()] (Direct manual campaign override — ALWAYS wins)
//   2. acc.brand (Dedicated ad account brand)
//   3. S.keywords rules top-to-bottom: [word, brand, optionalExcludeCsv]
//      Matches when campaign contains `word` (case-insensitive) AND contains NONE of `optionalExcludeCsv`.
//   4. Fallback ("Unmapped" by default, or custom fallback)

function clean(v) {
  return String(v == null ? "" : v).trim().replace(/\s+/g, " ");
}

function campKey(name) {
  return clean(name).toLowerCase();
}

function splitExcl(ex) {
  return String(ex || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function makeBrandResolver(S, opt) {
  opt = opt || {};
  const fallback = opt.fallback !== undefined ? opt.fallback : "Unmapped";
  const overrides = {};
  const rawOv = S && S.campaignBrands && typeof S.campaignBrands === "object" ? S.campaignBrands : {};
  Object.keys(rawOv).forEach((k) => {
    const ck = campKey(k);
    const b = clean(rawOv[k]);
    if (ck && b) overrides[ck] = b;
  });

  const kws = ((S && S.keywords) || [])
    .filter((k) => k && k[0] && k[1])
    .map((k) => [String(k[0]).trim().toLowerCase(), clean(k[1]), splitExcl(k[2])]);

  const byKeyword = (name) => {
    const s = String(name || "").toLowerCase();
    if (!s) return fallback;
    for (let i = 0; i < kws.length; i++) {
      const k = kws[i];
      if (s.indexOf(k[0]) >= 0) {
        if (k[2].length && k[2].some((ex) => s.indexOf(ex) >= 0)) continue;
        return k[1];
      }
    }
    return fallback;
  };

  const forAccountCampaign = (acc, name) => {
    const ck = campKey(name);
    if (ck && overrides[ck]) return overrides[ck];
    if (acc && acc.brand) return clean(acc.brand);
    return byKeyword(name);
  };

  const forCampaign = (name, acc) => forAccountCampaign(acc || null, name);

  return { overrides, kws, byKeyword, forCampaign, forAccountCampaign };
}

module.exports = { makeBrandResolver, campKey, splitExcl };

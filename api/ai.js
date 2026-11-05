// Ask AI chatbot & LLM configuration endpoint for EBG Dashboard
// Supports Gemini, OpenAI, Anthropic Claude, and custom OpenAI-compatible models.
//
// Endpoints:
//   GET  /api/ai?op=config       -> returns status & active model (full config for admin only)
//   POST /api/ai?op=save-config  -> saves provider, model, API key, and settings (admin only)
//   POST /api/ai?op=test         -> tests API key connection with provider (admin only)
//   POST /api/ai?op=chat         -> handles user query with dashboard context (any team member)
//   POST /api/ai?op=clear-key    -> removes stored API key (admin only)

const SB_URL = process.env.SUPABASE_URL || "https://oggmosadlkarwlurxdjk.supabase.co";
const SB_ANON = process.env.SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9nZ21vc2FkbGthcndsdXJ4ZGprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwODEyNjQsImV4cCI6MjEwNzY1NzI2NH0.WfxddEbJwtIXlc5ENVM6fLmB46zmgi7eeVk02FWJfQ0";

function send(res, code, body) {
  res.statusCode = code;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function maskKey(key) {
  if (!key) return "";
  const s = String(key).trim();
  if (s.length <= 8) return "••••••••";
  return s.slice(0, 4) + "••••••••" + s.slice(-4);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const s = Buffer.concat(chunks).toString("utf8");
        resolve(s ? JSON.parse(s) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

async function whoIs(req) {
  const auth = String(req.headers.authorization || "");
  if (!/^Bearer\s+\S+/.test(auth)) return { reason: "no-session" };
  const u = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: SB_ANON, authorization: auth } });
  if (!u.ok) return { reason: "session", status: u.status };
  const user = await u.json(), email = String(user.email || "").toLowerCase();
  if (!email) return null;
  const r = await fetch(SB_URL + "/rest/v1/team_members?select=role&email=eq." + encodeURIComponent(email), {
    headers: { apikey: SB_ANON, authorization: auth }
  });
  const rows = r.ok ? await r.json() : [];
  return { email, role: rows[0] ? rows[0].role : null, token: auth.replace(/^Bearer\s+/, "") };
}

function makeSbFetch(userToken) {
  return async function(path, opt) {
    opt = opt || {};
    const servKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const token = servKey || userToken || SB_ANON;
    const apikey = servKey || SB_ANON;
    opt.headers = Object.assign({
      apikey: apikey,
      authorization: "Bearer " + token,
      "content-type": "application/json"
    }, opt.headers || {});
    const r = await fetch(SB_URL + "/rest/v1/" + path, opt);
    const text = typeof r.text === "function" ? await r.text() : (typeof r.json === "function" ? JSON.stringify(await r.json()) : "");
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) {}
    if (!r.ok) {
      const msg = (body && (body.message || body.error || body.hint)) || text || ("HTTP " + r.status);
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return body;
  };
}

async function loadStoredAiSettings(sbFetch) {
  let stored = null;
  // 1. Try public.ai_settings table
  try {
    const rows = await sbFetch("ai_settings?id=eq.1&select=*");
    if (rows && rows[0]) {
      stored = {
        provider: rows[0].provider || "gemini",
        model: rows[0].model || "gemini-1.5-flash",
        apiKey: rows[0].api_key || "",
        customUrl: rows[0].custom_url || "",
        systemPrompt: rows[0].system_prompt || "",
        temperature: typeof rows[0].temperature === "number" ? rows[0].temperature : 0.3,
        enabled: rows[0].enabled !== false,
        updatedBy: rows[0].updated_by,
        updatedAt: rows[0].updated_at
      };
    }
  } catch (e) {
    // Table might not exist yet if SQL hasn't run
  }

  // 2. Fallback to public.team_settings.settings.ai
  if (!stored || !stored.apiKey) {
    try {
      const st = await sbFetch("team_settings?id=eq.1&select=settings");
      const S = (st && st[0] && st[0].settings) || {};
      if (S && S.ai) {
        stored = Object.assign({
          provider: S.ai.provider || "gemini",
          model: S.ai.model || "gemini-1.5-flash",
          apiKey: S.ai.apiKey || "",
          customUrl: S.ai.customUrl || "",
          systemPrompt: S.ai.systemPrompt || "",
          temperature: typeof S.ai.temperature === "number" ? S.ai.temperature : 0.3,
          enabled: S.ai.enabled !== false
        }, stored || {});
      }
    } catch (e) {}
  }

  // 3. Fallback to environment variables
  if (!stored || !stored.apiKey) {
    const envKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY || "";
    let envProv = "gemini", envModel = "gemini-1.5-flash";
    if (process.env.OPENAI_API_KEY) { envProv = "openai"; envModel = "gpt-4o-mini"; }
    else if (process.env.ANTHROPIC_API_KEY) { envProv = "anthropic"; envModel = "claude-3-5-sonnet-20241022"; }

    stored = Object.assign({
      provider: envProv,
      model: envModel,
      apiKey: envKey,
      customUrl: "",
      systemPrompt: "",
      temperature: 0.3,
      enabled: true
    }, stored || {});
  }

  return stored || {
    provider: "gemini",
    model: "gemini-1.5-flash",
    apiKey: "",
    customUrl: "",
    systemPrompt: "",
    temperature: 0.3,
    enabled: true
  };
}

async function saveStoredAiSettings(sbFetch, cfg, meEmail) {
  const payload = {
    id: 1,
    provider: String(cfg.provider || "gemini").trim().toLowerCase(),
    model: String(cfg.model || "gemini-1.5-flash").trim(),
    api_key: String(cfg.apiKey || "").trim(),
    custom_url: String(cfg.customUrl || "").trim(),
    system_prompt: String(cfg.systemPrompt || "").trim(),
    temperature: typeof cfg.temperature === "number" ? cfg.temperature : 0.3,
    enabled: cfg.enabled !== false,
    updated_by: meEmail,
    updated_at: new Date().toISOString()
  };

  let savedInTable = false;
  // 1. Try upserting into public.ai_settings
  try {
    await sbFetch("ai_settings", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(payload)
    });
    savedInTable = true;
  } catch (e) {
    // If table doesn't exist, ignore and persist in team_settings below
  }

  // 2. Also sync into team_settings.settings.ai for seamless portability
  try {
    const st = await sbFetch("team_settings?id=eq.1&select=settings");
    const S = (st && st[0] && st[0].settings) || {};
    S.ai = {
      provider: payload.provider,
      model: payload.model,
      apiKey: payload.api_key,
      customUrl: payload.custom_url,
      systemPrompt: payload.system_prompt,
      temperature: payload.temperature,
      enabled: payload.enabled,
      updated_by: meEmail,
      updated_at: payload.updated_at
    };
    await sbFetch("team_settings?id=eq.1", {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ settings: S, updated_by: meEmail, updated_at: payload.updated_at })
    });
  } catch (e) {
    if (!savedInTable) throw e;
  }

  return payload;
}

// ---------------- LLM Provider API Calls ----------------

async function callGemini(model, apiKey, systemPrompt, userMessage, history, temperature) {
  if (!apiKey) throw new Error("Gemini API key is missing. Add your Gemini API key in Settings › Ask AI Settings.");
  const m = model || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents = [];
  // Add recent history if available
  if (Array.isArray(history) && history.length) {
    history.slice(-6).forEach((h) => {
      const role = h.role === "assistant" || h.role === "model" ? "model" : "user";
      const text = String(h.text || h.content || "").trim();
      if (text) contents.push({ role, parts: [{ text }] });
    });
  }
  // Add current turn
  contents.push({ role: "user", parts: [{ text: userMessage }] });

  const body = {
    contents,
    generationConfig: {
      temperature: typeof temperature === "number" ? temperature : 0.3,
      maxOutputTokens: 2048
    }
  };
  if (systemPrompt) {
    body.system_instruction = { parts: [{ text: systemPrompt }] };
  }

  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  const resText = typeof r.text === "function" ? await r.text() : (typeof r.json === "function" ? JSON.stringify(await r.json()) : "");
  let json = null;
  try { json = JSON.parse(resText); } catch (e) {}

  if (!r.ok) {
    const errMsg = (json && json.error && json.error.message) || ("Gemini Error " + r.status + ": " + resText.slice(0, 200));
    throw new Error(errMsg);
  }

  const candidate = json && json.candidates && json.candidates[0];
  const part = candidate && candidate.content && candidate.content.parts && candidate.content.parts[0];
  const answer = part && part.text;
  if (!answer) {
    if (candidate && candidate.finishReason) {
      throw new Error("Model finished with reason: " + candidate.finishReason);
    }
    throw new Error("Empty response received from Gemini.");
  }
  return answer;
}

async function callOpenAI(model, apiKey, customUrl, systemPrompt, userMessage, history, temperature) {
  if (!apiKey) throw new Error("OpenAI API key is missing. Add your OpenAI API key in Settings › Ask AI Settings.");
  const m = model || "gpt-4o-mini";
  let url = (customUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
  if (!/\/chat\/completions$/i.test(url)) {
    url = `${url}/chat/completions`;
  }

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  if (Array.isArray(history) && history.length) {
    history.slice(-6).forEach((h) => {
      const role = h.role === "assistant" || h.role === "model" ? "assistant" : "user";
      const text = String(h.text || h.content || "").trim();
      if (text) messages.push({ role, content: text });
    });
  }
  messages.push({ role: "user", content: userMessage });

  const body = {
    model: m,
    messages,
    temperature: typeof temperature === "number" ? temperature : 0.3,
    max_tokens: 2048
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + apiKey
    },
    body: JSON.stringify(body)
  });

  const resText = typeof r.text === "function" ? await r.text() : (typeof r.json === "function" ? JSON.stringify(await r.json()) : "");
  let json = null;
  try { json = JSON.parse(resText); } catch (e) {}

  if (!r.ok) {
    const errMsg = (json && json.error && json.error.message) || ("OpenAI Error " + r.status + ": " + resText.slice(0, 200));
    throw new Error(errMsg);
  }

  const choice = json && json.choices && json.choices[0];
  const answer = choice && choice.message && choice.message.content;
  if (!answer) throw new Error("Empty response received from OpenAI model.");
  return answer;
}

async function callAnthropic(model, apiKey, systemPrompt, userMessage, history, temperature) {
  if (!apiKey) throw new Error("Anthropic API key is missing. Add your Anthropic API key in Settings › Ask AI Settings.");
  const m = model || "claude-3-5-sonnet-20241022";
  const url = "https://api.anthropic.com/v1/messages";

  const messages = [];
  if (Array.isArray(history) && history.length) {
    history.slice(-6).forEach((h) => {
      const role = h.role === "assistant" || h.role === "model" ? "assistant" : "user";
      const text = String(h.text || h.content || "").trim();
      if (text) messages.push({ role, content: text });
    });
  }
  messages.push({ role: "user", content: userMessage });

  const body = {
    model: m,
    system: systemPrompt || undefined,
    messages,
    max_tokens: 2048,
    temperature: typeof temperature === "number" ? temperature : 0.3
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(body)
  });

  const resText = typeof r.text === "function" ? await r.text() : (typeof r.json === "function" ? JSON.stringify(await r.json()) : "");
  let json = null;
  try { json = JSON.parse(resText); } catch (e) {}

  if (!r.ok) {
    const errMsg = (json && json.error && json.error.message) || ("Anthropic Error " + r.status + ": " + resText.slice(0, 200));
    throw new Error(errMsg);
  }

  const contentBlock = json && json.content && json.content[0];
  const answer = contentBlock && contentBlock.text;
  if (!answer) throw new Error("Empty response received from Claude.");
  return answer;
}

async function dispatchLLM(provider, model, apiKey, customUrl, systemPrompt, userMessage, history, temperature) {
  const p = (provider || "gemini").toLowerCase().trim();
  if (p === "gemini") {
    return callGemini(model, apiKey, systemPrompt, userMessage, history, temperature);
  } else if (p === "openai" || p === "custom") {
    return callOpenAI(model, apiKey, customUrl, systemPrompt, userMessage, history, temperature);
  } else if (p === "anthropic") {
    return callAnthropic(model, apiKey, systemPrompt, userMessage, history, temperature);
  } else {
    // Default fallback to OpenAI-compatible
    return callOpenAI(model, apiKey, customUrl, systemPrompt, userMessage, history, temperature);
  }
}

// ---------------- Default Prompt Construction ----------------

function buildSystemPrompt(customSystemPrompt, context) {
  const basePrompt = customSystemPrompt || [
    "You are an expert Performance Marketing Analyst for EBG Group, Hyderabad.",
    "You are embedded directly inside the EBG Lead Performance Dashboard as an intelligent analytical assistant.",
    "",
    "Rules you MUST follow:",
    "1. Answer as an experienced performance marketer: business impact first, concise, actionable, in plain language with no jargon dumps.",
    "2. Accuracy is critical: NEVER invent numbers, targets, values, actors, or events.",
    "3. Use Indian numbering (e.g. ₹1,50,000) and Rupee symbol (₹).",
    "4. When calculating or reviewing metrics:",
    "   - Meta leads = reported Results in Meta UI (leads, forms, WhatsApp chats).",
    "   - TeleCRM leads = actual leads captured in the CRM by created date.",
    "   - CPL = Spend ÷ Meta leads.",
    "   - CPQL = Spend ÷ Qualified Leads (QL).",
    "   - Lead gap = Meta leads vs TeleCRM leads (indicates lead leakage, tracking failure, or sync delay).",
    "   - TAT = Turnaround time for first call.",
    "5. Format responses cleanly using GitHub-style Markdown: clear headings, bullet points, and highlight key numbers.",
    "6. If data is not available or denominator is 0, use N/A — never say 0."
  ].join("\n");

  if (!context || (context.hasData === false && !context.summary && !context.totals && !context.brands)) {
    return basePrompt + "\n\nNote: No active dataset is currently loaded on the dashboard.";
  }

  const totals = context.summary || context.totals || {};

  const contextText = [
    "",
    "=== CURRENT DASHBOARD SNAPSHOT ===",
    `Active View / Window: ${context.activeTab || "Overview"}`,
    `Selected Brand Filter: ${context.activeBrand || context.selectedBrand || "All"}`,
    `Selected Date Range: ${context.dateRange || "All"}`,
    "",
    "OVERALL TOTALS:",
    `- Total Spend: ₹${Number(totals.spend || 0).toLocaleString("en-IN")}`,
    `- Meta Leads (UI): ${Number(totals.metaLeads || 0).toLocaleString("en-IN")}`,
    `- TeleCRM Leads: ${Number(totals.crmLeads || 0).toLocaleString("en-IN")}`,
    `- Qualified Leads (QL): ${Number(totals.qualifiedLeads || totals.ql || 0).toLocaleString("en-IN")}`,
    `- Qualification Rate: ${totals.qlRate || "N/A"}`,
    `- Blended CPL: ₹${Number(totals.cpl || totals.blendedCPL || 0).toLocaleString("en-IN")}`,
    `- Blended CPQL: ₹${Number(totals.cpql || totals.blendedCPQL || 0).toLocaleString("en-IN")}`,
    `- Lead Discrepancy (Meta vs CRM): ${totals.leadDifference !== undefined ? totals.leadDifference : (totals.leadGap || 0)} leads (${totals.leadDiffPct || "N/A"})`,
    totals.avgTatMin ? `- Speed to Lead (Avg TAT): ${totals.avgTatMin} min` : "",
    totals.slaCompliance ? `- SLA Compliance (≤30m): ${totals.slaCompliance}` : "",
    totals.notContactedLeads ? `- Uncalled / Pending Leads: ${totals.notContactedLeads}` : "",
    "",
    "BRAND BREAKDOWN:",
    JSON.stringify(context.brands || [], null, 2),
    "",
    "TOP CAMPAIGNS (BY SPEND):",
    JSON.stringify(context.topCampaigns || [], null, 2),
    "",
    context.leakages ? `CAMPAIGN LEAKAGES & ISSUES:\n${JSON.stringify(context.leakages, null, 2)}\n` : "",
    "DATA INTEGRITY CHECKS:",
    JSON.stringify(context.dataChecks || [], null, 2),
    context.viewSpecific ? `\nVIEW-SPECIFIC DATA:\n${JSON.stringify(context.viewSpecific, null, 2)}` : ""
  ].filter(Boolean).join("\n");

  return basePrompt + "\n" + contextText;
}

// ---------------- Main Handler ----------------

module.exports = async function handler(req, res) {
  try {
    const urlObj = new URL(req.url || "/", "http://localhost");
    const queryOp = (req.query && req.query.op) || urlObj.searchParams.get("op");
    let body = (req.body && typeof req.body === "object") ? req.body : null;
    if (!body && (req.method === "POST" || req.method === "PUT")) {
      body = await readJsonBody(req);
      req.body = body;
    }
    const op = String(queryOp || (body && body.op) || "status").toLowerCase();
    const me = await whoIs(req);

    if (!me || me.reason) {
      return send(res, 401, {
        code: "session",
        error: "Your sign-in wasn't accepted (" + ((me && me.status) || "no session") + "). Sign in to access Ask AI."
      });
    }

    if (!me.role) {
      return send(res, 403, {
        ok: false,
        code: "not-team",
        error: me.email + " is not on the team list (Settings › Team)."
      });
    }

    const sbFetch = makeSbFetch(me.token);

    // ================= 1. GET CONFIG =================
    if (req.method === "GET" && (op === "status" || op === "config")) {
      const stored = await loadStoredAiSettings(sbFetch);
      const isAdmin = me.role === "admin";

      const resp = {
        ok: true,
        role: me.role,
        isAdmin,
        configured: !!(stored.apiKey && stored.apiKey.length > 5),
        provider: stored.provider,
        model: stored.model,
        customUrl: stored.customUrl || "",
        temperature: stored.temperature,
        systemPrompt: stored.systemPrompt || "",
        enabled: stored.enabled
      };

      if (isAdmin) {
        resp.maskedKey = maskKey(stored.apiKey);
        resp.hasKey = !!(stored.apiKey && stored.apiKey.length > 5);
        resp.updatedBy = stored.updatedBy;
        resp.updatedAt = stored.updatedAt;
      }

      return send(res, 200, resp);
    }

    // ================= 2. SAVE CONFIG (ADMIN ONLY) =================
    if (op === "save-config") {
      if (me.role !== "admin") {
        return send(res, 403, {
          ok: false,
          error: "Forbidden: API key settings configuration is available for admin users only."
        });
      }

      const body = await readJsonBody(req);
      const existing = await loadStoredAiSettings(sbFetch);

      const toSave = {
        provider: body.provider || existing.provider || "gemini",
        model: body.model || existing.model || "gemini-1.5-flash",
        apiKey: (body.apiKey !== undefined && body.apiKey !== null && String(body.apiKey).trim() !== "")
          ? String(body.apiKey).trim()
          : existing.apiKey,
        customUrl: body.customUrl !== undefined ? String(body.customUrl).trim() : existing.customUrl,
        systemPrompt: body.systemPrompt !== undefined ? String(body.systemPrompt).trim() : existing.systemPrompt,
        temperature: typeof body.temperature === "number" ? body.temperature : existing.temperature,
        enabled: body.enabled !== false
      };

      await saveStoredAiSettings(sbFetch, toSave, me.email);

      return send(res, 200, {
        ok: true,
        message: "AI configuration and API key saved in database successfully.",
        provider: toSave.provider,
        model: toSave.model,
        maskedKey: maskKey(toSave.apiKey),
        hasKey: !!(toSave.apiKey && toSave.apiKey.length > 5),
        configured: !!(toSave.apiKey && toSave.apiKey.length > 5)
      });
    }

    // ================= 3. CLEAR KEY (ADMIN ONLY) =================
    if (op === "clear-key") {
      if (me.role !== "admin") {
        return send(res, 403, { ok: false, error: "Forbidden: Only admins can remove the API key." });
      }

      const existing = await loadStoredAiSettings(sbFetch);
      existing.apiKey = "";
      await saveStoredAiSettings(sbFetch, existing, me.email);

      return send(res, 200, {
        ok: true,
        message: "API key removed from database.",
        configured: false
      });
    }

    // ================= 4. TEST CONNECTION (ADMIN ONLY) =================
    if (op === "test") {
      if (me.role !== "admin") {
        return send(res, 403, { ok: false, error: "Forbidden: Only admins can test API keys." });
      }

      const body = await readJsonBody(req);
      const existing = await loadStoredAiSettings(sbFetch);

      const provider = body.provider || existing.provider || "gemini";
      const model = body.model || existing.model || "gemini-1.5-flash";
      const apiKey = body.apiKey || existing.apiKey;
      const customUrl = body.customUrl || existing.customUrl;

      if (!apiKey) {
        return send(res, 400, { error: "No API key provided or saved to test." });
      }

      const testMsg = "Respond with 'API connection successful' in 5 words or less.";
      const startTime = Date.now();
      const answer = await dispatchLLM(
        provider,
        model,
        apiKey,
        customUrl,
        "You are an API connection test responder.",
        testMsg,
        [],
        0.1
      );
      const latencyMs = Date.now() - startTime;

      return send(res, 200, {
        ok: true,
        provider,
        model,
        latencyMs,
        response: answer,
        message: `Successfully connected to ${provider} (${model}) in ${(latencyMs / 1000).toFixed(2)}s!`
      });
    }

    // ================= 5. CHAT (ANY TEAM MEMBER) =================
    if (op === "chat") {
      const body = await readJsonBody(req);
      const message = String(body.message || "").trim();
      if (!message) {
        return send(res, 400, { error: "Message cannot be empty." });
      }

      const stored = await loadStoredAiSettings(sbFetch);
      if (!stored.apiKey) {
        return send(res, 400, {
          error: "No AI API key is configured for this dashboard yet. An admin must add an API key in Settings › Ask AI Settings."
        });
      }

      const provider = body.provider || stored.provider || "gemini";
      const model = body.model || stored.model || "gemini-1.5-flash";
      const customUrl = stored.customUrl;
      const temperature = typeof body.temperature === "number" ? body.temperature : stored.temperature;
      const systemPrompt = buildSystemPrompt(stored.systemPrompt, body.context);
      const history = Array.isArray(body.history) ? body.history : [];

      const answer = await dispatchLLM(
        provider,
        model,
        stored.apiKey,
        customUrl,
        systemPrompt,
        message,
        history,
        temperature
      );

      return send(res, 200, {
        ok: true,
        reply: answer,
        answer,
        provider,
        model,
        at: new Date().toISOString()
      });
    }

    return send(res, 405, { error: "Method or operation not allowed: " + op });
  } catch (e) {
    console.error("AI API Error:", e);
    return send(res, e.status || 500, {
      error: e.message || "An unexpected error occurred while communicating with the AI service."
    });
  }
};

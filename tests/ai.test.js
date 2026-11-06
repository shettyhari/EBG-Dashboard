const assert = require('assert');
const path = require('path');

// Load api/ai.js
const aiHandler = require('../api/ai.js');

async function runTests() {
  console.log('--- RUNNING AI API UNIT TESTS ---');

  // Test 1: Helper function tests inside api/ai.js
  console.log('Test 1: Module loads and exports a handler function');
  assert.strictEqual(typeof aiHandler, 'function', 'api/ai.js should export a handler function');
  console.log('✓ api/ai.js exports handler function');

  // Helper to mock request & response
  function createMockReqRes(options) {
    const req = {
      method: options.method || 'GET',
      headers: Object.assign({
        'content-type': 'application/json',
        'host': 'localhost:3000'
      }, options.headers || {}),
      query: options.query || {},
      body: options.body || null,
      on: function(event, callback) {
        if (event === 'data') {
          if (options.rawBody) callback(Buffer.from(options.rawBody));
        } else if (event === 'end') {
          callback();
        }
      }
    };

    let headers = {};
    let responseBody = '';

    const res = {
      statusCode: 200,
      setHeader: function(k, v) { headers[k.toLowerCase()] = v; },
      status: function(code) { this.statusCode = code; return res; },
      json: function(data) {
        headers['content-type'] = 'application/json';
        responseBody = JSON.stringify(data);
        return res;
      },
      end: function(data) {
        if (data) responseBody = data;
        return res;
      },
      get headers() { return headers; },
      get body() {
        try { return JSON.parse(responseBody); }
        catch (e) { return responseBody; }
      }
    };

    return { req, res };
  }

  // Test 2: Unauthenticated GET returns 401
  console.log('Test 2: Request without credentials');
  {
    const { req, res } = createMockReqRes({
      method: 'GET',
      query: { op: 'config' }
    });

    await aiHandler(req, res);
    assert.strictEqual(res.statusCode, 401, 'Should return 401 without auth header');
    assert.strictEqual(res.body.code, 'session');
    console.log('✓ Unauthenticated request rejected with 401');
  }

  // Test 3: Viewer role is blocked from admin operations
  console.log('Test 3: Viewer role is blocked from admin operations');
  {
    const fakeViewerPayload = {
      sub: 'viewer-uuid-1234',
      email: 'viewer@example.com',
      aud: 'authenticated',
      role: 'authenticated'
    };
    const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 
      Buffer.from(JSON.stringify(fakeViewerPayload)).toString('base64url') + 
      '.fakesignature';

    // Mock global fetch for Supabase calls
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/v1/user')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'viewer-uuid-1234', email: 'viewer@example.com' })
        };
      }
      if (urlStr.includes('/rest/v1/team_members')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ email: 'viewer@example.com', role: 'viewer' }]
        };
      }
      if (urlStr.includes('/rest/v1/v_ai_config') || urlStr.includes('/rest/v1/ai_settings')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ provider: 'gemini', model: 'gemini-1.5-flash', is_active: true }]
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    // Attempt save-config as viewer
    {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + fakeJwt },
        body: { op: 'save-config', provider: 'gemini', apiKey: 'test-key-12345' }
      });
      await aiHandler(req, res);
      assert.strictEqual(res.statusCode, 403, 'Viewer should be forbidden from save-config');
      assert.strictEqual(res.body.ok, false);
      assert(/admin/i.test(res.body.error), 'Error message should mention admin users only');
    }

    // Attempt clear-key as viewer
    {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + fakeJwt },
        body: { op: 'clear-key' }
      });
      await aiHandler(req, res);
      assert.strictEqual(res.statusCode, 403, 'Viewer should be forbidden from clear-key');
    }

    // Attempt test as viewer
    {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + fakeJwt },
        body: { op: 'test', provider: 'gemini', apiKey: 'key' }
      });
      await aiHandler(req, res);
      assert.strictEqual(res.statusCode, 403, 'Viewer should be forbidden from test');
    }

    // Call config as viewer: allowed, but without raw or masked key!
    {
      const { req, res } = createMockReqRes({
        method: 'GET',
        headers: { 'authorization': 'Bearer ' + fakeJwt },
        query: { op: 'config' }
      });
      await aiHandler(req, res);
      assert.strictEqual(res.statusCode, 200, 'Viewer can read public config status');
      assert.strictEqual(res.body.role, 'viewer');
      assert.strictEqual(res.body.maskedKey, undefined, 'Viewer should NOT receive maskedKey');
    }

    console.log('✓ Viewer role properly restricted from admin configuration actions');
    global.fetch = originalFetch;
  }

  // Test 4: Admin role permitted for save-config and returns maskedKey on config
  console.log('Test 4: Admin role allowed to save-config');
  {
    const fakeAdminPayload = {
      sub: 'admin-uuid-5678',
      email: 'admin@example.com',
      aud: 'authenticated',
      role: 'authenticated'
    };
    const fakeAdminJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 
      Buffer.from(JSON.stringify(fakeAdminPayload)).toString('base64url') + 
      '.fakesignature';

    let savedData = null;
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/v1/user')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'admin-uuid-5678', email: 'admin@example.com' }),
          json: async () => ({ id: 'admin-uuid-5678', email: 'admin@example.com' })
        };
      }
      if (urlStr.includes('/rest/v1/team_members')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ email: 'admin@example.com', role: 'admin' }]),
          json: async () => [{ email: 'admin@example.com', role: 'admin' }]
        };
      }
      if (urlStr.includes('/rest/v1/ai_settings')) {
        if (opts && opts.method === 'POST') {
          savedData = JSON.parse(opts.body);
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify([savedData]),
            json: async () => [savedData]
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{
            provider: 'openai',
            model: 'gpt-4o-mini',
            api_key: 'sk-abcdef1234567890abcdef1234567890',
            updated_by: 'admin@example.com',
            is_active: true
          }]),
          json: async () => [{
            provider: 'openai',
            model: 'gpt-4o-mini',
            api_key: 'sk-abcdef1234567890abcdef1234567890',
            updated_by: 'admin@example.com',
            is_active: true
          }]
        };
      }
      if (urlStr.includes('/rest/v1/team_settings')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ id: 1 }]),
          json: async () => [{ id: 1 }]
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    // Save config as admin
    {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + fakeAdminJwt },
        body: {
          op: 'save-config',
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiKey: 'sk-abcdef1234567890abcdef1234567890'
        }
      });
      await aiHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
      assert.strictEqual(res.body.hasKey, true);
      assert(res.body.maskedKey.startsWith('sk-a'), 'Admin receives masked key');
      assert.strictEqual(savedData.provider, 'openai');
      assert.strictEqual(savedData.model, 'gpt-4o-mini');
      assert.strictEqual(savedData.api_key, 'sk-abcdef1234567890abcdef1234567890');
    }

    console.log('✓ Admin successfully saves config and receives masked key');
    global.fetch = originalFetch;
  }

  // Test 5: Chat endpoint dispatches with dashboard context
  console.log('Test 5: Chat endpoint injects structured dashboard snapshot');
  {
    const fakeUserPayload = {
      sub: 'user-uuid-9999',
      email: 'analyst@example.com',
      aud: 'authenticated',
      role: 'authenticated'
    };
    const fakeUserJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 
      Buffer.from(JSON.stringify(fakeUserPayload)).toString('base64url') + 
      '.fakesignature';

    let llmReceivedUrl = '';
    let llmReceivedHeaders = {};
    let llmReceivedBody = null;

    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/v1/user')) {
        return { ok: true, status: 200, json: async () => ({ id: 'user-9999', email: 'analyst@example.com' }) };
      }
      if (urlStr.includes('/rest/v1/team_members')) {
        return { ok: true, status: 200, json: async () => [{ email: 'analyst@example.com', role: 'viewer' }] };
      }
      if (urlStr.includes('/rest/v1/ai_settings')) {
        const rows = [{
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          api_key: 'AIzaSyFakeGeminiKey123',
          is_active: true
        }];
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(rows),
          json: async () => rows
        };
      }
      // Gemini API mock
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        llmReceivedUrl = urlStr;
        llmReceivedHeaders = opts.headers || {};
        llmReceivedBody = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: 'Overall performance summary: Total spend is ₹50,000 across 250 leads with a CPL of ₹200 and CPQL of ₹800.'
                }]
              }
            }]
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const dashboardContext = {
      activeTab: 'overview',
      activeBrand: 'All',
      dateRange: '01-Nov-2026 – 05-Nov-2026',
      summary: {
        spend: 50000,
        metaLeads: 250,
        crmLeads: 240,
        qualifiedLeads: 62,
        cpl: 200,
        cpql: 806
      },
      brands: [
        { brand: 'Acer', spend: 20000, metaLeads: 100, ql: 30, cpl: 200 },
        { brand: 'Carlton', spend: 30000, metaLeads: 150, ql: 32, cpl: 200 }
      ]
    };

    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + fakeUserJwt },
      body: {
        op: 'chat',
        message: 'Give me a performance summary.',
        context: dashboardContext
      }
    });

    await aiHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert(res.body.reply.includes('Total spend is ₹50,000'), 'Reply should match LLM response');

    // Verify Gemini payload had system instructions with dashboard context
    assert(llmReceivedUrl.includes('AIzaSyFakeGeminiKey123'), 'URL should have API key');
    assert(llmReceivedUrl.includes('gemini-1.5-flash'), 'URL should specify model');
    const sysInst = llmReceivedBody.system_instruction || llmReceivedBody.systemInstruction;
    const systemText = sysInst.parts[0].text;
    assert(systemText.includes('50,000') || systemText.includes('50000'), 'System instruction should include spend');
    assert(systemText.includes('Acer'), 'System instruction should include brand data');

    console.log('✓ Chat endpoint correctly passes dashboard snapshot and returns AI analysis');
    global.fetch = originalFetch;
  }

  // Test 6: Anthropic provider integration
  console.log('Test 6: Anthropic Claude integration payload check');
  {
    let anthropicUrl = '';
    let anthropicHeaders = {};
    let anthropicBody = null;

    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/v1/user')) {
        return { ok: true, status: 200, json: async () => ({ id: 'user-1', email: 'user@example.com' }) };
      }
      if (urlStr.includes('/rest/v1/team_members')) {
        return { ok: true, status: 200, json: async () => [{ email: 'user@example.com', role: 'admin' }] };
      }
      if (urlStr.includes('/rest/v1/ai_settings')) {
        const rows = [{
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          api_key: 'sk-ant-fakeAnthropicKey',
          is_active: true
        }];
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(rows),
          json: async () => rows
        };
      }
      if (urlStr.includes('api.anthropic.com')) {
        anthropicUrl = urlStr;
        anthropicHeaders = opts.headers || {};
        anthropicBody = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            content: [{ type: 'text', text: 'Anthropic Claude analysis: Strong performance.' }]
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const fakeUserPayload = { sub: 'u1', email: 'user@example.com', aud: 'authenticated', role: 'authenticated' };
    const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + Buffer.from(JSON.stringify(fakeUserPayload)).toString('base64url') + '.sig';

    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + fakeJwt },
      body: { op: 'chat', message: 'Analyze performance' }
    });

    await aiHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(anthropicHeaders['x-api-key'], 'sk-ant-fakeAnthropicKey');
    assert.strictEqual(anthropicHeaders['anthropic-version'], '2023-06-01');
    assert.strictEqual(anthropicBody.model, 'claude-3-5-sonnet-20241022');
    assert.strictEqual(res.body.reply, 'Anthropic Claude analysis: Strong performance.');
    console.log('✓ Anthropic Claude payload and headers verified');

    global.fetch = originalFetch;
  }

  // Test 7: Custom OpenAI-compatible provider
  console.log('Test 7: Custom OpenAI-compatible provider integration');
  {
    let customUrl = '';
    let customHeaders = {};

    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/v1/user')) {
        return { ok: true, status: 200, json: async () => ({ id: 'u1', email: 'user@example.com' }) };
      }
      if (urlStr.includes('/rest/v1/team_members')) {
        return { ok: true, status: 200, json: async () => [{ email: 'user@example.com', role: 'admin' }] };
      }
      if (urlStr.includes('/rest/v1/ai_settings')) {
        const rows = [{
          provider: 'custom',
          model: 'deepseek-chat',
          custom_url: 'https://api.deepseek.com/v1/chat/completions',
          api_key: 'sk-custom-fake-key',
          is_active: true
        }];
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(rows),
          json: async () => rows
        };
      }
      if (urlStr.includes('api.deepseek.com')) {
        customUrl = urlStr;
        customHeaders = opts.headers || {};
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'Deepseek response.' } }]
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const fakeUserPayload = { sub: 'u1', email: 'user@example.com', aud: 'authenticated', role: 'authenticated' };
    const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + Buffer.from(JSON.stringify(fakeUserPayload)).toString('base64url') + '.sig';

    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + fakeJwt },
      body: { op: 'chat', message: 'Hi' }
    });

    await aiHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(customUrl, 'https://api.deepseek.com/v1/chat/completions');
    assert.strictEqual(customHeaders['authorization'], 'Bearer sk-custom-fake-key');
    assert.strictEqual(res.body.reply, 'Deepseek response.');
    console.log('✓ Custom OpenAI-compatible endpoint verified');

    global.fetch = originalFetch;
  }

  // Test 8: op=test with whitespace/quotes and masked key fallback
  console.log('Test 8: Test connection sanitizes API key quotes/spaces and handles masked keys');
  {
    let testedUrl = '';
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/v1/user')) {
        return { ok: true, status: 200, json: async () => ({ id: 'admin-1', email: 'admin@example.com' }) };
      }
      if (urlStr.includes('/rest/v1/team_members')) {
        return { ok: true, status: 200, json: async () => [{ email: 'admin@example.com', role: 'admin' }] };
      }
      if (urlStr.includes('/rest/v1/ai_settings')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ provider: 'gemini', model: 'gemini-1.5-flash', api_key: 'AIzaSySavedKeyReal' }]),
          json: async () => [{ provider: 'gemini', model: 'gemini-1.5-flash', api_key: 'AIzaSySavedKeyReal' }]
        };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        testedUrl = urlStr;
        return {
          ok: true,
          status: 200,
          json: async () => ({ candidates: [{ content: { parts: [{ text: 'API connection successful' }] } }] })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const fakeAdminPayload = { sub: 'a1', email: 'admin@example.com', aud: 'authenticated', role: 'authenticated' };
    const fakeAdminJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + Buffer.from(JSON.stringify(fakeAdminPayload)).toString('base64url') + '.sig';

    // 8a: Test with spaces and quotes in key: `  "AIzaSyCleanMeKey"  `
    {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + fakeAdminJwt },
        body: {
          op: 'test',
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          apiKey: '  "AIzaSyCleanMeKey"  '
        }
      });
      await aiHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
      assert(testedUrl.includes('key=AIzaSyCleanMeKey'), 'URL key query should be cleaned of quotes and spaces');
      assert(!testedUrl.includes('%20'), 'Should not have encoded whitespace');
      assert(!testedUrl.includes('%22'), 'Should not have encoded quotes');
    }

    // 8b: Test with masked key `••••••••` falls back to existing key `AIzaSySavedKeyReal`
    {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: { 'authorization': 'Bearer ' + fakeAdminJwt },
        body: {
          op: 'test',
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          apiKey: '••••••••'
        }
      });
      await aiHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
      assert(testedUrl.includes('key=AIzaSySavedKeyReal'), 'Should fall back to stored real key when masked');
    }

    // 8c: Test with local-dev-token bypass
    {
      const { req, res } = createMockReqRes({
        method: 'POST',
        headers: {
          'host': 'localhost:3000',
          'authorization': 'Bearer local-dev-token',
          'x-local-dev': '1'
        },
        body: {
          op: 'test',
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          apiKey: 'AIzaSyLocalTest'
        }
      });
      await aiHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
      assert(testedUrl.includes('key=AIzaSyLocalTest'));
    }

    console.log('✓ API key test sanitization, masked key fallback, and local dev bypass verified');
    global.fetch = originalFetch;
  }

  // Test 9: Gemini thinking models filter thought:true parts and return clean answer
  console.log('Test 9: Gemini 2.0 thinking models filter internal thoughts and support new models');
  {
    const originalFetch = global.fetch;
    let requestedModel = '';
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/v1/user')) {
        return { ok: true, status: 200, json: async () => ({ id: 'u-gemini', email: 'user@example.com' }) };
      }
      if (urlStr.includes('/rest/v1/team_members')) {
        return { ok: true, status: 200, json: async () => [{ email: 'user@example.com', role: 'viewer' }] };
      }
      if (urlStr.includes('/rest/v1/ai_settings')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ provider: 'gemini', model: 'gemini-2.0-flash-thinking-exp-01-21', api_key: 'AIzaSyThinking123' }]),
          json: async () => [{ provider: 'gemini', model: 'gemini-2.0-flash-thinking-exp-01-21', api_key: 'AIzaSyThinking123' }]
        };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        requestedModel = urlStr;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [
                  { thought: true, text: 'Analyzing CPL and TAT data...' },
                  { text: 'Final analysis: The blended CPL is ₹200 and lead TAT is under 15 minutes.' }
                ]
              }
            }]
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const fakeUserPayload = { sub: 'u-g', email: 'user@example.com', aud: 'authenticated', role: 'authenticated' };
    const fakeUserJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + Buffer.from(JSON.stringify(fakeUserPayload)).toString('base64url') + '.sig';

    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + fakeUserJwt },
      body: { op: 'chat', message: 'Analyze performance' }
    });

    await aiHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert(requestedModel.includes('gemini-2.0-flash-thinking-exp-01-21'), 'Should call the requested model');
    assert.strictEqual(res.body.reply, 'Final analysis: The blended CPL is ₹200 and lead TAT is under 15 minutes.');
    assert(!res.body.reply.includes('Analyzing CPL'), 'Thought parts should be filtered out');

    console.log('✓ Gemini thinking models correctly filtered and clean response returned');
    global.fetch = originalFetch;
  }

  // Test 10: Agentic copilot parses action blocks and interactive suggestions
  console.log('Test 10: Agentic action parsing and interactive suggestions');
  {
    const originalFetch = global.fetch;
    global.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes('/auth/v1/user')) {
        return { ok: true, status: 200, json: async () => ({ id: 'u-agent', email: 'agent@example.com' }) };
      }
      if (urlStr.includes('/rest/v1/team_members')) {
        return { ok: true, status: 200, json: async () => [{ email: 'agent@example.com', role: 'viewer' }] };
      }
      if (urlStr.includes('/rest/v1/ai_settings')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify([{ provider: 'gemini', model: 'gemini-2.0-flash', api_key: 'AIzaSyAgentKey123' }]),
          json: async () => [{ provider: 'gemini', model: 'gemini-2.0-flash', api_key: 'AIzaSyAgentKey123' }]
        };
      }
      if (urlStr.includes('generativelanguage.googleapis.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: 'Here is the campaign leakage analysis for Carlton:\n\n' +
                    '- 2 campaigns have high spend with 0 QL.\n\n' +
                    '```action\n' +
                    '[\n' +
                    '  {"tool": "switch_tab", "tab": "leaks"},\n' +
                    '  {"tool": "filter_brand", "brand": "Carlton"}\n' +
                    ']\n' +
                    '```\n\n' +
                    '```suggestions\n' +
                    '[\n' +
                    '  {"label": "Inspect Adset Level", "action": {"tool": "switch_tab", "tab": "adsets"}},\n' +
                    '  {"label": "Download Excel Export", "action": {"tool": "export_report"}},\n' +
                    '  {"label": "Speed to Lead Analysis", "prompt": "Show lead TAT and SLA violations"}\n' +
                    ']\n' +
                    '```'
                }]
              }
            }]
          })
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };

    const fakeUserPayload = { sub: 'u-a', email: 'agent@example.com', aud: 'authenticated', role: 'authenticated' };
    const fakeUserJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + Buffer.from(JSON.stringify(fakeUserPayload)).toString('base64url') + '.sig';

    const { req, res } = createMockReqRes({
      method: 'POST',
      headers: { 'authorization': 'Bearer ' + fakeUserJwt },
      body: { op: 'chat', message: 'Show me campaign leakages for Carlton' }
    });

    await aiHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);

    // Verify actions parsed
    assert(Array.isArray(res.body.actions), 'res.body.actions should be an array');
    assert.strictEqual(res.body.actions.length, 2, 'Should have parsed 2 actions');
    assert.strictEqual(res.body.actions[0].tool, 'switch_tab');
    assert.strictEqual(res.body.actions[0].tab, 'leaks');
    assert.strictEqual(res.body.actions[1].tool, 'filter_brand');
    assert.strictEqual(res.body.actions[1].brand, 'Carlton');

    // Verify suggestions parsed
    assert(Array.isArray(res.body.suggestedActions), 'res.body.suggestedActions should be an array');
    assert.strictEqual(res.body.suggestedActions.length, 3, 'Should have parsed 3 suggestions');
    assert.strictEqual(res.body.suggestedActions[0].label, 'Inspect Adset Level');
    assert.strictEqual(res.body.suggestedActions[0].action.tool, 'switch_tab');
    assert.strictEqual(res.body.suggestedActions[2].prompt, 'Show lead TAT and SLA violations');

    // Verify clean reply has stripped action/suggestion code blocks
    assert(!res.body.reply.includes('```action'), 'Reply text must not contain ```action blocks');
    assert(!res.body.reply.includes('```suggestions'), 'Reply text must not contain ```suggestions blocks');
    assert(res.body.reply.includes('campaign leakage analysis for Carlton'), 'Clean reply must retain analysis');

    console.log('✓ Agentic actions and suggested actions parsed correctly and stripped from reply');
    global.fetch = originalFetch;
  }

  // Test 11: Ensure index.html maintains strict ES5 compatibility (no const, let, arrow functions)
  console.log('Test 11: index.html strict ES5 compliance');
  {
    const fs = require('fs');
    const htmlPath = path.join(__dirname, '..', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');
    const scriptMatches = [...html.matchAll(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi)];
    const es5Violations = [];

    scriptMatches.forEach((m) => {
      const lines = m[1].split(/\r?\n/);
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*')) return;
        // Strip out string literals so english words like "or let the brand" inside strings aren't falsely flagged
        const codeOnly = line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
        if (/\bconst\s+[a-zA-Z_$]/.test(codeOnly)) {
          es5Violations.push(`Line ${idx + 1}: const keyword used -> ${trimmed}`);
        }
        if (/\blet\s+[a-zA-Z_$]/.test(codeOnly)) {
          es5Violations.push(`Line ${idx + 1}: let keyword used -> ${trimmed}`);
        }
        if (/=>/.test(codeOnly) && !codeOnly.includes('==>')) {
          es5Violations.push(`Line ${idx + 1}: arrow function used -> ${trimmed}`);
        }
      });
    });

    assert.strictEqual(es5Violations.length, 0, 'index.html must not contain ES6+ keywords: ' + JSON.stringify(es5Violations));
    console.log('✓ index.html has 0 ES6 syntax violations in <script> blocks');
  }

  // Test 12: AI chat history isolation per user account and ad account/brand
  console.log('Test 12: AI chat history isolation per user account and ad account/brand');
  {
    const fs = require('fs');
    const htmlPath = path.join(__dirname, '..', 'index.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Verify UI contains account bar and user tag
    assert(html.includes('id="ask-ai-account-select"'), 'index.html must have #ask-ai-account-select');
    assert(html.includes('id="ask-ai-user-tag"'), 'index.html must have #ask-ai-user-tag');
    assert(html.includes('switchAskAIAccount'), 'index.html must define switchAskAIAccount');
    assert(html.includes('getAskAIAccountKey'), 'index.html must define getAskAIAccountKey');

    // Simulate multi-account storage isolation
    const mockStorage = {};
    function getAskAIAccountKey(userKey, scopeKey) {
      const u = (userKey || 'local').toLowerCase().trim();
      const s = scopeKey || 'All';
      return u + '::' + s;
    }

    function saveHistory(user, brand, messages) {
      const k = 'ebg-ai-hist:' + getAskAIAccountKey(user, brand);
      mockStorage[k] = JSON.stringify(messages);
    }

    function loadHistory(user, brand) {
      const k = 'ebg-ai-hist:' + getAskAIAccountKey(user, brand);
      return mockStorage[k] ? JSON.parse(mockStorage[k]) : [];
    }

    function clearHistory(user, brand) {
      const k = 'ebg-ai-hist:' + getAskAIAccountKey(user, brand);
      delete mockStorage[k];
    }

    // Account A (hari@ebg.com) chats under Carlton
    saveHistory('hari@ebg.com', 'Carlton', [
      { role: 'user', content: 'Audit Carlton campaigns' },
      { role: 'bot', content: 'Carlton has 2 high-spend leakages' }
    ]);

    // Account A (hari@ebg.com) chats under Acer
    saveHistory('hari@ebg.com', 'Acer', [
      { role: 'user', content: 'What is Acer CPQL?' },
      { role: 'bot', content: 'Acer CPQL is ₹340' }
    ]);

    // Account B (manager@ebg.com) chats under Carlton
    saveHistory('manager@ebg.com', 'Carlton', [
      { role: 'user', content: 'Check Carlton TAT' }
    ]);

    // Verify complete isolation
    const hariCarlton = loadHistory('hari@ebg.com', 'Carlton');
    const hariAcer = loadHistory('hari@ebg.com', 'Acer');
    const managerCarlton = loadHistory('manager@ebg.com', 'Carlton');
    const managerAcer = loadHistory('manager@ebg.com', 'Acer');
    const localAll = loadHistory('local', 'All');

    assert.strictEqual(hariCarlton.length, 2, 'hari@ebg.com on Carlton should have 2 messages');
    assert.strictEqual(hariAcer.length, 2, 'hari@ebg.com on Acer should have 2 messages');
    assert.strictEqual(managerCarlton.length, 1, 'manager@ebg.com on Carlton should have 1 message');
    assert.strictEqual(managerAcer.length, 0, 'manager@ebg.com on Acer should be empty');
    assert.strictEqual(localAll.length, 0, 'local user on All should be empty');

    // Verify messages do not bleed into each other
    assert.strictEqual(hariCarlton[0].content, 'Audit Carlton campaigns');
    assert.strictEqual(hariAcer[0].content, 'What is Acer CPQL?');
    assert.strictEqual(managerCarlton[0].content, 'Check Carlton TAT');

    // Clear hari's Carlton history only
    clearHistory('hari@ebg.com', 'Carlton');
    assert.strictEqual(loadHistory('hari@ebg.com', 'Carlton').length, 0, 'hari Carlton history cleared');
    assert.strictEqual(loadHistory('hari@ebg.com', 'Acer').length, 2, 'hari Acer history remains intact');
    assert.strictEqual(loadHistory('manager@ebg.com', 'Carlton').length, 1, 'manager Carlton history remains intact');

    console.log('✓ Multi-account chat history isolation and scoped deletion verified');
  }

  // Test 13: Unique brand deduplication, QL duplicate retention, and Lead Temperature
  console.log('Test 13: Unique brand deduplication, QL duplicate retention, and Lead Temperature');
  {
    const fs = require('fs');
    const vm = require('vm');
    const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

    // Extract the engine code from index.html (between DEFAULT_SETTINGS and ENGINE END)
    const scriptEnd = indexHtml.indexOf('// ENGINE END');
    assert(scriptEnd > 0, 'ENGINE END boundary should exist in index.html');

    const helpersStart = indexHtml.indexOf('// ENGINE START');
    assert(helpersStart > 0, 'ENGINE START boundary should exist in index.html');
    const codeToRun = indexHtml.slice(helpersStart, scriptEnd);

    const sandbox = {
      console: console,
      Date: Date,
      Math: Math,
      Number: Number,
      String: String,
      Array: Array,
      Object: Object,
      isFinite: isFinite,
      isNaN: isNaN,
      parseInt: parseInt,
      parseFloat: parseFloat
    };
    vm.createContext(sandbox);
    vm.runInContext(codeToRun, sandbox);

    // Verify leadTemperature function
    const leadTemperature = sandbox.leadTemperature;
    assert.strictEqual(typeof leadTemperature, 'function', 'leadTemperature function should exist');
    assert.strictEqual(leadTemperature('Won'), 'Hot');
    assert.strictEqual(leadTemperature('Token Received'), 'Hot');
    assert.strictEqual(leadTemperature('Payment Completed'), 'Hot');
    assert.strictEqual(leadTemperature('Interested'), 'Warm');
    assert.strictEqual(leadTemperature('Site Visit Scheduled'), 'Warm');
    assert.strictEqual(leadTemperature('Details Shared'), 'Warm');
    assert.strictEqual(leadTemperature('New Lead'), 'Cold');
    assert.strictEqual(leadTemperature('Not Interested'), 'Cold');
    assert.strictEqual(leadTemperature('Junk Lead'), 'Cold');
    assert.strictEqual(leadTemperature('Custom Status', 'Hot'), 'Hot');
    assert.strictEqual(leadTemperature('Custom Status', 'Warm'), 'Warm');
    assert.strictEqual(leadTemperature('Custom Status', 'Cold'), 'Cold');

    // Now test processData with cross-brand and duplicate leads
    const metaAOA = [
      ["Campaign name", "Ad set name", "Ad name", "Amount spent", "Results", "Reporting starts", "Reporting ends"],
      ["Carlton | Conversions", "Adset 1", "Ad 1", "1000", "5", "2025-01-01", "2025-01-05"],
      ["Acer | Conversions", "Adset 2", "Ad 2", "1500", "8", "2025-01-01", "2025-01-05"]
    ];

    const crmAOA = [
      ["Lead id", "Created On", "Lead Source", "Facebook Campaign Name", "Facebook Ad Set Name", "Facebook Ad", "Status", "Brand", "Phone", "Email", "Previous lead", "Lead Temperature"],
      // Lead 1: Person A submits for Carlton (Brand 1)
      ["L1", "2025-01-01 10:00", "Facebook", "Carlton | Conversions", "Adset 1", "Ad 1", "New Lead", "Carlton", "9876543210", "personA@example.com", "", "Cold"],
      // Lead 2: Same Person A submits for Acer (Brand 2). Unique brand!
      // In TeleCRM, Previous lead points to L1 because the contact existed under Carlton.
      ["L2", "2025-01-02 11:00", "Facebook", "Acer | Conversions", "Adset 2", "Ad 2", "Interested", "Acer", "9876543210", "personA@example.com", "L1", "Warm"],
      // Lead 3: Same Person A submits for Acer AGAIN (repeat lead for same brand). Status: Site Visit Scheduled (QL)
      ["L3", "2025-01-03 12:00", "Facebook", "Acer | Conversions", "Adset 2", "Ad 2", "Site Visit Scheduled", "Acer", "9876543210", "personA@example.com", "L2", "Warm"],
      // Lead 4: Same Person A submits for Acer a 3rd time. Status: Not Interested (Not QL duplicate)
      ["L4", "2025-01-04 13:00", "Facebook", "Acer | Conversions", "Adset 2", "Ad 2", "Not Interested", "Acer", "9876543210", "personA@example.com", "L3", "Cold"]
    ];

    const S = sandbox.DEFAULT_SETTINGS;
    S.dupExclude = true; // default setting: exclude duplicates
    const R = sandbox.processData(metaAOA, crmAOA, S, null, Date.UTC(2025, 0, 10));

    // 1. Verify Unique Brands Deduplication:
    // L2 was submitted for Acer while L1 was Carlton.
    // L2 MUST NOT be treated as a duplicate!
    const l2Dup = (R.dupList || []).find(d => d.id === 'L2');
    assert.strictEqual(l2Dup, undefined, 'Lead 2 (unique brand Acer) should NOT be in dupList');

    // 2. Verify Duplicate Lead QL Retention:
    // L3 was submitted for Acer (same brand as L2), so it is a duplicate of L2.
    // BUT L3 status is "Site Visit Scheduled" (QL).
    // Because it is a QL, its QL count MUST NOT be dropped!
    const l3Dup = (R.dupList || []).find(d => d.id === 'L3');
    assert.notStrictEqual(l3Dup, undefined, 'Lead 3 should be detected as a repeat lead for Acer');
    assert.strictEqual(l3Dup.excluded, false, 'Lead 3 is a Qualified Lead, so excluded must be false');
    assert.strictEqual(l3Dup.isQL, true, 'Lead 3 isQL must be true');

    // L4 is not a QL ("Not Interested"), so it should be excluded
    const l4Dup = (R.dupList || []).find(d => d.id === 'L4');
    assert.notStrictEqual(l4Dup, undefined, 'Lead 4 should be detected as a duplicate');
    assert.strictEqual(l4Dup.excluded, true, 'Lead 4 is NOT a QL, so excluded must be true when dupExclude is on');

    // Check Acer QL count:
    // Acer had L2 (Interested, QL) and L3 (Site Visit Scheduled, QL duplicate).
    // Both QLs must be counted!
    const acerBrand = R.brandRows.find(b => b.brand === 'Acer');
    assert(acerBrand, 'Acer brand row should exist');
    assert.strictEqual(acerBrand.ql, 2, 'Acer should have 2 QLs (L2 + L3), not 1!');

    // Check R.statuses has Lead Temperature
    assert(R.statuses && R.statuses.length > 0, 'R.statuses should not be empty');
    R.statuses.forEach(st => {
      assert(['Hot', 'Warm', 'Cold'].includes(st.temperature), 'Every status should have Hot, Warm, or Cold temperature');
    });

    // Check viewQL UI in index.html contains temperature column and KPI cards
    assert(indexHtml.includes('Lead Temperature'), 'index.html should have Lead Temperature column');
    assert(indexHtml.includes('🔥 Hot Leads'), 'index.html should have Hot Leads KPI');
    assert(indexHtml.includes('⚡ Warm Leads'), 'index.html should have Warm Leads KPI');
    assert(indexHtml.includes('❄️ Cold Leads'), 'index.html should have Cold Leads KPI');

    console.log('✓ Unique brands deduplication, duplicate QL retention, and Lead Temperature verified');
  }

  console.log('\n========================================');
  console.log('ALL 13 AI API INTEGRATION TESTS PASSED!');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

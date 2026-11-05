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

  console.log('\n=======================================');
  console.log('ALL 7 AI API INTEGRATION TESTS PASSED!');
  console.log('=======================================');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

if (process.argv.includes('--child')) {
  globalThis.fetch = async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer synthetic-openai-key');
    assert.equal(init.redirect, 'error');
    if (url === 'https://api.openai.com/v1/models/gpt-5.4')
      return Response.json({ id: 'gpt-5.4' });
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body);
    assert.equal(body.store, false);
    assert.equal(body.tools, undefined);
    if (body.instructions === 'FAIL') return Response.json({ error: {
      code: 'invalid_api_key', message: 'Never expose synthetic-openai-key or document content',
    } }, { status: 401 });
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [
      { type: 'output_text', text: JSON.stringify({ reviewed: true, bytes: body.input[0].content.at(-1).file_data }) },
    ] }], usage: { input_tokens: 1, output_tokens: 1 }, ignored: 'private metadata' });
  };
  await import(process.env.RELAY_TEST_ENTRY || '../index.js');
} else {
  async function start(apiKey) {
    const probe = createServer();
    await new Promise(r => probe.listen(0, '127.0.0.1', r));
    const port = probe.address().port;
    await new Promise(r => probe.close(r));
    const child = spawn(process.execPath, [import.meta.filename, '--child'], { env: {
      ...process.env, PORT: String(port), OPENAI_API_KEY: apiKey, OPENAI_REVIEW_MODEL: 'gpt-5.4',
      DOCDIGITAL_CLIENT_ID: 'synthetic-client', DOCDIGITAL_CLIENT_SECRET: 'synthetic-secret',
      PROXY_API_KEY: 'synthetic-legacy-key', VISACIONES_API_KEY: 'synthetic-site-key',
      DOCDIGITAL_BASE_URL: 'http://127.0.0.1:1',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill(), 20000);
    await new Promise((resolve, reject) => {
      child.stdout.on('data', data => { if (data.toString().includes('escuchando')) resolve(); });
      child.once('exit', () => reject(new Error('Server exited before ready')));
    });
    return { url: `http://127.0.0.1:${port}`, async close() {
      clearTimeout(timer); const exited = once(child, 'exit'); child.kill(); await exited;
    } };
  }
  const headers = { Authorization: 'Bearer synthetic-site-key', 'Content-Type': 'application/json' };
  const body = { model: 'gpt-5.4', store: false, instructions: 'Review synthetic evidence',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'Synthetic inventory' },
      { type: 'input_file', filename: 'test.pdf', file_data: 'data:application/pdf;base64,JVBERi0xLjc=' }] }],
    max_output_tokens: 12000, text: { format: { type: 'json_schema', name: 'revision_documental', strict: true, schema: { type: 'object' } } } };
  const server = await start('synthetic-openai-key');
  try {
    const send = (b = body, h = {}) => fetch(server.url + '/visaciones-ai/responses', {
      method: 'POST', headers: { ...headers, 'X-Visaciones-Request-Id': randomUUID(), ...h }, body: JSON.stringify(b),
    });
    assert.equal((await fetch(server.url + '/visaciones-ai/status')).status, 401);
    assert.equal((await fetch(server.url + '/visaciones-ai/status', { headers: { Authorization: 'Bearer synthetic-legacy-key' } })).status, 401);
    assert.equal((await send(body, { Origin: 'https://browser.example' })).status, 403);
    assert.deepEqual(await (await fetch(server.url + '/visaciones-ai/status', { headers })).json(), { ok: true, model: 'gpt-5.4', generationTested: false });
    assert.equal((await send({ ...body, tools: [{ type: 'web_search' }] })).status, 400);
    assert.equal((await send({ ...body, store: true })).status, 400);
    assert.equal((await send({ ...body, model: 'unapproved-model' })).status, 400);
    assert.equal((await send({ ...body, input: [{ role: 'user', content: [{ type: 'input_file', file_url: 'https://external.invalid/sensitive' }] }] })).status, 400);
    const requestId = randomUUID();
    const response = await send(body, { 'X-Visaciones-Request-Id': requestId });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, 'completed');
    assert.equal(JSON.parse(result.output[0].content[0].text).bytes, body.input[0].content[1].file_data);
    assert.equal(result.ignored, undefined);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await send(body, { 'X-Visaciones-Request-Id': requestId })).status, 409);
    const failed = await send({ ...body, instructions: 'FAIL' });
    assert.equal(failed.status, 401);
    assert.deepEqual(await failed.json(), { error: { code: 'invalid_api_key' } });
    const malformed = await fetch(server.url + '/visaciones-ai/responses', { method: 'POST', headers, body: '{SECRET_BAD_JSON' });
    assert.equal(malformed.status, 400);
    assert.ok(!(await malformed.text()).includes('SECRET_BAD_JSON'));
    const legacy = await fetch(server.url + '/mcp', { method: 'POST', headers: { ...headers, Authorization: 'Bearer synthetic-legacy-key', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    assert.equal(legacy.status, 200);
    assert.ok((await legacy.text()).includes('docdigital_rechazar_comunicacion'));
  } finally { await server.close(); }
  const missing = await start('');
  try {
    const r = await fetch(missing.url + '/visaciones-ai/status', { headers });
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: { code: 'analysis_key_missing' } });
  } finally { await missing.close(); }
  console.log('PASS: relay authentication, missing key, model check, complete PDF forwarding, no tools/remote URLs, duplicate suppression, safe errors and legacy MCP.');
}

import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import { createHmac, randomBytes, createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const escape = v => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => escape(r[h])).join(','))].join('\n');
}

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Webhook receiver (must be before express.json() to read raw body for HMAC) ──
const webhookEvents = [];

app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const signingKey = process.env.WEBHOOK_SIGNING_KEY;
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

  let verified = null;
  if (signingKey) {
    const incoming = req.headers['x-signature'] || req.headers['x-sfdc-signature'] || '';
    const keyBuf = Buffer.from(signingKey, 'base64');
    const computed = createHmac('sha256', keyBuf).update(rawBody).digest('base64');
    verified = incoming ? incoming === computed : false;
  }

  let body;
  try { body = JSON.parse(rawBody.toString()); } catch { body = rawBody.toString(); }

  webhookEvents.unshift({
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    receivedAt: new Date().toISOString(),
    verified,
    headers: req.headers,
    body,
  });
  if (webhookEvents.length > 50) webhookEvents.length = 50;
  res.status(200).json({ received: true });
});

app.use(express.json());

// Step 1: Exchange client credentials for org access token
app.post('/api/oauth', async (req, res) => {
  const { domain, clientId, clientSecret } = req.body;
  const url = `https://${domain}/services/oauth2/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 2: Swap org token for Data Cloud access token
app.post('/api/dc-token', async (req, res) => {
  const { instanceUrl, orgAccessToken } = req.body;
  const url = `${instanceUrl}/services/a360/token`;
  const params = new URLSearchParams({
    grant_type: 'urn:salesforce:grant-type:external:cdp',
    subject_token: orgAccessToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
  });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 3: Send data to Data Cloud Ingestion API
app.post('/api/ingest', async (req, res) => {
  const { dcInstanceUrl, dcAccessToken, connectorName, objectName, payload } = req.body;
  const base = dcInstanceUrl.startsWith('http') ? dcInstanceUrl : `https://${dcInstanceUrl}`;
  const url = `${base}/api/v1/ingest/sources/${connectorName}/${objectName}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dcAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let data;
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MySQL: list tables with row counts
app.get('/api/mysql/tables', async (req, res) => {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_SSL } = process.env;
  if (!DB_HOST) return res.status(503).json({ error: 'MySQL not configured.' });
  let conn;
  try {
    conn = await mysql.createConnection({
      host: DB_HOST, port: parseInt(DB_PORT || '3306'),
      user: DB_USER, password: DB_PASS, database: DB_NAME,
      ssl: DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });
    const [tableRows] = await conn.execute('SHOW TABLES');
    const key = Object.keys(tableRows[0] || {})[0];
    const EXCLUDE_TABLES = ['guests_archive'];
    const tables = await Promise.all(
      tableRows
        .map(row => row[key])
        .filter(name => !EXCLUDE_TABLES.includes(name))
        .map(async name => {
          const [[{ cnt }]] = await conn.execute(`SELECT COUNT(*) AS cnt FROM \`${name}\``);
          return { name, rowCount: Number(cnt) };
        })
    );
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
});

// MySQL query (preview — 50 rows max)
app.post('/api/mysql/query', async (req, res) => {
  const { query, limit = 50 } = req.body;
  const { DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_SSL } = process.env;
  if (!DB_HOST) {
    return res.status(503).json({ error: 'MySQL not configured — set DB_HOST, DB_USER, DB_PASS, DB_NAME env vars on the server.' });
  }
  let conn;
  try {
    conn = await mysql.createConnection({
      host: DB_HOST,
      port: parseInt(DB_PORT || '3306'),
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
      ssl: DB_SSL === 'false' ? undefined : { rejectUnauthorized: false },
    });
    const isSelect = /^\s*SELECT\b/i.test(query);
    const applyLimit = req.body.applyLimit !== false;
    const safeQuery = (isSelect && applyLimit && !/\bLIMIT\b/i.test(query))
      ? `${query.trimEnd().replace(/;$/, '')} LIMIT ${limit}`
      : query;
    const [rows] = await conn.execute(safeQuery);
    res.json({ rows, count: rows.length, columns: rows.length ? Object.keys(rows[0]) : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
});

// Bulk ingest: MySQL rows → DC bulk job (create → upload CSV → close → poll)
app.post('/api/ingest/bulk', async (req, res) => {
  const { dcInstanceUrl, dcAccessToken, sourceName, objectName, rows } = req.body;
  if (!dcInstanceUrl || !dcAccessToken || !sourceName || !objectName || !rows?.length) {
    return res.status(400).json({ error: 'Missing required fields: dcInstanceUrl, dcAccessToken, sourceName, objectName, rows' });
  }
  const base = dcInstanceUrl.startsWith('http') ? dcInstanceUrl : `https://${dcInstanceUrl}`;
  const steps = [];

  try {
    // 1. Create job
    const jobRes = await fetch(`${base}/api/v1/ingest/jobs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${dcAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ object: objectName, sourceName, operation: 'upsert' }),
    });
    const job = await jobRes.json();
    if (!jobRes.ok) {
      steps.push({ label: 'Create job', status: 'error', detail: job.message || JSON.stringify(job) });
      return res.status(jobRes.status).json({ steps });
    }
    const jobId = job.id;
    steps.push({ label: 'Create job', status: 'ok', detail: `Job ID: ${jobId}` });

    // 2. Upload CSV
    const csv = rowsToCsv(rows);
    const batchRes = await fetch(`${base}/api/v1/ingest/jobs/${jobId}/batches`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${dcAccessToken}`, 'Content-Type': 'text/csv' },
      body: csv,
    });
    if (!batchRes.ok) {
      const errText = await batchRes.text();
      steps.push({ label: 'Upload CSV', status: 'error', detail: errText });
      return res.status(batchRes.status).json({ steps });
    }
    steps.push({ label: 'Upload CSV', status: 'ok', detail: `${rows.length} rows` });

    // 3. Close job
    const closeRes = await fetch(`${base}/api/v1/ingest/jobs/${jobId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${dcAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'UploadComplete' }),
    });
    const closeData = await closeRes.json();
    if (!closeRes.ok) {
      steps.push({ label: 'Close job', status: 'error', detail: closeData.message || JSON.stringify(closeData) });
      return res.status(closeRes.status).json({ steps });
    }
    steps.push({ label: 'Close job (UploadComplete)', status: 'ok', detail: `State: ${closeData.state}` });

    // 4. Poll up to 20s
    let finalStatus = closeData;
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 2500));
      const pollRes = await fetch(`${base}/api/v1/ingest/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${dcAccessToken}` },
      });
      finalStatus = await pollRes.json();
      if (['Complete', 'Failed', 'Aborted'].includes(finalStatus.state)) break;
    }
    const done = ['Complete', 'Failed', 'Aborted'].includes(finalStatus.state);
    const failures = finalStatus.processingFailures ? ` · ${finalStatus.processingFailures} failures` : '';
    steps.push({
      label: 'Processing',
      status: finalStatus.state === 'Complete' ? 'ok' : done ? 'error' : 'pending',
      detail: (done ? finalStatus.state : 'Still processing — check Data Cloud job monitor') + failures,
    });

    res.json({ steps, jobId, state: finalStatus.state });
  } catch (err) {
    steps.push({ label: 'Error', status: 'error', detail: err.message });
    res.status(500).json({ steps, error: err.message });
  }
});

// ── Webhook API endpoints ────────────────────────────────────────────────

app.get('/api/webhook/events', (req, res) => {
  res.json(webhookEvents);
});

// Return the public-facing webhook URL (ngrok if running, else server origin)
app.get('/api/webhook/url', async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:4040/api/tunnels');
    const data = await r.json();
    const tunnel = (data.tunnels || []).find(t => t.proto === 'https') || data.tunnels?.[0];
    if (tunnel?.public_url) {
      return res.json({ url: tunnel.public_url + '/webhook', via: 'ngrok' });
    }
  } catch {}
  // Fall back to request origin — honour x-forwarded-proto set by reverse proxies (Render, Heroku)
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const origin = `${proto}://${req.get('host')}`;
  res.json({ url: origin + '/webhook', via: 'local' });
});

app.delete('/api/webhook/events', (req, res) => {
  webhookEvents.length = 0;
  res.json({ cleared: true });
});

// Data Cloud: search individuals by name
app.post('/api/datacloud/search', async (req, res) => {
  const { orgAccessToken, orgInstanceUrl, q } = req.body;
  if (!orgAccessToken || !orgInstanceUrl || !q) return res.status(400).json({ error: 'orgAccessToken, orgInstanceUrl, q required' });
  const base = orgInstanceUrl.startsWith('http') ? orgInstanceUrl : `https://${orgInstanceUrl}`;
  const safe = q.replace(/'/g, "''").toLowerCase();
  try {
    const r1 = await fetch(`${base}/services/data/v67.0/ssot/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: `SELECT ssot__Id__c, ssot__FirstName__c, ssot__LastName__c, ssot__BirthDate__c, ssot__GenderIdentity__c FROM ssot__Individual__dlm WHERE LOWER(ssot__FirstName__c) LIKE '%${safe}%' OR LOWER(ssot__LastName__c) LIKE '%${safe}%' LIMIT 20` }),
    });
    const d1 = await r1.json();
    if (!r1.ok) return res.status(r1.status).json(d1);
    const rows = d1.data || [];
    if (!rows.length) return res.json([]);

    const ids = rows.map(r => `'${r.ssot__Id__c}'`).join(',');
    const r2 = await fetch(`${base}/services/data/v67.0/ssot/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: `SELECT Contact_c__c, COUNT(*) as cnt FROM Experience_Booking__dlm WHERE Contact_c__c IN (${ids}) GROUP BY Contact_c__c` }),
    });
    const d2 = await r2.json();
    const countMap = {};
    for (const c of (d2.data || [])) countMap[c.Contact_c__c] = c.cnt;

    const nameMap = {};
    for (const r of rows) {
      const key = `${r.ssot__FirstName__c}|${r.ssot__LastName__c}`.toLowerCase();
      const g = { id: r.ssot__Id__c, firstName: r.ssot__FirstName__c, lastName: r.ssot__LastName__c, birthDate: r.ssot__BirthDate__c, gender: r.ssot__GenderIdentity__c, bookingCount: countMap[r.ssot__Id__c] || 0 };
      if (!nameMap[key] || g.bookingCount > nameMap[key].bookingCount) nameMap[key] = g;
    }
    res.json(Object.values(nameMap));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Data Cloud: full guest profile from data graph
app.post('/api/datacloud/guest', async (req, res) => {
  const { orgAccessToken, orgInstanceUrl, id } = req.body;
  if (!orgAccessToken || !orgInstanceUrl || !id) return res.status(400).json({ error: 'orgAccessToken, orgInstanceUrl, id required' });
  const base = orgInstanceUrl.startsWith('http') ? orgInstanceUrl : `https://${orgInstanceUrl}`;
  const safe = id.replace(/'/g, "''");
  try {
    const [r1, r2] = await Promise.all([
      fetch(`${base}/services/data/v67.0/ssot/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${orgAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: `SELECT ssot__Id__c, ssot__FirstName__c, ssot__LastName__c, ssot__BirthDate__c, ssot__GenderIdentity__c FROM ssot__Individual__dlm WHERE ssot__Id__c = '${safe}' LIMIT 1` }),
      }),
      fetch(`${base}/services/data/v67.0/ssot/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${orgAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: `SELECT Name__c, Experience_Name_c__c, Date_c__c, Status_c__c, Total_Price_c__c, Activity_Level_c__c, Number_of_Guests_c__c FROM Experience_Booking__dlm WHERE Contact_c__c = '${safe}' ORDER BY Date_c__c DESC LIMIT 50` }),
      }),
    ]);
    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);
    const p = (d1.data || [])[0] || {};
    const bList = (d2.data || []).map(b => ({ name: b.Name__c, experience: b.Experience_Name_c__c, date: b.Date_c__c, status: b.Status_c__c, price: b.Total_Price_c__c, activity: b.Activity_Level_c__c, guestCount: b.Number_of_Guests_c__c }));
    const totalSpend = bList.reduce((s, b) => s + (Number(b.price) || 0), 0);
    const activities = bList.reduce((m, b) => { if (b.activity) m[b.activity] = (m[b.activity] || 0) + 1; return m; }, {});
    res.json({ id: p.ssot__Id__c, firstName: p.ssot__FirstName__c, lastName: p.ssot__LastName__c, birthDate: p.ssot__BirthDate__c, gender: p.ssot__GenderIdentity__c, bookings: bList, stats: { totalBookings: bList.length, totalSpend, avgSpend: bList.length ? totalSpend / bList.length : 0, activities } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MCP OAuth ────────────────────────────────────────────────────────────────

const mcpSessions = new Map(); // sessionId → { domain, clientId, clientSecret, accessToken, instanceUrl, connectedAt }

function genId() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

app.post('/api/mcp/initiate', async (req, res) => {
  const { domain, clientId, clientSecret, serverUrl } = req.body;
  if (!domain || !clientId || !clientSecret) return res.status(400).json({ error: 'domain, clientId, clientSecret required' });

  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

  const sessionId = genId();
  mcpSessions.set(sessionId, { domain, clientId, clientSecret, serverUrl: serverUrl || 'https://api.salesforce.com/platform/mcp/v1/data/data360', codeVerifier, createdAt: Date.now() });

  const proto = req.get('x-forwarded-proto') || req.protocol;
  const callbackUrl = `${proto}://${req.get('host')}/oauth/callback`;

  const authUrl = `https://${domain}/services/oauth2/authorize?` + new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: 'refresh_token mcp_api',
    state: sessionId,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  res.json({ authUrl, sessionId });
});

app.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) return res.redirect(`/?mcp_error=${encodeURIComponent(error_description || error)}`);

  const session = state && mcpSessions.get(state);
  if (!session) return res.redirect('/?mcp_error=Session+expired+or+invalid.+Please+start+again.');

  const proto = req.get('x-forwarded-proto') || req.protocol;
  const callbackUrl = `${proto}://${req.get('host')}/oauth/callback`;

  try {
    const r = await fetch(`https://${session.domain}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: session.clientId,
        client_secret: session.clientSecret,
        redirect_uri: callbackUrl,
        ...(session.codeVerifier ? { code_verifier: session.codeVerifier } : {}),
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.access_token) {
      return res.redirect(`/?mcp_error=${encodeURIComponent(data.error_description || data.error || 'Token exchange failed')}`);
    }
    session.accessToken = data.access_token;
    session.refreshToken = data.refresh_token;
    session.instanceUrl = data.instance_url;
    session.connectedAt = Date.now();
    res.redirect(`/?mcp=ok&sid=${state}`);
  } catch (err) {
    res.redirect(`/?mcp_error=${encodeURIComponent(err.message)}`);
  }
});

app.get('/api/mcp/status', (req, res) => {
  const { sid } = req.query;
  const session = sid && mcpSessions.get(sid);
  if (!session?.accessToken) return res.json({ connected: false });
  res.json({ connected: true, domain: session.domain, instanceUrl: session.instanceUrl, serverUrl: session.serverUrl, connectedAt: session.connectedAt });
});

async function mcpPost(session, body) {
  const headers = {
    Authorization: `Bearer ${session.accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (session.mcpSessionKey) headers['Mcp-Session-Id'] = session.mcpSessionKey;

  const r = await fetch(session.serverUrl, { method: 'POST', headers, body: JSON.stringify(body) });

  const key = r.headers.get('Mcp-Session-Id') || r.headers.get('mcp-session-id');
  if (key) session.mcpSessionKey = key;

  return r;
}

async function mcpEnsureSession(session) {
  if (session.mcpSessionKey) return;
  try {
    // Step 1: initialize — server returns Mcp-Session-Id header
    const initR = await mcpPost(session, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'data360-playground', version: '1.0' } },
    });
    await initR.text(); // drain SSE body

    // Step 2: notifications/initialized — activates the session (no id = notification, no response)
    if (session.mcpSessionKey) {
      const notifR = await mcpPost(session, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
      await notifR.text();
    }
  } catch {}
}

app.post('/api/mcp/call', async (req, res) => {
  const { sessionId, method, params } = req.body;
  const session = sessionId && mcpSessions.get(sessionId);
  if (!session?.accessToken) return res.status(401).json({ error: 'Not connected to MCP. Authorize first on the MCP Connect tab.' });

  if (method !== 'initialize') {
    await mcpEnsureSession(session);
  }

  try {
    const r = await mcpPost(session, { jsonrpc: '2.0', id: Date.now(), method, params: params || {} });

    const contentType = r.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
      const text = await r.text();
      const events = text.split('\n\n').filter(Boolean).map(block => {
        const dataLine = block.split('\n').find(l => l.startsWith('data:'));
        if (!dataLine) return null;
        try { return JSON.parse(dataLine.slice(5).trim()); } catch { return { raw: dataLine.slice(5).trim() }; }
      }).filter(Boolean);
      return res.json({ streaming: true, events });
    }

    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/mcp/session', (req, res) => {
  const { sessionId } = req.body;
  if (sessionId) mcpSessions.delete(sessionId);
  res.json({ disconnected: true });
});

async function parseMcpResponse(r) {
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    const text = await r.text();
    const events = text.split('\n\n').filter(Boolean).map(block => {
      const dataLine = block.split('\n').find(l => l.startsWith('data:'));
      if (!dataLine) return null;
      try { return JSON.parse(dataLine.slice(5).trim()); } catch { return null; }
    }).filter(Boolean);
    return events[0];
  }
  return r.json();
}

// ── AI Chat (Gemini + MCP tools) ──────────────────────────────────────────────

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';

const SYSTEM_PROMPT = `You are a helpful Data 360 AI assistant for Coral Cloud Resorts. You have access to tools that can query and manage Salesforce Data Cloud. Use them to answer questions about guests, bookings, revenue, calculated insights, and experiences. Be concise, highlight key insights, and format numbers clearly. If a question requires data you cannot access with the available tools, say so.`;

app.post('/api/chat', async (req, res) => {
  const { sessionId, messages } = req.body;
  const session = sessionId && mcpSessions.get(sessionId);
  if (!session?.accessToken) return res.status(401).json({ error: 'Not connected to MCP. Connect on the MCP Connect tab first.' });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'GEMINI_API_KEY not configured on this server.' });

  await mcpEnsureSession(session);

  // Cache tools list per MCP session
  if (!session.tools) {
    try {
      const r = await mcpPost(session, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      const data = await parseMcpResponse(r);
      session.tools = data?.result?.tools || [];
    } catch { session.tools = []; }
  }

  const functionDeclarations = session.tools.map(t => ({
    name: t.name,
    description: t.description || '',
    parameters: t.inputSchema || { type: 'object', properties: {} },
  }));

  // Build conversation — skip the welcome model message, start from first user turn
  const firstUserIdx = messages.findIndex(m => m.role === 'user');
  if (firstUserIdx < 0) return res.json({ text: 'Please send a message.', toolsUsed: [] });

  let loopContents = messages.slice(firstUserIdx).map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }));

  const toolsUsed = [];

  for (let iter = 0; iter < 6; iter++) {
    const geminiBody = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: loopContents,
      ...(functionDeclarations.length ? { tools: [{ functionDeclarations }] } : {}),
    };

    const r = await fetch(`${GEMINI_URL}?key=${process.env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.error?.message || JSON.stringify(data.error) });

    const parts = data.candidates?.[0]?.content?.parts || [];
    const funcPart = parts.find(p => p.functionCall);

    if (!funcPart) {
      const text = parts.map(p => p.text || '').join('').trim();
      return res.json({ text: text || '(no response)', toolsUsed });
    }

    const { name, args } = funcPart.functionCall;
    let toolResult = '';
    try {
      const toolR = await mcpPost(session, {
        jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
        params: { name, arguments: args },
      });
      const toolData = await parseMcpResponse(toolR);
      const content = toolData?.result?.content;
      toolResult = Array.isArray(content)
        ? content.map(c => c.text || JSON.stringify(c)).join('\n').slice(0, 8000)
        : JSON.stringify(toolData?.result || toolData).slice(0, 8000);
    } catch (err) {
      toolResult = `Error: ${err.message}`;
    }

    toolsUsed.push({ name, args });

    loopContents = [
      ...loopContents,
      { role: 'model', parts: [{ functionCall: { name, args } }] },
      { role: 'user', parts: [{ functionResponse: { name, response: { output: toolResult } } }] },
    ];
  }

  return res.json({ text: 'Too many tool calls — try a more specific question.', toolsUsed });
});

// ── Agentforce ───────────────────────────────────────────────────────────────


app.post('/api/agent/session', async (req, res) => {
  let { orgAccessToken, orgInstanceUrl, agentId } = req.body;
  if (!orgAccessToken || !orgInstanceUrl || !agentId)
    return res.status(400).json({ error: 'orgAccessToken, orgInstanceUrl, agentId required' });
  const base = orgInstanceUrl.startsWith('http') ? orgInstanceUrl : `https://${orgInstanceUrl}`;

  // If it doesn't look like a Salesforce ID (15/18 alphanumeric chars), treat as API name
  const looksLikeId = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(agentId);
  if (!looksLikeId) {
    try {
      const q = encodeURIComponent(`SELECT Id FROM GenAiAgent WHERE DeveloperName = '${agentId.replace(/'/g, "\\'")}'`);
      const lr = await fetch(`${base}/services/data/v62.0/tooling/query/?q=${q}`, {
        headers: { Authorization: `Bearer ${orgAccessToken}` },
      });
      const ld = await lr.json();
      if (!lr.ok) return res.status(lr.status).json({ error: `Tooling API error: ${JSON.stringify(ld)}` });
      const record = (ld.records || [])[0];
      if (!record) return res.status(404).json({ error: `No GenAiAgent found with DeveloperName "${agentId}". Tooling query returned ${ld.totalSize} records. Try entering the 18-char ID directly from Setup → Agents URL instead.` });
      agentId = record.Id;
    } catch (err) {
      return res.status(500).json({ error: `Failed to look up agent by API name: ${err.message}` });
    }
  }

  const externalSessionKey = Date.now().toString(36) + Math.random().toString(36).slice(2);
  // Try v63.0 first (new Agentforce Studio agents), fall back to v62.0
  const versions = ['v63.0', 'v62.0'];
  let lastData, lastStatus;
  for (const ver of versions) {
    try {
      const r = await fetch(`${base}/services/data/${ver}/einstein/ai/agent/sessions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${orgAccessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          externalSessionKey,
          instanceConfig: { endpoint: base },
          streamingCapabilities: { chunkTypes: ['Text'] },
          bypassUser: { userId: '' },
        }),
      });
      lastData = await r.json();
      lastStatus = r.status;
      if (r.ok) return res.status(r.status).json(lastData);
    } catch (err) {
      lastData = { error: err.message };
      lastStatus = 500;
    }
  }
  res.status(lastStatus).json(lastData);
});

app.post('/api/agent/message', async (req, res) => {
  const { orgAccessToken, orgInstanceUrl, sessionId, text } = req.body;
  if (!orgAccessToken || !orgInstanceUrl || !sessionId || !text)
    return res.status(400).json({ error: 'orgAccessToken, orgInstanceUrl, sessionId, text required' });
  const base = orgInstanceUrl.startsWith('http') ? orgInstanceUrl : `https://${orgInstanceUrl}`;
  try {
    const r = await fetch(`${base}/services/data/v63.0/einstein/ai/agent/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${orgAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: { role: 'user', content: [{ type: 'text', text }] },
        variables: [],
      }),
    });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/agent/session/:sessionId', async (req, res) => {
  const { orgAccessToken, orgInstanceUrl } = req.body;
  const { sessionId } = req.params;
  if (!orgAccessToken || !orgInstanceUrl)
    return res.status(400).json({ error: 'orgAccessToken, orgInstanceUrl required' });
  const base = orgInstanceUrl.startsWith('http') ? orgInstanceUrl : `https://${orgInstanceUrl}`;
  try {
    const r = await fetch(`${base}/services/data/v63.0/einstein/ai/agent/sessions/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${orgAccessToken}` },
    });
    res.status(r.ok ? 200 : r.status).json({ ended: r.ok });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve Vite-built frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(join(__dirname, 'dist')));
  app.get('*', (req, res) => {
    res.sendFile(join(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

import { useState, useEffect, useRef } from 'react';

// ── Helpers ──────────────────────────────────────────────────────

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function fmtDate(d) {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function fmtPrice(p) {
  if (p == null || p === '') return null;
  const n = Number(p);
  if (isNaN(n)) return null;
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function guestAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
}

function initials(f, l) { return ((f || '?')[0] + (l || '?')[0]).toUpperCase(); }

const PALETTE = [
  ['#3b82f6', '#1d4ed8'], ['#06b6d4', '#0e7490'], ['#a78bfa', '#7c3aed'],
  ['#10b981', '#065f46'], ['#f59e0b', '#92400e'], ['#f43f5e', '#9f1239'],
  ['#6366f1', '#4338ca'], ['#ec4899', '#9d174d'],
];

function avatarGrad(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return PALETTE[Math.abs(h) % PALETTE.length];
}

function statusClass(s) {
  if (!s) return 'default';
  const t = s.toLowerCase();
  if (t.includes('complet')) return 'completed';
  if (t.includes('pend')) return 'pending';
  if (t.includes('cancel')) return 'cancelled';
  if (t.includes('confirm')) return 'confirmed';
  return 'default';
}

const DOT_COLOR = { completed: '#10b981', pending: '#f59e0b', cancelled: '#f43f5e', confirmed: '#06b6d4', default: '#475569' };

// ── Sample data ───────────────────────────────────────────────────

const SAMPLE_SINGLE = {
  data: [{
    device_id: 'a1b2c3d4e5f6-4b0c-b264-7a358e8a81b41',
    device_OS: 'iPadOS 16.7.10',
    session_id: '3c103817-b2da-4ce1-91de-652e69a55f81',
    session_datetime: new Date().toISOString(),
    email: 'jschmidt.10021.0269@aol.exacttargettest.com',
    first_name: 'Jane',
    last_name: 'Schmidt',
  }],
};

const SAMPLE_MULTIPLE = {
  data: [
    { device_id: 'a1b2c3d4e5f6-4b0c-b265-7a358e8a81b50', device_OS: 'iOS 16.7.10', session_id: 'be7e26fa-88c5-4be0-8ddd-e96cee645cbf', session_datetime: new Date().toISOString(), email: '', first_name: 'James', last_name: 'Davis' },
    { device_id: '5ea21294-00b3-469f-b306-aB42d560ce2d', device_OS: 'iOS 16.7.10', session_id: '3c103817-b2da-4ce1-91de-652e69a55f82', session_datetime: new Date(Date.now() - 120_000).toISOString(), email: '', first_name: 'Sarah', last_name: 'Taylor' },
    { device_id: '2r8461b6-082b-4c83-bbee-40254d023fd0', device_OS: 'iOS 16.7.10', session_id: '3c103817-b2da-4ce1-91de-652e69a55f83', session_datetime: new Date(Date.now() - 180_000).toISOString(), email: 'mary.johnson1@example.com', first_name: 'Mary', last_name: 'Johnson' },
    { device_id: 'ff9db0ee-6058-4701-8f4d-ac7d2f875e74', device_OS: 'Android 14', session_id: '3c103817-b2da-4ce1-91de-652e69a55f84', session_datetime: new Date(Date.now() - 240_000).toISOString(), email: 'lwhite@example.com', first_name: 'Lisa', last_name: 'Smith' },
  ],
};

const SAMPLE_LOYALTY = {
  data: [{
    description: 'This will make them Titanium.',
    guest_id: '151',
    transaction_type: 'earn',
    transaction_date: new Date().toISOString(),
    transaction_id: '999999',
    points: 2345,
  }],
};

const STORAGE_KEY = 'dc_playground_creds';

const TABS = [
  { id: 'auth', label: 'Authenticate' },
  { id: 'batch', label: 'Batch Ingestion API' },
  { id: 'streaming', label: 'Streaming Ingestion API' },
  { id: 'graphs', label: 'Data Graphs' },
  { id: 'action', label: 'Data Action' },
  { id: 'webhook', label: 'Webhook Receiver' },
  { id: 'agent', label: 'Service Agent' },
];

// ── Shared components ─────────────────────────────────────────────

function BulkStepList({ steps }) {
  return (
    <div className="bulk-steps">
      {steps.map((s, i) => (
        <div key={i} className={`bulk-step bulk-step-${s.status}`}>
          <span className="step-icon">{s.status === 'ok' ? '✓' : s.status === 'error' ? '✗' : '⋯'}</span>
          <div>
            <div className="step-label">{s.label}</div>
            {s.detail && <div className="step-detail">{typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PreviewTable({ rows, maxRows = 5 }) {
  if (!rows?.length) return null;
  const cols = Object.keys(rows[0]);
  return (
    <div className="preview-wrap">
      <div className="preview-meta">{rows.length} rows (preview)</div>
      <div className="preview-scroll">
        <table className="preview-table">
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, maxRows).map((row, i) => (
              <tr key={i}>
                {cols.map((c, j) => (
                  <td key={j}>{row[c] === null ? <span className="null-val">null</span> : String(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > maxRows && <p className="preview-more">…{rows.length - maxRows} more rows</p>}
      </div>
    </div>
  );
}

function GateMessage() {
  return (
    <div className="gate-msg">
      <span className="gate-icon">🔒</span>
      <p>Authenticate first on the <strong>Authenticate</strong> tab.</p>
    </div>
  );
}

// ── Tab: Authenticate ─────────────────────────────────────────────

function AuthTab({ authState, onAuth }) {
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; } })();
  const [domain, setDomain] = useState(saved.domain || '');
  const [clientId, setClientId] = useState(saved.clientId || '');
  const [clientSecret, setClientSecret] = useState(saved.clientSecret || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function authenticate() {
    setLoading(true);
    setError('');
    if (domain || clientId) localStorage.setItem(STORAGE_KEY, JSON.stringify({ domain, clientId, clientSecret }));
    try {
      const r1 = await fetch('/api/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, clientId, clientSecret }),
      });
      const d1 = await r1.json();
      if (!r1.ok || !d1.access_token) {
        setError(`Step 1 failed — ${d1.error_description || d1.error || JSON.stringify(d1)}`);
        return;
      }
      const r2 = await fetch('/api/dc-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceUrl: d1.instance_url, orgAccessToken: d1.access_token }),
      });
      const d2 = await r2.json();
      if (!r2.ok || !d2.access_token) {
        setError(`Step 2 failed — ${d2.error_description || d2.error || JSON.stringify(d2)}`);
        return;
      }
      onAuth({
        orgAccessToken: d1.access_token,
        orgInstanceUrl: d1.instance_url,
        dcInstanceUrl: d2.instance_url,
        dcAccessToken: d2.access_token,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const canAuth = domain && clientId && clientSecret && !loading;

  return (
    <div className="tab-content">
      <div className="tab-section">
        <h3 className="section-heading">Connected App Credentials</h3>
        <p className="section-desc">Enter your Salesforce org credentials. The app will obtain an org access token, then exchange it for a Data Cloud token.</p>
        <div className="field-group">
          <div className="field full-width">
            <label>Salesforce Domain</label>
            <input type="text" placeholder="myorg.my.salesforce.com" value={domain}
              onChange={e => setDomain(e.target.value.trim())} autoComplete="off" />
            <span className="hint">Your My Domain URL — without https://</span>
          </div>
          <div className="field">
            <label>Consumer Key (Client ID)</label>
            <input type="text" placeholder="3MVG9..." value={clientId}
              onChange={e => setClientId(e.target.value.trim())} autoComplete="off" />
          </div>
          <div className="field">
            <label>Consumer Secret</label>
            <input type="password" placeholder="Your Connected App secret" value={clientSecret}
              onChange={e => setClientSecret(e.target.value.trim())} autoComplete="off" />
          </div>
        </div>
        <button className="btn-primary" onClick={authenticate} disabled={!canAuth}>
          {loading ? <><span className="spinner" /> Authenticating…</> : 'Authenticate'}
        </button>
        {error && <div className="alert alert-error"><strong>Authentication failed</strong><p>{error}</p></div>}
        {authState && (
          <div className="alert alert-success">
            <strong>✓ Authenticated — tokens ready</strong>
            <p className="token-url">{authState.dcInstanceUrl}</p>
          </div>
        )}
      </div>

      {authState && (
        <div className="tab-section">
          <h3 className="section-heading">Token Details</h3>
          <div className="token-detail-row">
            <span className="token-detail-label">Org Instance URL</span>
            <code className="token-detail-val">{authState.orgInstanceUrl}</code>
          </div>
          <div className="token-detail-row">
            <span className="token-detail-label">Org Access Token</span>
            <code className="token-detail-val token-truncate">{authState.orgAccessToken?.slice(0, 40)}…</code>
          </div>
          <div className="token-detail-row">
            <span className="token-detail-label">DC Instance URL</span>
            <code className="token-detail-val">{authState.dcInstanceUrl}</code>
          </div>
          <div className="token-detail-row">
            <span className="token-detail-label">DC Access Token</span>
            <code className="token-detail-val token-truncate">{authState.dcAccessToken?.slice(0, 40)}…</code>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared streaming send logic ───────────────────────────────────

function StreamingPanel({ authState, defaultConnector, defaultObject, samples, showFreshIds }) {
  const [connectorName, setConnectorName] = useState(defaultConnector);
  const [objectName, setObjectName] = useState(defaultObject);
  const [payload, setPayload] = useState(JSON.stringify(samples[0].data, null, 2));
  const [payloadError, setPayloadError] = useState('');
  const [response, setResponse] = useState(null);
  const [sending, setSending] = useState(false);

  function loadSample(sample, connector, object) {
    const copy = JSON.parse(JSON.stringify(sample));
    const now = new Date();
    copy.data.forEach((rec, i) => {
      if ('session_datetime' in rec) rec.session_datetime = new Date(now - i * 120_000).toISOString();
      if ('transaction_date' in rec) rec.transaction_date = new Date(now - i * 120_000).toISOString();
    });
    if (connector) setConnectorName(connector);
    if (object) setObjectName(object);
    setPayload(JSON.stringify(copy, null, 2));
    setPayloadError('');
    setResponse(null);
  }

  function freshIds() {
    try {
      const parsed = JSON.parse(payload);
      const now = new Date();
      (parsed.data || []).forEach((rec, i) => {
        if ('session_id' in rec) rec.session_id = uuid();
        if ('device_id' in rec) rec.device_id = uuid();
        if ('session_datetime' in rec) rec.session_datetime = new Date(now - i * 120_000).toISOString();
        if ('transaction_date' in rec) rec.transaction_date = new Date(now - i * 120_000).toISOString();
        if ('transaction_id' in rec) rec.transaction_id = String(Math.floor(Math.random() * 9_000_000 + 1_000_000));
      });
      setPayload(JSON.stringify(parsed, null, 2));
      setPayloadError('');
    } catch (e) {
      setPayloadError('Invalid JSON: ' + e.message);
    }
  }

  async function send() {
    setPayloadError('');
    setResponse(null);
    let parsed;
    try { parsed = JSON.parse(payload); } catch (e) { setPayloadError('Invalid JSON: ' + e.message); return; }
    setSending(true);
    try {
      const r = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dcInstanceUrl: authState.dcInstanceUrl, dcAccessToken: authState.dcAccessToken, connectorName, objectName, payload: parsed }),
      });
      const data = await r.json();
      setResponse({ status: r.status, ok: r.ok, body: data });
    } catch (err) {
      setResponse({ status: 0, ok: false, body: { error: err.message } });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="tab-section">
        <h3 className="section-heading">Target Stream</h3>
        <div className="inline-fields">
          <div className="field">
            <label>Connector</label>
            <input type="text" value={connectorName} onChange={e => setConnectorName(e.target.value.trim())} />
          </div>
          <div className="field">
            <label>Object</label>
            <input type="text" value={objectName} onChange={e => setObjectName(e.target.value.trim())} />
          </div>
        </div>
        <div className="endpoint-bar">
          POST <span className="endpoint-path">/api/v1/ingest/sources/{connectorName}/{objectName}</span>
        </div>
      </div>

      <div className="tab-section">
        <h3 className="section-heading">Payload</h3>
        <div className="preset-row">
          <span className="preset-label">Load sample:</span>
          {samples.map((s, i) => (
            <button key={i} className="btn-ghost" onClick={() => loadSample(s.data, s.connector, s.object)}>{s.label}</button>
          ))}
          {showFreshIds && (
            <button className="btn-ghost" onClick={freshIds} title="Regenerate IDs and timestamps">↻ Fresh IDs</button>
          )}
        </div>
        <textarea className="code-editor" value={payload} rows={18} spellCheck={false}
          onChange={e => { setPayload(e.target.value); setPayloadError(''); }} />
        {payloadError && <div className="alert alert-error"><strong>Invalid JSON</strong><p>{payloadError}</p></div>}
        <button className="btn-primary" onClick={send} disabled={sending}>
          {sending ? <><span className="spinner" /> Sending…</> : 'Send to Data Cloud'}
        </button>
      </div>

      {response && (
        <div className="tab-section">
          <h3 className="section-heading">
            Response
            <span className={`resp-badge ${response.ok ? 'resp-ok' : 'resp-err'}`}>
              HTTP {response.status} {response.ok ? '✓' : '✗'}
            </span>
          </h3>
          <pre className="response-body">{JSON.stringify(response.body, null, 2)}</pre>
          {response.ok && <p className="response-tip">Data accepted. Check <strong>Data Cloud → Data Explorer → {connectorName}-{objectName}</strong> to verify.</p>}
        </div>
      )}
    </>
  );
}

// ── Tab: Streaming Ingestion API ──────────────────────────────────

function StreamingTab({ authState }) {
  if (!authState) return <GateMessage />;
  return (
    <div className="tab-content">
      <StreamingPanel
        authState={authState}
        defaultConnector="CCRMobile"
        defaultObject="user_session"
        showFreshIds
        samples={[
          { label: 'Single session', connector: 'CCRMobile', object: 'user_session', data: SAMPLE_SINGLE },
          { label: '4 sessions', connector: 'CCRMobile', object: 'user_session', data: SAMPLE_MULTIPLE },
        ]}
      />
    </div>
  );
}

// ── Tab: Data Action ──────────────────────────────────────────────

function DataActionTab({ authState }) {
  if (!authState) return <GateMessage />;
  return (
    <div className="tab-content">
      <StreamingPanel
        authState={authState}
        defaultConnector="CCRLoyalty"
        defaultObject="points_transactions"
        showFreshIds={false}
        samples={[
          { label: 'Loyalty transaction', connector: 'CCRLoyalty', object: 'points_transactions', data: SAMPLE_LOYALTY },
        ]}
      />
    </div>
  );
}

// ── Tab: Batch Ingestion API ──────────────────────────────────────

function BatchTab({ authState }) {
  const [sourceName, setSourceName] = useState('CCRLoyalty');
  const [tables, setTables] = useState(null);
  const [tablesError, setTablesError] = useState('');
  const [loadingTables, setLoadingTables] = useState(false);
  const [tableResults, setTableResults] = useState({});
  const [ingestingAll, setIngestingAll] = useState(false);

  async function fetchTables() {
    setLoadingTables(true);
    setTablesError('');
    try {
      const r = await fetch('/api/mysql/tables');
      const data = await r.json();
      if (!r.ok) { setTablesError(data.error || JSON.stringify(data)); return; }
      setTables(data.tables.map(t => ({ ...t, objectName: t.name, checked: true })));
    } catch (err) {
      setTablesError(err.message);
    } finally {
      setLoadingTables(false);
    }
  }

  function toggleTable(name) {
    setTables(prev => prev.map(t => t.name === name ? { ...t, checked: !t.checked } : t));
  }

  function updateObjectName(name, value) {
    setTables(prev => prev.map(t => t.name === name ? { ...t, objectName: value } : t));
  }

  async function previewTable(table) {
    setTableResults(prev => ({ ...prev, [table.name]: { ...prev[table.name], previewing: true, previewError: '', previewRows: null } }));
    try {
      const r = await fetch('/api/mysql/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `SELECT * FROM \`${table.name}\``, limit: 50 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || JSON.stringify(data));
      setTableResults(prev => ({ ...prev, [table.name]: { ...prev[table.name], previewing: false, previewRows: data.rows } }));
    } catch (err) {
      setTableResults(prev => ({ ...prev, [table.name]: { ...prev[table.name], previewing: false, previewError: err.message } }));
    }
  }

  async function ingestTable(table) {
    setTableResults(prev => ({ ...prev, [table.name]: { ...prev[table.name], ingesting: true, steps: null } }));
    try {
      const rowsRes = await fetch('/api/mysql/query', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `SELECT * FROM \`${table.name}\``, applyLimit: false }),
      });
      const rowsData = await rowsRes.json();
      if (!rowsRes.ok) throw new Error(rowsData.error);
      const r = await fetch('/api/ingest/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dcInstanceUrl: authState.dcInstanceUrl, dcAccessToken: authState.dcAccessToken, sourceName, objectName: table.objectName, rows: rowsData.rows }),
      });
      const data = await r.json();
      setTableResults(prev => ({ ...prev, [table.name]: { ...prev[table.name], ingesting: false, steps: data.steps, state: data.state } }));
    } catch (err) {
      setTableResults(prev => ({ ...prev, [table.name]: { ...prev[table.name], ingesting: false, steps: [{ label: 'Error', status: 'error', detail: err.message }] } }));
    }
  }

  async function ingestSelected() {
    const selected = (tables || []).filter(t => t.checked);
    setIngestingAll(true);
    for (const table of selected) await ingestTable(table);
    setIngestingAll(false);
  }

  if (!authState) return <GateMessage />;

  return (
    <div className="tab-content">
      <div className="tab-section">
        <h3 className="section-heading">Source Configuration</h3>
        <div className="endpoint-bar" style={{ marginBottom: 0 }}>
          POST → PUT (CSV) → PATCH (UploadComplete)
          <span className="endpoint-path"> /api/v1/ingest/jobs</span>
        </div>
      </div>
      <div className="tab-section">
        <div className="toolbar-row">
          <div className="field" style={{ maxWidth: 260 }}>
            <label>Source Name (connector)</label>
            <input type="text" value={sourceName} onChange={e => setSourceName(e.target.value.trim())} />
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <button className="btn-ghost" onClick={fetchTables} disabled={loadingTables}>
              {loadingTables ? <><span className="spinner spinner-dark" /> Loading…</> : tables ? '↻ Refresh Tables' : 'Load Tables'}
            </button>
            {tables && (
              <button className="btn-primary" onClick={ingestSelected}
                disabled={ingestingAll || !(tables || []).some(t => t.checked)}>
                {ingestingAll ? <><span className="spinner" /> Ingesting…</> : `Ingest Selected (${(tables || []).filter(t => t.checked).length})`}
              </button>
            )}
          </div>
        </div>
        {tablesError && <div className="alert alert-error"><strong>Error</strong><p>{tablesError}</p></div>}
        {tables && (
          <div className="table-browser">
            <div className="table-browser-header">
              <span />
              <span className="col-table">Table</span>
              <span className="col-rows">Rows</span>
              <span className="col-object">DC Object Name</span>
              <span className="col-actions" />
            </div>
            {tables.map(t => {
              const res = tableResults[t.name] || {};
              return (
                <div key={t.name} className={`table-row${t.checked ? '' : ' table-row-dim'}`}>
                  <div className="table-row-main">
                    <input type="checkbox" className="table-checkbox" checked={t.checked} onChange={() => toggleTable(t.name)} />
                    <span className="col-table">{t.name}</span>
                    <span className="col-rows">{t.rowCount.toLocaleString()}</span>
                    <input type="text" className="object-name-input" value={t.objectName}
                      onChange={e => updateObjectName(t.name, e.target.value.trim())} />
                    <div className="col-actions">
                      <button className="btn-ghost btn-xs" onClick={() => previewTable(t)} disabled={res.previewing}>
                        {res.previewing ? '…' : 'Preview'}
                      </button>
                      <button className="btn-ghost btn-xs" onClick={() => ingestTable(t)} disabled={res.ingesting || ingestingAll}>
                        {res.ingesting ? <><span className="spinner spinner-dark spinner-xs" /> Ingesting</> : 'Ingest'}
                      </button>
                    </div>
                  </div>
                  {res.previewError && <div className="row-error">{res.previewError}</div>}
                  {res.previewRows && <div style={{ margin: '0 28px 8px' }}><PreviewTable rows={res.previewRows} maxRows={5} /></div>}
                  {res.steps && <div style={{ margin: '0 28px 8px' }}><BulkStepList steps={res.steps} /></div>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Data Graphs ──────────────────────────────────────────────

function DataGraphsTab({ authState }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selectedGuest, setSelectedGuest] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileError, setProfileError] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    if (!query.trim()) { setResults(null); setSearchError(''); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(query.trim()), 350);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  async function doSearch(q) {
    setSearching(true);
    setSearchError('');
    try {
      const r = await fetch('/api/datacloud/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgAccessToken: authState.orgAccessToken, orgInstanceUrl: authState.orgInstanceUrl, q }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || JSON.stringify(data));
      setResults(data);
    } catch (err) {
      setSearchError(err.message);
      setResults(null);
    } finally {
      setSearching(false);
    }
  }

  async function loadProfile(id) {
    setLoadingProfile(true);
    setProfileError('');
    setSelectedGuest(null);
    try {
      const r = await fetch('/api/datacloud/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgAccessToken: authState.orgAccessToken, orgInstanceUrl: authState.orgInstanceUrl, id }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || JSON.stringify(data));
      setSelectedGuest(data);
    } catch (err) {
      setProfileError(err.message);
    } finally {
      setLoadingProfile(false);
    }
  }

  if (!authState) return <GateMessage />;

  // ── Profile view ──
  if (loadingProfile) {
    return (
      <div className="tab-content">
        <div className="profile-loading">
          <div className="profile-spinner" />
          <span>Loading profile…</span>
        </div>
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="tab-content">
        <button className="back-btn" onClick={() => { setProfileError(''); setSelectedGuest(null); }}>← Back to search</button>
        <div className="alert alert-error"><strong>Error loading profile</strong><p>{profileError}</p></div>
      </div>
    );
  }

  if (selectedGuest) {
    const g = selectedGuest;
    const name = `${g.firstName || ''} ${g.lastName || ''}`.trim() || 'Unknown Guest';
    const [c1, c2] = avatarGrad(name);
    const ini = initials(g.firstName, g.lastName);
    const ageVal = guestAge(g.birthDate);
    const s = g.stats || {};
    const bookings = g.bookings || [];
    const actEntries = Object.entries(s.activities || {}).sort((a, b) => b[1] - a[1]);
    const topActivity = actEntries[0]?.[0] || null;

    const chips = [];
    if (ageVal) chips.push(`${ageVal} yrs old`);
    if (g.birthDate) chips.push(`Born ${fmtDate(g.birthDate)}`);
    if (g.gender) chips.push(g.gender);
    if (topActivity) chips.push(`⚡ ${topActivity}`);

    return (
      <div className="tab-content">
        <button className="back-btn" onClick={() => setSelectedGuest(null)}>← Back to search</button>

        <div className="profile-hero">
          <div className="hero-glow" style={{ background: `radial-gradient(circle, ${c1}, transparent)` }} />
          <div className="hero-avatar" style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}>{ini}</div>
          <div className="hero-info">
            <div className="hero-label">Unified Individual · Data Graph</div>
            <div className="hero-name">{name}</div>
            <div className="hero-chips">
              {chips.map((ch, i) => <span key={i} className="hero-chip">{ch}</span>)}
            </div>
          </div>
          <div className="hero-source">Data Cloud<br />Guest Overview<br />Data Graph</div>
        </div>

        <div className="profile-stats">
          <div className="stat-tile">
            <div className="stat-tile-label">Total Bookings</div>
            <div className="stat-tile-value">{s.totalBookings || 0}</div>
            <div className="stat-tile-sub">experience reservations</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Lifetime Spend</div>
            <div className="stat-tile-value" style={{ fontSize: 26 }}>{fmtPrice(s.totalSpend) || '—'}</div>
            <div className="stat-tile-sub">total revenue</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Avg per Booking</div>
            <div className="stat-tile-value" style={{ fontSize: 26 }}>{fmtPrice(s.avgSpend) || '—'}</div>
            <div className="stat-tile-sub">spend per experience</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Activity Profile</div>
            <div className="stat-tile-value" style={{ fontSize: 20 }}>{topActivity || '—'}</div>
            <div className="stat-tile-sub">{actEntries.map(([k, v]) => `${k} ×${v}`).join(' · ') || 'no data'}</div>
          </div>
        </div>

        <div className="bookings-card">
          <div className="bookings-header">
            <span className="bookings-title">Experience Bookings</span>
            <span className="bookings-count">{bookings.length}</span>
          </div>
          {bookings.length === 0 && <div className="no-bookings">No bookings found.</div>}
          {bookings.map((b, i) => {
            const sc = statusClass(b.status);
            const dot = DOT_COLOR[sc] || DOT_COLOR.default;
            return (
              <div key={i} className="booking-row">
                <div className="dot-col">
                  <div className="booking-dot" style={{ background: dot, boxShadow: `0 0 6px ${dot}` }} />
                  {i < bookings.length - 1 && <div className="dot-line" />}
                </div>
                <div className="booking-main">
                  <div className="booking-experience">{b.experience || 'Experience'}</div>
                  {b.name && <div className="booking-ref">{b.name}</div>}
                  <div className="booking-tags">
                    {b.status && <span className={`tag tag-${sc}`}>{b.status}</span>}
                    {b.activity && <span className="tag tag-activity">{b.activity} activity</span>}
                    {b.guestCount && <span className="tag tag-guests">👥 {b.guestCount} guests</span>}
                  </div>
                </div>
                <div className="booking-price-col">
                  {fmtPrice(b.price) && <div className="booking-price">{fmtPrice(b.price)}</div>}
                  {fmtDate(b.date) && <div className="booking-date">{fmtDate(b.date)}</div>}
                </div>
              </div>
            );
          })}
        </div>

        <div className="graph-footer">ssot__Individual__dlm + Experience_Booking__dlm · Guest Overview Data Graph</div>
      </div>
    );
  }

  // ── Search view ──
  return (
    <div className="tab-content">
      <div className="search-stage">
        <div className="search-eyebrow">Unified Individual · Data Graph</div>
        <h2 className="search-headline">Find a <em>Guest</em></h2>
        <p className="search-sub">Search by first or last name — powered by Data 360</p>

        <div className="search-box-wrap">
          <input
            className="search-box"
            type="text"
            autoComplete="off"
            placeholder="Type a guest name…"
            spellCheck="false"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <span className="search-icon">🔍</span>
        </div>

        {!query && <p className="search-hint">Try: <strong>Findley</strong>, <strong>Rivera</strong>, <strong>Kim</strong>…</p>}

        {searching && (
          <div className="searching-row">
            <div className="mini-spinner" />
            <span>Searching…</span>
          </div>
        )}

        {searchError && (
          <div className="alert alert-error" style={{ width: '100%', maxWidth: 600, marginTop: 12 }}>
            <strong>Search error</strong><p>{searchError}</p>
          </div>
        )}

        {results && !searching && (
          <div className="results-list">
            {results.length === 0
              ? <div className="no-results">No guests found for "<strong>{query}</strong>"</div>
              : results.map(g => {
                  const name = `${g.firstName || ''} ${g.lastName || ''}`.trim();
                  const [gc1, gc2] = avatarGrad(name);
                  const ini2 = initials(g.firstName, g.lastName);
                  const ageStr = g.birthDate ? `Age ${guestAge(g.birthDate)} · ` : '';
                  const bStr = g.bookingCount === 1 ? '1 booking' : `${g.bookingCount} bookings`;
                  return (
                    <div key={g.id} className="result-item" onClick={() => loadProfile(g.id)}>
                      <div className="result-avatar" style={{ background: `linear-gradient(135deg, ${gc1}, ${gc2})` }}>{ini2}</div>
                      <div>
                        <div className="result-name">{name}</div>
                        <div className="result-meta">{ageStr}{bStr}</div>
                      </div>
                      <span className="result-arrow">›</span>
                    </div>
                  );
                })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Webhook Receiver ─────────────────────────────────────────

function WebhookTab() {
  const [events, setEvents] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [justCleared, setJustCleared] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [urlVia, setUrlVia] = useState('local');
  const pollRef = useRef(null);

  async function fetchEvents() {
    try {
      const r = await fetch('/api/webhook/events');
      if (r.ok) setEvents(await r.json());
    } catch {}
  }

  async function refreshUrl() {
    try {
      const r = await fetch('/api/webhook/url');
      if (r.ok) {
        const d = await r.json();
        setWebhookUrl(d.url);
        setUrlVia(d.via);
      }
    } catch {}
  }

  useEffect(() => {
    refreshUrl();
    fetchEvents();
    pollRef.current = setInterval(() => { fetchEvents(); refreshUrl(); }, 3000);
    return () => clearInterval(pollRef.current);
  }, []);

  async function clearEvents() {
    await fetch('/api/webhook/events', { method: 'DELETE' });
    setEvents([]);
    setExpanded({});
    setJustCleared(true);
    setTimeout(() => setJustCleared(false), 2000);
  }

  function toggleExpand(id) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div className="tab-content">
      {/* URL card */}
      <div className="tab-section">
        <h3 className="section-heading">Webhook Endpoint</h3>
        <p className="section-desc">
          Paste this URL into your Data 360 Data Action as the webhook target. Data 360 will POST
          the event payload here whenever the action fires.
        </p>
        {urlVia === 'local' && (
          <div className="alert alert-warn" style={{ marginBottom: 12 }}>
            <strong>⚠ localhost URL detected</strong>
            <p>Data 360 cannot reach localhost. Run <code>ngrok http 3000</code> in your terminal to get a public HTTPS URL — it will appear here automatically.</p>
          </div>
        )}
        {urlVia === 'ngrok' && (
          <div className="alert alert-success" style={{ marginBottom: 12 }}>
            <strong>✓ ngrok tunnel active</strong>
            <p>Public URL detected. Copy it below and paste into your Data Action.</p>
          </div>
        )}
        <div className="webhook-url-row">
          <code className="webhook-url">{webhookUrl || '…'}</code>
          <button className="btn-ghost btn-xs" onClick={() => navigator.clipboard.writeText(webhookUrl)} disabled={!webhookUrl}>
            Copy
          </button>
        </div>
        <div className="webhook-setup-steps">
          <div className="setup-step"><span className="setup-num">1</span>In Data 360 → <strong>Data Actions</strong> → New Data Action</div>
          <div className="setup-step"><span className="setup-num">2</span>Set Type to <strong>Webhook</strong>, paste the URL above</div>
          <div className="setup-step"><span className="setup-num">3</span>Attach to a Segment or Calculated Insight trigger</div>
          <div className="setup-step"><span className="setup-num">4</span>When the trigger fires, the payload appears below in real time</div>
        </div>
      </div>

      {/* Live feed */}
      <div className="tab-section">
        <h3 className="section-heading">
          Live Event Feed
          <span className="wh-badge">{events.length}</span>
          <span className="wh-live-dot" title="Polling every 3s" />
          <button className="btn-ghost btn-xs" style={{ marginLeft: 'auto' }} onClick={clearEvents}>
            {justCleared ? 'Cleared ✓' : 'Clear all'}
          </button>
        </h3>

        {events.length === 0 ? (
          <div className="wh-empty">
            <div className="wh-empty-icon">📡</div>
            <p>Listening for events… nothing received yet.</p>
            <p className="wh-empty-sub">Start ngrok and configure your Data Action to send here.</p>
          </div>
        ) : (
          <div className="wh-feed">
            {events.map((ev, i) => (
              <div key={ev.id} className={`wh-event${i === 0 ? ' wh-event-new' : ''}`}>
                <div className="wh-event-header" onClick={() => toggleExpand(ev.id)}>
                  <span className="wh-method">POST</span>
                  <span className="wh-path">/webhook</span>
                  {i === 0 && <span className="wh-new-badge">NEW</span>}
                  {ev.verified === true && <span className="wh-verified">✓ Verified</span>}
                  {ev.verified === false && <span className="wh-unverified">⚠ Unverified</span>}
                  <span className="wh-time">{new Date(ev.receivedAt).toLocaleTimeString()}</span>
                  <span className="wh-chevron">{expanded[ev.id] ? '▲' : '▼'}</span>
                </div>
                {expanded[ev.id] && (
                  <div className="wh-event-body">
                    <div className="wh-section-label">Payload</div>
                    <pre className="wh-json">{JSON.stringify(ev.body, null, 2)}</pre>
                    <div className="wh-section-label" style={{ marginTop: 12 }}>Headers</div>
                    <pre className="wh-json wh-json-muted">{JSON.stringify(
                      Object.fromEntries(
                        Object.entries(ev.headers).filter(([k]) =>
                          ['content-type','user-agent','x-'].some(p => k.startsWith(p))
                        )
                      ), null, 2
                    )}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Service Agent ────────────────────────────────────────────

const AGENT_SNIPPET_KEY = 'dc_playground_agent_snippet';

async function injectSnippet(snippetHtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${snippetHtml}</div>`, 'text/html');
  const scripts = Array.from(doc.querySelectorAll('script'));

  for (const script of scripts) {
    await new Promise((resolve) => {
      const el = document.createElement('script');
      el.type = script.type || 'text/javascript';
      const src = script.getAttribute('src');
      if (src) {
        el.src = src;
        const onloadAttr = script.getAttribute('onload');
        el.onload = () => { if (onloadAttr) { try { eval(onloadAttr); } catch(e) {} } resolve(); }; // eslint-disable-line no-eval
        el.onerror = resolve;
      } else {
        el.textContent = script.textContent;
        resolve();
      }
      document.head.appendChild(el);
    });
  }
}

function AgentTab() {
  const [snippet, setSnippet] = useState(() => localStorage.getItem(AGENT_SNIPPET_KEY) || '');
  const [launched, setLaunched] = useState(false);
  const [injected, setInjected] = useState(false);

  async function launch() {
    if (!snippet.trim()) return;
    localStorage.setItem(AGENT_SNIPPET_KEY, snippet.trim());
    setLaunched(true);
    if (!injected) {
      await injectSnippet(snippet.trim());
      setInjected(true);
    }
  }

  if (launched) {
    return (
      <div className="tab-content">
        <div className="agent-launched">
          <div className="agent-launched-icon">💬</div>
          <h2 className="agent-setup-title">Service Agent Ready</h2>
          <p className="agent-setup-sub">Look for the chat button in the <strong>bottom-right corner</strong> of this page.</p>
          <div className="agent-launched-arrow">↘ Chat icon is down there</div>
          <button className="btn-ghost" style={{ marginTop: 24 }} onClick={() => setLaunched(false)}>
            ← Change snippet
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content">
      <div className="agent-setup">
        <div className="agent-setup-icon">🤖</div>
        <h2 className="agent-setup-title">Embed Your Service Agent</h2>
        <p className="agent-setup-sub">Paste the Embedded Service snippet from your Salesforce org to launch the agent chat widget.</p>
        <div className="agent-setup-hint">
          Agentforce Studio → [your agent] → <strong>Deploy</strong> → Web → copy the code snippet
        </div>
        <div className="field" style={{ width: '100%', maxWidth: 580 }}>
          <label>Deployment Snippet</label>
          <textarea
            rows={9}
            style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical', width: '100%' }}
            placeholder={'<script src="https://yourorg.my.salesforce.com/embeddedservice/...">\n</script>\n<script>\n  // initESW(...)\n</script>'}
            value={snippet}
            onChange={e => setSnippet(e.target.value)}
            spellCheck={false}
          />
        </div>
        <button className="btn-primary" onClick={launch} disabled={!snippet.trim()}>
          Launch Agent →
        </button>
        {snippet && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Snippet saved — persists on refresh.</p>}
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────

export default function App() {
  const [activeTab, setActiveTab] = useState('auth');
  const [authState, setAuthState] = useState(null);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <span className="header-icon">⚡</span>
          <div>
            <h1>Data 360 Playground</h1>
            <p>Coral Cloud Resorts</p>
          </div>
          {authState
            ? <span className="auth-badge auth-ok">● Authenticated</span>
            : <span className="auth-badge auth-no">● Not authenticated</span>}
        </div>
      </header>

      <nav className="tab-nav">
        <div className="tab-nav-inner">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn${activeTab === tab.id ? ' tab-btn-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="main">
        {activeTab === 'auth' && <AuthTab authState={authState} onAuth={setAuthState} />}
        {activeTab === 'streaming' && <StreamingTab authState={authState} />}
        {activeTab === 'batch' && <BatchTab authState={authState} />}
        {activeTab === 'action' && <DataActionTab authState={authState} />}
        {activeTab === 'graphs' && <DataGraphsTab authState={authState} />}
        {activeTab === 'webhook' && <WebhookTab />}
        {activeTab === 'agent' && <AgentTab />}
      </main>

      <footer className="footer">
        Data 360 Playground · Coral Cloud Resorts
      </footer>
    </div>
  );
}

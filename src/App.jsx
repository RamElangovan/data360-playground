import { useState } from 'react';

const SAMPLE_SINGLE = {
  data: [
    {
      device_id: 'a1b2c3d4e5f6-4b0c-b264-7a358e8a81b41',
      device_OS: 'iPadOS 16.7.10',
      session_id: '3c103817-b2da-4ce1-91de-652e69a55f81',
      session_datetime: new Date().toISOString(),
      email: 'jschmidt.10021.0269@aol.exacttargettest.com',
      first_name: 'Jane',
      last_name: 'Schmidt',
    },
  ],
};

const SAMPLE_MULTIPLE = {
  data: [
    {
      device_id: 'a1b2c3d4e5f6-4b0c-b265-7a358e8a81b50',
      device_OS: 'iOS 16.7.10',
      session_id: 'be7e26fa-88c5-4be0-8ddd-e96cee645cbf',
      session_datetime: new Date().toISOString(),
      email: '',
      first_name: 'James',
      last_name: 'Davis',
    },
    {
      device_id: '5ea21294-00b3-469f-b306-aB42d560ce2d',
      device_OS: 'Android 14',
      session_id: '3c103817-b2da-4ce1-91de-652e69a55f82',
      session_datetime: new Date(Date.now() - 120_000).toISOString(),
      email: 'james.smith@coralcloudresorts.com',
      first_name: 'James',
      last_name: 'Smith',
    },
  ],
};

export default function App() {
  const [domain, setDomain] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [connectorName, setConnectorName] = useState('CCRMobile');
  const [objectName, setObjectName] = useState('user_session');

  const [authState, setAuthState] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [payload, setPayload] = useState(JSON.stringify(SAMPLE_SINGLE, null, 2));
  const [payloadError, setPayloadError] = useState('');
  const [response, setResponse] = useState(null);
  const [sending, setSending] = useState(false);

  async function authenticate() {
    setAuthLoading(true);
    setAuthError('');
    setAuthState(null);
    setResponse(null);

    try {
      const r1 = await fetch('/api/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain, clientId, clientSecret }),
      });
      const d1 = await r1.json();

      if (!r1.ok || !d1.access_token) {
        setAuthError(
          `Step 1 failed — ${d1.error_description || d1.error || JSON.stringify(d1)}`
        );
        return;
      }

      const r2 = await fetch('/api/dc-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceUrl: d1.instance_url,
          orgAccessToken: d1.access_token,
        }),
      });
      const d2 = await r2.json();

      if (!r2.ok || !d2.access_token) {
        setAuthError(
          `Step 2 failed — ${d2.error_description || d2.error || JSON.stringify(d2)}`
        );
        return;
      }

      setAuthState({ dcInstanceUrl: d2.instance_url, dcAccessToken: d2.access_token });
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function send() {
    setPayloadError('');
    setResponse(null);

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (e) {
      setPayloadError('Invalid JSON: ' + e.message);
      return;
    }

    setSending(true);
    try {
      const r = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dcInstanceUrl: authState.dcInstanceUrl,
          dcAccessToken: authState.dcAccessToken,
          connectorName,
          objectName,
          payload: parsed,
        }),
      });
      const data = await r.json();
      setResponse({ status: r.status, ok: r.ok, body: data });
    } catch (err) {
      setResponse({ status: 0, ok: false, body: { error: err.message } });
    } finally {
      setSending(false);
    }
  }

  function loadSample(sample) {
    const copy = JSON.parse(JSON.stringify(sample));
    const now = new Date();
    copy.data.forEach((rec, i) => {
      rec.session_datetime = new Date(now - i * 120_000).toISOString();
    });
    setPayload(JSON.stringify(copy, null, 2));
    setPayloadError('');
    setResponse(null);
  }

  const canAuth = domain && clientId && clientSecret && !authLoading;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <span className="header-icon">⚡</span>
          <div>
            <h1>Data 360 Ingestion Playground</h1>
            <p>Exercise 2-5 · Streaming Ingestion API · Coral Cloud Resorts</p>
          </div>
        </div>
      </header>

      <main className="main">
        {/* ── Step 1: Auth ── */}
        <section className="card">
          <div className="card-header">
            <span className="step-pill">1</span>
            <h2>Configure Connected App</h2>
          </div>

          <div className="field-grid">
            <div className="field">
              <label>Salesforce Domain</label>
              <input
                type="text"
                placeholder="myorg.my.salesforce.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value.trim())}
                autoComplete="off"
              />
              <span className="hint">Your Current My Domain URL (without https://)</span>
            </div>
            <div className="field">
              <label>Consumer Key (Client ID)</label>
              <input
                type="text"
                placeholder="3MVG9..."
                value={clientId}
                onChange={(e) => setClientId(e.target.value.trim())}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label>Consumer Secret (Client Secret)</label>
              <input
                type="password"
                placeholder="Your Connected App secret"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value.trim())}
                autoComplete="off"
              />
            </div>
          </div>

          <button className="btn-primary" onClick={authenticate} disabled={!canAuth}>
            {authLoading ? (
              <>
                <span className="spinner" /> Authenticating…
              </>
            ) : (
              'Authenticate'
            )}
          </button>

          {authError && (
            <div className="alert alert-error">
              <strong>Authentication failed</strong>
              <p>{authError}</p>
            </div>
          )}

          {authState && (
            <div className="alert alert-success">
              <strong>✓ Authenticated — Data Cloud token ready</strong>
              <p className="token-url">{authState.dcInstanceUrl}</p>
            </div>
          )}
        </section>

        {/* ── Step 2: Payload ── */}
        <section className={`card${!authState ? ' card-disabled' : ''}`}>
          <div className="card-header">
            <span className="step-pill">2</span>
            <h2>Send Session Data</h2>
          </div>

          <div className="target-row">
            <div className="field field-inline">
              <label>Connector</label>
              <input
                type="text"
                value={connectorName}
                onChange={(e) => setConnectorName(e.target.value.trim())}
                disabled={!authState}
              />
            </div>
            <div className="field field-inline">
              <label>Object</label>
              <input
                type="text"
                value={objectName}
                onChange={(e) => setObjectName(e.target.value.trim())}
                disabled={!authState}
              />
            </div>
          </div>

          <div className="endpoint-bar">
            POST
            <span className="endpoint-path">
              /api/v1/ingest/sources/{connectorName}/{objectName}
            </span>
          </div>

          <div className="preset-row">
            <span className="preset-label">Load sample:</span>
            <button
              className="btn-ghost"
              onClick={() => loadSample(SAMPLE_SINGLE)}
              disabled={!authState}
            >
              Single session
            </button>
            <button
              className="btn-ghost"
              onClick={() => loadSample(SAMPLE_MULTIPLE)}
              disabled={!authState}
            >
              Multiple sessions
            </button>
          </div>

          <textarea
            className="code-editor"
            value={payload}
            onChange={(e) => {
              setPayload(e.target.value);
              setPayloadError('');
            }}
            rows={22}
            spellCheck={false}
            disabled={!authState}
          />

          {payloadError && (
            <div className="alert alert-error">
              <strong>Invalid JSON</strong>
              <p>{payloadError}</p>
            </div>
          )}

          <button className="btn-primary" onClick={send} disabled={!authState || sending}>
            {sending ? (
              <>
                <span className="spinner" /> Sending…
              </>
            ) : (
              'Send to Data Cloud'
            )}
          </button>
        </section>

        {/* ── Step 3: Response ── */}
        {response && (
          <section className={`card response-card${response.ok ? ' response-ok' : ' response-err'}`}>
            <div className="card-header">
              <span className="step-pill">3</span>
              <h2>Response</h2>
              <span className={`http-badge ${response.ok ? 'badge-ok' : 'badge-err'}`}>
                HTTP {response.status} {response.ok ? '✓' : '✗'}
              </span>
            </div>
            <pre className="response-body">{JSON.stringify(response.body, null, 2)}</pre>
            {response.ok && (
              <p className="response-tip">
                Data accepted. Navigate to <strong>Data Cloud → Data Explorer → CCRMobile-user_session</strong> to verify.
              </p>
            )}
          </section>
        )}
      </main>

      <footer className="footer">
        Data 360 Developer · Trailblazer Bootcamp · Coral Cloud Resorts
      </footer>
    </div>
  );
}

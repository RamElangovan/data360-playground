import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));

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
  const url = `${dcInstanceUrl}/api/v1/ingest/sources/${connectorName}/${objectName}`;

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

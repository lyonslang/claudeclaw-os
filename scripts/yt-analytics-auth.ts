#!/usr/bin/env npx tsx
/**
 * yt-analytics-auth.ts
 * One-time OAuth2 authorization flow for the YouTube Analytics API.
 *
 * Prerequisites:
 *   1. Create OAuth2 credentials in Google Cloud Console
 *      (APIs & Services → Credentials → OAuth 2.0 Client ID → Desktop app)
 *   2. Enable the "YouTube Analytics API" in your project
 *   3. Set YT_ANALYTICS_CLIENT_ID and YT_ANALYTICS_CLIENT_SECRET in .env
 *
 * Usage:
 *   npx tsx scripts/yt-analytics-auth.ts
 *
 * This script:
 *   1. Starts a local HTTP server on port 8089
 *   2. Opens your browser to the Google OAuth consent screen
 *   3. Captures the authorization code via redirect
 *   4. Exchanges it for access + refresh tokens
 *   5. Saves the token to YT_ANALYTICS_TOKEN_PATH
 */

import { createServer } from 'http';
import { exec } from 'child_process';
import fs from 'fs';
import https from 'https';
import path from 'path';

// ── Load config ─────────────────────────────────────────────────

// Inline env reading (can't import config.ts cleanly from scripts/)
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function readEnv(): Record<string, string> {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    env[key] = val;
  }
  return env;
}

function expandHome(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(process.env.HOME || '/tmp', p.slice(1));
  }
  return p;
}

const dotenv = readEnv();
const CLIENT_ID = process.env.YT_ANALYTICS_CLIENT_ID || dotenv.YT_ANALYTICS_CLIENT_ID || '';
const CLIENT_SECRET = process.env.YT_ANALYTICS_CLIENT_SECRET || dotenv.YT_ANALYTICS_CLIENT_SECRET || '';
const TOKEN_PATH = expandHome(
  process.env.YT_ANALYTICS_TOKEN_PATH || dotenv.YT_ANALYTICS_TOKEN_PATH || '~/.config/youtube-analytics/token.json',
);

const PORT = 8089;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPES = 'https://www.googleapis.com/auth/yt-analytics.readonly';

// ── Validate ─────────────────────────────────────────────────────

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ Missing YT_ANALYTICS_CLIENT_ID or YT_ANALYTICS_CLIENT_SECRET in .env');
  console.error('\nSteps:');
  console.error('  1. Go to https://console.cloud.google.com/apis/credentials');
  console.error('  2. Create an OAuth 2.0 Client ID (type: Desktop app)');
  console.error('  3. Enable the "YouTube Analytics API" in your project');
  console.error('  4. Add these to your .env:');
  console.error('     YT_ANALYTICS_CLIENT_ID=your-client-id');
  console.error('     YT_ANALYTICS_CLIENT_SECRET=your-client-secret');
  process.exit(1);
}

// ── Token exchange ───────────────────────────────────────────────

function exchangeCodeForTokens(code: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString();

    const req = https.request(
      {
        hostname: 'oauth2.googleapis.com',
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Invalid response from token endpoint: ${data.slice(0, 300)}`));
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── Main flow ────────────────────────────────────────────────────

console.log('\n🔐 YouTube Analytics OAuth2 Authorization\n');
console.log(`   Client ID:  ${CLIENT_ID.slice(0, 20)}...`);
console.log(`   Token path: ${TOKEN_PATH}`);
console.log(`   Scope:      ${SCOPES}\n`);

const authUrl =
  `https://accounts.google.com/o/oauth2/v2/auth?` +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent', // Force refresh_token generation
  }).toString();

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);

  if (url.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h2>❌ Authorization denied: ${error}</h2><p>You can close this tab.</p>`);
    console.error(`\n❌ Authorization denied: ${error}`);
    server.close();
    process.exit(1);
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h2>Missing authorization code</h2>');
    return;
  }

  try {
    console.log('⏳ Exchanging authorization code for tokens...');
    const tokenResp = await exchangeCodeForTokens(code);

    if (tokenResp.error) {
      throw new Error(`${tokenResp.error}: ${tokenResp.error_description || ''}`);
    }

    const token = {
      access_token: tokenResp.access_token,
      refresh_token: tokenResp.refresh_token,
      token_type: tokenResp.token_type || 'Bearer',
      expiry_date: Date.now() + (tokenResp.expires_in || 3600) * 1000,
      scope: tokenResp.scope || SCOPES,
    };

    // Save token
    const dir = path.dirname(TOKEN_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8');
    try { fs.chmodSync(TOKEN_PATH, 0o600); } catch { /* non-fatal */ }

    console.log(`\n✅ Token saved to ${TOKEN_PATH}`);
    console.log('   YouTube Analytics API is now configured.\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(
      '<h2>✅ Authorization successful!</h2>' +
      '<p>Token has been saved. You can close this tab.</p>' +
      '<p>YouTube Analytics metrics will now be available in God\'s Eye.</p>',
    );
  } catch (err: any) {
    console.error(`\n❌ Token exchange failed: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>❌ Token exchange failed</h2><pre>${err.message}</pre>`);
  }

  // Shut down after a short delay to ensure the response is sent
  setTimeout(() => {
    server.close();
    process.exit(0);
  }, 1000);
});

server.listen(PORT, () => {
  console.log(`📡 Listening on http://localhost:${PORT}/callback\n`);
  console.log('Opening browser for authorization...\n');

  // Open browser (macOS)
  const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${openCmd} "${authUrl}"`, (err) => {
    if (err) {
      console.log('Could not open browser automatically. Open this URL manually:\n');
      console.log(authUrl);
      console.log('');
    }
  });
});

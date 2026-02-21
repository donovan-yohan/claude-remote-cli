'use strict';

const http = require('http');
const path = require('path');
const readline = require('readline');

const express = require('express');
const cookieParser = require('cookie-parser');

const { loadConfig, saveConfig, DEFAULTS } = require('./config');
const auth = require('./auth');
const sessions = require('./sessions');
const { setupWebSocket } = require('./ws');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function parseTTL(ttl) {
  if (typeof ttl !== 'string') return 24 * 60 * 60 * 1000;
  const match = ttl.match(/^(\d+)([smhd])$/);
  if (!match) return 24 * 60 * 60 * 1000;
  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default:  return 24 * 60 * 60 * 1000;
  }
}

function promptPin(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  let config;
  try {
    config = loadConfig(CONFIG_PATH);
  } catch (_) {
    config = { ...DEFAULTS };
    saveConfig(CONFIG_PATH, config);
  }

  if (!config.pinHash) {
    const pin = await promptPin('Set up a PIN for claude-mobile: ');
    config.pinHash = await auth.hashPin(pin);
    saveConfig(CONFIG_PATH, config);
    console.log('PIN set successfully.');
  }

  const authenticatedTokens = new Set();

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  function requireAuth(req, res, next) {
    const token = req.cookies && req.cookies.token;
    if (!token || !authenticatedTokens.has(token)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // POST /auth
  app.post('/auth', async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress;
    if (auth.isRateLimited(ip)) {
      return res.status(429).json({ error: 'Too many attempts. Try again later.' });
    }

    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ error: 'PIN required' });
    }

    const valid = await auth.verifyPin(pin, config.pinHash);
    if (!valid) {
      auth.recordFailedAttempt(ip);
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    auth.clearRateLimit(ip);
    const token = auth.generateCookieToken();
    authenticatedTokens.add(token);

    const ttlMs = parseTTL(config.cookieTTL);
    setTimeout(() => authenticatedTokens.delete(token), ttlMs);

    res.cookie('token', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: ttlMs,
    });

    return res.json({ ok: true });
  });

  // GET /sessions
  app.get('/sessions', requireAuth, (req, res) => {
    res.json(sessions.list());
  });

  // GET /repos
  app.get('/repos', requireAuth, (req, res) => {
    res.json(config.repos || []);
  });

  // POST /sessions
  app.post('/sessions', requireAuth, (req, res) => {
    const { repoPath, repoName, claudeArgs } = req.body;
    if (!repoPath) {
      return res.status(400).json({ error: 'repoPath is required' });
    }
    const session = sessions.create({
      repoName: repoName || repoPath,
      repoPath,
      command: config.claudeCommand,
      args: claudeArgs || config.claudeArgs || [],
    });
    return res.status(201).json(session);
  });

  // DELETE /sessions/:id
  app.delete('/sessions/:id', requireAuth, (req, res) => {
    try {
      sessions.kill(req.params.id);
      res.json({ ok: true });
    } catch (_) {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  const server = http.createServer(app);
  setupWebSocket(server, authenticatedTokens);

  server.listen(config.port, config.host, () => {
    console.log(`claude-mobile server listening on ${config.host}:${config.port}`);
  });
}

main().catch(console.error);

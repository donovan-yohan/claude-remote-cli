const fs = require('fs');

const DEFAULTS = {
  host: '0.0.0.0',
  port: 3456,
  cookieTTL: '24h',
  repos: [],
  claudeCommand: 'claude',
  claudeArgs: [],
};

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  return { ...DEFAULTS, ...parsed };
}

function saveConfig(configPath, config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

module.exports = { DEFAULTS, loadConfig, saveConfig };

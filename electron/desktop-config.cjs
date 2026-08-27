const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  groqApiKey: '',
  groqModel: 'openai/gpt-oss-120b',
  appSecret: '',
  serverPort: 39101,
  metadata: {
    mysqlHost: '127.0.0.1',
    mysqlPort: 3306,
    mysqlUser: 'root',
    mysqlPassword: '',
    mysqlDatabase: 'traceiq',
  },
  limits: {},
};

const METADATA_LIMIT_KEYS = {
  maxAgentSteps: 'MAX_AGENT_STEPS',
  maxSqlQueries: 'MAX_SQL_QUERIES',
  maxQueryRows: 'MAX_QUERY_ROWS',
  maxExecutionTimeMs: 'MAX_EXECUTION_TIME_MS',
  maxQueryTimeoutMs: 'MAX_QUERY_TIMEOUT_MS',
  maxQuestionLength: 'MAX_QUESTION_LENGTH',
  llmMaxTokens: 'LLM_MAX_TOKENS',
  maxToolResultChars: 'MAX_TOOL_RESULT_CHARS',
  maxContextChars: 'MAX_CONTEXT_CHARS',
  maxConcurrentInvestigations: 'MAX_CONCURRENT_INVESTIGATIONS',
  investigationQueueTimeoutMs: 'INVESTIGATION_QUEUE_TIMEOUT_MS',
  threadContextTurns: 'THREAD_CONTEXT_TURNS',
  threadContextAnswerChars: 'THREAD_CONTEXT_ANSWER_CHARS',
};

function configPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

function normalizeAppSecret(value) {
  if (value && /^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  return crypto.randomBytes(32).toString('hex');
}

function loadConfig() {
  const p = configPath();
  let file = {};
  if (fs.existsSync(p)) {
    try {
      file = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      file = {};
    }
  }
  const merged = {
    ...JSON.parse(JSON.stringify(DEFAULTS)),
    ...file,
    metadata: { ...DEFAULTS.metadata, ...(file.metadata || {}) },
    limits: { ...DEFAULTS.limits, ...(file.limits || {}) },
  };
  if (!merged.appSecret || !/^[0-9a-fA-F]{64}$/.test(merged.appSecret)) {
    merged.appSecret = normalizeAppSecret(merged.appSecret);
    saveConfig(merged);
  }
  return merged;
}

function saveConfig(config) {
  const p = configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

function updateConfig(partial) {
  const current = loadConfig();
  const next = {
    ...current,
    ...partial,
    metadata: { ...current.metadata, ...(partial.metadata || {}) },
    limits: { ...current.limits, ...(partial.limits || {}) },
  };
  return saveConfig(next);
}

// Map desktop config -> environment variables the Express server expects.
function toEnv() {
  const cfg = loadConfig();
  const env = {
    PORT: String(cfg.serverPort || 39101),
    HOST: '127.0.0.1',
    // Not 'production': the app serves over plain http on 127.0.0.1, and the
    // auth cookie would get the Secure flag (https-only) under production and
    // silently fail to persist. 'desktop' keeps dotenv loading benign and the
    // cookie non-secure.
    NODE_ENV: 'desktop',
    GROQ_API_KEY: cfg.groqApiKey,
    GROQ_MODEL: cfg.groqModel || 'openai/gpt-oss-120b',
    APP_SECRET: cfg.appSecret,
    MYSQL_HOST: cfg.metadata.mysqlHost || '127.0.0.1',
    MYSQL_PORT: String(cfg.metadata.mysqlPort || 3306),
    MYSQL_USER: cfg.metadata.mysqlUser || 'root',
    MYSQL_PASSWORD: cfg.metadata.mysqlPassword || '',
    MYSQL_DATABASE: cfg.metadata.mysqlDatabase || 'traceiq',
  };
  for (const [key, envKey] of Object.entries(METADATA_LIMIT_KEYS)) {
    const val = cfg.limits && cfg.limits[key];
    if (val != null && val !== '') env[envKey] = String(val);
  }
  return env;
}

function isConfigured() {
  const cfg = loadConfig();
  return Boolean(cfg.groqApiKey && cfg.groqApiKey.trim());
}

function metadataEnv() {
  const cfg = loadConfig();
  return {
    MYSQL_HOST: cfg.metadata.mysqlHost || '127.0.0.1',
    MYSQL_PORT: String(cfg.metadata.mysqlPort || 3306),
    MYSQL_USER: cfg.metadata.mysqlUser || 'root',
    MYSQL_PASSWORD: cfg.metadata.mysqlPassword || '',
    MYSQL_DATABASE: cfg.metadata.mysqlDatabase || 'traceiq',
  };
}

module.exports = {
  DEFAULTS,
  loadConfig,
  saveConfig,
  updateConfig,
  toEnv,
  metadataEnv,
  isConfigured,
  configPath,
  METADATA_LIMIT_KEYS,
};

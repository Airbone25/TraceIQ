const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// The MongoDB connection string is baked into every build and is not editable
// from the Settings UI. Instead of hardcoding a secret in source, the built-in
// default is taken from MONGODB_URI in the repo's .env file (read at require
// time). Set MONGODB_URI in .env to your Atlas/remote URI before building; the
// app connects directly to that cluster for all product data (accounts, threads,
// investigations, saved connections, Groq keys).
function loadDotenvMongodbUri() {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  } catch { /* dotenv unavailable or file missing */ }
  const uri = (process.env.MONGODB_URI || '').trim();
  return uri || 'mongodb://127.0.0.1:27017/traceiq';
}
const DEFAULT_MONGODB_URI = loadDotenvMongodbUri();

const DEFAULTS = {
  groqApiKey: '',
  groqModel: 'openai/gpt-oss-120b',
  appSecret: '',
  mongodbUri: DEFAULT_MONGODB_URI,
  serverPort: 39101,
  metadata: {
    mysqlHost: '127.0.0.1',
    mysqlPort: 3306,
    mysqlUser: 'root',
    mysqlPassword: '',
    mysqlDatabase: 'traceiq',
    mysqlUseSsl: false,
    mysqlSslRejectUnauthorized: true,
  },
  limits: {},
  email: {
    resendApiKey: '',
    from: 'TraceIQ <onboarding@resend.dev>',
  },
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

// APP_SECRET is the envelope key used to encrypt stored MySQL target passwords
// and to sign auth tokens. It must be the SAME value whether the app is run
// with `npm start` (reads .env) or with the Electron shell (reads config.json).
// The authoritative source is .env, so a connection password saved under one
// launcher still decrypts under the other.
function loadDotenvAppSecret() {
  try {
    require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  } catch { /* dotenv unavailable or file missing */ }
  if (process.env.APP_SECRET && /^[0-9a-fA-F]{64}$/.test(process.env.APP_SECRET)) {
    return process.env.APP_SECRET.toLowerCase();
  }
  return null;
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
  // The MongoDB URI is baked in and never user-editable; ignore anything stored.
  merged.mongodbUri = DEFAULTS.mongodbUri;
  // Prefer the .env APP_SECRET so both launchers share one encryption key.
  const envSecret = loadDotenvAppSecret();
  const current = merged.appSecret && /^[0-9a-fA-F]{64}$/.test(merged.appSecret)
    ? merged.appSecret.toLowerCase()
    : null;
  if (envSecret && envSecret !== current) {
    merged.appSecret = envSecret;
    saveConfig(merged);
  } else if (!envSecret && !current) {
    merged.appSecret = normalizeAppSecret(merged.appSecret);
    saveConfig(merged);
  } else {
    merged.appSecret = envSecret || current;
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
    // Per-account Groq keys are now stored in the users table and injected per
    // request. env requires a non-empty GROQ_API_KEY to boot, so we inject a
    // placeholder here; it is overridden by the account's real key at call time.
    GROQ_API_KEY: cfg.groqApiKey || 'traceiq-desktop-placeholder',
    GROQ_MODEL: cfg.groqModel || 'openai/gpt-oss-120b',
    APP_SECRET: cfg.appSecret,
    MONGODB_URI: cfg.mongodbUri || DEFAULTS.mongodbUri,
    MYSQL_HOST: cfg.metadata.mysqlHost || '127.0.0.1',
    MYSQL_PORT: String(cfg.metadata.mysqlPort || 3306),
    MYSQL_USER: cfg.metadata.mysqlUser || 'root',
    MYSQL_PASSWORD: cfg.metadata.mysqlPassword || '',
    MYSQL_DATABASE: cfg.metadata.mysqlDatabase || 'traceiq',
    MYSQL_SSL: cfg.metadata.mysqlUseSsl ? 'true' : 'false',
    MYSQL_SSL_REJECT_UNAUTHORIZED: cfg.metadata.mysqlSslRejectUnauthorized === false ? 'false' : 'true',
    RESEND_API_KEY: cfg.email?.resendApiKey || '',
    EMAIL_FROM: cfg.email?.from || 'TraceIQ <onboarding@resend.dev>',
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
    MYSQL_SSL: cfg.metadata.mysqlUseSsl ? 'true' : 'false',
    MYSQL_SSL_REJECT_UNAUTHORIZED: cfg.metadata.mysqlSslRejectUnauthorized === false ? 'false' : 'true',
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

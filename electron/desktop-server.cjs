const { spawn } = require('child_process');
const http = require('http');
const net = require('net');
const path = require('path');
const desktopConfig = require('./desktop-config.cjs');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// Track the running server child process.
let serverProcess = null;
let stopping = false;

// Returns true if nothing is currently listening on 127.0.0.1:<port>.
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(true));
    socket.connect(port, '127.0.0.1');
  });
}

function healthCheckUrl() {
  return `http://127.0.0.1:${desktopConfig.loadConfig().serverPort || 39101}/api/health`;
}

// Returns a promise that resolves when the server begins responding with a valid
// TraceIQ health payload on HTTP.
function waitForServer(timeoutMs = 30000) {
  const url = healthCheckUrl();
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        let body = '';
        res.on('data', (d) => (body += d.toString()));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (parsed && typeof parsed.status === 'string') {
              resolve();
              return;
            }
          } catch { /* not our server */ }
          failTick();
        });
      });
      req.setTimeout(2000, () => { req.destroy(); failTick(); });
      req.on('error', failTick);
      function failTick() {
        if (stopping) return;
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for the TraceIQ server at ${url}`));
          return;
        }
        setTimeout(tick, 400);
      }
    };
    tick();
  });
}

// Spawn the Express server with injected environment. Restarts are supported.
function startServer({ timeoutMs } = {}) {
  if (serverProcess) return serverProcess;
  const env = { ...process.env, ...desktopConfig.toEnv(), ELECTRON_RUN_AS_NODE: '1' };
  serverProcess = spawn(process.execPath, [path.join(PROJECT_ROOT, 'src', 'server.js')], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  serverProcess.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`TraceIQ server exited unexpectedly (code=${code}, signal=${signal})`);
    }
    serverProcess = null;
  });
  return serverProcess;
}

async function stopServer() {
  stopping = true;
  if (!serverProcess) {
    stopping = false;
    return;
  }
  const proc = serverProcess;
  serverProcess = null;
  await new Promise((resolve) => {
    const timer = setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 4000);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
  stopping = false;
}

// Provision the metadata database + schema by reusing scripts/setup-db.js as a child.
// dotenv/config only fills variables that are not already set, so our injected
// MYSQL_* env wins over any committed .env.
async function provisionSchema() {
  const env = { ...process.env, ...desktopConfig.metadataEnv(), ELECTRON_RUN_AS_NODE: '1' };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'scripts', 'setup-db.js')], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (out += d.toString()));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Schema provisioning failed (exit ${code}): ${out.trim() || 'see logs'}`));
    });
  });
}

module.exports = {
  startServer,
  stopServer,
  waitForServer,
  provisionSchema,
  isPortAvailable,
  healthCheckUrl,
};

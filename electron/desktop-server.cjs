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

// Verify the product-data store (MongoDB) is reachable before launching the
// Express server. The server also connects at boot and refuses to start if this
// is unavailable, so this is an early catch that lets the user fix MONGODB_URI
// in Settings instead of hitting a generic server-crash dialog.
async function checkDatabase(timeoutMs = 10000) {
  const uri = (desktopConfig.loadConfig().mongodbUri || 'mongodb://127.0.0.1:27017/traceiq').trim();
  const mongoose = require('mongoose');
  mongoose.set('strictQuery', true);
  const conn = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: timeoutMs }).asPromise();
  await conn.close();
  return { uri };
}

// Kept for callers that used to provision the local MySQL schema; now the data
// store is MongoDB and no schema provisioning is needed, so this is just a
// connectivity pre-flight.
const provisionSchema = checkDatabase;

module.exports = {
  startServer,
  stopServer,
  waitForServer,
  provisionSchema,
  checkDatabase,
  isPortAvailable,
  healthCheckUrl,
};

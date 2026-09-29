import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const serverDir = path.resolve(rootDir, 'server');

console.log('====================================================');
console.log('   Surplus MealGuard AI - Master Test Suite Runner  ');
console.log('====================================================\n');

async function isServerRunning() {
  try {
    const res = await fetch('http://localhost:4000/api/health');
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 30000) {
  const start = Date.now();
  process.stdout.write('Waiting for backend server to become healthy...');
  while (Date.now() - start < timeoutMs) {
    if (await isServerRunning()) {
      console.log(' [READY]');
      return true;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(' [TIMEOUT]');
  return false;
}

let serverProcess = null;

async function startServerIfNeeded() {
  const running = await isServerRunning();
  if (running) {
    console.log('Detected already running server on http://localhost:4000/api.');
    return;
  }

  console.log('Starting local server instance on port 4000...');
  // Use tsx directly to run src/index.ts
  serverProcess = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverDir,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, PORT: '4000', NODE_ENV: 'test' },
  });

  serverProcess.stderr.on('data', (d) => {
    // Only print error logs if needed
    const str = d.toString();
    if (str.includes('Error:') || str.includes('SyntaxError')) {
      console.error('[Server Error]', str.trim());
    }
  });

  const ready = await waitForServer(30000);
  if (!ready) {
    throw new Error('Failed to start server within timeout.');
  }
}

function stopServer() {
  if (serverProcess) {
    console.log('Shutting down test server instance...');
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${serverProcess.pid} /T /F`, { stdio: 'ignore' });
      } else {
        serverProcess.kill('SIGINT');
      }
    } catch {
      // ignore cleanup errors
    }
    serverProcess = null;
  }
}

process.on('SIGINT', () => {
  stopServer();
  process.exit(1);
});

process.on('SIGTERM', () => {
  stopServer();
  process.exit(1);
});

async function runStep(name, cmd, cwd = rootDir) {
  console.log(`\n▶ [TEST SUITE] ${name}`);
  console.log(`  Executing: ${cmd}`);
  try {
    execSync(cmd, { cwd, stdio: 'inherit' });
    console.log(`✔ [PASS] ${name}`);
    return true;
  } catch (err) {
    console.error(`✖ [FAIL] ${name} (exit code ${err.status})`);
    return false;
  }
}

async function main() {
  const results = [];

  try {
    // 1. Pure Unit Tests (deterministic AI models, mathematical formulas, eligibility, matching, risk)
    const unitPass = await runStep(
      'Unit Tests (Forecasting, Targets, Risk, Waste, Eligibility, Matching, Impact)',
      'npx tsx --test "tests/unit/*.test.mjs"',
      serverDir
    );
    results.push({ name: 'Unit Tests', pass: unitPass });

    // 2. Start server for API and E2E suites
    await startServerIfNeeded();

    // 3. API Integration & Authorization Tests
    const apiPass = await runStep(
      'API Authorization & Scoping Tests',
      'npx tsx --test "tests/api/*.test.mjs"',
      serverDir
    );
    results.push({ name: 'API Authorization Tests', pass: apiPass });

    // 4. E2E User Journeys
    const e2ePass = await runStep(
      'End-to-End User Journey Tests (Signup, Menu, Flow, EOD, NGO, Reports)',
      'npx tsx --test "tests/e2e/*.test.mjs"',
      serverDir
    );
    results.push({ name: 'E2E Journey Tests', pass: e2ePass });

    // 5. Baseline System Acceptance Suite
    const acceptPass = await runStep(
      'System Acceptance Suite',
      'node acceptance.js',
      serverDir
    );
    results.push({ name: 'Acceptance Suite', pass: acceptPass });

    // 6. No Dead Controls & UI Verification Audit
    const controlsPass = await runStep(
      'No Dead Controls & Interactive Verification Audit',
      'node scripts/no-dead-controls.mjs',
      rootDir
    );
    results.push({ name: 'No Dead Controls Audit', pass: controlsPass });

  } catch (err) {
    console.error('\nFatal test execution error:', err.message);
    results.push({ name: 'Test Execution', pass: false });
  } finally {
    stopServer();
  }

  // Print Summary Table
  console.log('\n====================================================');
  console.log('                 TEST SUMMARY REPORT                ');
  console.log('====================================================');
  let allPass = true;
  for (const r of results) {
    console.log(` ${r.pass ? '✔ PASS' : '✖ FAIL'} : ${r.name}`);
    if (!r.pass) allPass = false;
  }
  console.log('====================================================');

  if (allPass) {
    console.log('🎉 ALL TESTS PASSED! Application verified robust, secure, and ready for demo.');
    process.exit(0);
  } else {
    console.error('❌ Some test suites failed. See logs above for details.');
    process.exit(1);
  }
}

main();

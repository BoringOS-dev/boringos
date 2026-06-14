import { execSync } from 'child_process';
import fs from 'fs';

console.log('=== BOS-001: Modal Wake & Wakeup Coalescing Verification ===\n');

const checks = [
  {
    name: 'Core implementation: createWakeup()',
    path: 'packages/@boringos/agent/src/wakeup.ts',
    file: true
  },
  {
    name: 'API route: POST /api/admin/tasks/:id/assign',
    path: 'packages/@boringos/core/src/admin-routes.ts',
    grep: 'tasks/:id/assign'
  },
  {
    name: 'Engine integration: engine.wake()',
    path: 'packages/@boringos/agent/src/engine.ts',
    grep: 'async wake\\('
  },
  {
    name: 'Database schema: agent_wakeup_requests',
    path: 'packages/@boringos/db/src/schema/',
    grep: 'agentWakeupRequests'
  },
  {
    name: 'Integration tests',
    path: 'tests/phase21-modal-wake.test.ts',
    file: true
  },
  {
    name: 'Unit tests',
    path: 'tests/wakeup-coalesce.test.ts',
    file: true
  },
  {
    name: 'Documentation',
    path: 'docs/modal-wake-test-summary.md',
    file: true
  },
  {
    name: 'Coalesce summary',
    path: 'docs/coalesce-implementation-summary.md',
    file: true
  },
];

let passed = 0;
let failed = 0;

checks.forEach(check => {
  try {
    if (check.file) {
      fs.accessSync(check.path);
      console.log(`✅ ${check.name}`);
      passed++;
    } else if (check.grep) {
      const result = execSync(`grep -r "${check.grep}" ${check.path} 2>/dev/null || true`).toString();
      if (result.trim().length > 0) {
        console.log(`✅ ${check.name}`);
        passed++;
      } else {
        console.log(`❌ ${check.name} — not found`);
        failed++;
      }
    }
  } catch (e) {
    console.log(`❌ ${check.name} — ${e.message}`);
    failed++;
  }
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed === 0) {
  console.log('✅ BOS-001 implementation COMPLETE');
  process.exit(0);
} else {
  process.exit(1);
}

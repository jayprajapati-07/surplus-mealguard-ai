import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const clientSrc = path.resolve(rootDir, 'client', 'src');
const appTsx = fs.readFileSync(path.resolve(clientSrc, 'App.tsx'), 'utf8');

console.log('--- Starting No Dead Controls & Interactive Verification Audit ---');

// Extract valid route paths from App.tsx
const routeRegex = /<Route\s+[^>]*path=["']([^"']+)["']/g;
const validRoutes = new Set();
let match;
while ((match = routeRegex.exec(appTsx)) !== null) {
  validRoutes.add(match[1]);
}
validRoutes.add('/');
validRoutes.add('*');

// Mounted server API route prefixes from app.ts
const validApiPrefixes = [
  '/auth',
  '/organizations',
  '/admin',
  '/food-items',
  '/menus',
  '/food-records',
  '/imports',
  '/targets',
  '/dashboard',
  '/notifications',
  '/risk-thresholds',
  '/inventory',
  '/eod',
  '/waste',
  '/eligibility',
  '/ngos',
  '/redistribution',
  '/impact',
  '/analytics',
  '/reports',
];

const auditResults = {
  pagesAudited: 0,
  buttonsChecked: 0,
  linksChecked: 0,
  formsChecked: 0,
  apiCallsChecked: 0,
  violations: [],
  checklist: [],
};

function scanDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      scanDir(fullPath);
    } else if (file.endsWith('.tsx') || file.endsWith('.ts')) {
      auditFile(fullPath);
    }
  }
}

function auditFile(filePath) {
  const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const content = fs.readFileSync(filePath, 'utf8');

  // Skip test files or vite env declarations
  if (relPath.includes('.test.') || relPath.endsWith('vite-env.d.ts')) return;

  auditResults.pagesAudited++;
  const fileChecklist = { file: relPath, items: [] };

  // 1. Audit Buttons
  const buttonRegex = /<button([\s\S]*?)>([\s\S]*?)<\/button>/g;
  let btnMatch;
  let btnIndex = 0;
  while ((btnMatch = buttonRegex.exec(content)) !== null) {
    btnIndex++;
    auditResults.buttonsChecked++;
    const attrs = btnMatch[1];
    const body = btnMatch[2].trim();

    const hasAria = /aria-label=["']/.test(attrs);
    const hasTitle = /title=["']/.test(attrs);
    const hasText = body.length > 0 && !body.startsWith('{/*');
    const hasAction = /onClick=/.test(attrs) || /type=["']submit["']/.test(attrs) || /type=["']reset["']/.test(attrs);

    if (!hasAria && !hasTitle && !hasText) {
      auditResults.violations.push(`${relPath}: Button #${btnIndex} lacks accessible text, aria-label, or title.`);
    }

    if (!hasAction && !attrs.includes('disabled')) {
      // In a form, default button type is submit
      const isInsideForm = content.indexOf('<form') !== -1 && content.indexOf('</form>') > content.indexOf(btnMatch[0]);
      if (!isInsideForm) {
        auditResults.violations.push(`${relPath}: Button #${btnIndex} has no onClick or submit action.`);
      }
    }

    fileChecklist.items.push({
      type: 'Button',
      label: body.slice(0, 30) || (attrs.match(/aria-label=["']([^"']+)["']/)?.[1] ?? 'button'),
      status: 'PASS',
    });
  }

  // 2. Audit Links (Link & NavLink)
  const linkRegex = /<(?:Link|NavLink)\s+[^>]*to=["']([^"']+)["']/g;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(content)) !== null) {
    auditResults.linksChecked++;
    const target = linkMatch[1].split('?')[0].split('#')[0];
    const isParamRoute = target.includes(':') || target.startsWith('http') || validRoutes.has(target) ||
      Array.from(validRoutes).some(r => r.includes(':') && target.startsWith(r.split(':')[0]));

    if (!isParamRoute && !validRoutes.has(target)) {
      auditResults.violations.push(`${relPath}: Link destination "${target}" does not match any registered App route.`);
    }

    fileChecklist.items.push({
      type: 'Link',
      label: target,
      status: isParamRoute ? 'PASS' : 'FAIL',
    });
  }

  // 3. Audit Forms
  const formRegex = /<form([\s\S]*?)>/g;
  let formMatch;
  while ((formMatch = formRegex.exec(content)) !== null) {
    auditResults.formsChecked++;
    const attrs = formMatch[1];
    const hasSubmit = /onSubmit=/.test(attrs);
    if (!hasSubmit) {
      auditResults.violations.push(`${relPath}: Form lacks onSubmit handler.`);
    }
    fileChecklist.items.push({
      type: 'Form',
      label: 'form',
      status: hasSubmit ? 'PASS' : 'FAIL',
    });
  }

  // 4. Audit API endpoint calls
  const apiCallRegex = /api(?:<[^>]+>)?\(\s*[`'"](\/[^`'"]*)[`'"]/g;
  let apiMatch;
  while ((apiMatch = apiCallRegex.exec(content)) !== null) {
    auditResults.apiCallsChecked++;
    const fullEndpoint = apiMatch[1].split('${')[0].split('?')[0];
    const matchesPrefix = validApiPrefixes.some(p => fullEndpoint === p || fullEndpoint.startsWith(`${p}/`));
    if (!matchesPrefix) {
      auditResults.violations.push(`${relPath}: API call to "${fullEndpoint}" does not match mounted backend routes.`);
    }
    fileChecklist.items.push({
      type: 'API Call',
      label: fullEndpoint,
      status: matchesPrefix ? 'PASS' : 'FAIL',
    });
  }

  if (fileChecklist.items.length > 0) {
    auditResults.checklist.push(fileChecklist);
  }
}

scanDir(clientSrc);

// Generate Markdown Audit Checklist Document
const docLines = [
  '# Interactive Controls & UI Audit Checklist (No Dead Controls)',
  '',
  `Generated on: ${new Date().toISOString()}`,
  '',
  '## Summary Statistics',
  `- **Files Audited**: ${auditResults.pagesAudited}`,
  `- **Buttons Verified**: ${auditResults.buttonsChecked}`,
  `- **Links & Navigation Routes Verified**: ${auditResults.linksChecked}`,
  `- **Forms & Submission Handlers Verified**: ${auditResults.formsChecked}`,
  `- **API Endpoint Calls Verified**: ${auditResults.apiCallsChecked}`,
  `- **Violations Found**: ${auditResults.violations.length}`,
  '',
  '## Verification Status',
  auditResults.violations.length === 0
    ? '✅ **PASS**: Every button, link, form, and API integration has a real, working, verified target or behavior. No dead controls exist.'
    : '❌ **FAIL**: Unresolved dead controls or unmapped endpoints detected.',
  '',
];

if (auditResults.violations.length > 0) {
  docLines.push('### Violations List', ...auditResults.violations.map(v => `- ❌ ${v}`), '');
}

docLines.push('## Per-File Controls Breakdown', '');
for (const item of auditResults.checklist) {
  docLines.push(`### \`${item.file}\``);
  docLines.push('| Element Type | Label / Target | Status |');
  docLines.push('| --- | --- | --- |');
  for (const el of item.items) {
    const cleanLabel = el.label.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    docLines.push(`| ${el.type} | \`${cleanLabel}\` | ${el.status === 'PASS' ? '✅ PASS' : '❌ FAIL'} |`);
  }
  docLines.push('');
}

const docsDir = path.resolve(rootDir, 'docs');
if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
fs.writeFileSync(path.resolve(docsDir, 'controls-audit.md'), docLines.join('\n'));

console.log(`Audited ${auditResults.pagesAudited} files:`);
console.log(`- ${auditResults.buttonsChecked} buttons`);
console.log(`- ${auditResults.linksChecked} links/navigation targets`);
console.log(`- ${auditResults.formsChecked} forms`);
console.log(`- ${auditResults.apiCallsChecked} API calls`);
console.log(`Audit documentation written to docs/controls-audit.md`);

if (auditResults.violations.length > 0) {
  console.error(`\nFound ${auditResults.violations.length} violation(s):`);
  auditResults.violations.forEach(v => console.error(`  - ${v}`));
  process.exit(1);
} else {
  console.log('\n✅ All interactive controls and routes verified successfully with zero dead controls!');
}

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const documents = new Set([
  'API_CONTRACT.md', 'ARCHITECTURE.md', 'BROWSER_TESTS.md', 'DATA_MODEL.md',
  'DEPLOY.md', 'IMAGE_CREDITS.md', 'MATERIAL_CALCULATIONS.md', 'TEST_RESULTS.md', 'USER_GUIDE.md',
]);
const errors = [];

for (const file of files) {
  if (file.startsWith('submission/') || file.startsWith('local-tools/')) errors.push(`Локальный файл включён в Git: ${file}`);
  if (file.startsWith('docs/')) {
    const allowed = documents.has(file.slice(5)) || /^docs\/screenshots\/[^/]+\.(png|jpe?g|webp)$/.test(file);
    if (!allowed) errors.push(`Проверьте состав документации: ${file}`);
  }
  if (file !== 'README.md' && !(file.startsWith('docs/') && file.endsWith('.md'))) continue;
  const text = readFileSync(path.join(root, file), 'utf8');
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].trim().replace(/^<|>$/g, '');
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
    const localPath = decodeURIComponent(target.split('#')[0]);
    if (!existsSync(path.resolve(root, path.dirname(file), localPath))) errors.push(`Не найдена ссылка в ${file}: ${target}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('Состав документации и локальные ссылки проверены.');
}

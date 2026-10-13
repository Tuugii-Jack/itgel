import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const vault = path.join(root, 'docs/obsidian/Itgel');
const cache = new Map(); const seen = new Set(); const routes = [];
async function walk(file, router, base) {
  const key = `${file}:${router}:${base}`; if (seen.has(key)) return; seen.add(key);
  let text = cache.get(file); if (text === undefined) { text = await readFile(file, 'utf8'); cache.set(file, text); }
  const imports = new Map();
  for (const match of text.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
    if (!match[2].startsWith('.')) continue;
    for (const name of match[1].split(',')) {
      const parts = name.trim().split(/\s+as\s+/); if (!parts[0].endsWith('Router')) continue;
      imports.set(parts[1] ?? parts[0], { name: parts[0], file: path.resolve(path.dirname(file), match[2].replace(/\.js$/, '.ts')) });
    }
  }
  for (const match of text.matchAll(/(\w+Router)\.(get|post|patch|delete|put|head)\(\s*['"]([^'"]+)['"]/g)) {
    if (match[1] !== router) continue;
    const route = `${base}/${match[3]}`.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    routes.push({ method: match[2].toUpperCase(), route, source: path.relative(root, file), line: text.slice(0, match.index).split('\n').length });
  }
  for (const match of text.matchAll(/(\w+Router)\.use\(\s*['"]([^'"]+)['"]\s*,([\s\S]*?)\);/g)) {
    if (match[1] !== router) continue;
    const children = match[3].match(/\b\w+Router\b/g) ?? [];
    for (const child of children) { const imported = imports.get(child); if (imported) await walk(imported.file, imported.name, `${base}/${match[2]}`.replace(/\/{2,}/g, '/')); }
  }
}
await walk(path.join(root, 'backend/src/routes/index.ts'), 'apiRouter', '/api');
routes.sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method));
await writeFile(path.join(vault, '13 API лавлах.md'), '# API лавлах\n\nКодын статик router холбоосоос автоматаар үүсгэнэ. Нууц/бодит хэрэглэгчийн өгөгдөл биш.\nЭрх, input, dynamic alias-ийн эцсийн эх сурвалж нь тухайн route-ийн код ба тест.\n\n' +
  '| Арга | Зам | Код |\n|---|---|---|\n' + routes.map((row) => `| ${row.method} | \`${row.route}\` | \`${row.source}:${row.line}\` |`).join('\n') + '\n');
const schema = await readFile(path.join(root, 'backend/prisma/schema.prisma'), 'utf8');
const models = [...schema.matchAll(/(model|enum)\s+(\w+)\s*\{([\s\S]*?)\n\}/g)];
await writeFile(path.join(vault, '14 Өгөгдлийн лавлах.md'), '# Өгөгдлийн лавлах\n\n`backend/prisma/schema.prisma`-аас үүсгэсэн бүтцийн лавлах. Бодит утга, нууц, сангийн dump агуулахгүй.\n\n' + models.map((model) => {
  const fields = model[3].split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//') && !line.startsWith('@@'));
  return `## ${model[2]} (${model[1]})\n\n\`\`\`prisma\n${fields.join('\n')}\n\`\`\`\n`;
}).join('\n'));
console.log(JSON.stringify({ documentedRoutes: routes.length, documentedModelsAndEnums: models.length }));

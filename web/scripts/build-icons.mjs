// 从 src 扫描全部 mdi:<name> 图标字面量，生成离线集合 src/assets/icons-mdi.ts。
// 运行：npm run icons:build（web build 前自动执行）。
// 源码里出现但 MDI 集合中不存在的名称会直接报错退出，避免静默渲染出空按钮。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(webRoot, 'src');
const require = createRequire(path.join(webRoot, 'package.json'));
const mdiSet = require('@iconify-json/mdi/icons.json');

function collectIconNames(dir, found = new Set()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectIconNames(full, found);
      continue;
    }
    if (!/\.(vue|ts)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const match of text.matchAll(/\bmdi:[a-z0-9]+(?:-[a-z0-9]+)*\b/g)) {
      found.add(match[0].slice('mdi:'.length));
    }
  }
  return found;
}

const names = [...collectIconNames(srcDir)].sort();
if (names.length === 0) {
  console.error('[icons] 未在 src 中找到任何 mdi: 图标引用');
  process.exit(1);
}

const missing = names.filter((name) => !mdiSet.icons[name]);
if (missing.length > 0) {
  console.error(`[icons] 以下图标在 @iconify-json/mdi 中不存在，请修正引用：\n${missing.map((n) => `mdi:${n}`).join('\n')}`);
  process.exit(1);
}

// 别名展开：MDI 里部分名称指向父图标的 body
const icons = {};
for (const name of names) {
  const direct = mdiSet.icons[name];
  if (direct) {
    icons[name] = direct;
    continue;
  }
  const alias = mdiSet.aliases[name];
  const parent = mdiSet.icons[alias.parent];
  icons[name] = {
    body: alias.body ?? parent.body,
    ...(alias.width != null ? { width: alias.width } : {}),
    ...(alias.height != null ? { height: alias.height } : {}),
  };
}

const outDir = path.join(webRoot, 'src', 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'icons-mdi.ts');
const content =
  `// 自动生成：npm run icons:build —— 请勿手改。\n` +
  `// 数据来源 @iconify-json/mdi，仅含源码实际引用的 ${names.length} 个图标；` +
  `经 main.ts 的 addCollection 注册后 Iconify 完全离线渲染。\n` +
  `export default {\n` +
  `  prefix: 'mdi',\n` +
  `  width: ${mdiSet.width},\n` +
  `  height: ${mdiSet.height},\n` +
  `  icons: {\n` +
  names
    .map((name) => {
      const icon = icons[name];
      return (
        `    '${name}': { body: ${JSON.stringify(icon.body)}` +
        (icon.width != null ? `, width: ${icon.width}` : '') +
        (icon.height != null ? `, height: ${icon.height}` : '') +
        ' },'
      );
    })
    .join('\n') +
  `\n  },\n};\n`;

fs.writeFileSync(outFile, content);
console.log(`[icons] 已生成 src/assets/icons-mdi.ts（${names.length} 个图标，${content.length} 字节）`);

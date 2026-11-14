#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 by Mr lin

/**
 * SPDX 头检查与自动修复。
 * 用法：
 *   node scripts/license.mjs          # 只检查，缺失时退出码 1
 *   node scripts/license.mjs --fix    # 自动在文件头插入两行声明
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src', 'scripts', 'public', 'test'];
const EXTENSIONS = new Set(['.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'data', 'logs', '.git']);
const HEADER = '// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 by Mr lin\n';

const fix = process.argv.includes('--fix');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, out);
      continue;
    }
    if (EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

function hasHeader(text) {
  return text.includes('SPDX-License-Identifier: MIT') && text.includes('Copyright (c) 2026 by Mr lin');
}

function applyHeader(text) {
  if (text.startsWith('#!')) {
    const end = text.indexOf('\n');
    if (end === -1) return `${text}\n${HEADER}`;
    return `${text.slice(0, end + 1)}${HEADER}\n${text.slice(end + 1).replace(/^\n/, '')}`;
  }
  return `${HEADER}\n${text.replace(/^\n/, '')}`;
}

const files = ROOTS.flatMap((root) => {
  try {
    return walk(root);
  } catch {
    return [];
  }
});

const missing = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (hasHeader(text)) continue;
  if (fix) {
    writeFileSync(file, applyHeader(text), 'utf8');
    console.log(`已补头: ${file}`);
  } else {
    missing.push(file);
  }
}

if (missing.length > 0) {
  console.error(`缺少 SPDX 头（${missing.length} 个），可执行 npm run license:fix：`);
  for (const file of missing) console.error(`  - ${file}`);
  process.exit(1);
}

console.log(fix ? `完成：检查 ${files.length} 个文件，已补齐缺失头。` : `通过：${files.length} 个文件均含 SPDX 头。`);

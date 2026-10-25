#!/usr/bin/env node
/**
 * 飞牛 fnOS 打包脚本（Native 应用，非 Docker）。
 *
 *   node scripts/build-fnos.mjs                 # 组装 + 内置 Node 运行时 + 出 x86/arm 两个 fpk
 *   node scripts/build-fnos.mjs --arch x64      # 只出一个架构
 *   node scripts/build-fnos.mjs --no-runtime    # 不内置 Node（依赖应用中心 nodejs_v22）
 *   node scripts/build-fnos.mjs --no-pack       # 只组装 app/server，不调 fnpack
 *
 * 步骤（对应指南 §13 / 附录 B）：
 *   1. 把 src/、public/、package.json、package-lock.json 组装到 fnos/siteguard/app/server/
 *   2. 在 server/ 内 `npm ci --omit=dev`，依赖随包携带（离线可装，manifest 不写 install_dep_apps）
 *   3. 按架构下载官方 Node 二进制，只取 bin/node 放进 server/runtime/<arch>/node
 *   4. 权限归一（§13.2），按架构改写 manifest 的 platform
 *   5. `fnpack build --directory fnos/siteguard`，产物改名后放进 dist/fnos/
 *
 * 环境变量：FNPACK_BIN 可显式指定 fnpack 路径；未指定时按 fnpack → 本机缓存的顺序探测。
 */

import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_DIR = path.join(ROOT, 'fnos', 'siteguard');
const SERVER_DIR = path.join(PACK_DIR, 'app', 'server');
const CACHE_DIR = path.join(ROOT, 'build', 'node-cache');
const OUT_DIR = path.join(ROOT, 'dist', 'fnos');
const MANIFEST = path.join(PACK_DIR, 'manifest');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const archs = value('--arch', 'x64,arm64')
  .split(',')
  .map((a) => a.trim())
  .filter(Boolean);

const WITH_RUNTIME = !flag('--no-runtime');
const WITH_PACK = !flag('--no-pack');

const log = (msg) => console.log(`[build-fnos] ${msg}`);
const die = (msg) => {
  console.error(`[build-fnos] ${msg}`);
  process.exit(1);
};

const run = (cmd, argv, opts = {}) => {
  const options = { stdio: 'inherit', ...opts };
  // Windows 上 npm 是 npm.cmd，直接 spawn 会 ENOENT，交给 shell 解析。
  if (process.platform === 'win32' && /^(npm|npm\.cmd)$/.test(cmd)) {
    options.shell = true;
    cmd = 'npm';
    argv = argv.map((item) => (/\s/.test(item) ? `"${item}"` : item));
  }
  const res = spawnSync(cmd, argv, options);
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} 退出码 ${res.status}`);
};

/* ---------------- 1. 组装 app/server ---------------- */

function assemble() {
  log('组装 app/server ...');
  fs.rmSync(SERVER_DIR, { recursive: true, force: true });
  fs.mkdirSync(SERVER_DIR, { recursive: true });

  fs.cpSync(path.join(ROOT, 'src'), path.join(SERVER_DIR, 'src'), { recursive: true });
  // 后端按 config.js 的 ../public/ 找前端产物，所以部署形态是 app/server/public/。
  fs.cpSync(path.join(ROOT, 'public'), path.join(SERVER_DIR, 'public'), { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) {
    const src = path.join(ROOT, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(SERVER_DIR, file));
  }

  // 依赖随包携带：只装生产依赖，禁用安装脚本（nodemailer 是纯 JS，无原生编译）。
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: SERVER_DIR });
  log('依赖已安装到 app/server/node_modules');
}

/* ---------------- 2. 内置 Node 运行时 ---------------- */

const NODE_MIRROR = process.env.NODE_MIRROR || 'https://nodejs.org/dist';

async function resolveNodeVersion() {
  const res = await fetch(`${NODE_MIRROR}/latest-v22.x/`);
  if (!res.ok) throw new Error(`拉取 Node 版本索引失败：HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/node-v(\d+\.\d+\.\d+)-linux-x64\.tar\.gz/);
  if (!match) throw new Error('版本索引里没有找到 linux-x64 的 Node 包');
  return match[1];
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`下载失败：${url} → HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function installRuntime(arch, nodeVersion) {
  const platform = arch === 'x64' ? 'linux-x64' : 'linux-arm64';
  const tarball = path.join(CACHE_DIR, `node-v${nodeVersion}-${platform}.tar.gz`);

  if (!fs.existsSync(tarball) || fs.statSync(tarball).size < 1024 * 1024) {
    log(`下载 Node v${nodeVersion} ${platform} ...`);
    await download(`${NODE_MIRROR}/v${nodeVersion}/node-v${nodeVersion}-${platform}.tar.gz`, tarball);
  } else {
    log(`复用缓存的 Node v${nodeVersion} ${platform}`);
  }

  // 只取 bin/node（约 110MB 的完整发行包其余部分用不上），塞进包里当自带运行时。
  const destDir = path.join(SERVER_DIR, 'runtime', arch);
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  // 全部用正斜杠的相对路径：GNU tar 会把带冒号的 Windows 绝对路径当成“远程主机:path”，
  // MSYS 还会把反斜杠再转义一层。以 ROOT 为工作目录可避开这两个坑。
  const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
  run(
    'tar',
    [
      '-xzf',
      rel(tarball),
      '-C',
      rel(destDir),
      '--strip-components=2',
      `node-v${nodeVersion}-${platform}/bin/node`
    ],
    { cwd: ROOT }
  );

  const nodeBin = path.join(destDir, 'node');
  if (!fs.existsSync(nodeBin)) die(`解包后没有找到 ${nodeBin}`);
  fs.chmodSync(nodeBin, 0o755);
  log(`内置运行时：server/runtime/${arch}/node`);
}

/* ---------------- 3. 权限归一与 manifest ---------------- */

function normalizePermissions() {
  // §13.2：scp/tar 往返容易把权限打乱，fnpack 报 permission denied 就是这么来的。
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        fs.chmodSync(full, 0o755);
        walk(full);
      } else {
        fs.chmodSync(full, 0o644);
      }
    }
  };
  walk(PACK_DIR);
  // cmd/ 与内置 node 必须可执行。
  for (const name of fs.readdirSync(path.join(PACK_DIR, 'cmd'))) {
    fs.chmodSync(path.join(PACK_DIR, 'cmd', name), 0o755);
  }
  for (const arch of archs) {
    const bin = path.join(SERVER_DIR, 'runtime', arch, 'node');
    if (fs.existsSync(bin)) fs.chmodSync(bin, 0o755);
  }
}

function setPlatform(platform) {
  const original = fs.readFileSync(MANIFEST, 'utf8');
  const patched = original.replace(/^platform\s*=.*$/m, `platform              = ${platform}`);
  fs.writeFileSync(MANIFEST, patched);
  return () => fs.writeFileSync(MANIFEST, original);
}

/* ---------------- 4. fnpack ---------------- */

function findFnpack() {
  if (process.env.FNPACK_BIN) return process.env.FNPACK_BIN;
  const local = path.join(CACHE_DIR, 'fnpack.exe');
  if (fs.existsSync(local)) return local;
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['fnpack'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return which.stdout.trim().split(/\r?\n/)[0];
  return 'fnpack';
}

function pack(arch, platform, version) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const fnpack = findFnpack();
  log(`fnpack build（platform=${platform}）...`);
  run(fnpack, ['build', '--directory', PACK_DIR], { cwd: OUT_DIR });

  const produced = path.join(OUT_DIR, 'siteguard.fpk');
  if (!fs.existsSync(produced)) die(`没有生成 ${produced}`);
  const target = path.join(OUT_DIR, `siteguard-${version}-${arch === 'x64' ? 'x86' : 'arm'}.fpk`);
  fs.rmSync(target, { force: true });
  fs.renameSync(produced, target);
  const mb = (fs.statSync(target).size / 1024 / 1024).toFixed(1);
  log(`产物：${path.relative(ROOT, target)}（${mb} MB）`);
  return target;
}

/* ---------------- main ---------------- */

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;

  // 仓库里的 manifest 是源文件，platform 会被按架构临时改写；
  // 注册退出钩子保证即使 process.exit() 掩过 finally 也能还原（fnpack 失败时会走那条路）。
  const pristineManifest = fs.readFileSync(MANIFEST, 'utf8');
  process.on('exit', () => {
    try {
      if (fs.readFileSync(MANIFEST, 'utf8') !== pristineManifest) fs.writeFileSync(MANIFEST, pristineManifest);
    } catch {
      // 还原失败不掩盖原始退出码。
    }
  });

  for (const arch of archs) {
    if (!['x64', 'arm64'].includes(arch)) die(`不支持的架构：${arch}（只支持 x64 / arm64）`);
  }

  assemble();

  let nodeVersion = '';
  if (WITH_RUNTIME) {
    nodeVersion = await resolveNodeVersion();
    log(`目标 Node 版本：v${nodeVersion}`);
  } else {
    log('已跳过内置运行时：安装后需要应用中心提供 nodejs_v22');
  }

  normalizePermissions();

  const restore = WITH_RUNTIME ? null : setPlatform('all');
  if (restore) log('platform 写为 all（无内置运行时）');
  else log(`platform 按架构分别写为 x86 / arm（内置 Node v${nodeVersion}）`);

  if (!WITH_PACK) {
    log('--no-pack：组装完成，跳过 fnpack');
    restore?.();
    return;
  }

  try {
    if (WITH_RUNTIME) {
      for (const arch of archs) {
        // 一个 fpk 只带一个架构的运行时，否则体积翻倍且 platform 字段对不上。
        for (const other of ['x64', 'arm64']) {
          if (other !== arch) fs.rmSync(path.join(SERVER_DIR, 'runtime', other), { recursive: true, force: true });
        }
        await installRuntime(arch, nodeVersion);
        normalizePermissions();
        const restorePlatform = setPlatform(arch === 'x64' ? 'x86' : 'arm');
        try {
          pack(arch, arch === 'x64' ? 'x86' : 'arm', version);
        } finally {
          restorePlatform();
        }
      }
    } else {
      pack('all', 'all', version);
    }
  } finally {
    restore?.();
  }
}

main().catch((err) => {
  console.error(`[build-fnos] 失败：${err.message}`);
  process.exit(1);
});

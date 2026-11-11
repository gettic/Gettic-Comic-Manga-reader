// One-command build from Windows. The Rust part is built inside WSL (Ubuntu) by
// scripts/build-exe.sh with cargo-xwin; only the finished exe comes back to Windows.
//
// Usage (from code\):
//   node scripts/build.mjs release [--smoke]   npm run exe / npm run exe:smoke
//   node scripts/build.mjs check               npm run rust:check   (Windows target)
//   node scripts/build.mjs clippy              npm run rust:clippy  (Windows target, -D warnings)
//   node scripts/build.mjs test                npm run rust:test    (unit tests, run in Linux)
//   node scripts/build.mjs lock                npm run rust:lock    (after editing Cargo.toml: update Cargo.lock)
//
// Output: src-tauri\target\release\gettics-comic-manga-reader.exe. Exit code 0 = all passed.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DISTRO = "Ubuntu";
const MODES = ["release", "check", "clippy", "test", "lock"];

const codeDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = join(codeDir, "src-tauri", "target", "release");
const exe = join(releaseDir, "gettics-comic-manga-reader.exe");
const smokeDir = join(codeDir, "src-tauri", "target", "smoke-data");

const mode = process.argv[2] ?? "release";
const smoke = process.argv.includes("--smoke");
if (!MODES.includes(mode)) fail(`unknown mode "${mode}" (use ${MODES.join(", ")})`);

function fail(msg, code = 1) {
  console.error(`build: ${msg}`);
  process.exit(code);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", windowsHide: true, ...opts });
  if (r.error) fail(`${cmd} could not start: ${r.error.message}`);
  return r.status ?? 1;
}

function toWslPath(winPath) {
  const r = spawnSync("wsl.exe", ["-d", DISTRO, "-e", "wslpath", "-a", winPath], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.status !== 0) fail(`wslpath failed for ${winPath}: ${r.stderr}`);
  return r.stdout.trim();
}

// The Rust build embeds ..\dist, so it must exist (always rebuilt for a release).
if (mode === "release" || !existsSync(join(codeDir, "dist", "index.html"))) {
  // npm is a .cmd file on Windows, so it needs a shell; fixed command, no arguments passed in.
  if (run("npm run build", [], { cwd: codeDir, shell: true }) !== 0) fail("npm run build failed");
}

const wslArgs = ["-d", DISTRO, "-e", "bash", toWslPath(join(codeDir, "scripts", "build-exe.sh")), mode];
if (mode === "release") {
  mkdirSync(releaseDir, { recursive: true });
  wslArgs.push(toWslPath(releaseDir));
}
const status = run("wsl.exe", wslArgs);
if (status !== 0) fail(`WSL ${mode} failed (exit code ${status})`, status);

if (mode === "release") {
  console.log(`Built ${exe} (${(statSync(exe).size / 1024 / 1024).toFixed(2)} MB)`);
}

if (smoke) {
  if (!existsSync(exe)) fail(`no exe to smoke-test: ${exe}`);
  mkdirSync(smokeDir, { recursive: true });
  const r = spawnSync(exe, ["--smoke-test", smokeDir], {
    stdio: "inherit",
    windowsHide: true,
    timeout: 40_000,
  });
  rmSync(smokeDir, { recursive: true, force: true });
  if (r.error) fail(`smoke test could not run: ${r.error.message}`);
  console.log(`Smoke test exit code: ${r.status}`);
  if (r.status !== 0) process.exit(r.status ?? 1);
}

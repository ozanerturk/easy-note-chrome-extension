#!/usr/bin/env node

// Branded Chrome removed --load-extension in v137 and the
// --disable-features escape hatch in v142, so unpacked extensions can only be
// auto-loaded by a Chrome for Testing build.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const extensionPath = path.resolve(__dirname, "..");
const profilePath = path.join(extensionPath, ".dev-profile");
const cachePath = path.join(extensionPath, ".chrome");

function findChrome() {
  const roots = [path.join(cachePath, "chrome")];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const build of fs.readdirSync(root)) {
      const bin = path.join(
        root,
        build,
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing"
      );
      if (fs.existsSync(bin)) return bin;
      const x64 = bin.replace("chrome-mac-arm64", "chrome-mac-x64");
      if (fs.existsSync(x64)) return x64;
    }
  }
  return null;
}

const chromeBin = findChrome();

if (!chromeBin) {
  console.error("Chrome for Testing not found. Install it with:\n");
  console.error(`  npx @puppeteer/browsers install chrome@stable --path "${cachePath}"\n`);
  process.exit(1);
}

const args = [
  `--load-extension=${extensionPath}`,
  `--disable-extensions-except=${extensionPath}`,
  `--user-data-dir=${profilePath}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  "--disable-translate",
  "--disable-default-apps",
];

console.log("🚀 Launching Chrome for Testing with Easy Note...");
console.log(`   Extension: ${extensionPath}`);
console.log(`   Profile:   ${profilePath}\n`);

const chrome = spawn(chromeBin, args, { stdio: "inherit", detached: true });

chrome.on("error", (err) => {
  console.error("Failed to launch Chrome:", err.message);
  process.exit(1);
});

chrome.unref();

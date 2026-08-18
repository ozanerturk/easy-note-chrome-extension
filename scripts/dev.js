#!/usr/bin/env node

const { spawn } = require("child_process");
const path = require("path");

const extensionPath = path.resolve(__dirname, "..");
const profilePath = path.resolve(extensionPath, ".dev-profile");

const args = [
  `--load-extension=${extensionPath}`,
  `--disable-extensions-except=${extensionPath}`,
  `--user-data-dir=${profilePath}`,
  "chrome://newtab",
];

console.log(`🚀 Launching Chrome with Easy Note extension...`);
console.log(`   Extension path: ${extensionPath}`);
console.log(`   Profile path: ${profilePath}\n`);

const chrome = spawn("open", ["-a", "Google Chrome", "--args", ...args], {
  stdio: "inherit",
});

chrome.on("error", (err) => {
  console.error("Failed to launch Chrome:", err.message);
  process.exit(1);
});

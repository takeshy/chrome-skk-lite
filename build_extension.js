const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const decoder = new TextDecoder("euc-jp");

const ROOT = __dirname;
const BUILD_CONFIG_FILE = path.join(ROOT, "dictionary_sources.json");
const COMPILED_DIR = path.join(ROOT, "compiled");
const COMPILED_FILE = path.join(COMPILED_DIR, "dictionary.json");

function loadBuildConfig() {
  const config = JSON.parse(fs.readFileSync(BUILD_CONFIG_FILE, "utf8"));
  if (!config || typeof config !== "object") {
    throw new Error(`Invalid build config: ${BUILD_CONFIG_FILE}`);
  }
  if (!Array.isArray(config.dictionaries) || config.dictionaries.length === 0) {
    throw new Error("Build config must contain a non-empty dictionaries array.");
  }
  if (!Array.isArray(config.runtimeFiles) || config.runtimeFiles.length === 0) {
    throw new Error("Build config must contain a non-empty runtimeFiles array.");
  }
  if (typeof config.sourceBaseUrl !== "string" || !config.sourceBaseUrl) {
    throw new Error("Build config must contain sourceBaseUrl.");
  }
  if (typeof config.packageDirectory !== "string" || !config.packageDirectory) {
    throw new Error("Build config must contain packageDirectory.");
  }
  return config;
}

function dictionaryArchiveUrl(sourceBaseUrl, dictionaryName) {
  return `${sourceBaseUrl.replace(/\/+$/, "")}/${encodeURIComponent(dictionaryName)}.gz`;
}

async function fetchDictionaryText(sourceBaseUrl, dictionaryName) {
  const url = dictionaryArchiveUrl(sourceBaseUrl, dictionaryName);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${dictionaryName} (${response.status} ${response.statusText})`);
  }
  const archiveBuffer = Buffer.from(await response.arrayBuffer());
  const textBuffer = zlib.gunzipSync(archiveBuffer);
  return decoder.decode(textBuffer);
}

function parseDictionary(text, dict) {
  const lines = text.split("\n");
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith(";;")) continue;

    const spaceIndex = line.indexOf(" ");
    if (spaceIndex === -1) continue;

    const kana = line.substring(0, spaceIndex);
    const rest = line.substring(spaceIndex + 1);
    if (!rest.startsWith("/") || !rest.endsWith("/")) continue;

    const entries = rest.substring(1, rest.length - 1).split("/");
    let bucket = dict[kana];
    if (!bucket) {
      bucket = [];
      dict[kana] = bucket;
    }

    for (const entry of entries) {
      if (!entry) continue;
      // Keep the annotation (";..." suffix); dedupe by the word before it.
      const word = entry.split(";")[0];
      if (word && !bucket.some((item) => item.split(";")[0] === word)) {
        bucket.push(entry);
      }
    }
  }
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyRuntimeFile(sourcePath, destinationPath) {
  try {
    fs.copyFileSync(sourcePath, destinationPath);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    fs.writeFileSync(destinationPath, fs.readFileSync(sourcePath));
  }
}

function copyRuntimeFiles(runtimeFiles, packageDir) {
  for (const relativePath of runtimeFiles) {
    const sourcePath = path.join(ROOT, relativePath);
    const destinationPath = path.join(packageDir, relativePath);
    ensureDirectory(path.dirname(destinationPath));
    copyRuntimeFile(sourcePath, destinationPath);
  }
}

async function main() {
  const buildConfig = loadBuildConfig();
  const dict = Object.create(null);
  let totalKeys = 0;

  for (const dictionaryName of buildConfig.dictionaries) {
    const text = await fetchDictionaryText(buildConfig.sourceBaseUrl, dictionaryName);
    const beforeKeys = Object.keys(dict).length;
    parseDictionary(text, dict);
    const addedKeys = Object.keys(dict).length - beforeKeys;
    totalKeys = Object.keys(dict).length;
    console.log(`Processed ${dictionaryName}: +${addedKeys} keys`);
  }

  const packageDir = path.join(ROOT, buildConfig.packageDirectory);
  const packageCompiledDir = path.join(packageDir, "compiled");
  const packageCompiledFile = path.join(packageCompiledDir, "dictionary.json");
  const dictionaryJson = JSON.stringify(dict);

  fs.rmSync(packageDir, { recursive: true, force: true });
  ensureDirectory(COMPILED_DIR);
  ensureDirectory(packageCompiledDir);
  fs.writeFileSync(COMPILED_FILE, dictionaryJson);
  fs.writeFileSync(packageCompiledFile, dictionaryJson);
  copyRuntimeFiles(buildConfig.runtimeFiles, packageDir);

  const size = Buffer.byteLength(dictionaryJson);
  console.log(`Wrote ${COMPILED_FILE}`);
  console.log(`Packaged extension into ${packageDir}`);
  console.log(`Total keys: ${totalKeys}`);
  console.log(`Output size: ${size} bytes`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

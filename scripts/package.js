const { execFileSync, execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const PACKAGE_DIR = path.join(ROOT, "build", "chrome-skk-lite");
const ZIP_FILE = path.join(ROOT, "build", "chrome-skk-lite.zip");

function createZipArchive() {
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Compress-Archive -Path $args[0] -DestinationPath $args[1]",
        path.join(PACKAGE_DIR, "*"),
        ZIP_FILE
      ],
      { stdio: "inherit" }
    );
    return;
  }

  try {
    execFileSync("zip", ["-qr", ZIP_FILE, "."], { cwd: PACKAGE_DIR, stdio: "inherit" });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    // `zip` is unavailable (e.g. stock WSL); fall back to python3's zipfile module.
    const script = [
      "import os, sys, zipfile",
      "src, dst = sys.argv[1], sys.argv[2]",
      "with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf:",
      "    for root, dirs, files in os.walk(src):",
      "        for name in files:",
      "            path = os.path.join(root, name)",
      "            zf.write(path, os.path.relpath(path, src))"
    ].join("\n");
    execFileSync("python3", ["-c", script, PACKAGE_DIR, ZIP_FILE], { stdio: "inherit" });
  }
}

function main() {
  console.log("Building extension...");
  execSync("node build_extension.js", { stdio: "inherit", cwd: ROOT });

  if (fs.existsSync(ZIP_FILE)) {
    fs.unlinkSync(ZIP_FILE);
  }

  console.log(`Creating ZIP archive: ${ZIP_FILE}`);
  createZipArchive();
  console.log("Package created successfully!");
  console.log(`Upload this file to Chrome Web Store: ${ZIP_FILE}`);
}

main();

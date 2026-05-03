const { execSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const PACKAGE_DIR = path.join(ROOT, "build", "chrome-skk-lite");
const ZIP_FILE = path.join(ROOT, "build", "chrome-skk-lite.zip");

function main() {
  console.log("Building extension...");
  execSync("node build_extension.js", { stdio: "inherit", cwd: ROOT });

  if (fs.existsSync(ZIP_FILE)) {
    fs.unlinkSync(ZIP_FILE);
  }

  console.log(`Creating ZIP archive: ${ZIP_FILE}`);
  // Using PowerShell's Compress-Archive for Windows compatibility
  const command = `powershell.exe -NoProfile -Command "Compress-Archive -Path '${PACKAGE_DIR}\\*' -DestinationPath '${ZIP_FILE}'"`;
  
  try {
    execSync(command, { stdio: "inherit" });
    console.log("Package created successfully!");
    console.log(`Upload this file to Chrome Web Store: ${ZIP_FILE}`);
  } catch (error) {
    console.error("Failed to create ZIP archive.");
    console.error(error);
  }
}

main();

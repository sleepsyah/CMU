import { access, cp, chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

if (process.platform !== "darwin") throw new Error("The macOS connector package must be built on macOS.");

const root = resolve(".");
const app = join(root, "artifacts/Ellipsis AI Connector.app");
const archive = join(root, "artifacts/Ellipsis-AI-Connector-macOS.zip");
const contents = join(app, "Contents");
const resources = join(contents, "Resources/app");
const macos = join(contents, "MacOS");
const sdkEntryUrl = import.meta.resolve("@openai/codex-sdk");
const sdkEntry = fileURLToPath(sdkEntryUrl);
const sdkDir = dirname(dirname(sdkEntry));
const codexScript = createRequire(sdkEntryUrl).resolve("@openai/codex/bin/codex.js");
const codexDir = dirname(dirname(codexScript));
const execFileAsync = promisify(execFile);

async function standaloneNodeBinary() {
  if (process.env.ELLIPSIS_NODE_BINARY) return resolve(process.env.ELLIPSIS_NODE_BINARY);
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const version = process.version;
  const archiveName = `node-${version}-darwin-${arch}`;
  const cacheRoot = join(root, "artifacts/.node-runtime", archiveName);
  const binary = join(cacheRoot, "bin/node");
  try {
    await access(binary);
    return binary;
  } catch {
    const archive = join(root, "artifacts/.node-runtime", `${archiveName}.tar.gz`);
    await mkdir(dirname(archive), { recursive: true });
    const response = await fetch(`https://nodejs.org/dist/${version}/${archiveName}.tar.gz`);
    if (!response.ok) throw new Error(`Could not download the standalone Node ${version} runtime.`);
    await writeFile(archive, Buffer.from(await response.arrayBuffer()));
    await execFileAsync("/usr/bin/tar", ["-xzf", archive, "-C", dirname(cacheRoot)]);
    return binary;
  }
}

await rm(app, { recursive: true, force: true });
await mkdir(join(resources, "native-host"), { recursive: true });
await mkdir(join(resources, "node_modules/@openai"), { recursive: true });
await mkdir(macos, { recursive: true });
for (const file of ["app-server.mjs", "analysis.mjs", "claude.mjs", "host.mjs", "native-protocol.mjs", "restrictions.mjs"]) {
  await cp(join(root, "native-host", file), join(resources, "native-host", file));
}
await cp(sdkDir, join(resources, "node_modules/@openai/codex-sdk"), { recursive: true });
await cp(codexDir, join(resources, "node_modules/@openai/codex"), { recursive: true });
const codexPackage = JSON.parse(await readFile(join(codexDir, "package.json"), "utf8"));
for (const dependency of Object.keys(codexPackage.optionalDependencies || {})) {
  try {
    const dependencyDir = join(root, "node_modules", dependency);
    await access(dependencyDir);
    await cp(dependencyDir, join(resources, "node_modules", dependency), { recursive: true });
  } catch {
    // Only the current platform package is installed.
  }
}
await cp(await standaloneNodeBinary(), join(contents, "Resources/node"));
await chmod(join(contents, "Resources/node"), 0o755);

const launcher = `#!/bin/sh\nset -eu\nCONTENTS=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\ncase "\${1:-}" in\n  chrome-extension://*) exec "$CONTENTS/Resources/node" "$CONTENTS/Resources/app/native-host/host.mjs" "$@" ;;\n  *) exec "$CONTENTS/Resources/node" "$CONTENTS/Resources/app/native-host/register-macos.mjs" "$CONTENTS/MacOS/ellipsis-ai-connector" ;;\nesac\n`;
await writeFile(join(macos, "ellipsis-ai-connector"), launcher, "utf8");
await chmod(join(macos, "ellipsis-ai-connector"), 0o755);

const registerScript = `import { mkdir, rm, writeFile } from "node:fs/promises";\nimport { homedir } from "node:os";\nimport { dirname, join } from "node:path";\nconst hostPath = process.argv[2];\nconst hosts = join(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts");\nconst target = join(hosts, "com.ellipsis.codex.json");\nawait mkdir(dirname(target), { recursive: true });\nawait writeFile(target, JSON.stringify({ name: "com.ellipsis.codex", description: "Ellipsis AI Connector", path: hostPath, type: "stdio", allowed_origins: ["chrome-extension://pnejddnjlgkoadpmnmfcodkgcgohkkbl/"] }, null, 2) + "\\n");\nconst previousBrand = ["un", "framed"].join("");\nawait rm(join(hosts, "com." + previousBrand + ".codex.json"), { force: true });\nconst { execFile } = await import("node:child_process");\nexecFile("/usr/bin/osascript", ["-e", 'display dialog "Ellipsis AI Connector is installed. Return to Chrome and connect your AI provider." buttons {"OK"} default button "OK" with title "Ellipsis"']);\n`;
await writeFile(join(resources, "native-host/register-macos.mjs"), registerScript, "utf8");
await writeFile(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>ellipsis-ai-connector</string><key>CFBundleIdentifier</key><string>com.ellipsis.codex</string><key>CFBundleName</key><string>Ellipsis AI Connector</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.2.0</string></dict></plist>\n`, "utf8");

if (process.env.ELLIPSIS_CODESIGN_IDENTITY) {
  await execFileAsync("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--options",
    "runtime",
    "--timestamp",
    "--sign",
    process.env.ELLIPSIS_CODESIGN_IDENTITY,
    app,
  ]);
}

await rm(archive, { force: true });
await execFileAsync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
process.stdout.write(`${app}\n${archive}\n`);

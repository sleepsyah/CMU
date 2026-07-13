import { execFile } from "node:child_process";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

export const HOST_NAME = "com.ellipsis.codex";
export const EXTENSION_ID = "pnejddnjlgkoadpmnmfcodkgcgohkkbl";
const execFileAsync = promisify(execFile);

export function hostManifest(hostPath) {
  return {
    name: HOST_NAME,
    description: "Ellipsis AI Connector",
    path: resolve(hostPath),
    type: "stdio",
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`]
  };
}

function manifestPath() {
  if (process.platform === "darwin") return join(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${HOST_NAME}.json`);
  if (process.platform === "linux") return join(homedir(), ".config/google-chrome/NativeMessagingHosts", `${HOST_NAME}.json`);
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || homedir(), "Ellipsis/NativeMessagingHosts", `${HOST_NAME}.json`);
  throw new Error(`Unsupported platform: ${process.platform}`);
}

function legacyManifestPath() {
  const previousBrand = ["un", "framed"].join("");
  if (process.platform === "darwin") return join(homedir(), `Library/Application Support/Google/Chrome/NativeMessagingHosts/com.${previousBrand}.codex.json`);
  if (process.platform === "linux") return join(homedir(), `.config/google-chrome/NativeMessagingHosts/com.${previousBrand}.codex.json`);
  return null;
}

function generatedLauncherDirectory() {
  if (process.platform === "darwin") return join(homedir(), "Library/Application Support/Ellipsis/NativeHost");
  if (process.platform === "linux") return join(homedir(), ".local/share/Ellipsis/NativeHost");
  throw new Error("The source connector installer currently supports macOS and Linux.");
}

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function sourceLauncherContents(nodePath, hostScript) {
  return `#!/bin/sh\nset -eu\nexec ${shellQuote(nodePath)} ${shellQuote(hostScript)} "$@"\n`;
}

async function createSourceLauncher() {
  const directory = generatedLauncherDirectory();
  const launcher = join(directory, "ellipsis-ai-connector");
  const hostScript = resolve("native-host/host.mjs");
  await mkdir(directory, { recursive: true });
  await writeFile(
    launcher,
    sourceLauncherContents(process.execPath, hostScript),
    "utf8"
  );
  await chmod(launcher, 0o755);
  return launcher;
}

export async function installNativeHost(hostPath) {
  const target = manifestPath();
  const resolvedHostPath = hostPath ? resolve(hostPath) : await createSourceLauncher();
  await chmod(resolvedHostPath, 0o755).catch(() => undefined);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(hostManifest(resolvedHostPath), null, 2)}\n`, "utf8");
  const legacyTarget = legacyManifestPath();
  if (legacyTarget) await rm(legacyTarget, { force: true });
  if (process.platform === "win32") {
    await execFileAsync("reg.exe", ["ADD", `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, "/ve", "/t", "REG_SZ", "/d", target, "/f"]);
  }
  return target;
}

export async function uninstallNativeHost() {
  const target = manifestPath();
  await rm(target, { force: true });
  const legacyTarget = legacyManifestPath();
  if (legacyTarget) await rm(legacyTarget, { force: true });
  if (process.platform !== "win32") await rm(generatedLauncherDirectory(), { recursive: true, force: true });
  if (process.platform === "win32") {
    await execFileAsync("reg.exe", ["DELETE", `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`, "/f"]).catch(() => undefined);
  }
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const uninstall = process.argv.includes("--uninstall");
  const target = uninstall ? await uninstallNativeHost() : await installNativeHost();
  process.stdout.write(`${uninstall ? "Removed" : "Installed"} ${HOST_NAME}: ${target}\n`);
}

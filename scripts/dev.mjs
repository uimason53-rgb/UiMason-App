import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const windowsShell = process.env.ComSpec || "cmd.exe";

const resolveCommand = (command, args) => {
  if (isWindows && command.endsWith(".cmd")) {
    return {
      command: windowsShell,
      args: ["/d", "/s", "/c", command, ...args],
    };
  }

  return { command, args };
};

const run = (label, command, args, options = {}) => {
  const target = resolveCommand(command, args);
  const child = spawn(target.command, target.args, {
    stdio: "inherit",
    shell: false,
    ...options,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.log(`[${label}] exited via ${signal}`);
      return;
    }
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
};

const build = run("build", npmCmd, ["run", "build:server"]);

let server;
let client;
let shuttingDown = false;

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [server, client]) {
    if (!child || child.killed) continue;
    if (isWindows) {
      spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  }
  process.exitCode = code;
};

build.on("exit", (code) => {
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }

  server = run("server", "node", ["dist-server/index.js"], {
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || "development",
      PORT: process.env.PORT || "3001",
    },
  });

  client = run("client", npmCmd, ["run", "dev:client"]);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

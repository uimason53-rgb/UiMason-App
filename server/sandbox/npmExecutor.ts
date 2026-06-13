import { commandRunner } from "./commandRunner";

export class NpmExecutor {
  async execute(command: string) {
    return commandRunner(`npm ${command}`);
  }

  async install(pkg?: string) {
    return commandRunner(pkg ? `npm install ${pkg}` : "npm install");
  }

  async build() {
    return commandRunner("npm run build");
  }

  async dev() {
    return commandRunner("npm run dev");
  }

  async test() {
    return commandRunner("npm test");
  }

  async runScript(script: string) {
    return commandRunner(`npm run ${script}`);
  }
}
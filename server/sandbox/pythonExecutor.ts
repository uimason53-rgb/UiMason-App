import { commandRunner } from "./commandRunner";

export class PythonExecutor {
  async execute(command: string) {
    return commandRunner(`python ${command}`);
  }

  async run(file: string) {
    return commandRunner(`python ${file}`);
  }

  async runModule(module: string) {
    return commandRunner(`python -m ${module}`);
  }

  async pip(command: string) {
    return commandRunner(`pip ${command}`);
  }

  async install(pkg: string) {
    return commandRunner(`pip install ${pkg}`);
  }
}
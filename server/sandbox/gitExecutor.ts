import { commandRunner } from "./commandRunner";

export class GitExecutor {
  async execute(command: string) {
    return commandRunner(`git ${command}`);
  }

  async status() {
    return commandRunner("git status");
  }

  async branch() {
    return commandRunner("git branch");
  }

  async checkout(branch: string) {
    return commandRunner(`git checkout ${branch}`);
  }

  async add(files = ".") {
    return commandRunner(`git add ${files}`);
  }

  async commit(message: string) {
    return commandRunner(`git commit -m "${message}"`);
  }

  async diff(file?: string) {
    return commandRunner(file ? `git diff ${file}` : "git diff");
  }

  async log(limit = 10) {
    return commandRunner(`git log --oneline -${limit}`);
  }

  async push(branch = "main") {
    return commandRunner(`git push origin ${branch}`);
  }
}
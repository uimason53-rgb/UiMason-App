import { commandRunner } from "../sandbox/commandRunner";

export class BranchService {
  async create(branch: string) {
    console.log(`[BranchService] Creating: ${branch}`);
    return commandRunner(`git checkout -b ${branch}`);
  }

  async getAll() {
    const result = await commandRunner("git branch -a");
    const branches = result.stdout
      .split("\n")
      .map(b => b.replace("*", "").trim())
      .filter(Boolean);
    return branches;
  }

  async current() {
    const result = await commandRunner("git branch --show-current");
    return result.stdout.trim();
  }

  async checkout(branch: string) {
    console.log(`[BranchService] Checkout: ${branch}`);
    return commandRunner(`git checkout ${branch}`);
  }

  async delete(branch: string) {
    console.log(`[BranchService] Deleting: ${branch}`);
    return commandRunner(`git branch -d ${branch}`);
  }
}
import { commandRunner } from "../sandbox/commandRunner";
import type { GitCommit } from "./types/git.types";

export class CommitService {
  async create(message: string): Promise<GitCommit> {
    console.log(`[CommitService] Committing: "${message}"`);
    await commandRunner("git add .");
    const result = await commandRunner(`git commit -m "${message}"`);

    const hashResult = await commandRunner("git rev-parse --short HEAD");
    const hash = hashResult.stdout.trim() || crypto.randomUUID();

    console.log(`[CommitService] Committed: ${hash}`);
    return { hash, message };
  }

  async getAll(): Promise<GitCommit[]> {
    const result = await commandRunner("git log --oneline -20");
    return result.stdout
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [hash, ...rest] = line.split(" ");
        return { hash, message: rest.join(" ") };
      });
  }

  async getLatest(): Promise<GitCommit | null> {
    const all = await this.getAll();
    return all[0] || null;
  }
}
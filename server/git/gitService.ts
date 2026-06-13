import { BranchService } from "./branchService";
import { CommitService } from "./commitService";
import { DiffService } from "./diffService";
import { MergeService } from "./mergeService";
import { StashService } from "./stashService";
import { eventBus } from "../events/eventBus";

export class GitService {
  private branches = new BranchService();
  private commits = new CommitService();
  private diffs = new DiffService();
  private merges = new MergeService();
  private stashes = new StashService();

  createBranch(name: string) {
    console.log(`[GitService] Creating branch: ${name}`);
    eventBus.emit("git:branch:created", { name });
    return this.branches.create(name);
  }

  commit(message: string) {
    console.log(`[GitService] Committing: "${message}"`);
    eventBus.emit("git:committed", { message });
    return this.commits.create(message);
  }

  diff(file?: string) {
    console.log(`[GitService] Diffing: ${file || "all"}`);
    return this.diffs.generate(file);
  }

  merge(branch: string) {
    console.log(`[GitService] Merging: ${branch}`);
    eventBus.emit("git:merged", { branch });
    return this.merges.merge(branch);
  }

  stash(message?: string) {
    console.log(`[GitService] Stashing: ${message || "unnamed"}`);
    return this.stashes.push(message);
  }

  popStash() {
    return this.stashes.pop();
  }
}
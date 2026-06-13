import type { Patch } from "./types/patch.types";
import * as fs from "fs";
import * as path from "path";

export class RollbackPatch {
  async rollback(patch: Patch): Promise<{ success: boolean; error?: string }> {
    console.log(`[RollbackPatch] Rolling back: ${patch.file}`);

    try {
      const fullPath = path.join(process.cwd(), patch.file);
      const backup = `${fullPath}.backup`;

      if (!fs.existsSync(backup)) {
        console.warn(`[RollbackPatch] No backup found for: ${patch.file}`);
        return { success: false, error: "No backup found" };
      }

      fs.copyFileSync(backup, fullPath);
      fs.unlinkSync(backup);

      console.log(`[RollbackPatch] Restored: ${patch.file}`);
      return { success: true };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[RollbackPatch] Failed: ${msg}`);
      return { success: false, error: msg };
    }
  }
}
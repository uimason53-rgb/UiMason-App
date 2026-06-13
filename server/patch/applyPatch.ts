import type { Patch } from "./types/patch.types";
import * as fs from "fs";
import * as path from "path";

export class ApplyPatch {
  async apply(patch: Patch): Promise<{ success: boolean; error?: string }> {
    console.log(`[ApplyPatch] Applying patch to: ${patch.file}`);

    try {
      const fullPath = path.join(process.cwd(), patch.file);
      const dir = path.dirname(fullPath);

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Backup original
      if (fs.existsSync(fullPath)) {
        const backup = `${fullPath}.backup`;
        fs.copyFileSync(fullPath, backup);
        console.log(`[ApplyPatch] Backup saved: ${backup}`);
      }

      // Write new content
      fs.writeFileSync(fullPath, patch.newContent, "utf-8");
      console.log(`[ApplyPatch] Patched: ${patch.file}`);

      return { success: true };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[ApplyPatch] Failed: ${msg}`);
      return { success: false, error: msg };
    }
  }
}
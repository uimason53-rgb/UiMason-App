import type { Patch } from "./types/patch.types";

export class DiffGenerator {
  generate(file: string, oldContent: string, newContent: string): Patch {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    const hunks: string[] = [];
    let hasChanges = false;

    for (let i = 0; i < Math.max(oldLines.length, newLines.length); i++) {
      const old = oldLines[i];
      const next = newLines[i];
      if (old !== next) {
        hasChanges = true;
        if (old !== undefined) hunks.push(`- ${old}`);
        if (next !== undefined) hunks.push(`+ ${next}`);
      } else {
        hunks.push(`  ${old}`);
      }
    }

    console.log(`[DiffGenerator] ${file} — ${hasChanges ? "has changes" : "no changes"}`);
    return { file, oldContent, newContent, diff: hunks.join("\n") };
  }
}
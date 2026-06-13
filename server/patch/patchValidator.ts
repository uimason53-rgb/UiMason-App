import type { Patch } from "./types/patch.types";

export class PatchValidator {
  validate(patch: Patch): boolean {
    if (!patch.file || patch.file.length === 0) {
      console.warn(`[PatchValidator] Invalid: no file specified`);
      return false;
    }

    if (patch.oldContent === patch.newContent) {
      console.warn(`[PatchValidator] Invalid: no changes detected`);
      return false;
    }

    if (patch.newContent === undefined || patch.newContent === null) {
      console.warn(`[PatchValidator] Invalid: newContent is empty`);
      return false;
    }

    console.log(`[PatchValidator] Valid patch for: ${patch.file}`);
    return true;
  }
}
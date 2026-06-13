import { DiffGenerator } from "./diffGenerator";
import { ApplyPatch } from "./applyPatch";
import { RollbackPatch } from "./rollbackPatch";
import { PatchValidator } from "./patchValidator";
import { eventBus } from "../events/eventBus";

export class PatchEngine {
  private diffGenerator = new DiffGenerator();
  private applyPatch = new ApplyPatch();
  private rollbackPatch = new RollbackPatch();
  private validator = new PatchValidator();

  async execute(file: string, oldContent: string, newContent: string) {
    console.log(`\n[PatchEngine] Patching: ${file}`);
    eventBus.emit("patch:started", { file });

    const patch = this.diffGenerator.generate(file, oldContent, newContent);
    const valid = this.validator.validate(patch);

    if (!valid) {
      console.warn(`[PatchEngine] Invalid patch — aborted`);
      eventBus.emit("patch:invalid", { file });
      return { success: false, message: "Invalid patch" };
    }

    const result = await this.applyPatch.apply(patch);

    if (!result.success) {
      console.error(`[PatchEngine] Apply failed — rolling back`);
      await this.rollbackPatch.rollback(patch);
      eventBus.emit("patch:failed", { file, error: result.error });
      return { success: false, message: result.error || "Apply failed" };
    }

    console.log(`[PatchEngine] Success: ${file}`);
    eventBus.emit("patch:completed", { file });
    return { success: true, message: `Patched ${file}` };
  }

  async rollback(file: string, oldContent: string) {
    console.log(`[PatchEngine] Rolling back: ${file}`);
    const patch = { file, oldContent, newContent: oldContent };
    return this.rollbackPatch.rollback(patch);
  }
}
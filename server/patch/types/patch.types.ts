export interface Patch {
  file: string;
  oldContent: string;
  newContent: string;
  diff?: string;
}

export interface PatchResult {
  success: boolean;
  message: string;
  backup?: string;
}
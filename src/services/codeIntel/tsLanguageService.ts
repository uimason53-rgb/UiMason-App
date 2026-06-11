import * as monaco from "monaco-editor";
import type { editor } from "monaco-editor";
import type { GeneratedFile } from "../claudeService";

export type DefinitionLocation = {
  filePath: string;
  range: monaco.IRange;
  displayText: string;
};

export type ReferenceLocation = {
  filePath: string;
  range: monaco.IRange;
  isDefinition: boolean;
  text: string;
};

export type RenameEdit = {
  filePath: string;
  edits: {
    range: monaco.IRange;
    newText: string;
  }[];
};

export type HoverResult = {
  filePath: string;
  range: monaco.IRange;
  contents: string;
};

export type DiagnosticResult = {
  filePath: string;
  message: string;
  severity: "error" | "warning" | "info" | "hint";
  range: monaco.IRange;
  code?: number | string;
};

export type WorkspaceSymbol = {
  filePath: string;
  name: string;
  kind: string;
  range: monaco.IRange;
  containerName?: string;
};

const TS_LANGUAGE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

type MonacoTypeScriptApi = typeof monaco & {
  languages?: typeof monaco.languages & {
    typescript?: {
      typescriptDefaults?: { setCompilerOptions: (options: Record<string, unknown>) => void };
      javascriptDefaults?: { setCompilerOptions: (options: Record<string, unknown>) => void };
      getTypeScriptWorker?: (uri: monaco.Uri) => Promise<TypeScriptWorker>;
    };
  };
  typescriptDefaults?: { setCompilerOptions: (options: Record<string, unknown>) => void };
  javascriptDefaults?: { setCompilerOptions: (options: Record<string, unknown>) => void };
  ScriptTarget?: Record<string, unknown>;
  ModuleKind?: Record<string, unknown>;
  JsxEmit?: Record<string, unknown>;
  ModuleResolutionKind?: Record<string, unknown>;
  getTypeScriptWorker?: (uri: monaco.Uri) => Promise<TypeScriptWorker>;
};

type TypeScriptWorker = {
  getDefinitionAtPosition: (fileName: string, offset: number) => Promise<DefinitionEntry[] | undefined>;
  getReferencesAtPosition: (fileName: string, offset: number) => Promise<ReferenceEntry[] | undefined>;
  doRename: (fileName: string, offset: number, newName: string) => Promise<RenameChange[] | undefined>;
  getSyntacticDiagnostics: (fileName: string) => Promise<TypeScriptDiagnostic[]>;
  getSemanticDiagnostics: (fileName: string) => Promise<TypeScriptDiagnostic[]>;
  getNavigationTree: (fileName: string) => Promise<NavigationTree | null | undefined>;
  getQuickInfoAtPosition: (fileName: string, offset: number) => Promise<QuickInfo | undefined>;
};

type DefinitionEntry = { fileName: string; textSpan: { start: number; length: number } };
type ReferenceEntry = { fileName: string; textSpan: { start: number; length: number }; isDefinition?: boolean };
type RenameChange = {
  fileName: string;
  textChanges: Array<{ span: { start: number; length: number }; newText: string }>;
};

type TypeScriptDiagnostic = {
  start?: number;
  length?: number;
  messageText?: string | { messageText: string };
  message?: string;
  category?: number;
  code?: number | string;
};

type QuickInfo = {
  textSpan: { start: number; length: number };
  displayParts?: Array<{ text: string }>;
  documentation?: Array<{ text: string }>;
};

type NavigationTree = {
  text?: string;
  kind?: string;
  spans?: Array<{ start: number; length: number }>;
  childItems?: NavigationTree[];
  containerName?: string;
};

export class TsLanguageService {
  private monaco: typeof monaco | null = null;
  private models = new Map<string, editor.ITextModel>();
  private fileUriMap = new Map<string, monaco.Uri>();

  public async init(monacoInstance: typeof monaco, files: GeneratedFile[]) {
    this.monaco = monacoInstance;
    this.registerCompilerOptions();
    this.updateFiles(files);
  }

  public updateFiles(files: GeneratedFile[]) {
    if (!this.monaco) return;

    const existingPaths = new Set(this.models.keys());

    for (const file of files) {
      this.ensureModel(file);
      existingPaths.delete(file.path);
    }

    for (const removedPath of existingPaths) {
      this.disposeModel(removedPath);
    }
  }

  public async setFileContent(filePath: string, content: string) {
    const model = this.models.get(filePath);
    if (model && model.getValue() !== content) {
      model.setValue(content);
    }
  }

  public async updateDiagnostics(filePath: string): Promise<DiagnosticResult[]> {
    const diagnostics = await this.getDiagnostics(filePath);
    if (!this.monaco) return diagnostics;

    const model = this.models.get(filePath);
    if (!model) return diagnostics;

    const markers: monaco.editor.IMarkerData[] = diagnostics.map((item) => ({
      severity: this.toMarkerSeverity(item.severity),
      message: item.message,
      startLineNumber: item.range.startLineNumber,
      startColumn: item.range.startColumn,
      endLineNumber: item.range.endLineNumber,
      endColumn: item.range.endColumn,
      source: "ts-language-service",
    }));

    this.monaco.editor.setModelMarkers(model, "ts-language-service", markers);
    return diagnostics;
  }

  public async updateAllDiagnostics(): Promise<DiagnosticResult[]> {
    const all: DiagnosticResult[] = [];
    for (const filePath of this.models.keys()) {
      if (!TS_LANGUAGE_EXTENSIONS.some((ext) => filePath.endsWith(ext))) continue;
      const diagnostics = await this.updateDiagnostics(filePath);
      all.push(...diagnostics);
    }
    return all;
  }

  public async getDefinition(filePath: string, position: monaco.Position): Promise<DefinitionLocation[]> {
    const source = this.getFileData(filePath);
    const worker = await this.getWorker(source.uri);
    const offset = source.model.getOffsetAt(position);
    const definitions = await worker.getDefinitionAtPosition(source.fileName, offset);
    if (!definitions || definitions.length === 0) return [];

    return definitions.map((definition) => {
      const uri = monaco.Uri.parse(definition.fileName);
      const model = this.monaco!.editor.getModel(uri);
      const range = this.spanToRange(definition.textSpan, model);
      return {
        filePath: this.uriToFilePath(uri),
        range,
        displayText: definition.textSpan?.length ? model?.getValueInRange(range) ?? "" : "",
      };
    });
  }

  public async findReferences(filePath: string, position: monaco.Position): Promise<ReferenceLocation[]> {
    const source = this.getFileData(filePath);
    const worker = await this.getWorker(source.uri);
    const offset = source.model.getOffsetAt(position);
    const references = await worker.getReferencesAtPosition(source.fileName, offset);
    if (!references || references.length === 0) return [];

    return references.map((ref) => {
      const uri = monaco.Uri.parse(ref.fileName);
      const model = this.monaco!.editor.getModel(uri);
      const range = this.spanToRange(ref.textSpan, model);
      return {
        filePath: this.uriToFilePath(uri),
        range,
        isDefinition: Boolean(ref.isDefinition),
        text: model?.getValueInRange(range) ?? "",
      };
    });
  }

  public async renameSymbol(filePath: string, position: monaco.Position, newName: string): Promise<RenameEdit[]> {
    const source = this.getFileData(filePath);
    const worker = await this.getWorker(source.uri);
    const offset = source.model.getOffsetAt(position);
    const edits = await worker.doRename(source.fileName, offset, newName);
    if (!edits || edits.length === 0) return [];

    return edits.map((change) => {
      const uri = monaco.Uri.parse(change.fileName);
      const model = this.monaco!.editor.getModel(uri);
      return {
        filePath: this.uriToFilePath(uri),
        edits: change.textChanges.map((textChange) => ({
          range: this.spanToRange(textChange.span, model),
          newText: textChange.newText,
        })),
      };
    });
  }

  public async getHover(filePath: string, position: monaco.Position): Promise<HoverResult | null> {
    const source = this.getFileData(filePath);
    const worker = await this.getWorker(source.uri);
    const offset = source.model.getOffsetAt(position);
    const info = (await worker.getQuickInfoAtPosition(source.fileName, offset)) as QuickInfo | undefined;
    if (!info || !info.textSpan) return null;
    const model = source.model;
    const range = this.spanToRange(info.textSpan, model);
    const contents = this.quickInfoToString(info);
    return { filePath, range, contents };
  }

  public async getDiagnostics(filePath: string): Promise<DiagnosticResult[]> {
    const source = this.getFileData(filePath);
    const worker = await this.getWorker(source.uri);
    const syntactic = await worker.getSyntacticDiagnostics(source.fileName);
    const semantic = await worker.getSemanticDiagnostics(source.fileName);
    const allDiagnostics = [...(syntactic ?? []), ...(semantic ?? [])];
    return allDiagnostics.map((problem) => this.mapDiagnostic(problem, source.model));
  }

  public async getWorkspaceSymbols(query: string): Promise<WorkspaceSymbol[]> {
    if (!this.monaco) return [];
    const results: WorkspaceSymbol[] = [];
    const worker = await this.getWorker(this.getAnyUri());
    if (!worker) return results;

    for (const [filePath, model] of this.models.entries()) {
      if (!TS_LANGUAGE_EXTENSIONS.some((ext) => filePath.endsWith(ext))) continue;
      const tree = await worker.getNavigationTree(this.fileUriMap.get(filePath)!.toString());
      if (!tree) continue;
      this.walkTree(tree, filePath, query.toLowerCase(), results, model);
    }

    return results;
  }

  private registerCompilerOptions() {
    if (!this.monaco) return;
    const monacoAny = this.monaco as MonacoTypeScriptApi;
    const tsContribution = monacoAny.languages?.typescript || {};
    const tsDefaults = tsContribution.typescriptDefaults || monacoAny.typescriptDefaults;
    const jsDefaults = tsContribution.javascriptDefaults || monacoAny.javascriptDefaults;
    const getScriptTarget = monacoAny.ScriptTarget;
    const getModuleKind = monacoAny.ModuleKind;
    const getJsxEmit = monacoAny.JsxEmit;
    const getModuleResolutionKind = monacoAny.ModuleResolutionKind;

    if (!tsDefaults || !jsDefaults || !getScriptTarget || !getModuleKind || !getJsxEmit || !getModuleResolutionKind) return;

    tsDefaults.setCompilerOptions({
      target: getScriptTarget.ES2020,
      module: getModuleKind.ESNext,
      allowJs: true,
      jsx: getJsxEmit.React,
      esModuleInterop: true,
      moduleResolution: getModuleResolutionKind.NodeJs,
      strict: true,
      noEmit: true,
    });

    jsDefaults.setCompilerOptions({
      target: getScriptTarget.ES2020,
      module: getModuleKind.ESNext,
      allowJs: true,
      jsx: getJsxEmit.React,
      esModuleInterop: true,
      moduleResolution: getModuleResolutionKind.NodeJs,
      strict: true,
      noEmit: true,
    });
  }

  private ensureModel(file: GeneratedFile) {
    if (!this.monaco) return;
    const uri = this.getUri(file.path);
    const existingModel = this.models.get(file.path);
    if (existingModel) {
      if (existingModel.getValue() !== file.content) {
        existingModel.setValue(file.content ?? "");
      }
      return;
    }
    const language = this.guessLanguage(file.path);
    const model = this.monaco.editor.getModel(uri) ?? this.monaco.editor.createModel(file.content ?? "", language, uri);
    this.models.set(file.path, model);
    this.fileUriMap.set(file.path, uri);
  }

  private disposeModel(filePath: string) {
    const model = this.models.get(filePath);
    if (model) {
      model.dispose();
    }
    this.models.delete(filePath);
    this.fileUriMap.delete(filePath);
  }

  private getUri(filePath: string): monaco.Uri {
    const existing = this.fileUriMap.get(filePath);
    if (existing) return existing;
    const uri = this.monaco!.Uri.parse(`inmemory://model/${encodeURIComponent(filePath)}`);
    this.fileUriMap.set(filePath, uri);
    return uri;
  }

  private getAnyUri(): monaco.Uri {
    const first = this.fileUriMap.values().next().value;
    if (first) return first;
    return this.monaco!.Uri.parse("inmemory://model/placeholder.ts");
  }

  private async getWorker(uri: monaco.Uri): Promise<TypeScriptWorker> {
    const monacoAny = this.monaco as MonacoTypeScriptApi;
    const tsContribution = monacoAny.languages?.typescript || {};
    const workerGetter = tsContribution.getTypeScriptWorker || monacoAny.getTypeScriptWorker;
    if (!workerGetter) {
      throw new Error("TypeScript worker loader is unavailable");
    }
    return await workerGetter(uri);
  }

  private getFileData(filePath: string) {
    const uri = this.fileUriMap.get(filePath);
    const model = this.models.get(filePath);
    if (!uri || !model) {
      throw new Error(`File not loaded in language service: ${filePath}`);
    }
    return { uri, model, fileName: uri.toString() };
  }

  private uriToFilePath(uri: monaco.Uri) {
    return decodeURIComponent(uri.path.slice(1));
  }

  private spanToRange(span: { start: number; length: number }, model: editor.ITextModel | null | undefined): monaco.IRange {
    if (!model) {
      return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
    }
    const start = model.getPositionAt(span.start);
    const end = model.getPositionAt(span.start + span.length);
    return {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: end.lineNumber,
      endColumn: end.column,
    };
  }

  private quickInfoToString(info: { displayParts?: Array<{ text: string }>; documentation?: Array<{ text: string }> }): string {
    const parts: string[] = [];
    if (Array.isArray(info.displayParts)) {
      parts.push(...info.displayParts.map((part) => part.text));
    }
    if (Array.isArray(info.documentation)) {
      parts.push(...info.documentation.map((part) => part.text));
    }
    return parts.join("");
  }

  private mapDiagnostic(problem: TypeScriptDiagnostic, model: editor.ITextModel): DiagnosticResult {
    const start = model.getPositionAt(problem.start ?? 0);
    const end = model.getPositionAt((problem.start ?? 0) + (problem.length ?? 0));
    const messageText = typeof problem.messageText === "string" ? problem.messageText : problem.messageText?.messageText;
    return {
      filePath: this.uriToFilePath(model.uri),
      message: String(messageText ?? problem.message ?? "Unknown diagnostic"),
      severity: this.tsCategoryToSeverity(problem.category ?? 0),
      range: {
        startLineNumber: start.lineNumber,
        startColumn: start.column,
        endLineNumber: end.lineNumber,
        endColumn: end.column,
      },
      code: problem.code,
    };
  }

  private tsCategoryToSeverity(category: number): DiagnosticResult["severity"] {
    if (!this.monaco) return "info";
    switch (category) {
      case this.monaco.MarkerSeverity.Error:
      case 1:
        return "error";
      case this.monaco.MarkerSeverity.Warning:
      case 2:
        return "warning";
      default:
        return "info";
    }
  }

  private toMarkerSeverity(severity: DiagnosticResult["severity"]): monaco.MarkerSeverity {
    if (!this.monaco) return monaco.MarkerSeverity.Info;
    switch (severity) {
      case "error":
        return monaco.MarkerSeverity.Error;
      case "warning":
        return monaco.MarkerSeverity.Warning;
      case "hint":
        return monaco.MarkerSeverity.Hint;
      default:
        return monaco.MarkerSeverity.Info;
    }
  }

  private guessLanguage(path: string): string {
    const extension = path.split(".").pop()?.toLowerCase() ?? "";
    if (extension === "ts" || extension === "tsx") return "typescript";
    if (extension === "js" || extension === "jsx") return "javascript";
    if (extension === "json") return "json";
    if (extension === "html") return "html";
    return "plaintext";
  }

  private walkTree(item: NavigationTree | null | undefined, filePath: string, query: string, results: WorkspaceSymbol[], model: editor.ITextModel) {
    if (!item) return;
    const text = String(item.text ?? "").toLowerCase();
    if (text.includes(query)) {
      const range = item.spans?.[0]
        ? this.spanToRange(item.spans[0], model)
        : { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
      results.push({
        filePath,
        name: item.text ?? "",
        kind: item.kind ?? "symbol",
        range,
        containerName: item.containerName,
      });
    }
    if (Array.isArray(item.childItems)) {
      item.childItems.forEach((child) => this.walkTree(child, filePath, query, results, model));
    }
  }
}

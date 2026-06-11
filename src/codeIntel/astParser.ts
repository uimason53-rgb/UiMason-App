import type { GeneratedFile } from "../services/claudeService";
import { TsAstAnalyzer, analyzeFiles } from "./tsAstAnalyzer";
import type { SymbolInfo, ImportInfo, CallSite, CodeGraph } from "./tsAstAnalyzer";

// Re-export enhanced types
export type { SymbolInfo, ImportInfo, CallSite, CodeGraph, ClassHierarchy } from "./tsAstAnalyzer";

const parseSymbols = (content: string, filePath: string): SymbolInfo[] => {
  // Fallback regex-based parser for quick single-file parsing
  const symbols: SymbolInfo[] = [];
  const lines = content.split("\n");

  lines.forEach((line, i) => {
    const ln = i + 1;
    const trimmed = line.trim();

    // function name() / async function name()
    const funcMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (funcMatch) {
      const isComponent = /^[A-Z]/.test(funcMatch[1]);
      const exported = trimmed.startsWith("export");
      symbols.push({ name: funcMatch[1], kind: isComponent ? "component" : "function", filePath, line: ln, column: 1, exported, isDefault: false });
      return;
    }

    // const/let/var name = () => / function()
    const arrowMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (arrowMatch) {
      const isComponent = /^[A-Z]/.test(arrowMatch[1]);
      const exported = trimmed.startsWith("export");
      symbols.push({ name: arrowMatch[1], kind: isComponent ? "component" : "function", filePath, line: ln, column: 1, exported, isDefault: false });
      return;
    }

    // const/let/var name = function
    const varFuncMatch = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\b/);
    if (varFuncMatch) {
      symbols.push({ name: varFuncMatch[1], kind: "function", filePath, line: ln, column: 1, exported: trimmed.startsWith("export"), isDefault: false });
      return;
    }

    // Class
    const classMatch = trimmed.match(/^(?:export\s+)?class\s+(\w+)/);
    if (classMatch) {
      symbols.push({ name: classMatch[1], kind: "class", filePath, line: ln, column: 1, exported: trimmed.startsWith("export"), isDefault: false });
      return;
    }

    // Interface
    const ifaceMatch = trimmed.match(/^(?:export\s+)?interface\s+(\w+)/);
    if (ifaceMatch) {
      symbols.push({ name: ifaceMatch[1], kind: "interface", filePath, line: ln, column: 1, exported: trimmed.startsWith("export"), isDefault: false });
      return;
    }

    // Type alias
    const typeMatch = trimmed.match(/^(?:export\s+)?type\s+(\w+)\s*=/);
    if (typeMatch) {
      symbols.push({ name: typeMatch[1], kind: "type", filePath, line: ln, column: 1, exported: trimmed.startsWith("export"), isDefault: false });
      return;
    }

    // export default function/class Name
    const defMatch = trimmed.match(/^export\s+default\s+(?:function|class)\s+(\w+)/);
    if (defMatch) {
      const kind = trimmed.includes("class") ? "class" : /^[A-Z]/.test(defMatch[1]) ? "component" : "function";
      symbols.push({ name: defMatch[1], kind, filePath, line: ln, column: 1, exported: true, isDefault: true });
    }
  });

  return symbols;
};

const parseImports = (content: string, filePath: string): ImportInfo[] => {
  const imports: ImportInfo[] = [];
  const lines = content.split("\n");

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^import\s+(.+?)\s+from\s+['"](.+?)['"]/);
    if (!match) return;

    const specPart = match[1];
    const source = match[2];
    const specifiers: string[] = [];
    let isDefault = false;

    if (specPart.startsWith("{")) {
      // import { a, b } from
      const inner = specPart.slice(1, -1);
      inner.split(",").forEach((s) => {
        const name = s.trim().split(/\s+as\s+/)[0].trim();
        if (name) specifiers.push(name);
      });
    } else if (specPart.includes(",")) {
      // import Def, { a, b } from
      const parts = specPart.split(",");
      const def = parts[0].trim();
      if (def && !def.startsWith("{")) { specifiers.push(def); isDefault = true; }
      parts.slice(1).forEach((p) => {
        const inner = p.trim().replace(/[{}]/g, "");
        inner.split(",").forEach((s) => {
          const name = s.trim().split(/\s+as\s+/)[0].trim();
          if (name) specifiers.push(name);
        });
      });
    } else {
      specifiers.push(specPart.trim());
      isDefault = true;
    }

    imports.push({ source, specifiers, isDefault, isNamespaceImport: false, filePath, line: i + 1 });
  });

  return imports;
};

const parseCalls = (content: string, filePath: string): CallSite[] => {
  const calls: CallSite[] = [];
  const lines = content.split("\n");
  let currentFunc = "(global)";

  lines.forEach((line, i) => {
    const trimmed = line.trim();

    const funcDecl = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
    if (funcDecl) currentFunc = funcDecl[1];
    const arrowDecl = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
    if (arrowDecl) currentFunc = arrowDecl[1];

    const callMatch = trimmed.match(/(\w+)\s*\(/g);
    if (callMatch) {
      callMatch.forEach((m) => {
        const called = m.slice(0, -1);
        if (!["if", "for", "while", "switch", "catch", "return", "throw", "typeof", "console", "require", "import"].includes(called) && called.length > 1) {
          calls.push({ caller: currentFunc, called, filePath, line: i + 1 });
        }
      });
    }
  });

  return calls;
};

export const initParser = async (): Promise<void> => { /* ts-morph initialized on-demand */ };

export const parseFile = (file: GeneratedFile): { symbols: SymbolInfo[]; imports: ImportInfo[]; calls: CallSite[] } => {
  if (!file.content) return { symbols: [], imports: [], calls: [] };

  try {
    const analyzer = new TsAstAnalyzer();
    analyzer.addFiles([file]);
    const graph = analyzer.buildGraph();
    return { symbols: graph.symbols, imports: graph.imports, calls: graph.calls };
  } catch (err) {
    console.warn(`Failed to parse ${file.path} with ts-morph, falling back to lightweight parse:`, err);
    const symbols = parseSymbols(file.content, file.path);
    const imports = parseImports(file.content, file.path);
    const calls = parseCalls(file.content, file.path);
    return { symbols, imports, calls };
  }
};

export const buildCodeGraph = async (files: GeneratedFile[]): Promise<CodeGraph> => {
  try {
    // Use ts-morph for comprehensive analysis
    return await analyzeFiles(files);
  } catch (err) {
    // Fallback to regex-based parsing
    console.warn("ts-morph analysis failed, falling back to regex parser:", err);
    
    const allSymbols: SymbolInfo[] = [];
    const allImports: ImportInfo[] = [];
    const allExports: SymbolInfo[] = [];
    const allCalls: CallSite[] = [];
    const depMap = new Map<string, string[]>();
    const importGraph = new Map<string, Set<string>>();
    const exportGraph = new Map<string, Set<string>>();
    const callGraph = new Map<string, Set<string>>();

    for (const f of files) {
      const { symbols, imports, calls } = parseFile(f);
      allSymbols.push(...symbols);
      allImports.push(...imports);
      allCalls.push(...calls);
      allExports.push(...symbols.filter((s) => s.exported));

      depMap.set(f.path, imports.map((i) => i.source));
      importGraph.set(f.path, new Set(imports.map((i) => i.source)));
      exportGraph.set(f.path, new Set(symbols.filter((s) => s.exported).map((s) => s.name)));
      callGraph.set(f.path, new Set(calls.map((c) => c.called)));
    }

    return {
      symbols: allSymbols,
      imports: allImports,
      exports: allExports.map(s => ({
        name: s.name,
        kind: s.kind,
        isDefault: s.isDefault,
        isNamespace: false,
        filePath: s.filePath,
        line: s.line,
      })),
      calls: allCalls,
      classHierarchies: [],
      files: files.map((f) => f.path),
      dependencyMap: new Map(
        Array.from(depMap.entries()).map(([key, value]) => [
          key,
          value.map(to => ({ from: key, to, importNames: [] }))
        ])
      ),
      importGraph,
      exportGraph,
      callGraph,
    };
  }
};

export const findReferences = (graph: CodeGraph, symbolName: string) => ({
  calls: graph.calls.filter((c) => c.called === symbolName),
  imports: graph.imports.filter((i) => i.specifiers.includes(symbolName)),
  symbols: graph.symbols.filter((s) => s.name === symbolName),
});

export const getDependencies = (graph: CodeGraph, filePath: string): ImportInfo[] =>
  graph.imports.filter((i) => i.filePath === filePath);

export const getDependents = (graph: CodeGraph, filePath: string): ImportInfo[] => {
  const base = filePath.replace(/\.(ts|tsx|js|jsx)$/, "");
  return graph.imports.filter((i) => {
    const src = i.source.replace(/\.(ts|tsx|js|jsx)$/, "");
    return src === base || src.endsWith("/" + (filePath.split("/").pop() || "").replace(/\.(ts|tsx|js|jsx)$/, ""));
  });
};

export const summarizeGraph = (graph: CodeGraph): string => {
  const components = graph.symbols.filter((s) => s.kind === "component");
  const exported = graph.symbols.filter((s) => s.exported);
  return [
    `**Code Graph Summary**`,
    `• Files: ${graph.files.length}`,
    `• Symbols: ${graph.symbols.length}`,
    `• Components: ${components.length} (${components.map((s) => s.name).join(", ")})`,
    `• Exports: ${exported.length}`,
    `• Imports: ${graph.imports.length}`,
    `• Call sites: ${graph.calls.length}`,
  ].join("\n");
};

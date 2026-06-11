import { Project, SyntaxKind, Node, ClassDeclaration, InterfaceDeclaration, FunctionDeclaration, VariableDeclaration, ModuleDeclaration, type SourceFile } from "ts-morph";
import type { GeneratedFile } from "../services/claudeService";

// ── Enhanced symbol types ────────────────────────────────────
export type SymbolKind = "function" | "class" | "component" | "variable" | "interface" | "type" | "import" | "export" | "enum" | "namespace" | "unknown";

export type SymbolInfo = {
  name: string;
  kind: SymbolKind;
  filePath: string;
  line: number;
  column: number;
  exported: boolean;
  isDefault: boolean;
  documentation?: string;
  isAbstract?: boolean;
  extends?: string;
  implements?: string[];
};

export type ImportInfo = {
  source: string;
  specifiers: string[];
  isDefault: boolean;
  isNamespaceImport: boolean;
  filePath: string;
  line: number;
};

export type ExportInfo = {
  name: string;
  kind: SymbolKind;
  isDefault: boolean;
  isNamespace: boolean;
  filePath: string;
  line: number;
};

export type CallSite = {
  caller: string;
  called: string;
  filePath: string;
  line: number;
  isConstructor?: boolean;
  isAsync?: boolean;
};

export type ClassHierarchy = {
  className: string;
  filePath: string;
  extends?: string;
  implements: string[];
  methods: string[];
  properties: string[];
};

export type DependencyEdge = {
  from: string;
  to: string;
  importNames: string[];
};

export type CodeGraph = {
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  calls: CallSite[];
  classHierarchies: ClassHierarchy[];
  files: string[];
  dependencyMap: Map<string, DependencyEdge[]>;
  importGraph: Map<string, Set<string>>;
  exportGraph: Map<string, Set<string>>;
  callGraph: Map<string, Set<string>>;
};

export class TsAstAnalyzer {
  private project: Project;

  constructor() {
    this.project = new Project({
      compilerOptions: {
        target: 99, // ES2020
        module: 99, // ESNext
        jsx: 4, // React
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
    });
  }

  /**
   * Add files to the project for analysis
   */
  public addFiles(files: GeneratedFile[]): void {
    for (const file of files) {
      this.project.createSourceFile(file.path, file.content ?? "", { overwrite: true });
    }
  }

  /**
   * Discover all symbols in a file
   */
  private discoverSymbols(filePath: string): SymbolInfo[] {
    const symbols: SymbolInfo[] = [];
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return symbols;

    const statements = sourceFile.getStatements();

    for (const statement of statements) {
      const pos = sourceFile.getLineAndColumnAtPos(statement.getStart());

      // Functions
      if (statement instanceof FunctionDeclaration) {
        const fn = statement as FunctionDeclaration;
        const name = fn.getName() ?? "anonymous";
        const isComponent = /^[A-Z]/.test(name);
        symbols.push({
          name,
          kind: isComponent ? "component" : "function",
          filePath,
          line: pos.line,
          column: pos.column,
          exported: fn.isExported(),
          isDefault: fn.isDefaultExport(),
          documentation: fn.getJsDocs()[0]?.getInnerText(),
        });
      }

      // Classes
      if (statement instanceof ClassDeclaration) {
        const cls = statement as ClassDeclaration;
        const name = cls.getName() ?? "AnonymousClass";
        symbols.push({
          name,
          kind: "class",
          filePath,
          line: pos.line,
          column: pos.column,
          exported: cls.isExported(),
          isDefault: cls.isDefaultExport(),
          documentation: cls.getJsDocs()[0]?.getInnerText(),
          isAbstract: cls.isAbstract(),
          extends: cls.getExtends()?.getText(),
          implements: cls.getImplements().map((i) => i.getText()),
        });
      }

      // Interfaces
      if (statement instanceof InterfaceDeclaration) {
        const iface = statement as InterfaceDeclaration;
        const name = iface.getName();
        symbols.push({
          name,
          kind: "interface",
          filePath,
          line: pos.line,
          column: pos.column,
          exported: iface.isExported(),
          isDefault: iface.isDefaultExport(),
          documentation: iface.getJsDocs()[0]?.getInnerText(),
          extends: iface.getExtends()[0]?.getText(),
        });
      }

      // Type aliases
      if (Node.isTypeAliasDeclaration(statement)) {
        const typeAlias = statement;
        const name = typeAlias.getName();
        symbols.push({
          name,
          kind: "type",
          filePath,
          line: pos.line,
          column: pos.column,
          exported: typeAlias.isExported(),
          isDefault: typeAlias.isDefaultExport(),
          documentation: typeAlias.getJsDocs()[0]?.getInnerText(),
        });
      }

      // Enums
      if (Node.isEnumDeclaration(statement)) {
        const enumDecl = statement;
        const name = enumDecl.getName();
        symbols.push({
          name,
          kind: "enum",
          filePath,
          line: pos.line,
          column: pos.column,
          exported: enumDecl.isExported(),
          isDefault: false,
          documentation: enumDecl.getJsDocs()[0]?.getInnerText(),
        });
      }

      // Namespaces / module declarations
      if (Node.isModuleDeclaration(statement)) {
        const ns = statement as ModuleDeclaration;
        const name = ns.getName();
        symbols.push({
          name,
          kind: "namespace",
          filePath,
          line: pos.line,
          column: pos.column,
          exported: ns.isExported(),
          isDefault: false,
          documentation: ns.getJsDocs()[0]?.getInnerText(),
        });
      }

      // Variable declarations (const/let/var)
      if (Node.isVariableStatement(statement)) {
        const varStmt = statement;
        const declarations = varStmt.getDeclarations();
        for (const decl of declarations) {
          const name = decl.getName();
          const initializer = decl.getInitializer();
          let kind: SymbolKind = "variable";

          if (initializer) {
            if (Node.isFunctionExpression(initializer) || Node.isArrowFunction(initializer)) {
              kind = /^[A-Z]/.test(name) ? "component" : "function";
            }
          }

          symbols.push({
            name,
            kind,
            filePath,
            line: pos.line,
            column: pos.column,
            exported: varStmt.isExported(),
            isDefault: varStmt.isDefaultExport?.() ?? false,
            documentation: varStmt.getJsDocs()[0]?.getInnerText(),
          });
        }
      }
    }

    return symbols;
  }

  /**
   * Discover all imports in a file
   */
  private discoverImports(filePath: string): ImportInfo[] {
    const imports: ImportInfo[] = [];
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return imports;

    const importDecls = sourceFile.getImportDeclarations();

    for (const importDecl of importDecls) {
      const pos = sourceFile.getLineAndColumnAtPos(importDecl.getStart());
      const source = importDecl.getModuleSpecifierValue();
      const specifiers: string[] = [];
      let isDefault = false;
      let isNamespaceImport = false;

      // Default import
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        specifiers.push(defaultImport.getText());
        isDefault = true;
      }

      // Namespace import (import * as X)
      const namespaceImport = importDecl.getNamespaceImport();
      if (namespaceImport) {
        specifiers.push(namespaceImport.getText());
        isNamespaceImport = true;
      }

      // Named imports
      const namedImports = importDecl.getNamedImports();
      for (const namedImport of namedImports) {
        const importedName = namedImport.getName();
        specifiers.push(importedName);
      }

      if (specifiers.length > 0) {
        imports.push({
          source,
          specifiers,
          isDefault,
          isNamespaceImport,
          filePath,
          line: pos.line,
        });
      }
    }

    return imports;
  }

  /**
   * Discover all exports in a file
   */
  private discoverExports(filePath: string): ExportInfo[] {
    const exports: ExportInfo[] = [];
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return exports;

    const exportDecls = sourceFile.getExportDeclarations();

    for (const exportDecl of exportDecls) {
      const pos = sourceFile.getLineAndColumnAtPos(exportDecl.getStart());
      const namedExports = exportDecl.getNamedExports();

      for (const namedExport of namedExports) {
        const name = namedExport.getName();
        exports.push({
          name,
          kind: "export",
          isDefault: false,
          isNamespace: false,
          filePath,
          line: pos.line,
        });
      }

      // Check for namespace export
      if (exportDecl.getNamespaceExport()) {
        exports.push({
          name: exportDecl.getNamespaceExport()!.getName(),
          kind: "namespace",
          isDefault: false,
          isNamespace: true,
          filePath,
          line: pos.line,
        });
      }
    }

    // Also get exported symbols from exported declarations
    const exportedDeclarations = sourceFile.getExportedDeclarations();
    const seenExports = new Set<string>();

    const addExportInfo = (
      name: string,
      kind: SymbolKind,
      isDefault = false,
      isNamespace = false,
      line = 1
    ) => {
      const key = `${name}:${kind}:${line}`;
      if (seenExports.has(key)) return;
      seenExports.add(key);
      exports.push({ name, kind, isDefault, isNamespace, filePath, line });
    };

    exportedDeclarations.forEach((declarations, name) => {
      for (const declaration of declarations) {
        const pos = sourceFile.getLineAndColumnAtPos(declaration.getStart());
        let kind: SymbolKind = "export";

        if (Node.isClassDeclaration(declaration)) kind = "class";
        else if (Node.isFunctionDeclaration(declaration)) kind = "function";
        else if (Node.isInterfaceDeclaration(declaration)) kind = "interface";
        else if (Node.isTypeAliasDeclaration(declaration)) kind = "type";
        else if (Node.isEnumDeclaration(declaration)) kind = "enum";
        else if (Node.isVariableDeclaration(declaration)) kind = "variable";
        else if (Node.isModuleDeclaration(declaration)) kind = "namespace";

        addExportInfo(name, kind, name === "default", false, pos.line);
      }
    });

    return exports;
  }

  /**
   * Discover function calls within a file
   */
  private discoverCalls(filePath: string): CallSite[] {
    const calls: CallSite[] = [];
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return calls;

    const allNodes = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const node of allNodes) {
      const callExpr = node;
      const pos = sourceFile.getLineAndColumnAtPos(callExpr.getStart());
      const expression = callExpr.getExpression();

      let calledName = "unknown";
      if (Node.isIdentifier(expression)) {
        calledName = expression.getText();
      } else if (Node.isPropertyAccessExpression(expression)) {
        calledName = expression.getName();
      }

      const parentFunc = this.findParentFunction(callExpr);
      const caller = parentFunc ?? "(global)";

      calls.push({
        caller,
        called: calledName,
        filePath,
        line: pos.line,
        isAsync: parentFunc ? this.isFunctionAsync(sourceFile, calledName) : false,
      });
    }

    return calls;
  }

  /**
   * Discover class hierarchies
   */
  private discoverClassHierarchies(filePath: string): ClassHierarchy[] {
    const hierarchies: ClassHierarchy[] = [];
    const sourceFile = this.project.getSourceFile(filePath);
    if (!sourceFile) return hierarchies;

    const classDecls = sourceFile.getDescendantsOfKind(SyntaxKind.ClassDeclaration);

    for (const classDecl of classDecls) {
      const className = classDecl.getName() ?? "AnonymousClass";
      const extendsExpr = classDecl.getExtends();
      const implementsExprs = classDecl.getImplements();
      const methods = classDecl.getMethods().map((m) => m.getName());
      const properties = classDecl.getProperties().map((p) => p.getName());

      hierarchies.push({
        className,
        filePath,
        extends: extendsExpr?.getText(),
        implements: implementsExprs.map((i) => i.getText()),
        methods,
        properties,
      });
    }

    return hierarchies;
  }

  /**
   * Build complete code graph from all files
   */
  public buildGraph(): CodeGraph {
    const allSymbols: SymbolInfo[] = [];
    const allImports: ImportInfo[] = [];
    const allExports: ExportInfo[] = [];
    const allCalls: CallSite[] = [];
    const allHierarchies: ClassHierarchy[] = [];
    const depMap = new Map<string, DependencyEdge[]>();
    const importGraph = new Map<string, Set<string>>();
    const exportGraph = new Map<string, Set<string>>();
    const callGraph = new Map<string, Set<string>>();

    const sourceFiles = this.project.getSourceFiles();
    const files = sourceFiles.map((sf) => sf.getFilePath());

    for (const sourceFile of sourceFiles) {
      const filePath = sourceFile.getFilePath();

      const symbols = this.discoverSymbols(filePath);
      const imports = this.discoverImports(filePath);
      const exports = this.discoverExports(filePath);
      const calls = this.discoverCalls(filePath);
      const hierarchies = this.discoverClassHierarchies(filePath);

      allSymbols.push(...symbols);
      allImports.push(...imports);
      allExports.push(...exports);
      allCalls.push(...calls);
      allHierarchies.push(...hierarchies);

      // Build dependency map
      const edges: DependencyEdge[] = imports.map((imp) => ({
        from: filePath,
        to: imp.source,
        importNames: imp.specifiers,
      }));
      depMap.set(filePath, edges);

      // Build import graph
      importGraph.set(filePath, new Set(imports.map((i) => i.source)));

      // Build export graph
      exportGraph.set(filePath, new Set(exports.map((e) => e.name)));

      // Build call graph
      const callTargets = new Set(calls.map((c) => c.called));
      callGraph.set(filePath, callTargets);
    }

    return {
      symbols: allSymbols,
      imports: allImports,
      exports: allExports,
      calls: allCalls,
      classHierarchies: allHierarchies,
      files,
      dependencyMap: depMap,
      importGraph,
      exportGraph,
      callGraph,
    };
  }

  /**
   * Find parent function name for a node
   */
  private findParentFunction(node: Node): string | null {
    let current: Node | undefined = node.getParent();

    while (current) {
      if (current instanceof FunctionDeclaration) {
        return (current as FunctionDeclaration).getName() ?? null;
      }
      if (Node.isVariableDeclaration(current)) {
        const name = (current as VariableDeclaration).getName();
        if (name) return name;
      }
      if (Node.isMethodDeclaration(current)) {
        const name = current.getName();
        if (name) return name;
      }
      if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
        // Try to get the name of the variable holding the arrow/function expression
        const parent = current.getParent();
        if (parent && Node.isVariableDeclaration(parent)) {
          return (parent as VariableDeclaration).getName();
        }
      }
      current = current.getParent();
    }

    return null;
  }

  /**
   * Check if a function is async
   */
  private isFunctionAsync(sourceFile: SourceFile, functionName: string): boolean {
    const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
    for (const fn of functions) {
      if (fn.getName() === functionName && fn.isAsync()) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Analyze files using ts-morph
 */
export async function analyzeFiles(files: GeneratedFile[]): Promise<CodeGraph> {
  const analyzer = new TsAstAnalyzer();
  analyzer.addFiles(files);
  return analyzer.buildGraph();
}

/**
 * Find all references to a symbol
 */
export function findSymbolReferences(graph: CodeGraph, symbolName: string) {
  return {
    definitions: graph.symbols.filter((s) => s.name === symbolName),
    calls: graph.calls.filter((c) => c.called === symbolName),
    imports: graph.imports.filter((i) => i.specifiers.includes(symbolName)),
    exports: graph.exports.filter((e) => e.name === symbolName),
  };
}

/**
 * Get dependency chain for a file
 */
export function getDependencyChain(graph: CodeGraph, filePath: string, depth = 2): string[] {
  const visited = new Set<string>();
  const chain: string[] = [];

  const traverse = (file: string, d: number) => {
    if (d <= 0 || visited.has(file)) return;
    visited.add(file);
    chain.push(file);

    const edges = graph.dependencyMap.get(file) || [];
    for (const edge of edges) {
      traverse(edge.to, d - 1);
    }
  };

  traverse(filePath, depth);
  return chain;
}

/**
 * Get dependents (files that import from a file)
 */
export function getFileDependents(graph: CodeGraph, filePath: string): string[] {
  const dependents: string[] = [];
  const base = filePath.replace(/\.(ts|tsx|js|jsx)$/, "");

  for (const [file, edges] of graph.dependencyMap) {
    for (const edge of edges) {
      const importedBase = edge.to.replace(/\.(ts|tsx|js|jsx)$/, "");
      if (importedBase === base || importedBase.endsWith("/" + base.split("/").pop())) {
        dependents.push(file);
      }
    }
  }

  return dependents;
}

/**
 * Summarize the code graph
 */
export function summarizeGraph(graph: CodeGraph): string {
  const components = graph.symbols.filter((s) => s.kind === "component");
  const classes = graph.symbols.filter((s) => s.kind === "class");
  const exported = graph.exports;
  const publicSymbols = graph.symbols.filter((s) => s.exported);

  return [
    `**Code Graph Summary**`,
    `• Files: ${graph.files.length}`,
    `• Symbols: ${graph.symbols.length}`,
    `• Components: ${components.length}`,
    `• Classes: ${classes.length}`,
    `• Exports: ${exported.length}`,
    `• Public symbols: ${publicSymbols.length}`,
    `• Imports: ${graph.imports.length}`,
    `• Call sites: ${graph.calls.length}`,
    `• Class hierarchies: ${graph.classHierarchies.length}`,
  ].join("\n");
}

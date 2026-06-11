import type { GeneratedFile } from "./claudeService";

// Generate unit tests for TypeScript/React files
export const generateUnitTests = (files: GeneratedFile[]): GeneratedFile[] => {
  const testFiles: GeneratedFile[] = [];

  for (const file of files) {
    if (!file.path.match(/\.(ts|tsx)$/) || file.path.endsWith(".d.ts") || file.path.includes("test") || file.path.includes("__test__")) continue;
    const content = file.content ?? "";
    const exports = extractExports(content);
    if (exports.length === 0) continue;

    const testContent = buildTestFile(file.path, exports);
    const testPath = file.path.replace(/^src\//, "src/__tests__/").replace(/\.(ts|tsx)$/, ".test.$1");
    testFiles.push({ path: testPath, content: testContent });
  }

  return testFiles;
};

const extractExports = (content: string): { name: string; type: "function" | "component" | "hook" | "const" }[] => {
  const results: { name: string; type: "function" | "component" | "hook" | "const" }[] = [];

  // Named exports
  const namedRegex = /export\s+(const|function|class)\s+(\w+)/g;
  let match;
  while ((match = namedRegex.exec(content)) !== null) {
    const kw = match[1];
    const name = match[2];
    if (name.startsWith("use")) results.push({ name, type: "hook" });
    else if (/^[A-Z]/.test(name)) results.push({ name, type: "component" });
    else if (kw === "function") results.push({ name, type: "function" });
    else results.push({ name, type: "const" });
  }

  // Default exports
  const defaultMatch = content.match(/export\s+default\s+(?:function\s+)?(\w+)/);
  if (defaultMatch && !results.some((r) => r.name === defaultMatch[1])) {
    const name = defaultMatch[1];
    results.push({ name, type: /^[A-Z]/.test(name) ? "component" : "function" });
  }

  return results;
};

const buildTestFile = (filePath: string, exports: { name: string; type: string }[]): string => {
  const importPath = filePath.replace(/^src\//, "../").replace(/\.(ts|tsx)$/, "");
  const component = exports.find((e) => e.type === "component");
  const hook = exports.find((e) => e.type === "hook");
  const func = exports.find((e) => e.type === "function");

  const lines: string[] = [
    `import { describe, it, expect, vi } from "vitest";`,
    component ? `import ${component.name} from "${importPath}";` : "",
    `import { render, screen } from "@testing-library/react";` + (component ? "" : " // eslint-disable-line"),
    "",
    `describe("${exports[0]?.name || filePath}", () => {`,
  ];

  if (component) {
    lines.push(`  it("renders without crashing", () => {`);
    lines.push(`    render(<${component.name} />);`);
    lines.push(`    expect(screen.getByRole("main") || document.body.children[0]).toBeTruthy();`);
    lines.push(`  });`);
    lines.push("");
    lines.push(`  it("matches snapshot", () => {`);
    lines.push(`    const { container } = render(<${component.name} />);`);
    lines.push(`    expect(container).toMatchSnapshot();`);
    lines.push(`  });`);
  }

  if (hook) {
    lines.push("");
    lines.push(`  it("returns expected hook values", () => {`);
    lines.push(`    const result = ${hook.name}();`);
    lines.push(`    expect(result).toBeDefined();`);
    lines.push(`  });`);
  }

  if (func) {
    lines.push("");
    lines.push(`  it("handles basic input", () => {`);
    lines.push(`    const result = ${func.name}();`);
    lines.push(`    expect(result).toBeDefined();`);
    lines.push(`  });`);
  }

  if (exports.length === 0) {
    lines.push(`  it("file structure is valid", () => {`);
    lines.push(`    expect(true).toBe(true);`);
    lines.push(`  });`);
  }

  lines.push("});");
  return lines.filter(Boolean).join("\n");
};

// Generate test coverage report
export const estimateCoverage = (files: GeneratedFile[], testFiles: GeneratedFile[]): string => {
  const sourceFiles = files.filter((f) => f.path.match(/\.(ts|tsx)$/) && !f.path.endsWith(".d.ts")).length;
  const testCount = testFiles.length;
  const coverage = sourceFiles > 0 ? Math.round((testCount / sourceFiles) * 100) : 0;

  return [
    `**Test Coverage Estimate**`,
    `• Source files: ${sourceFiles}`,
    `• Test files generated: ${testCount}`,
    `• Estimated coverage: ${Math.min(100, coverage)}%`,
  ].join("\n");
};
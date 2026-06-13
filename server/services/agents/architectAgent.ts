import * as fs from "fs";
import * as path from "path";

const OPENAI_KEY = process.env.OPENAI_KEY || "";

export interface ArchitectureAnalysis {
  files: string[];
  structure: string;
  recommendations: string[];
}

export class ArchitectAgent {
  async analyze(projectPath: string): Promise<ArchitectureAnalysis> {
    console.log(`\n[ArchitectAgent] Analyzing: "${projectPath}"\n`);

    const files = this.scanFiles(projectPath);
    console.log(`[ArchitectAgent] Found ${files.length} files`);

    const fileList = files.slice(0, 50).join("\n");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{
          role: "system",
          content: "You are a senior software architect. Analyze project structure and give recommendations. Reply ONLY with JSON, no markdown.",
        }, {
          role: "user",
          content: `Analyze this project structure and reply ONLY this JSON:
{"structure":"one line summary","recommendations":["rec1","rec2","rec3"]}

Files:
${fileList}`,
        }],
        temperature: 0.3,
      }),
    });

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content || "";
    console.log("[ArchitectAgent] Analysis:", text);

    let parsed = { structure: "", recommendations: [] as string[] };
    try {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]);
    } catch (e) {
      parsed.structure = text;
    }

    return { files, ...parsed };
  }

  private scanFiles(dir: string, base = dir): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) return results;
    const skip = ["node_modules", ".git", "dist", "generated"];
    for (const entry of fs.readdirSync(dir)) {
      if (skip.includes(entry)) continue;
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        results.push(...this.scanFiles(full, base));
      } else {
        results.push(path.relative(base, full));
      }
    }
    return results;
  }
}
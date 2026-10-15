/**
 * Write the Dify version of the assistant's inputs to dify/:
 *   knowledge/*.md   one file per document source; passages separated by DELIMITER, each starting with its id
 *   system-prompt.md the same rules as SYSTEM_PROMPT, with Dify's knowledge base in place of search_documents
 *
 *   npm run export-dify
 */
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { PROMPT_VERSION, SYSTEM_PROMPT } from "@/lib/assistant/prompts";
import { allPassages, Passage } from "@/lib/assistant/search";

export const DELIMITER = "§§§";
const OUT = path.join(process.cwd(), "dify");

const slug = (p: Passage) =>
  ({ FAQ: "faq", 常見問題: "faq", "Standard Plan policy template": "policy-template", 標準計劃保單範本: "policy-template" } as
    Record<string, string>)[p.source] ?? "other";

function main() {
  const files = new Map<string, string[]>();
  for (const p of allPassages()) {
    const name = `vhis-${slug(p)}-${p.lang}.md`;
    const block = [`[${p.id}] ${p.title}`, p.section ? `Section: ${p.section}` : null, p.text.trim(), `Source: ${p.url}`]
      .filter(Boolean).join("\n");
    files.set(name, [...(files.get(name) ?? []), block]);
  }
  mkdirSync(path.join(OUT, "knowledge"), { recursive: true });
  for (const [name, blocks] of Array.from(files)) {
    writeFileSync(path.join(OUT, "knowledge", name), blocks.join(`\n${DELIMITER}\n`) + "\n");
    console.log(`${name}: ${blocks.length} passages`);
  }

  const prompt = SYSTEM_PROMPT
    .replace("Data you can reach only through tools:", "Data you can reach only through tools and the attached knowledge base:")
    .replace(/2\. For questions about rules[^\n]+/, "2. For questions about rules, benefits, eligibility, claims, tax deduction or how VHIS works, answer only from the knowledge-base passages provided in the context. Each passage starts with an id in square brackets, e.g. [c0123]; cite each passage you rely on with that id. Never cite an id that is not in the context. If the passages do not answer the question, say you could not find it in the official documents.");
  writeFileSync(path.join(OUT, "system-prompt.md"), `<!-- generated from lib/assistant/prompts.ts ${PROMPT_VERSION} -->\n${prompt}\n`);
}

main();

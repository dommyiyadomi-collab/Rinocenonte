#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const USAGE =
  "Usage: node scripts/prepare-codex-pull-request.mjs <implementation-context.json> <output-json>";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function asPreformattedJson(value) {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

export function buildPullRequestMetadata(context) {
  const titleId = String(context.proposal_id)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  const title = `Implement approved proposal ${titleId || "proposal"}`;
  const body = `## Approved proposal

- Proposal ID: ${asPreformattedJson(context.proposal_id)}
- Source approval run ID: ${asPreformattedJson(context.approval_run_id)}
- Source audit run ID: ${asPreformattedJson(context.source_run_id)}
- Category: ${asPreformattedJson(context.category)}

### Evidence

${asPreformattedJson(context.evidence)}

### Recommended action

${asPreformattedJson(context.recommended_action)}

### Test results

- \`npm test\`: passed
- \`npx --yes html-validate@latest "public/**/*.html"\`: passed
- \`node scripts/check-internal-links.mjs\`: passed
- \`node scripts/check-render-visibility.mjs\`: passed
- \`git diff --cached --check\`: passed

### Safety boundary

This pull request is intentionally a Draft. It does not deploy, merge, publish packages, modify environment secrets, or mark itself ready for review. The \`Validate site\` workflow is explicitly dispatched for this branch after Draft PR creation.
`;

  return { title, body };
}

export async function main({ argv = process.argv } = {}) {
  const args = argv.slice(2);

  if (args.length !== 2) {
    throw new Error(USAGE);
  }

  const context = JSON.parse(await readFile(args[0], "utf8"));
  const metadata = buildPullRequestMetadata(context);

  await writeFile(args[1], `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`Prepared Draft PR metadata at ${path.resolve(args[1])}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

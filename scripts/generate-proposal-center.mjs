#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateRankedProposals } from "./generate-ranked-proposals.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "out", "audit-bundle");
const DEFAULT_RANKED_PROPOSALS_PATH = path.join(
  DEFAULT_OUTPUT_DIR,
  "ranked-proposals.json",
);
const DEFAULT_PROPOSAL_REVIEW_PATH = path.join(
  DEFAULT_OUTPUT_DIR,
  "proposal-review.md",
);
const DEFAULT_PROPOSAL_CENTER_PATH = path.join(
  DEFAULT_OUTPUT_DIR,
  "proposal-center.html",
);
const USAGE =
  "Usage: node scripts/generate-proposal-center.mjs [ranked-proposals.json] [proposal-review.md] [proposal-center.html]";

export class ProposalCenterError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProposalCenterError";
  }
}

export async function main({ argv = process.argv } = {}) {
  const args = argv.slice(2);

  if (args.length > 3) {
    throw new ProposalCenterError(USAGE);
  }

  const result = await generateProposalCenter({
    rankedProposalsPath: args[0]
      ? path.resolve(args[0])
      : DEFAULT_RANKED_PROPOSALS_PATH,
    proposalReviewPath: args[1]
      ? path.resolve(args[1])
      : DEFAULT_PROPOSAL_REVIEW_PATH,
    proposalCenterPath: args[2]
      ? path.resolve(args[2])
      : DEFAULT_PROPOSAL_CENTER_PATH,
  });

  console.log(
    `Generated read-only Proposal Center with ${result.proposalCount} proposals at ${result.proposalCenterPath}.`,
  );

  return result;
}

export async function generateProposalCenter({
  rankedProposalsPath = DEFAULT_RANKED_PROPOSALS_PATH,
  proposalReviewPath = DEFAULT_PROPOSAL_REVIEW_PATH,
  proposalCenterPath = DEFAULT_PROPOSAL_CENTER_PATH,
} = {}) {
  const resolvedRankedProposalsPath = path.resolve(rankedProposalsPath);
  const resolvedProposalReviewPath = path.resolve(proposalReviewPath);
  const resolvedProposalCenterPath = path.resolve(proposalCenterPath);
  const [rankedProposalsText, proposalReview] = await Promise.all([
    readSourceFile(resolvedRankedProposalsPath, "ranked-proposals.json"),
    readSourceFile(resolvedProposalReviewPath, "proposal-review.md"),
  ]);
  let rankedProposals;

  try {
    rankedProposals = JSON.parse(rankedProposalsText);
  } catch (error) {
    throw new ProposalCenterError(
      `ranked-proposals.json is malformed JSON: ${error.message}`,
    );
  }

  const html = renderProposalCenter({ rankedProposals, proposalReview });

  await mkdir(path.dirname(resolvedProposalCenterPath), { recursive: true });
  await writeFile(resolvedProposalCenterPath, html, "utf8");

  return {
    rankedProposalsPath: resolvedRankedProposalsPath,
    proposalReviewPath: resolvedProposalReviewPath,
    proposalCenterPath: resolvedProposalCenterPath,
    proposalCount: rankedProposals.proposals.length,
    html,
  };
}

export function renderProposalCenter({ rankedProposals, proposalReview }) {
  const validationErrors = validateRankedProposals(rankedProposals);

  if (validationErrors.length > 0) {
    throw new ProposalCenterError(
      `ranked-proposals.json does not match the expected proposal schema: ${validationErrors.join(
        "; ",
      )}`,
    );
  }

  const review = parseProposalReview(proposalReview);
  const generatedAt = collapseWhitespace(rankedProposals.generated_at);

  if (review.generatedAt !== generatedAt) {
    throw new ProposalCenterError(
      "proposal-review.md and ranked-proposals.json have different generated-at values.",
    );
  }

  if (
    review.proposalCount !== rankedProposals.proposals.length ||
    review.entries.length !== rankedProposals.proposals.length
  ) {
    throw new ProposalCenterError(
      "proposal-review.md and ranked-proposals.json have different proposal counts.",
    );
  }

  const availableProposals = rankedProposals.proposals.map((proposal) => ({
    proposal,
    normalizedId: collapseWhitespace(proposal.proposal_id),
  }));
  const orderedProposals = review.entries.map((entry) => {
    const matchIndex = availableProposals.findIndex(
      (candidate) => candidate.normalizedId === entry.proposalId,
    );

    if (matchIndex === -1) {
      throw new ProposalCenterError(
        `Proposal ${JSON.stringify(entry.proposalId)} from proposal-review.md was not found in ranked-proposals.json.`,
      );
    }

    const [{ proposal }] = availableProposals.splice(matchIndex, 1);

    return {
      title: entry.title,
      proposal,
    };
  });

  if (availableProposals.length > 0) {
    throw new ProposalCenterError(
      "ranked-proposals.json contains proposals that are missing from proposal-review.md.",
    );
  }

  const proposalMarkup =
    orderedProposals.length === 0
      ? renderEmptyState()
      : orderedProposals
          .map(({ title, proposal }, index) =>
            renderProposalCard({ title, proposal, index }),
          )
          .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Daily AI Audit Proposal Center</title>
  <style>
    :root {
      color-scheme: light;
      --canvas: #f5f7fb;
      --surface: #ffffff;
      --surface-soft: #f8faff;
      --ink: #172033;
      --muted: #657087;
      --quiet: #8a94a8;
      --line: #dfe4ee;
      --line-strong: #cbd3e1;
      --blue: #225be8;
      --blue-soft: #eaf0ff;
      --green: #166b50;
      --green-soft: #e6f5ef;
      --amber: #895d05;
      --amber-soft: #fff4d6;
      --shadow: 0 18px 50px rgba(25, 39, 70, 0.09);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background:
        radial-gradient(circle at 12% -8%, rgba(34, 91, 232, 0.12), transparent 30rem),
        var(--canvas);
      color: var(--ink);
      font-family:
        Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
        "Segoe UI", sans-serif;
      line-height: 1.5;
    }

    .shell {
      width: min(1180px, calc(100% - 2rem));
      margin: 0 auto;
      padding: 3.5rem 0 4rem;
    }

    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 2rem;
      align-items: end;
      margin-bottom: 1.4rem;
    }

    .eyebrow {
      margin: 0 0 0.5rem;
      color: var(--blue);
      font-size: 0.76rem;
      font-weight: 800;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(2.35rem, 6vw, 4.8rem);
      line-height: 0.96;
      letter-spacing: -0.065em;
    }

    .intro {
      max-width: 720px;
      margin: 1rem 0 0;
      color: var(--muted);
      font-size: 1.03rem;
    }

    .read-only {
      display: inline-flex;
      gap: 0.48rem;
      align-items: center;
      min-height: 2.35rem;
      padding: 0.55rem 0.85rem;
      border: 1px solid #bcdacc;
      border-radius: 999px;
      background: var(--green-soft);
      color: var(--green);
      font-size: 0.82rem;
      font-weight: 800;
      white-space: nowrap;
    }

    .read-only::before {
      width: 0.52rem;
      height: 0.52rem;
      border-radius: 50%;
      background: #2c9b73;
      content: "";
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin-bottom: 1.25rem;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 1rem;
      background: rgba(255, 255, 255, 0.82);
      box-shadow: 0 12px 38px rgba(25, 39, 70, 0.06);
    }

    .summary div {
      min-width: 0;
      padding: 1rem 1.15rem;
      border-right: 1px solid var(--line);
    }

    .summary div:last-child {
      border-right: 0;
    }

    .summary dt,
    .metric-grid dt,
    .field-label {
      color: var(--quiet);
      font-size: 0.7rem;
      font-weight: 800;
      letter-spacing: 0.075em;
      text-transform: uppercase;
    }

    .field-label {
      margin: 1rem 0 0;
    }

    .summary dd,
    .metric-grid dd {
      margin: 0.25rem 0 0;
      font-weight: 750;
    }

    .summary dd {
      overflow-wrap: anywhere;
    }

    .proposal-list {
      display: grid;
      gap: 1rem;
    }

    .proposal-card {
      display: grid;
      grid-template-columns: minmax(0, 1.35fr) minmax(19rem, 0.65fr);
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 1.2rem;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .proposal-main,
    .proposal-side {
      min-width: 0;
      padding: clamp(1.2rem, 3vw, 1.65rem);
    }

    .proposal-side {
      border-left: 1px solid var(--line);
      background: var(--surface-soft);
    }

    .card-kicker,
    .proposal-meta,
    .status-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.55rem;
      align-items: center;
    }

    .rank,
    .priority,
    .category,
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 1.85rem;
      padding: 0.3rem 0.62rem;
      border-radius: 999px;
      font-size: 0.73rem;
      font-weight: 800;
    }

    .rank {
      border: 1px solid var(--line);
      color: var(--muted);
    }

    .priority {
      background: var(--blue-soft);
      color: var(--blue);
    }

    .category {
      border: 1px solid var(--line);
      background: #f3f5f9;
      color: #556077;
    }

    .proposal-card h2 {
      max-width: 760px;
      margin: 1rem 0 0.75rem;
      font-size: clamp(1.35rem, 3vw, 2rem);
      line-height: 1.16;
      letter-spacing: -0.035em;
    }

    .field-label + h2 {
      margin-top: 0.35rem;
    }

    .proposal-meta {
      color: var(--muted);
      font-size: 0.82rem;
    }

    code {
      padding: 0.2rem 0.44rem;
      border: 1px solid var(--line);
      border-radius: 0.42rem;
      background: #f6f7fa;
      color: #4b566d;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 0.76rem;
      overflow-wrap: anywhere;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 0.55rem;
      margin: 1.2rem 0 0;
    }

    .metric-grid div {
      min-width: 0;
      padding: 0.72rem;
      border: 1px solid var(--line);
      border-radius: 0.72rem;
      background: #fbfcfe;
    }

    .metric-grid dd {
      font-size: 1.12rem;
    }

    h3 {
      margin: 0;
      font-size: 0.82rem;
      letter-spacing: 0.02em;
    }

    .evidence {
      margin: 0.75rem 0 0;
      padding-left: 1.2rem;
      color: var(--muted);
      font-size: 0.91rem;
    }

    .evidence li + li {
      margin-top: 0.52rem;
    }

    .status-row {
      justify-content: space-between;
      padding-bottom: 1rem;
      border-bottom: 1px solid var(--line);
    }

    .status {
      gap: 0.4rem;
      background: var(--amber-soft);
      color: var(--amber);
    }

    .status::before {
      width: 0.46rem;
      height: 0.46rem;
      border-radius: 50%;
      background: #d59a1d;
      content: "";
    }

    .action {
      margin-top: 1rem;
    }

    .action p {
      margin: 0.55rem 0 0;
      color: #445067;
      font-size: 0.93rem;
    }

    .empty-state {
      padding: 3.5rem 1.5rem;
      border: 1px dashed var(--line-strong);
      border-radius: 1.2rem;
      background: var(--surface);
      text-align: center;
    }

    .empty-state h2 {
      margin: 0;
    }

    .empty-state p,
    footer {
      color: var(--muted);
    }

    footer {
      margin-top: 1.5rem;
      font-size: 0.82rem;
      text-align: center;
    }

    @media (max-width: 860px) {
      .hero,
      .proposal-card {
        grid-template-columns: 1fr;
      }

      .hero {
        align-items: start;
      }

      .read-only {
        justify-self: start;
      }

      .proposal-side {
        border-top: 1px solid var(--line);
        border-left: 0;
      }
    }

    @media (max-width: 640px) {
      .shell {
        width: min(100% - 1rem, 1180px);
        padding-top: 2rem;
      }

      .summary,
      .metric-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .summary div:nth-child(2) {
        border-right: 0;
      }

      .summary div:last-child {
        grid-column: 1 / -1;
        border-top: 1px solid var(--line);
      }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="hero">
      <div>
        <p class="eyebrow">Daily AI Audit</p>
        <h1>Proposal Center</h1>
        <p class="intro">Review evidence-backed site proposals in priority order. This page is informational and cannot approve, reject, defer, dispatch, or implement a proposal.</p>
      </div>
      <span class="read-only">Read-only review</span>
    </header>

    <dl class="summary">
      <div>
        <dt>Proposals</dt>
        <dd>${orderedProposals.length}</dd>
      </div>
      <div>
        <dt>Generated</dt>
        <dd>${escapeHtml(rankedProposals.generated_at)}</dd>
      </div>
      <div>
        <dt>Site Stack</dt>
        <dd>${escapeHtml(rankedProposals.site_stack)}</dd>
      </div>
    </dl>

    <section class="proposal-list">
${proposalMarkup}
    </section>

    <footer>Generated from proposal-review.md and ranked-proposals.json. All proposals begin with Pending status.</footer>
  </main>
</body>
</html>
`;
}

export function parseProposalReview(proposalReview) {
  if (typeof proposalReview !== "string") {
    throw new ProposalCenterError("proposal-review.md must be text.");
  }

  const lines = proposalReview.replaceAll("\r\n", "\n").split("\n");
  const generatedAt = readMarkdownField(lines, "Generated at");
  const rawProposalCount = readMarkdownField(lines, "Proposal count");
  const proposalCount = Number(rawProposalCount);
  const entries = [];
  let pendingTitle = null;

  if (!Number.isSafeInteger(proposalCount) || proposalCount < 0) {
    throw new ProposalCenterError(
      "proposal-review.md has an invalid Proposal count.",
    );
  }

  for (const line of lines) {
    const titlePrefix = "- **Title:** ";
    const idPrefix = "- **Proposal ID:** ";

    if (line.startsWith(titlePrefix)) {
      pendingTitle = unescapeMarkdown(line.slice(titlePrefix.length));
      continue;
    }

    if (line.startsWith(idPrefix)) {
      if (pendingTitle === null) {
        throw new ProposalCenterError(
          "proposal-review.md contains a Proposal ID without a preceding Title.",
        );
      }

      const proposalId = unescapeMarkdown(line.slice(idPrefix.length));

      if (!pendingTitle || !proposalId) {
        throw new ProposalCenterError(
          "proposal-review.md contains an empty proposal Title or Proposal ID.",
        );
      }

      entries.push({
        title: pendingTitle,
        proposalId,
      });
      pendingTitle = null;
    }
  }

  if (pendingTitle !== null) {
    throw new ProposalCenterError(
      "proposal-review.md contains a Title without a following Proposal ID.",
    );
  }

  return {
    generatedAt,
    proposalCount,
    entries,
  };
}

function renderProposalCard({ title, proposal, index }) {
  const cardNumber = index + 1;
  const evidenceMarkup =
    proposal.evidence.length === 0
      ? "<li>No evidence summary was provided.</li>"
      : proposal.evidence
          .map((evidence) => `<li>${escapeHtml(evidence)}</li>`)
          .join("\n            ");

  return `      <article class="proposal-card" aria-labelledby="proposal-${cardNumber}-title">
        <div class="proposal-main">
          <div class="card-kicker">
            <span class="rank">#${String(cardNumber).padStart(2, "0")}</span>
            <span class="priority">Overall Priority · ${escapeHtml(proposal.overall_priority)}</span>
            <span class="category">Category · ${escapeHtml(proposal.category)}</span>
          </div>
          <p class="field-label">Proposal Title</p>
          <h2 id="proposal-${cardNumber}-title">${escapeHtml(title)}</h2>
          <div class="proposal-meta">
            <span>Proposal ID</span>
            <code>${escapeHtml(proposal.proposal_id)}</code>
          </div>
          <dl class="metric-grid">
            <div>
              <dt>Impact</dt>
              <dd>${escapeHtml(proposal.impact_score)}</dd>
            </div>
            <div>
              <dt>Implementation Cost</dt>
              <dd>${escapeHtml(proposal.implementation_cost_score)}</dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>${escapeHtml(proposal.risk_score)}</dd>
            </div>
            <div>
              <dt>Test Ease</dt>
              <dd>${escapeHtml(proposal.test_ease_score)}</dd>
            </div>
          </dl>
          <div class="action">
            <h3>Evidence Summary</h3>
            <ul class="evidence">
              ${evidenceMarkup}
            </ul>
          </div>
        </div>
        <div class="proposal-side">
          <div class="status-row">
            <h3>Current Status</h3>
            <span class="status">Pending</span>
          </div>
          <div class="action">
            <h3>Recommended Action</h3>
            <p>${escapeHtml(proposal.recommended_action)}</p>
          </div>
        </div>
      </article>`;
}

function renderEmptyState() {
  return `      <div class="empty-state">
        <h2>No proposals to review</h2>
        <p>The current Daily AI Audit did not produce any proposals.</p>
      </div>`;
}

async function readSourceFile(filePath, label) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ProposalCenterError(`${label} was not found at ${filePath}.`);
    }

    throw new ProposalCenterError(
      `Could not read ${label} at ${filePath}: ${error.message}`,
    );
  }
}

function readMarkdownField(lines, label) {
  const prefix = `- **${label}:** `;
  const line = lines.find((candidate) => candidate.startsWith(prefix));

  if (!line) {
    throw new ProposalCenterError(
      `proposal-review.md is missing the ${label} field.`,
    );
  }

  return unescapeMarkdown(line.slice(prefix.length));
}

function unescapeMarkdown(value) {
  let result = "";

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\" && index + 1 < value.length) {
      index += 1;
    }

    result += value[index];
  }

  return collapseWhitespace(result);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function collapseWhitespace(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

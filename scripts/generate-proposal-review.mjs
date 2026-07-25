#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateRankedProposals } from "./generate-ranked-proposals.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_RANKED_PROPOSALS_PATH = path.join(
  REPO_ROOT,
  "out",
  "audit-bundle",
  "ranked-proposals.json",
);
const REPORT_FILE_NAME = "proposal-review.md";
const USAGE =
  "Usage: node scripts/generate-proposal-review.mjs [ranked-proposals.json] [proposal-review.md]";
const PRIORITY_RANKS = new Map([
  ["urgent", 0],
  ["critical", 0],
  ["highest", 0],
  ["high", 1],
  ["medium", 2],
  ["moderate", 2],
  ["low", 3],
  ["lowest", 4],
]);

export class ProposalReviewError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProposalReviewError";
  }
}

export async function main({ argv = process.argv } = {}) {
  const args = argv.slice(2);

  if (args.length > 2) {
    throw new ProposalReviewError(USAGE);
  }

  const rankedProposalsPath = args[0]
    ? path.resolve(args[0])
    : DEFAULT_RANKED_PROPOSALS_PATH;
  const reportPath = args[1]
    ? path.resolve(args[1])
    : path.join(path.dirname(rankedProposalsPath), REPORT_FILE_NAME);
  const result = await generateProposalReviewReport({
    rankedProposalsPath,
    reportPath,
  });

  console.log(
    `Generated proposal review report with ${result.proposalCount} proposals at ${result.reportPath}.`,
  );

  return result;
}

export async function generateProposalReviewReport({
  rankedProposalsPath = DEFAULT_RANKED_PROPOSALS_PATH,
  reportPath,
} = {}) {
  const resolvedRankedProposalsPath = path.resolve(rankedProposalsPath);
  const resolvedReportPath = path.resolve(
    reportPath ??
      path.join(path.dirname(resolvedRankedProposalsPath), REPORT_FILE_NAME),
  );
  let rankedProposals;

  try {
    rankedProposals = JSON.parse(
      await readFile(resolvedRankedProposalsPath, "utf8"),
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ProposalReviewError(
        `ranked-proposals.json was not found at ${resolvedRankedProposalsPath}.`,
      );
    }

    if (error instanceof SyntaxError) {
      throw new ProposalReviewError(
        `ranked-proposals.json is malformed JSON: ${error.message}`,
      );
    }

    throw new ProposalReviewError(
      `Could not read ranked-proposals.json at ${resolvedRankedProposalsPath}: ${error.message}`,
    );
  }

  const validationErrors = validateRankedProposals(rankedProposals);

  if (validationErrors.length > 0) {
    throw new ProposalReviewError(
      `ranked-proposals.json does not match the expected proposal schema: ${validationErrors.join(
        "; ",
      )}`,
    );
  }

  const markdown = renderProposalReview(rankedProposals);

  await mkdir(path.dirname(resolvedReportPath), { recursive: true });
  await writeFile(resolvedReportPath, markdown, "utf8");

  return {
    rankedProposalsPath: resolvedRankedProposalsPath,
    reportPath: resolvedReportPath,
    proposalCount: rankedProposals.proposals.length,
    markdown,
  };
}

export function renderProposalReview(rankedProposals) {
  const validationErrors = validateRankedProposals(rankedProposals);

  if (validationErrors.length > 0) {
    throw new ProposalReviewError(
      `Cannot render invalid ranked proposals: ${validationErrors.join("; ")}`,
    );
  }

  const proposals = rankedProposals.proposals
    .map((proposal, sourceIndex) => ({
      proposal,
      sourceIndex,
      priority: priorityDetails(proposal.overall_priority),
    }))
    .sort((left, right) => {
      if (left.priority.rank !== right.priority.rank) {
        return left.priority.rank - right.priority.rank;
      }

      return left.sourceIndex - right.sourceIndex;
    });
  const lines = [
    "# Proposal Review Report",
    "",
    `- **Generated at:** ${escapeMarkdown(rankedProposals.generated_at)}`,
    `- **Proposal count:** ${proposals.length}`,
    "",
  ];

  if (proposals.length === 0) {
    lines.push("No proposals are available for review.", "");
    return `${lines.join("\n")}\n`;
  }

  proposals.forEach(({ proposal, priority }, index) => {
    const title = deriveTitle(proposal);

    lines.push(
      `## ${index + 1}. ${escapeMarkdown(title)}`,
      "",
      `- **Title:** ${escapeMarkdown(title)}`,
      `- **Proposal ID:** ${escapeMarkdown(proposal.proposal_id)}`,
      `- **Priority:** ${escapeMarkdown(proposal.overall_priority)}`,
      `- **Category:** ${escapeMarkdown(proposal.category)}`,
      `- **Impact:** ${escapeMarkdown(proposal.impact_score)}`,
      `- **Risk:** ${escapeMarkdown(proposal.risk_score)}`,
      `- **Implementation Cost:** ${escapeMarkdown(
        proposal.implementation_cost_score,
      )}`,
      `- **Recommendation:** ${recommendationFor(priority)}`,
      "- **Evidence:**",
    );

    if (proposal.evidence.length === 0) {
      lines.push("  - None provided.");
    } else {
      proposal.evidence.forEach((evidence) => {
        lines.push(`  - ${escapeMarkdown(evidence)}`);
      });
    }

    lines.push(
      `- **Recommended Action:** ${escapeMarkdown(
        proposal.recommended_action,
      )}`,
      "",
    );
  });

  return `${lines.join("\n")}\n`;
}

function priorityDetails(value) {
  const normalized = collapseWhitespace(value).toLowerCase();

  if (PRIORITY_RANKS.has(normalized)) {
    return {
      known: true,
      rank: PRIORITY_RANKS.get(normalized),
    };
  }

  const pLevel = normalized.match(/^p(?:riority)?[\s_-]*(\d+)$/);

  if (pLevel) {
    return {
      known: true,
      rank: Number(pLevel[1]),
    };
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return {
      known: true,
      rank: Number(normalized),
    };
  }

  return {
    known: false,
    rank: Number.POSITIVE_INFINITY,
  };
}

function recommendationFor(priority) {
  if (!priority.known) {
    return "Review according to its stated priority.";
  }

  if (priority.rank <= 1) {
    return "Review first.";
  }

  if (priority.rank === 2) {
    return "Review after higher-priority proposals.";
  }

  return "Review after higher-priority proposals are addressed.";
}

function deriveTitle(proposal) {
  const action = collapseWhitespace(proposal.recommended_action);

  if (!action) {
    return `Proposal ${collapseWhitespace(proposal.proposal_id)}`;
  }

  const firstSentence = action.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? action;

  if (firstSentence.length <= 120) {
    return firstSentence;
  }

  return `${firstSentence.slice(0, 117).trimEnd()}...`;
}

function escapeMarkdown(value) {
  return collapseWhitespace(value)
    .replaceAll("\\", "\\\\")
    .replace(/([`*_[\]{}<>|])/g, "\\$1");
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

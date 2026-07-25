import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ProposalReviewError,
  generateProposalReviewReport,
  renderProposalReview,
} from "./generate-proposal-review.mjs";

const FIXED_NOW = "2026-07-22T00:00:00.000Z";

test("report sorts proposals by priority and includes every review field", () => {
  const rankedProposals = createRankedProposals();
  const sourceOrder = rankedProposals.proposals.map(
    (proposal) => proposal.proposal_id,
  );
  const report = renderProposalReview(rankedProposals);

  assert.ok(
    report.indexOf("proposal-high") < report.indexOf("proposal-medium"),
  );
  assert.ok(
    report.indexOf("proposal-medium") < report.indexOf("proposal-low"),
  );
  assert.deepEqual(
    rankedProposals.proposals.map((proposal) => proposal.proposal_id),
    sourceOrder,
  );

  for (const field of [
    "Title",
    "Proposal ID",
    "Priority",
    "Category",
    "Impact",
    "Risk",
    "Implementation Cost",
    "Recommendation",
    "Evidence",
    "Recommended Action",
  ]) {
    assert.match(report, new RegExp(`\\*\\*${field}:\\*\\*`));
  }

  assert.match(report, /- \*\*Recommendation:\*\* Review first\./);
  assert.match(
    report,
    /- \*\*Recommendation:\*\* Review after higher-priority proposals\./,
  );
  assert.match(report, /  - High-priority evidence\./);
  assert.match(
    report,
    /- \*\*Recommended Action:\*\* Address the high-priority finding\./,
  );
});

test("file generator uses ranked-proposals.json and writes proposal-review.md", async () => {
  await withTempDir(async (tempDir) => {
    const rankedProposalsPath = path.join(tempDir, "ranked-proposals.json");
    const source = `${JSON.stringify(createRankedProposals(), null, 2)}\n`;

    await writeFile(rankedProposalsPath, source, "utf8");

    const result = await generateProposalReviewReport({
      rankedProposalsPath,
    });
    const report = await readFile(
      path.join(tempDir, "proposal-review.md"),
      "utf8",
    );

    assert.equal(result.reportPath, path.join(tempDir, "proposal-review.md"));
    assert.equal(result.proposalCount, 3);
    assert.equal(result.markdown, report);
    assert.equal(await readFile(rankedProposalsPath, "utf8"), source);
  });
});

test("empty proposal input creates a readable empty report", () => {
  const report = renderProposalReview({
    generated_at: FIXED_NOW,
    site_stack: "Static site.",
    proposals: [],
  });

  assert.match(report, /^# Proposal Review Report/m);
  assert.match(report, /- \*\*Proposal count:\*\* 0/);
  assert.match(report, /No proposals are available for review\./);
});

test("missing, malformed, and schema-invalid source files fail clearly", async () => {
  await withTempDir(async (tempDir) => {
    const missingPath = path.join(tempDir, "missing.json");
    const malformedPath = path.join(tempDir, "malformed.json");
    const invalidPath = path.join(tempDir, "invalid.json");

    await writeFile(malformedPath, "{", "utf8");
    await writeFile(
      invalidPath,
      `${JSON.stringify({ proposals: [] })}\n`,
      "utf8",
    );

    await assert.rejects(
      generateProposalReviewReport({
        rankedProposalsPath: missingPath,
      }),
      (error) =>
        error instanceof ProposalReviewError &&
        /was not found/.test(error.message),
    );
    await assert.rejects(
      generateProposalReviewReport({
        rankedProposalsPath: malformedPath,
      }),
      (error) =>
        error instanceof ProposalReviewError &&
        /malformed JSON/.test(error.message),
    );
    await assert.rejects(
      generateProposalReviewReport({
        rankedProposalsPath: invalidPath,
      }),
      (error) =>
        error instanceof ProposalReviewError &&
        /expected proposal schema/.test(error.message),
    );
  });
});

test("daily audit generates and uploads the report after ranked proposals", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/daily-site-audit.yml", import.meta.url),
    "utf8",
  );
  const rankedGeneration =
    "run: node scripts/generate-ranked-proposals.mjs";
  const reportGeneration =
    "run: node scripts/generate-proposal-review.mjs";

  assert.ok(workflow.includes(rankedGeneration));
  assert.ok(workflow.includes(reportGeneration));
  assert.ok(
    workflow.indexOf(rankedGeneration) < workflow.indexOf(reportGeneration),
  );
  assert.match(
    workflow,
    /out\/audit-bundle\/proposal-review\.md/,
  );
});

function createRankedProposals() {
  return {
    generated_at: FIXED_NOW,
    site_stack: "Static Cloudflare Pages site.",
    proposals: [
      createProposal({
        proposal_id: "proposal-low",
        overall_priority: "low",
        impact_score: 2,
        risk_score: 1,
        implementation_cost_score: 2,
        evidence: ["Low-priority evidence."],
        recommended_action: "Address the low-priority finding.",
      }),
      createProposal({
        proposal_id: "proposal-high",
        overall_priority: "high",
        impact_score: 5,
        risk_score: 2,
        implementation_cost_score: 3,
        evidence: ["High-priority evidence."],
        recommended_action: "Address the high-priority finding.",
      }),
      createProposal({
        proposal_id: "proposal-medium",
        overall_priority: "medium",
        impact_score: 3,
        risk_score: 2,
        implementation_cost_score: 2,
        evidence: ["Medium-priority evidence."],
        recommended_action: "Address the medium-priority finding.",
      }),
    ],
  };
}

function createProposal(overrides) {
  return {
    proposal_id: "proposal-fixture",
    category: "SEO",
    evidence: ["Fixture evidence."],
    impact_score: 3,
    implementation_cost_score: 2,
    risk_score: 1,
    test_ease_score: 4,
    overall_priority: "medium",
    recommended_action: "Review the fixture evidence.",
    ...overrides,
  };
}

async function withTempDir(callback) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "proposal-review-"));

  try {
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

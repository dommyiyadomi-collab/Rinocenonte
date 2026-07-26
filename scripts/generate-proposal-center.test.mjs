import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ProposalCenterError,
  generateProposalCenter,
  parseProposalReview,
  renderProposalCenter,
} from "./generate-proposal-center.mjs";
import { renderProposalReview } from "./generate-proposal-review.mjs";

const FIXED_NOW = "2026-07-25T00:00:00.000Z";

test("Proposal Center displays required fields in report priority order", () => {
  const rankedProposals = createRankedProposals();
  const proposalReview = renderProposalReview(rankedProposals);
  const html = renderProposalCenter({ rankedProposals, proposalReview });

  assert.ok(html.indexOf("proposal-high") < html.indexOf("proposal-medium"));
  assert.ok(html.indexOf("proposal-medium") < html.indexOf("proposal-low"));

  for (const field of [
    "Proposal Title",
    "Proposal ID",
    "Overall Priority",
    "Category",
    "Impact",
    "Implementation Cost",
    "Risk",
    "Test Ease",
    "Evidence Summary",
    "Recommended Action",
    "Current Status",
  ]) {
    assert.match(html, new RegExp(field));
  }

  assert.equal((html.match(/>Pending</g) ?? []).length, 3);
  assert.match(html, /Address the high-priority finding\./);
  assert.match(html, /High-priority evidence\./);
});

test("Proposal Center remains informational and escapes source content", () => {
  const rankedProposals = createRankedProposals();

  rankedProposals.proposals[1].proposal_id = "proposal-<script>";
  rankedProposals.proposals[1].recommended_action =
    "Review <img src=x onerror=alert(1)> & document the result.";
  rankedProposals.proposals[1].evidence = ["Observed <strong>signal</strong>."];

  const html = renderProposalCenter({
    rankedProposals,
    proposalReview: renderProposalReview(rankedProposals),
  });

  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /proposal-&lt;script&gt;/);
  assert.match(html, /&lt;strong&gt;signal&lt;\/strong&gt;/);
  assert.match(html, /&amp; document/);
  assert.doesNotMatch(html, /<button\b/i);
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /workflow_dispatch/);
});

test("file generator reads both sources without modifying them", async () => {
  await withTempDir(async (tempDir) => {
    const rankedProposals = createRankedProposals();
    const rankedProposalsPath = path.join(tempDir, "ranked-proposals.json");
    const proposalReviewPath = path.join(tempDir, "proposal-review.md");
    const proposalCenterPath = path.join(tempDir, "proposal-center.html");
    const rankedSource = `${JSON.stringify(rankedProposals, null, 2)}\n`;
    const reviewSource = renderProposalReview(rankedProposals);

    await writeFile(rankedProposalsPath, rankedSource, "utf8");
    await writeFile(proposalReviewPath, reviewSource, "utf8");

    const result = await generateProposalCenter({
      rankedProposalsPath,
      proposalReviewPath,
      proposalCenterPath,
    });
    const html = await readFile(proposalCenterPath, "utf8");

    assert.equal(result.proposalCount, 3);
    assert.equal(result.html, html);
    assert.equal(await readFile(rankedProposalsPath, "utf8"), rankedSource);
    assert.equal(await readFile(proposalReviewPath, "utf8"), reviewSource);
  });
});

test("empty proposal sources render a readable empty page", () => {
  const rankedProposals = {
    generated_at: FIXED_NOW,
    site_stack: "Static site.",
    proposals: [],
  };
  const html = renderProposalCenter({
    rankedProposals,
    proposalReview: renderProposalReview(rankedProposals),
  });

  assert.match(html, /No proposals to review/);
  assert.match(html, /Proposals<\/dt>\s*<dd>0<\/dd>/);
  assert.doesNotMatch(html, /class="proposal-card"/);
});

test("report parser reads generated metadata, titles, and proposal IDs", () => {
  const rankedProposals = createRankedProposals();
  const parsed = parseProposalReview(renderProposalReview(rankedProposals));

  assert.equal(parsed.generatedAt, FIXED_NOW);
  assert.equal(parsed.proposalCount, 3);
  assert.deepEqual(
    parsed.entries.map((entry) => entry.proposalId),
    ["proposal-high", "proposal-medium", "proposal-low"],
  );
  assert.equal(
    parsed.entries[0].title,
    "Address the high-priority finding.",
  );
});

test("missing, malformed, schema-invalid, and mismatched sources fail clearly", async () => {
  await withTempDir(async (tempDir) => {
    const missingJsonPath = path.join(tempDir, "missing.json");
    const malformedJsonPath = path.join(tempDir, "malformed.json");
    const validJsonPath = path.join(tempDir, "ranked-proposals.json");
    const reviewPath = path.join(tempDir, "proposal-review.md");
    const rankedProposals = createRankedProposals();
    const validReview = renderProposalReview(rankedProposals);

    await writeFile(malformedJsonPath, "{", "utf8");
    await writeFile(
      validJsonPath,
      `${JSON.stringify(rankedProposals)}\n`,
      "utf8",
    );
    await writeFile(reviewPath, validReview, "utf8");

    await assert.rejects(
      generateProposalCenter({
        rankedProposalsPath: missingJsonPath,
        proposalReviewPath: reviewPath,
      }),
      (error) =>
        error instanceof ProposalCenterError &&
        /was not found/.test(error.message),
    );

    await assert.rejects(
      generateProposalCenter({
        rankedProposalsPath: malformedJsonPath,
        proposalReviewPath: reviewPath,
      }),
      /malformed JSON/,
    );

    assert.throws(
      () =>
        renderProposalCenter({
          rankedProposals: { proposals: [] },
          proposalReview: validReview,
        }),
      /expected proposal schema/,
    );

    assert.throws(
      () =>
        renderProposalCenter({
          rankedProposals,
          proposalReview: validReview.replace(
            "proposal-high",
            "proposal-stale",
          ),
        }),
      /was not found in ranked-proposals\.json/,
    );
  });
});

test("daily audit generates and uploads the Proposal Center additively", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/daily-site-audit.yml", import.meta.url),
    "utf8",
  );
  const rankedGeneration =
    "run: node scripts/generate-ranked-proposals.mjs";
  const reportGeneration =
    "run: node scripts/generate-proposal-review.mjs";
  const centerGeneration =
    "run: node scripts/generate-proposal-center.mjs";

  assert.ok(workflow.includes(rankedGeneration));
  assert.ok(workflow.includes(reportGeneration));
  assert.ok(workflow.includes(centerGeneration));
  assert.ok(workflow.indexOf(rankedGeneration) < workflow.indexOf(reportGeneration));
  assert.ok(workflow.indexOf(reportGeneration) < workflow.indexOf(centerGeneration));
  assert.match(workflow, /out\/audit-bundle\/proposal-center\.html/);
  assert.match(workflow, /name: ranked-proposals/);
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
  const tempDir = await mkdtemp(path.join(tmpdir(), "proposal-center-"));

  try {
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

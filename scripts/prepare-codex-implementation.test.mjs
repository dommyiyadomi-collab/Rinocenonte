import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CodexImplementationError,
  prepareCodexImplementation,
} from "./prepare-codex-implementation.mjs";
import { buildPullRequestMetadata } from "./prepare-codex-pull-request.mjs";

test("valid approved-proposal.json succeeds", async () => {
  await withTempDir(async (tempDir) => {
    const result = await prepareFixture(tempDir);

    assert.equal(result.context.proposal_id, "proposal-001");
    assert.equal(result.context.approval_run_id, "2001");
    assert.equal(result.context.source_run_id, "1001");
    assert.match(
      result.branchName,
      /^codex\/proposal-proposal-001-[a-f0-9]{10}-run-3001-attempt-1$/,
    );
    assert.equal(
      await readFile(
        path.join(tempDir, "output", "implementation-prompt.txt"),
        "utf8",
      ),
      result.prompt,
    );
  });
});

test("missing approved-proposal.json fails", async () => {
  await withTempDir(async (tempDir) => {
    await assert.rejects(
      prepareFixture(tempDir, { writeFixture: false }),
      (error) =>
        error instanceof CodexImplementationError &&
        /approved-proposal\.json was not found/.test(error.message),
    );
  });
});

test("malformed approved-proposal.json fails", async () => {
  await withTempDir(async (tempDir) => {
    await assert.rejects(
      prepareFixture(tempDir, { fileContents: "{not-json" }),
      /approved-proposal\.json is malformed JSON/,
    );
  });
});

test("missing proposal_id fails", async () => {
  await withTempDir(async (tempDir) => {
    const approved = validApprovedProposal();
    delete approved.proposal_id;

    await assert.rejects(
      prepareFixture(tempDir, { approved }),
      /approved-proposal\.json proposal_id must be a non-empty string/,
    );
  });
});

test("reject decision fails", async () => {
  await assertDecisionFails("reject");
});

test("defer decision fails", async () => {
  await assertDecisionFails("defer");
});

test("requested and approved proposal IDs must match", async () => {
  await withTempDir(async (tempDir) => {
    await assert.rejects(
      prepareFixture(tempDir, { requestedProposalId: "proposal-999" }),
      /Requested proposal_id .* does not match/,
    );
  });
});

test("nested proposal_id must match the top-level proposal_id", async () => {
  await withTempDir(async (tempDir) => {
    const approved = validApprovedProposal();
    approved.proposal.proposal_id = "proposal-999";

    await assert.rejects(
      prepareFixture(tempDir, { approved }),
      /proposal\.proposal_id .* does not match top-level proposal_id/,
    );
  });
});

test("missing proposal object fails", async () => {
  await withTempDir(async (tempDir) => {
    const approved = validApprovedProposal();
    delete approved.proposal;

    await assert.rejects(
      prepareFixture(tempDir, { approved }),
      /must contain a proposal object/,
    );
  });
});

test("special characters remain data and are never shell-executed", async () => {
  await withTempDir(async (tempDir) => {
    const approved = validApprovedProposal();
    const markerPath = path.join(tempDir, "shell-executed");
    const specialText =
      'literal $(node -e "require(\'node:fs\').writeFileSync(\'shell-executed\',\'bad\')"); `echo unsafe`; $VALUE; "quotes"; <tag>';
    approved.proposal.evidence = [specialText];
    approved.proposal.recommended_action = specialText;

    const result = await prepareFixture(tempDir, { approved });

    assert.equal(result.context.evidence[0], specialText);
    assert.equal(result.context.recommended_action, specialText);
    assert.match(result.prompt, /\$\(node -e/);
    assert.equal(await pathExists(markerPath), false);
  });
});

test("generated prompt is limited to the approved proposal fields", async () => {
  await withTempDir(async (tempDir) => {
    const approved = validApprovedProposal();
    approved.decision_reason = "DO_NOT_INCLUDE_DECISION_REASON";
    approved.unapproved_top_level = "DO_NOT_INCLUDE_TOP_LEVEL";
    approved.proposal.unapproved_notes = "DO_NOT_INCLUDE_PROPOSAL_NOTES";

    const result = await prepareFixture(tempDir, { approved });

    assert.match(result.prompt, /Approved proposal_id/);
    assert.match(result.prompt, /Evidence from the approved artifact/);
    assert.match(result.prompt, /Make the one approved change/);
    assert.doesNotMatch(result.prompt, /DO_NOT_INCLUDE_DECISION_REASON/);
    assert.doesNotMatch(result.prompt, /DO_NOT_INCLUDE_TOP_LEVEL/);
    assert.doesNotMatch(result.prompt, /DO_NOT_INCLUDE_PROPOSAL_NOTES/);
  });
});

test("missing source_run_id fails", async () => {
  await withTempDir(async (tempDir) => {
    const approved = validApprovedProposal();
    delete approved.source_run_id;

    await assert.rejects(
      prepareFixture(tempDir, { approved }),
      /source_run_id must be a non-empty string/,
    );
  });
});

test("Draft PR metadata preserves approved data without rendering injected HTML", () => {
  const metadata = buildPullRequestMetadata({
    proposal_id: "proposal-<script>",
    approval_run_id: "2001",
    source_run_id: "1001",
    category: "SEO",
    evidence: ["<script>alert('evidence')</script>"],
    recommended_action: "<b>approved action</b>",
  });

  assert.match(metadata.body, /proposal-&lt;script&gt;/);
  assert.match(
    metadata.body,
    /&lt;script&gt;alert\('evidence'\)&lt;\/script&gt;/,
  );
  assert.match(metadata.body, /&lt;b&gt;approved action&lt;\/b&gt;/);
  assert.doesNotMatch(metadata.body, /<script>/);
  assert.match(metadata.body, /Source approval run ID/);
  assert.match(metadata.body, /npm test/);
});

async function assertDecisionFails(decision) {
  await withTempDir(async (tempDir) => {
    const approved = validApprovedProposal();
    approved.decision = decision;

    await assert.rejects(
      prepareFixture(tempDir, { approved }),
      new RegExp(`decision must be exactly "approve"; received "${decision}"`),
    );
  });
}

async function prepareFixture(
  tempDir,
  {
    approved = validApprovedProposal(),
    requestedProposalId = "proposal-001",
    fileContents,
    writeFixture = true,
  } = {},
) {
  const approvedProposalPath = path.join(tempDir, "approved-proposal.json");

  if (writeFixture) {
    await writeFile(
      approvedProposalPath,
      fileContents ?? `${JSON.stringify(approved, null, 2)}\n`,
      "utf8",
    );
  }

  return prepareCodexImplementation({
    approvedProposalPath,
    outputDir: path.join(tempDir, "output"),
    requestedProposalId,
    approvalRunId: "2001",
    workflowRunId: "3001",
    workflowRunAttempt: "1",
  });
}

function validApprovedProposal() {
  return {
    proposal_id: "proposal-001",
    decision: "approve",
    decided_by: "approver",
    decided_at: "2026-07-25T00:00:00.000Z",
    decision_reason: "Approved after review.",
    source_run_id: "1001",
    proposal: {
      proposal_id: "proposal-001",
      category: "SEO",
      evidence: ["Evidence from the approved artifact."],
      recommended_action: "Make the one approved change.",
    },
  };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function withTempDir(callback) {
  const tempDir = await mkdtemp(
    path.join(tmpdir(), "codex-implementation-test-"),
  );

  try {
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

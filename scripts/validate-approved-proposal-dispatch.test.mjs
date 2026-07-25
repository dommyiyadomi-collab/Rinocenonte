import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  ApprovedProposalDispatchError,
  validateApprovedProposalDispatch,
  validateApprovedProposalDispatchFile,
} from "./validate-approved-proposal-dispatch.mjs";

const DISPATCHER_WORKFLOW_PATH = fileURLToPath(
  new URL(
    "../.github/workflows/approved-proposal-dispatcher.yml",
    import.meta.url,
  ),
);

test("approve decision for the requested proposal succeeds", () => {
  assert.deepEqual(
    validateApprovedProposalDispatch(
      {
        proposal_id: "proposal-001",
        decision: "approve",
        proposal: {
          proposal_id: "proposal-001",
          recommended_action: "Approved content remains in the artifact.",
        },
      },
      "proposal-001",
    ),
    { proposalId: "proposal-001" },
  );
});

for (const [decision, renderedDecision] of [
  ["reject", '"reject"'],
  ["defer", '"defer"'],
  [undefined, "undefined"],
]) {
  test(`decision ${renderedDecision} cannot be dispatched`, () => {
    assert.throws(
      () =>
        validateApprovedProposalDispatch(
          {
            proposal_id: "proposal-001",
            decision,
          },
          "proposal-001",
        ),
      new RegExp(
        `decision must be exactly "approve"; received ${escapeRegExp(
          renderedDecision,
        )}`,
      ),
    );
  });
}

test("requested proposal_id must match the approved artifact", () => {
  assert.throws(
    () =>
      validateApprovedProposalDispatch(
        {
          proposal_id: "proposal-001",
          decision: "approve",
        },
        "proposal-999",
      ),
    /Requested proposal_id .* does not match approved-proposal\.json proposal_id/,
  );
});

test("proposal_id must be present in both the request and artifact", () => {
  assert.throws(
    () =>
      validateApprovedProposalDispatch(
        {
          proposal_id: "proposal-001",
          decision: "approve",
        },
        "",
      ),
    /Requested proposal_id must be a non-empty string/,
  );
  assert.throws(
    () =>
      validateApprovedProposalDispatch(
        {
          decision: "approve",
        },
        "proposal-001",
      ),
    /approved-proposal\.json proposal_id must be a non-empty string/,
  );
});

test("malformed JSON and a missing artifact fail without dispatch", async () => {
  await withTempDir(async (tempDir) => {
    const malformedPath = path.join(tempDir, "malformed.json");
    await writeFile(malformedPath, "{not-json", "utf8");

    await assert.rejects(
      validateApprovedProposalDispatchFile({
        approvedProposalPath: malformedPath,
        requestedProposalId: "proposal-001",
      }),
      /approved-proposal\.json is malformed JSON/,
    );

    await assert.rejects(
      validateApprovedProposalDispatchFile({
        approvedProposalPath: path.join(tempDir, "missing.json"),
        requestedProposalId: "proposal-001",
      }),
      (error) =>
        error instanceof ApprovedProposalDispatchError &&
        /approved-proposal\.json was not found/.test(error.message),
    );
  });
});

test("workflow dispatch contract passes only proposal and approval run IDs", async () => {
  const workflow = await readFile(DISPATCHER_WORKFLOW_PATH, "utf8");
  const declaredInputsBlock = workflow.match(
    /workflow_dispatch:\r?\n {4}inputs:\r?\n([\s\S]*?)\r?\n\r?\npermissions:/,
  );
  assert.ok(declaredInputsBlock, "workflow_dispatch inputs block was not found");
  assert.deepEqual(
    [...declaredInputsBlock[1].matchAll(/^ {6}([a-z_]+):\r?$/gm)].map(
      (match) => match[1],
    ),
    ["proposal_id", "approval_run_id"],
  );

  const apiInputsBlock = workflow.match(
    / {14}inputs: \{\r?\n([\s\S]*?)\r?\n {14}\},/,
  );
  assert.ok(apiInputsBlock, "implementation dispatch inputs were not found");
  assert.deepEqual(
    [...apiInputsBlock[1].matchAll(/^ {16}([a-z_]+):/gm)].map(
      (match) => match[1],
    ),
    ["proposal_id", "approval_run_id"],
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function withTempDir(callback) {
  const tempDir = await mkdtemp(
    path.join(tmpdir(), "approved-proposal-dispatch-"),
  );

  try {
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

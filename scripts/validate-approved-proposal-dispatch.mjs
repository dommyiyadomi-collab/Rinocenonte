#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const USAGE =
  "Usage: node scripts/validate-approved-proposal-dispatch.mjs <approved-proposal.json>; provide REQUESTED_PROPOSAL_ID via environment.";

export class ApprovedProposalDispatchError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApprovedProposalDispatchError";
  }
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApprovedProposalDispatchError(
      `${label} must be a non-empty string.`,
    );
  }

  return value;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateApprovedProposalDispatch(
  approvedProposal,
  requestedProposalId,
) {
  const requestedId = requireNonEmptyString(
    requestedProposalId,
    "Requested proposal_id",
  );

  if (!isObject(approvedProposal)) {
    throw new ApprovedProposalDispatchError(
      "approved-proposal.json must contain a JSON object.",
    );
  }

  if (approvedProposal.decision !== "approve") {
    throw new ApprovedProposalDispatchError(
      `approved-proposal.json decision must be exactly "approve"; received ${JSON.stringify(approvedProposal.decision)}.`,
    );
  }

  const approvedProposalId = requireNonEmptyString(
    approvedProposal.proposal_id,
    "approved-proposal.json proposal_id",
  );

  if (approvedProposalId !== requestedId) {
    throw new ApprovedProposalDispatchError(
      `Requested proposal_id ${JSON.stringify(requestedId)} does not match approved-proposal.json proposal_id ${JSON.stringify(approvedProposalId)}.`,
    );
  }

  return { proposalId: approvedProposalId };
}

export async function validateApprovedProposalDispatchFile({
  approvedProposalPath,
  requestedProposalId,
}) {
  if (!approvedProposalPath) {
    throw new ApprovedProposalDispatchError(USAGE);
  }

  let approvedProposal;
  try {
    approvedProposal = JSON.parse(
      await readFile(approvedProposalPath, "utf8"),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new ApprovedProposalDispatchError(
        `approved-proposal.json was not found at ${approvedProposalPath}.`,
      );
    }

    if (error instanceof SyntaxError) {
      throw new ApprovedProposalDispatchError(
        `approved-proposal.json is malformed JSON: ${error.message}`,
      );
    }

    throw new ApprovedProposalDispatchError(
      `Could not read approved-proposal.json at ${approvedProposalPath}: ${error.message}`,
    );
  }

  return validateApprovedProposalDispatch(
    approvedProposal,
    requestedProposalId,
  );
}

export async function main({ argv = process.argv, env = process.env } = {}) {
  const args = argv.slice(2);

  if (args.length !== 1) {
    throw new ApprovedProposalDispatchError(USAGE);
  }

  const result = await validateApprovedProposalDispatchFile({
    approvedProposalPath: args[0],
    requestedProposalId: env.REQUESTED_PROPOSAL_ID,
  });

  console.log(
    `Verified approval for proposal ${JSON.stringify(result.proposalId)}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

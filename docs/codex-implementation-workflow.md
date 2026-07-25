# Codex Implementation Workflow

`.github/workflows/codex-implementation.yml` is the implementation boundary
between a future Approved Proposal Dispatcher and Codex. The dispatcher is not
part of this repository change.

## Dispatch contract

The workflow accepts exactly two `workflow_dispatch` inputs:

| Input | Required | Meaning |
| --- | --- | --- |
| `proposal_id` | Yes | Exact ID of the one human-approved proposal to implement. |
| `approval_run_id` | Yes | Successful `Proposal approval` workflow run containing the approval artifact. |

Proposal content is never accepted as an input. The approval artifact identity
is fixed by the workflow:

- workflow: `.github/workflows/proposal-approval.yml`
- artifact: `proposal-decision`
- required file: `approved-proposal.json`

The future dispatcher must dispatch `.github/workflows/codex-implementation.yml`
on `main` and send only `proposal_id` and `approval_run_id`.

## Independent validation

Before Codex can run, the workflow verifies that:

- `approval_run_id` is a non-zero decimal GitHub Actions run ID
- the run belongs to `.github/workflows/proposal-approval.yml`
- the run used `main`, was triggered with `workflow_dispatch`, and completed successfully
- exactly one unexpired `proposal-decision` artifact exists
- `approved-proposal.json` exists and contains valid JSON
- top-level `proposal_id` is a non-empty string
- `decision` is exactly `approve`
- `source_run_id` is a non-empty string
- the requested `proposal_id` exactly matches the top-level `proposal_id`
- `proposal` is an object
- `proposal.proposal_id` exactly matches the top-level `proposal_id`
- `proposal.category` and `proposal.recommended_action` are non-empty strings
- `proposal.evidence` is an array containing only strings

Consequently, `ranked-proposals.json` alone, `approval-decision.json` alone,
reject/defer decisions, mismatched proposals, and proposal content supplied
through dispatch inputs are rejected.

## Implementation and branch boundary

After validation, a secret-free prompt and context file are uploaded as the
`codex-implementation-prompt-<workflow-run-id>-<attempt>` artifact for 30 days.
Only the approved proposal ID, category, evidence, and recommended action enter
the Codex prompt.

The workflow uses the officially maintained `openai/codex-action@v1` with the
repository's existing `OPENAI_ACCESS_TOKEN` secret convention. It does not pin
or invent a model name. Codex runs on `ubuntu-latest` with
`permission-profile: ":workspace"` and `safety-strategy: drop-sudo`; it is
never given `danger-full-access`. Dependencies are installed before Codex
starts because the workspace permission profile does not grant Codex network
access.

The branch name is deterministic per proposal and workflow attempt:

```text
codex/proposal-<safe-proposal-slug>-<proposal-sha256-prefix>-run-<workflow-run-id>-attempt-<attempt>
```

The hash preserves collision resistance when two proposal IDs normalize to the
same branch-safe slug. The workflow checks out `main`, creates this branch, and
never commits directly to `main`.

Codex is instructed to modify only the approved proposal, inspect the existing
repository and instructions, avoid unrelated refactoring, avoid dependencies
unless strictly necessary, preserve the existing architecture, run applicable
tests, and report inability instead of guessing. Codex is also forbidden from
committing, pushing, creating or updating PRs, merging, or deploying.

## Validation, commit, and Draft PR

After Codex exits, the workflow requires all of these commands to pass:

```text
npm test
npx --yes html-validate@latest "public/**/*.html"
node scripts/check-internal-links.mjs
node scripts/check-render-visibility.mjs
git diff --cached --check
```

No branch or PR is published if Codex produces no change or validation fails.
For a passing change, the workflow stages the clean implementation checkout,
commits, pushes the dedicated branch, and creates a Draft PR targeting `main`.
The PR records the proposal ID, source approval run ID, source audit run ID,
category, evidence, recommended action, and test results. It is not marked
ready, merged, or deployed.

PRs created with the workflow `GITHUB_TOKEN` do not themselves trigger another
workflow. To ensure CI is still attached to the implementation commit,
`validate.yml` also accepts `workflow_dispatch`, and the implementation
workflow explicitly dispatches it for the new branch after creating the Draft
PR.

## Permissions

The workflow starts with `permissions: {}` and grants permissions per job:

| Job | Permission | Why |
| --- | --- | --- |
| Validate and prepare | `actions: read` | Read approval run metadata and download its fixed artifact. |
| Validate and prepare | `contents: read` | Check out trusted code from `main`. |
| Implement and publish | `actions: write` | Download the prompt artifact and dispatch `validate.yml` for the implementation commit. |
| Implement and publish | `contents: write` | Check out `main`, push the dedicated implementation branch, and create its commit. |
| Implement and publish | `pull-requests: write` | Create the Draft PR targeting `main`. |

No deployment, environment, package, issue, check, status, ID-token, or secret
administration permission is granted. Checkout credentials are not persisted
while Codex runs. Push credentials are configured only after Codex exits and
are removed at the end of the job.

## Required repository configuration

`OPENAI_ACCESS_TOKEN` must remain available as a GitHub Actions secret and must
be a credential accepted by `openai/codex-action` for the OpenAI Responses API.
The repository or organization Actions policy must also permit workflows to
request the declared write permissions and permit `GITHUB_TOKEN` to create pull
requests. GitHub does not expose secret values, so credential validity must be
confirmed by the first authorized implementation run.
The Proposal Approval workflow must continue to upload the fixed
`proposal-decision` artifact containing `approved-proposal.json`. No dispatcher,
deployment workflow, auto-merge setting, environment approval bypass, model
variable, or additional secret is introduced here.

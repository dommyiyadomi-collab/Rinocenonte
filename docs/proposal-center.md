# Daily AI Audit Proposal Center

The Proposal Center is a self-contained HTML dashboard generated during the
existing Daily Site Audit proposal job. It helps reviewers scan daily proposals
in priority order and hand a selected proposal to the existing GitHub Proposal
Approval workflow.

## Preview

The committed fixture produces this priority-ordered card summary:

| Order | Proposal | Priority | Category | Status |
| ---: | --- | --- | --- | --- |
| 1 | Strengthen the digital nomad visa guide around the supported search intent. | high | SEO | Pending |
| 2 | Clarify the city comparison path with a concise, evidence-backed summary. | medium | UX | Pending |
| 3 | Review the hero image delivery settings before considering a scoped optimization. | low | performance | Pending |

Generate the full self-contained preview with:

```text
node scripts/generate-proposal-center.mjs scripts/fixtures/proposal-center/ranked-proposals.json scripts/fixtures/proposal-center/proposal-review.md out/proposal-center-preview.html
```

## Open The Dashboard

1. Open a completed **Daily site audit** run in GitHub Actions.
2. Download the existing `ranked-proposals` artifact.
3. Extract the artifact and open `proposal-center.html` in a browser.

The page is self-contained and does not require a server, client-side API
request, or deployment to review. Using an Approve action opens GitHub and
therefore requires browser access to the repository and an authenticated GitHub
session.

## Displayed Information

Each proposal card shows:

- proposal title
- proposal ID
- category
- overall priority
- impact
- implementation cost
- risk
- test ease
- evidence summary
- recommended action
- current status
- an Approve action with the exact Proposal Approval workflow inputs

Every proposal is displayed with an initial status of `Pending`. The status is
informational only and is not derived from approval artifacts.

The Approve action opens:

```text
{GITHUB_SERVER_URL}/{GITHUB_REPOSITORY}/actions/workflows/proposal-approval.yml
```

Each card displays the exact `source_run_id` and `proposal_id` values to submit,
plus `decision` set to `approve`. A reviewer may also enter the workflow's
optional `decision_reason` before manually running it.

## Source And Ordering

The generator reads proposal content only from:

```text
out/audit-bundle/proposal-review.md
out/audit-bundle/ranked-proposals.json
```

The existing review report supplies the proposal title and priority-sorted
display order. The ranked JSON supplies the structured proposal fields. The
generator verifies that both sources have the same generation timestamp,
proposal count, and proposal IDs before writing the page.

For the approval handoff, it also reads `GITHUB_RUN_ID`, `GITHUB_REPOSITORY`,
and `GITHUB_SERVER_URL` from the generation environment. `GITHUB_SERVER_URL`
defaults to `https://github.com`. If the required GitHub run or repository
metadata is unavailable, every proposal shows a clear unavailable action
instead of a workflow link.

To generate the default output locally:

```text
node scripts/generate-proposal-center.mjs
```

The default output is:

```text
out/audit-bundle/proposal-center.html
```

Local generation normally has no GitHub run metadata, so its approval actions
remain unavailable unless that metadata is explicitly supplied.

## Approval Handoff And Boundary

The Approve action is a normal link to the existing GitHub Proposal Approval
workflow. The generated page contains no credentials, forms, client scripts,
REST dispatch requests, or repository writes, and it does not approve a
proposal by itself. It does not change:

- proposal IDs
- Proposal Approval workflow inputs or behavior
- Approved Proposal Dispatcher inputs or behavior
- Codex Implementation workflow inputs or behavior
- deployment configuration or production site files

GitHub authentication and the reviewer's manual submission of the existing
workflow remain the human approval boundary.

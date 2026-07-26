# Daily AI Audit Proposal Center

The Proposal Center is a read-only HTML dashboard generated during the existing
Daily Site Audit proposal job. It helps reviewers scan daily proposals in
priority order without changing any approval or implementation behavior.

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

The page is self-contained and does not require a server, network request, or
deployment.

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

Every proposal is displayed with an initial status of `Pending`. The status is
informational only and is not derived from approval artifacts.

## Source And Ordering

The generator reads only:

```text
out/audit-bundle/proposal-review.md
out/audit-bundle/ranked-proposals.json
```

The existing review report supplies the proposal title and priority-sorted
display order. The ranked JSON supplies the structured proposal fields. The
generator verifies that both sources have the same generation timestamp,
proposal count, and proposal IDs before writing the page.

To generate the default output locally:

```text
node scripts/generate-proposal-center.mjs
```

The default output is:

```text
out/audit-bundle/proposal-center.html
```

## Read-Only Boundary

The Proposal Center contains no approval or rejection controls, forms, client
scripts, workflow dispatch calls, or repository writes. It does not change:

- proposal IDs
- Proposal Approval workflow inputs or behavior
- Approved Proposal Dispatcher inputs or behavior
- Codex Implementation workflow inputs or behavior
- deployment configuration or production site files

The established approval workflow remains the only approval boundary.

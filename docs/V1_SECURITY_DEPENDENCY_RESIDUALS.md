# V1 Security Dependency Residuals

Status: **ACCEPTED WITH MITIGATIONS FOR V1**

This document records the production dependency residuals reported by the exact-head Backend Security audit after verified-unused direct dependencies were removed. It is not a claim that the upstream advisories are fixed.

## Runtime-reachable residuals

| Dependency | Current V1 position | Runtime reachability | V1 mitigation | Follow-up |
|---|---|---|---|---|
| `nodemailer` | High advisories remain on the current major; the available audited fix requires a major upgrade | owner daily digest, purchase-request mail, support notifications | explicit production support destination policy, no hard-coded production fallback recipient, credential-safe error/log handling | compatibility-test a supported major upgrade before changing the mail runtime |
| `puppeteer` | High advisory chain remains on the current major | PDF generation only | production Chromium sandbox is mandatory; production no-sandbox override fails closed | compatibility-test a supported major upgrade and regenerated lockfile |
| `xlsx` | High advisories remain and the current npm audit reports no automatic fix | product import parser only | 25 MB in-memory admission bound, supported extension/MIME checks, actual file-signature/content verification before parser execution, row-count bound before canonical import/database work | replace or upgrade the parser when a maintained compatible path is available |

## V1 release disposition

These residuals are accepted for V1 only because their runtime reachability is narrow and guarded by executable compensating controls already merged into the Security acceptance suite. The repository must continue to report high/critical production advisories in CI; a new direct high/critical dependency, removal of a listed mitigation, or widening one of these parsers/transports beyond its current bounded surface requires a new Security review.

Verified-unused direct dependencies removed earlier (`20`, external `crypto`, `grep`, `latest`, `router`) must not be reintroduced without an explicit runtime need and review.

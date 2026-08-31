# Security Policy

Marlo is a security-positioned project; we hold ourselves to the standard we
pitch. If you find a vulnerability, we want to hear about it.

## Reporting a vulnerability

**Where to send it.** Marlo is a Qumge distribution of
[OpenWorker](https://github.com/andrewyng/openworker) — the engine, the permission
gates and the approval flow are upstream's work, and so is the OAuth broker. Report
those to upstream at **security@openworker.com**.

Report anything Marlo adds — the Qumge sign-in and gateway, the device-code flow,
the skills catalog, the update/mirror path — to us at
[our issues](https://github.com/Qumge/marlo/issues) marked private, or to the
address on [qumge.com](https://qumge.com).

<!-- TODO(owner): Qumge 还没有公开的安全上报邮箱。定了之后把上面这行换成邮箱 ——
     "去 issues 提" 对安全问题不是合格的入口（公开可见）。 -->

When in doubt, send it upstream; they route Marlo-specific reports back to us.
Include:

- a description of the issue and its impact,
- reproduction steps or a proof of concept,
- the version you tested (app version from the About screen, or a commit hash).

Please use email rather than a public issue so a fix can ship before details are
public. We'll acknowledge your report within 3 business days, keep you updated as
we work on it, and credit you in the release notes when the fix ships (unless you
prefer otherwise). Please give us a reasonable window to fix before public
disclosure.

## Scope

- The desktop app and local agent server in this repository - including the
  permission gates, approval/reviewer flow, and audit trail. Bypasses of the
  human-only floors or approval gates (e.g. via prompt injection or a malicious
  MCP tool) are in scope and treated as high severity.
- The OAuth broker service used for managed connectors (upstream's).
- Marlo's own additions: the Qumge sign-in and gateway calls, the device-code
  authorization flow, the skills catalog install path, and the update mirror.

Out of scope: vulnerabilities in third-party model providers or connected
services themselves, and issues requiring an already-compromised machine.

## Supported versions

The latest release only. The app auto-updates, so fixes reach installs quickly -
this is also why we don't patch older versions.

There is no bug bounty program at this time.

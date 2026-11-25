---
name: typescript-security-check
description: Scan all TypeScript files in the project for security vulnerabilities (OWASP Top 10, injection, auth, crypto, data exposure), prioritize findings as high/medium/low, and provide actionable fixes. Use as a recurring security review tool for any TypeScript codebase.
---

# TypeScript Security Check

You are performing an automated security review of every TypeScript file in this project. Follow the steps below exactly.

## 1 — Discover files

Use Glob to find all `**/*.ts` and `**/*.tsx` files under the project root. Exclude `node_modules`, `dist`, and any generated output directories.

## 2 — Analyze each file

Read each file and evaluate it against the security categories below. Only report **concrete, evidence-based findings** — do not speculate or flag hypothetical issues that have no supporting code.

### Security categories to check

| Category | What to look for |
|---|---|
| **Injection** | SQL / NoSQL injection, command injection (`child_process`, `exec`, `spawn` with unsanitized input), template-literal injection, RegExp DoS |
| **XSS** | Use of `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, `eval`, `Function()`, unsanitized user input rendered in DOM or templates |
| **Authentication & Authorization** | Hard-coded credentials or API keys, missing or weak auth checks, insecure session handling, permissive CORS |
| **Sensitive data exposure** | Secrets in source, overly verbose error messages leaking internals, sensitive data logged or sent to the client |
| **Insecure dependencies / imports** | Dynamic `require`/`import` with user-controlled paths, prototype pollution patterns |
| **Cryptography** | Weak algorithms (MD5/SHA-1 for security purposes), hard-coded keys/IVs, insecure random (`Math.random` for tokens) |
| **Path traversal** | File-system operations using unsanitized user input (`fs.readFile`, `fs.writeFile`, `path.join` without validation) |
| **Server configuration** | Binding to `0.0.0.0` without intent, missing rate limiting on sensitive endpoints, disabled security headers |
| **Unsafe type assertions** | `as any`, non-null assertions (`!`) hiding potential null-reference bugs at trust boundaries |
| **Denial of service** | Unbounded loops or allocations driven by external input, missing request-size limits |

## 3 — Classify and prioritize

Assign each finding a severity:

- **HIGH** — Exploitable vulnerability that could lead to data breach, RCE, or privilege escalation. Requires immediate action.
- **MEDIUM** — Weakness that increases attack surface or could be exploited under specific conditions. Should be addressed in the next development cycle.
- **LOW** — Code smell or defense-in-depth gap with limited direct impact. Address when convenient.

## 4 — Report findings

Present a single, structured report using this format. If no issues are found in a severity tier, omit that tier.

```
## TypeScript Security Review — <project name or directory>

Scanned: <N> files | Findings: <high count> high, <medium count> medium, <low count> low

### HIGH

#### [H1] <Short title>
- **File:** `<path>:<line>`
- **Category:** <category from table>
- **Description:** <What the issue is and why it matters>
- **Evidence:** <The relevant code snippet, ≤ 10 lines>
- **Recommendation:** <Specific, actionable fix>

...

### MEDIUM
#### [M1] ...

### LOW
#### [L1] ...

## Summary & Next Steps
<2–4 sentences: overall posture, top priorities, and any structural recommendations>
```

## Rules

- Be precise: cite file paths and line numbers.
- Keep code snippets short — enough to show the issue, not the whole function.
- Do not suggest adding dependencies unless strictly necessary; prefer stdlib or built-in mitigations.
- If a finding relates to a known framework convention (e.g., `textContent` is already used instead of `innerHTML`), note it as a **positive practice** in the summary rather than flagging it.
- When the project has tests, note whether the vulnerable code path is covered by tests.
- Do NOT auto-fix code. Only recommend changes. The user decides what to apply.

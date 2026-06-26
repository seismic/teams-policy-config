# Security Policy

Thank you for helping keep **Teams Policy Config** and its users safe. This project is
maintained by Seismic and released under the MIT license. We welcome coordinated
disclosure of security vulnerabilities from the community.

> **At a glance:** Report privately via GitHub Private Vulnerability Reporting (preferred)
> or email **security@seismic.com**. Please do **not** open a public issue for a
> security problem. We aim to acknowledge submissions as soon as they come in. 

---

## Supported versions

Security fixes are provided for the **latest released version** on the default branch.
Older tagged releases and any forks or self-built copies are not maintained. If you run a
modified or downstream build, you are responsible for its security (see the MIT license
warranty disclaimer).

| Version | Supported |
|---|---|
| Latest release (default branch) | ✅ |
| Older tags | ❌ |
| Forks / modified builds | ❌ (downstream owner's responsibility) |

---

## How to report a vulnerability

Please choose **one** private channel:

1. **GitHub Private Vulnerability Reporting (preferred).**
   Go to the repository's **Security** tab → **Report a vulnerability**. This opens a
   private advisory visible only to you and the maintainers and lets us collaborate on a
   fix and request a CVE.
2. Register in our HackerOne Bug Bounty Program by emailing **security@seismic.com**. Use the subject line `[Teams Policy        Config] Vulnerability Report`. If you wish to encrypt, request our PGP key in an initial (non-sensitive) message.

**Do not** report security issues through public GitHub issues, pull requests,
discussions, or social media until a fix has been released and coordinated.

### What to include

A good report helps us triage quickly. Where possible, include:

- A clear description of the vulnerability and its security impact.
- The affected component (e.g., PowerShell command layer, Electron IPC, CI workflow,
  installer/release) and version or commit SHA.
- Step-by-step reproduction instructions and a minimal proof of concept.
- Your assessment of severity (CVSS vector welcome) and any prerequisites for exploitation.
- Whether the issue is already public or known to third parties.

---

## Our commitment (coordinated disclosure)

When you report responsibly, we will:

- **Acknowledge** your report.
- Provide an **initial triage assessment** (severity, scope, validity).
- Keep you **informed** of remediation progress at reasonable intervals.
- **Credit** you in the release notes and the published advisory if you wish (you may also
  remain anonymous).
- Coordinate a **public disclosure date** with you, typically when a fix is released.

---

## Scope

**In scope** (this repository):

- The Electron application (renderer, Node.js main process, IPC layer).
- The PowerShell execution/command layer and prerequisite-install logic.
- The device-code authentication and Azure AD / Microsoft Teams interaction code.
- This repository's GitHub Actions workflows, build, and release pipeline.
- The project's dependency declarations and lockfile.

**Out of scope:**

- Microsoft Azure AD / Entra ID, Microsoft Teams, Microsoft Graph, and the Microsoft
  Teams PowerShell module — report those to **Microsoft (MSRC)**.
- The Seismic platform, Seismic Teams app registration internals, and Seismic-hosted
  services — report those through Seismic's product security process, not this repo.
- GitHub.com platform issues — report to **GitHub**.
- Vulnerabilities only present in forks, modified builds, or out-of-date releases.
- Findings that require a pre-compromised operator workstation or that only affect the
  attacker's own machine.

When in doubt, report it privately and let us help route it.

---

## Safe harbor

We will not pursue or support legal action against researchers who:

- Make a good-faith effort to follow this policy and avoid privacy violations, data
  destruction, and service degradation.
- Only test against their **own** installations and their **own** test tenants — **never**
  against another organization's Azure AD/Teams tenant or another user's data.
- Give us a reasonable opportunity to remediate before public disclosure.

Activities inconsistent with this policy (e.g., testing against third-party tenants,
exfiltrating data, social engineering of maintainers or users) are not authorized.

---

## A note for users

- Download releases **only** from this repository's official **Releases** page and verify
  the published checksums and signatures before running installers.
- This tool makes privileged changes to your Microsoft Teams tenant; run it from a trusted
  workstation and review the actions it reports before confirming.

---

*This policy is offered in the spirit of coordinated disclosure. The software is provided
"as is", without warranty, under the MIT license.*

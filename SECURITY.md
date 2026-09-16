# Security policy

## Supported versions

Nostraxis is currently pre-1.0. Security fixes are applied to the latest release on the `main` branch.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability.

Use GitHub's **Report a vulnerability** action in the repository's Security tab to submit a private security advisory. Include:

- the affected version or commit;
- the operating system and Node.js version;
- a minimal reproduction with synthetic data;
- the expected and observed security boundary;
- the potential impact.

Do not attach real agent histories, access tokens, prompts from private projects or `.nostraxis` database files. You can expect an acknowledgement through the advisory within seven days.

## Local trust model

Nostraxis is designed to bind to `127.0.0.1`, reject unexpected host headers and keep its SQLite data on the local machine. It still processes sensitive local information:

- agent conversation histories;
- repository paths and Git metadata;
- commands and file activity from managed runs;
- short-lived provider usage responses.

Only run Nostraxis on a machine and user account you trust. Review the **Commands** and **Writes** permissions before launching a managed session. Keep the dashboard, its data directory and registered repositories out of shared or publicly served folders.

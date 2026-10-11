# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in the TypeWhisper browser extension, please report it responsibly.

**Do not open a public issue.** Instead, email security concerns to: **security@typewhisper.com**

You can also use [GitHub's private vulnerability reporting](https://github.com/TypeWhisper/typewhisper-browser-extension/security/advisories/new).

We will acknowledge your report within 48 hours and aim to provide a fix within 7 days for critical issues.

## Scope

The extension handles sensitive data including:
- The address and title of the active tab
- The TypeWhisper API token
- Access to all websites when the microphone button is turned on

Issues in these areas are especially relevant.

## Security Boundaries

- The extension sends requests only to TypeWhisper's local API on `127.0.0.1`.
- Tab addresses from private windows are never sent.
- The microphone button does not read or change field content; TypeWhisper inserts the text.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older versions | No |

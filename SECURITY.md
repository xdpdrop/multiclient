# Security

Do not include credentials, sensitive prompts or private file content in public issues. Use the repository host's private vulnerability reporting facility if enabled; otherwise ask the maintainers for a private reporting channel before sharing exploit details.

The renderer has no Node access and all IPC is schema-checked. Markdown, files, media, terminal output and provider messages are untrusted data. OS credential storage protects API keys when a secure backend is available; Linux plaintext fallback is never treated as secure storage.

The user terminal is an unrestricted local shell. Provider subprocesses run as the logged-in user and have provider-specific sandbox semantics. Multiclient is not an isolation boundary against malicious executables or compromised dependencies. Workspace trust must precede starting a CLI.

Explicitly selecting **Bypass** disables provider approval prompts and requests unrestricted native execution. It can affect files outside the workspace and perform external actions. The mode is shown in the composer, stored with the conversation, isolated from normal Code sessions and reset for new conversations. Native organizational restrictions are not overridden. API credentials are still excluded from CLI process environments.

Code mode can edit files and execute commands. Native approval requests are routed to allow-once/deny cards; broad grants and unsupported requests are denied. Ask and Plan do not enable editing. Codex edit/deletion approval tests passed on Windows; Claude and Cursor have protocol coverage but no successful live write verification yet. Native policies and inherited rules affect approval coverage. Full cross-platform write-permission certification remains a public-release gate; see the provider compatibility documentation.

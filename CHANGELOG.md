# Changelog

## [0.1.1] - 2026-10-26

Tested with Claude Code 2.1.310.

### Changed

- Every call to the Claude Code engine now lives in `hooks/register.tsx`, where the plugin directory reads them. What the plugin shows and does is unchanged.
- `plugin.json` names the support, documentation and privacy policy links, and the README says in a Privacy section what the plugin reads, which program it runs and that it sends nothing.

## [0.1.0] - 2026-10-25

Tested with Claude Code 2.1.310.

### Added

- **Time on your messages**: the date and time each of your messages was sent, on the right of the message, read from the session's transcript so a session resumed with `/resume` shows the same time as it did live. Date format, 24 or 12-hour clock, and whether today's messages show the date, in `/config`.
- **Frame around your messages**: a frame in a color of your theme, so your messages stand out from Claude's replies in the light and the dark theme. Border style and color in `/config`.
- **Last message line**: `last message 10:29 · 2h ago` at the end of the hint line under the prompt, counted on every minute.

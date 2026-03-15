# oh-my-claudecode v4.8.2: Major Hotfixes

## Release Notes

Hotfix release addressing **CCG skill nesting**, **team runtime enhancements**, **ralph/ralplan hook reliability**, **dead code cleanup**, and **deep-interview convergence tracking**.

### Hotfixes

- **fix(ccg): use CLI-first path for ask advisors** — Skill nesting is unsupported in Claude Code; CCG now routes advisor calls through the CLI path instead. (#1662)
- **fix(hooks): fix ralph/ralplan stop hook not auto-continuing** — Stop hooks now correctly resume ralph/ralplan iterations instead of halting. (#1660)
- **fix: remove dead code from deprecated features** — Cleaned up unused code paths from previously deprecated functionality. (#1659)

### Enhancements

- **feat(team): backport 6 OMX team runtime enhancements** — Brings team worker stability, mailbox handling, shell affinity, and allocation improvements from OMX upstream. (#1658, #1540)
- **feat(deep-interview): add ontology convergence tracking** — Inspired by Q00/ouroboros, adds mathematical convergence metrics to deep-interview sessions. (#1657)

### Install / Update

```bash
npm install -g oh-my-claude-sisyphus@4.8.2
```

Or reinstall the plugin:

```bash
claude /install-plugin oh-my-claudecode
```

**Full Changelog**: https://github.com/Yeachan-Heo/oh-my-claudecode/compare/v4.8.1...v4.8.2

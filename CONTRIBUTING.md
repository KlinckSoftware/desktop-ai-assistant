# Contributing

Thanks for your interest in Desktop AI Assistant. This is an Electron +
TypeScript + React app maintained by Klinck Software LLC. Contributions,
bug reports, and ideas are welcome.

## Dev setup

Requires Node 20+.

```
git clone https://github.com/<org>/desktopAI.git
cd desktopAI
npm install          # postinstall rebuilds native modules (node-pty, keytar) for Electron
npm run dev          # electron-vite dev with HMR
```

If native module rebuilds fail after switching Node/Electron versions, run
`npm run rebuild`.

Useful scripts (see `package.json`):

```
npm run typecheck    # tsc — node + web projects
npm test             # vitest unit tests
npm run test:watch   # vitest watch mode
npm run dist:win     # NSIS installer (close the dev app first — native file locks)
```

## Before opening a PR

1. `npm run typecheck` and `npm test` must pass locally.
2. Keep changes scoped — prefer several small PRs over one large one.
3. If you touch a security-relevant path (`CommandBroker`, `FileEditBroker`,
   `ToolBroker`, `ApprovalPolicy`, `WorktreeManager`, anything under
   `src/shared/protectedPath.ts` or `src/shared/dangerousCommand.ts`), say so in
   the PR description and explain the trust-boundary impact — see
   [SECURITY.md](SECURITY.md) for the model these gates enforce.
4. Add/update tests alongside behavior changes (Vitest; see the many
   `*.test.ts`/`*.test.tsx` files for the existing style — unit tests colocated
   with the module they cover).

## Branch / commit conventions

- Branch names: `type/short-description` (e.g. `feat/pipeline-retry`,
  `fix/worktree-prune-race`). Types: `feat`, `fix`, `refactor`, `chore`, `test`,
  `docs`.
- Commit messages: short imperative subject line; a body explaining *why* when
  the reasoning isn't obvious from the diff.
- Keep PRs flat against `main` where possible — avoid deep stacked branches.

## Code style

- TypeScript throughout; keep `strict` settings in `tsconfig*.json` satisfied.
- Main-process code (`src/main`) is trusted and gates all side effects; renderer
  code (`src/renderer`) talks to main only through the typed `window.api`
  bridge (`src/preload`) — never add a direct Node/IPC escape hatch to the
  renderer.
- React function components + hooks; Tailwind for styling; Zustand for
  renderer-side state (`src/renderer/src/store`).
- Match existing formatting/structure in the file you're editing rather than
  introducing a new pattern.

## Sign-off (DCO)

By submitting a contribution, you certify that you wrote it (or have the right
to submit it) under the project's [Apache License 2.0](LICENSE), per the
[Developer Certificate of Origin](https://developercertificate.org/). Please
add a `Signed-off-by` trailer to your commits:

```
git commit -s -m "your message"
```

## Reporting bugs

Open a GitHub issue with repro steps, expected vs. actual behavior, and your
OS/Node/Electron versions. For **security** issues, do not open a public issue
— follow the private disclosure process in [SECURITY.md](SECURITY.md).

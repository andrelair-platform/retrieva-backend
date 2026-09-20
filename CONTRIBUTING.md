# Contributing

## Branch conventions

Trunk-based (environments ≠ branches). `main` is the only deploy branch — Kargo promotes the
`main` image dev→prod.

| Branch | Rules |
|---|---|
| `main` | PR required. GPG-signed commits. cosign + SBOM on the image. |
| `feat/…` `fix/…` `docs/…` `chore/…` | Short-lived feature branches → PR → `main` (auto-deleted on merge). |

## Commit style

Conventional Commits (`type(scope): message`), enforced by commitlint.
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`, `ci`, `build`, `revert`.

```
feat(rag): evidence-grounded verdict with citations
fix(auth): reject expired refresh token
```

## PR requirements

- All CI checks (`ci.yml`) must pass before merge.
- `main` PRs require GPG-signed commits (key `FD6D39D681DEFA34`).
- No `Co-Authored-By` lines — commits represent the portfolio owner's work.

## ESM / NodeNext gotcha

The repo is Node ESM (`"type": "module"`) on `moduleResolution: nodenext`. Relative imports
need an explicit `.js` extension **even in `.ts` source** (`import { x } from './foo.js'`). The
`.js`→`.ts` conversion is tracked in RTV-21..24; until then the code is JavaScript type-checked
loosely under `allowJs`.

## Running tests locally

```bash
npm ci --legacy-peer-deps
npm run lint
npm run typecheck        # tsc --noEmit (allowJs baseline)
npm run test             # vitest unit + integration (integration uses testcontainers → needs Docker)
npm run test:unit        # unit only
```

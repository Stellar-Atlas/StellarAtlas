# Dependency security update — 2026-09-07

## Evidence and scope

GitHub's push notice reported 27 open dependency alerts. The reproducible
`pnpm audit --json` baseline for this checkout reported 23 advisories:
3 critical, 16 high, 3 moderate, and 1 low. These counts are different views;
this change does not claim the GitHub alerts have closed before push/reanalysis.

All three critical advisories affect `vm2 <=3.11.5`:

- [Host builtin exposure](https://github.com/advisories/GHSA-m5w8-4gq2-6f8x).
- [Error.cause sandbox escape](https://github.com/advisories/GHSA-m283-3h24-438v).
- [Host prototype-mutator escape](https://github.com/advisories/GHSA-cfcw-xp6x-25gj).

The dependency path is `packages/shared -> typescript-json-schema -> vm2`.
`typescript-json-schema` is a development dependency in
`packages/shared/package.json`; repository source searches found no direct
runtime imports of it or `vm2`. This is an installed build-tool risk, not
evidence that a public endpoint was accepting sandbox code.

## Targeted fixes

Workspace overrides retain compatible release lines for `vm2 3.11.6`,
`fast-uri 3.1.6`, `brace-expansion 1.1.18/2.1.4/5.0.9`,
`js-yaml 3.15.1`, `qs 6.16.0`, `browserslist 4.28.7`,
`nanoid 3.3.18`, and `@humanfs/node 0.16.8`. Transitive support packages
required by those versions are recorded in the lockfile.

The backend's `toml` requirement moves from `^3.0.0` to `^4.2.0`,
resolved by the lockfile to 4.3.0. This deliberately scoped major update is
necessary for the upstream prototype-pollution and nesting-depth fixes.
It retains the CommonJS `parse` API and supports our Node 26 runtime.
`TomlService.ts` parses fetched stellar.toml metadata, so this package has
a real network-input path. `qs` is also used by Express/body-parser;
`fast-uri` is consumed by AJV schema validation.

## Verification and remaining alert

The updated lockfile's audit reports **0 critical, 0 high, 0 moderate, 1 low**.
The remaining low-severity
[Vue 2 parser ReDoS](https://github.com/advisories/GHSA-5j4c-8p2g-v4jx)
belongs to `apps/frontend`, the legacy Vue application, not the production
`apps/frontend-v4` Next.js application. Replacing Vue 2 with Vue 3 is a
separate application migration; this update neither suppresses that alert
nor pretends that a compatible security patch exists.

Focused regression command:
`node --test scripts/dependency-security.test.mjs`.
Existing parser compatibility suites are `TomlService`, `NodeTomlFetcher`,
and `OrganizationTomlFetcher`. All five security regressions and 25 tests
across those three suites plus the archive-failure DTO suite passed after the
frozen installation completed. A final audit retained the counts above.
The security changes require the normal
coordinated build/release; installing dependencies alone does not prove that
every running process has loaded the fixed versions.

## Install path compatibility

The initial VM install was interrupted gracefully after NFS metadata operations
made extraction extremely slow. Both installer processes were confirmed exited
before the same frozen install continued directly on the host's existing
`/mnt/bulk/stellarbeat-data/Observer` backing directory.

The host now has one compatibility alias:
`/home/observe/stellarbeat-data -> /mnt/bulk/stellarbeat-data`.
The alias and native paths were verified to address the identical repository
and pnpm-store inodes. This preserves pnpm's existing absolute store path in
`node_modules/.modules.yaml`; it is not a copied source tree or a separate
deployment. The VM remains the source editing location. Both environments
use UID 1000, Node 26.5.1 and pnpm 10.12.1.

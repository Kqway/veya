# Next ESLint directory roots

This development-only adapter replaces the sole `fast-glob` call in
`@next/eslint-plugin-next` 16.3.8: `globSync(pattern, {onlyDirectories: true})`.
The former dependency includes `braces` affected by GHSA-vfj7-8cjw-p6xm;
there was no patched upstream release on 2026-10-03.

The adapter uses pinned `tinyglobby`, disables its default recursive directory
expansion to preserve Next's root selection, and rejects brace nesting beyond
64 before parsing. It is not a general replacement for the fast-glob API.
Regression tests exercise the actual Next plugin utility, including configured
literal, wildcard, brace and array roots. All Next ESLint rules remain enabled.

Recheck this narrow dependency override when upgrading Next's lint plugin;
remove it when the upstream dependency chain is safe.

The scoped override's relative file path is resolved from the installed
`node_modules/@next/eslint-plugin-next` directory by npm. `.npmrc` enables
`install-links` so npm copies the package instead of creating a symlink.
The Docker dependency stage copies the adapter and this npm setting before
`npm ci`; both clean installs and container builds exercise this resolution.

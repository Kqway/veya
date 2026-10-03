import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Context = { cwd: string; settings: { next?: { rootDir?: string | string[] } } };
const { getRootDirs } = require("@next/eslint-plugin-next/dist/utils/get-root-dirs") as {
  getRootDirs: (context: Context) => string[];
};
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "veya-lint-roots-"));
  directories.push(directory);
  for (const name of ["app-a", "app-b"]) mkdirSync(join(directory, name, "nested", "app"), { recursive: true });
  writeFileSync(join(directory, "app-file"), "not a directory");
  return directory;
}
it("preserves the default Next lint root without expanding descendants", () => {
  const directory = fixture();
  expect(getRootDirs({ cwd: directory, settings: {} })).toEqual([directory]);
});
it("preserves configured literal, brace and array directory roots without recursive expansion or files", () => {
  const directory = fixture();
  const a = join(directory, "app-a"), b = join(directory, "app-b");
  const cases: [string | string[], string[]][] = [
    [a, [a]],
    [`${a}/`, [a]],
    [join(directory, "app-*"), [a, b]],
    [join(directory, "{app-a,app-b}"), [a, b]],
    [[a, b], [a, b]],
  ];
  for (const [rootDir, expected] of cases)
    expect(getRootDirs({ cwd: directory, settings: { next: { rootDir } } }).map(root => resolve(root)).sort()).toEqual(expected.sort());
});
it("rejects excessive brace nesting before glob parsing without exhausting the stack", () => {
  const directory = fixture();
  const rootDir = join(directory, "{".repeat(4000) + "app-a,app-b" + "}".repeat(4000));
  expect(() => getRootDirs({ cwd: directory, settings: { next: { rootDir } } }))
    .toThrow("Root glob nesting exceeds 64.");
});

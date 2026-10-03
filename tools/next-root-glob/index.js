import { globSync as tinyGlobSync } from "tinyglobby";

// This adapter implements only the directory-root call used by Next's ESLint
// plugin. Avoid expanding literal directories into every descendant root.
export function globSync(pattern, options) {
  let depth = 0;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === "\\") { i++; continue; }
    if (pattern[i] === "{" && ++depth > 64)
      throw new Error("Root glob nesting exceeds 64.");
    if (pattern[i] === "}") depth = Math.max(0, depth - 1);
  }
  return tinyGlobSync(pattern, { ...options, expandDirectories: false });
}

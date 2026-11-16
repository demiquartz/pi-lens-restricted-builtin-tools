// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Takaaki Sato
/**
 * pi-lens-restricted-builtin-tools Extension
 *
 * Registers restricted versions of the built-in `write`, `read`, and `edit`
 * tools that complement pi-lens:
 *
 * - `write`: create a new file, or overwrite an existing file with fewer than
 *   64 lines (any format).
 * - `read`:  read a file that pi-lens does NOT support (prose, config, ...).
 *   Rejects pi-lens-supported formats (code, JSON, YAML).
 * - `edit`:  edit a file that pi-lens does NOT support via exact text
 *   replacement. Rejects pi-lens-supported formats.
 *
 * All tools are confined to the workspace: relative paths only, no absolute
 * paths, no `~`-prefixed paths, no `..` segments, no trailing slashes, and no
 * symlink escapes.
 *
 * `read`/`edit` reject pi-lens formats so that code/JSON/YAML go through
 * pi-lens (read_symbol / module_report / ast_grep_replace). Together with
 * pi-lens, these tools cover all files without overlap.
 */
import { type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";

/** Existing files with fewer than this many lines may be overwritten by `write`. */
const MAX_OVERWRITE_LINES = 64;

/** Maximum lines returned by `read` in a single call. */
const MAX_READ_LINES = 2000;

/**
 * File extensions supported by pi-lens (its AST languages). `read` and `edit`
 * reject these so that code/JSON/YAML are handled by pi-lens instead.
 */
const LENS_EXTENSIONS = new Set([
  "sh", "bash", "zsh", "ksh", // bash
  "c", "h", // c
  "cpp", "cc", "cxx", "hpp", "hxx", // cpp
  "cs", // csharp
  "css", // css
  "ex", "exs", // elixir
  "go", // go
  "hs", // haskell
  "html", "htm", // html
  "java", // java
  "js", "mjs", "cjs", // javascript
  "json", // json
  "kt", "kts", // kotlin
  "lua", // lua
  "nix", // nix
  "php", // php
  "py", // python
  "rb", // ruby
  "rs", // rust
  "scala", // scala
  "swift", // swift
  "tsx", // tsx
  "ts", // typescript
  "yaml", "yml", // yaml
]);

export default function restrictedBuiltinToolsExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "write",
    label: "Safe Write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does (only if the existing " +
      `file has fewer than ${MAX_OVERWRITE_LINES} lines). Automatically creates parent directories. ` +
      "Workspace-relative paths only: no absolute paths, no ~-prefixed paths, no '..' segments, no trailing slashes.",
    promptSnippet: `Create or overwrite files (overwrite only if the existing file is under ${MAX_OVERWRITE_LINES} lines)`,
    promptGuidelines: ["Use write only for new files or complete rewrites."],
    parameters: Type.Object({
      path: Type.String({
        description:
          "Workspace-relative path of the file to write. Absolute paths, ~-prefixed paths, '..' segments, " +
          "and trailing slashes are rejected.",
      }),
      content: Type.String({
        description: "Content to write to the file",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { rel, target } = resolveWorkspacePath(params.path, ctx.cwd);

      let overwrittenLines: number | undefined;

      await withFileMutationQueue(target, async () => {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });

        let existing: fs.Stats | null = null;
        try {
          existing = await fs.promises.stat(target);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }

        if (existing) {
          if (existing.isDirectory()) {
            throw new Error(`path already exists: ${rel}`);
          }
          const existingContent = await fs.promises.readFile(target, "utf-8");
          const lines = countLines(existingContent);
          if (lines >= MAX_OVERWRITE_LINES) {
            throw new Error(
              `path already exists: ${rel} (existing file has ${lines} lines, overwriting is only allowed for ` +
                `files with fewer than ${MAX_OVERWRITE_LINES} lines)`,
            );
          }
          await fs.promises.writeFile(target, params.content, "utf-8");
          overwrittenLines = lines;
        } else {
          try {
            await fs.promises.writeFile(target, params.content, { encoding: "utf-8", flag: "wx" });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") {
              throw new Error(`path already exists: ${rel}`);
            }
            throw error;
          }
        }
      });

      let text: string;
      if (overwrittenLines !== undefined) {
        text = `Overwrote file: ${rel} (existing file had ${overwrittenLines} line${overwrittenLines === 1 ? "" : "s"})`;
      } else {
        text = `Created file: ${rel}`;
      }

      return {
        content: [{ type: "text", text }],
        details: { path: rel, overwritten: overwrittenLines !== undefined, previousLines: overwrittenLines },
      };
    },
  });

  pi.registerTool({
    name: "read",
    label: "Restricted Read",
    description:
      "Read a file that pi-lens does not support (prose, config, and other non-code text). Rejects files in " +
      "pi-lens-supported formats (code, JSON, YAML) — use read_symbol or module_report for those. " +
      "Workspace-relative paths only: no absolute paths, no ~-prefixed paths, no '..' segments, no trailing slashes.",
    promptSnippet: "Read non-lens files (prose/config). Use read_symbol/module_report for code.",
    parameters: Type.Object({
      path: Type.String({
        description:
          "Workspace-relative path of the file to read. Must be a format pi-lens does not support. " +
          "Absolute paths, ~-prefixed paths, '..' segments, and trailing slashes are rejected.",
      }),
      offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
      limit: Type.Optional(Type.Number({ description: `Maximum number of lines to read (default ${MAX_READ_LINES})` })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { rel, target } = resolveWorkspacePath(params.path, ctx.cwd);
      assertNotLensFormat(rel);

      let content: string;
      try {
        content = await fs.promises.readFile(target, "utf-8");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") throw new Error(`file not found: ${rel}`);
        if (code === "EISDIR") throw new Error(`path is a directory, not a file: ${rel}`);
        throw error;
      }

      if (content === "") {
        return { content: [{ type: "text", text: "" }], details: { path: rel, total: 0 } };
      }

      const allLines = content.split("\n");
      if (content.endsWith("\n")) allLines.pop();
      const total = allLines.length;
      const start = Math.max(1, params.offset ?? 1);
      const limit = Math.min(params.limit ?? MAX_READ_LINES, MAX_READ_LINES);
      const slice = allLines.slice(start - 1, start - 1 + limit);
      const end = start + slice.length - 1;

      let text = slice.join("\n");
      if (start > 1 || end < total) {
        text = `Lines ${start}-${end} of ${total}\n${text}`;
      }

      return {
        content: [{ type: "text", text }],
        details: { path: rel, start, end, total },
      };
    },
  });

  pi.registerTool({
    name: "edit",
    label: "Restricted Edit",
    description:
      "Edit a file that pi-lens does not support (prose, config, and other non-code text) via exact text " +
      "replacement. Each oldText must match uniquely and edits must not overlap. Rejects files in " +
      "pi-lens-supported formats (code, JSON, YAML) — use ast_grep_replace for those. " +
      "Workspace-relative paths only: no absolute paths, no ~-prefixed paths, no '..' segments, no trailing slashes.",
    promptSnippet: "Edit non-lens files (prose/config) by exact text replacement. Use ast_grep_replace for code.",
    parameters: Type.Object({
      path: Type.String({
        description:
          "Workspace-relative path of the file to edit. Must be a format pi-lens does not support. " +
          "Absolute paths, ~-prefixed paths, '..' segments, and trailing slashes are rejected.",
      }),
      edits: Type.Array(
        Type.Object({
          oldText: Type.String({ description: "Exact text to find (must match uniquely in the file)" }),
          newText: Type.String({ description: "Replacement text" }),
        }),
        { description: "One or more edits to apply. Each oldText must match uniquely; edits must not overlap." },
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { rel, target } = resolveWorkspacePath(params.path, ctx.cwd);
      assertNotLensFormat(rel);

      if (params.edits.length === 0) throw new Error("at least one edit is required");

      await withFileMutationQueue(target, async () => {
        let original: string;
        try {
          original = await fs.promises.readFile(target, "utf-8");
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === "ENOENT") throw new Error(`file not found: ${rel}`);
          if (code === "EISDIR") throw new Error(`path is a directory, not a file: ${rel}`);
          throw error;
        }

        const matches: { start: number; end: number; newText: string }[] = [];
        for (let i = 0; i < params.edits.length; i++) {
          const { oldText, newText } = params.edits[i];
          const count = countOccurrences(original, oldText);
          if (count === 0) {
            throw new Error(`edit ${i + 1}: oldText not found in file`);
          }
          if (count > 1) {
            throw new Error(`edit ${i + 1}: oldText matches ${count} times; provide a more specific oldText`);
          }
          const start = original.indexOf(oldText);
          matches.push({ start, end: start + oldText.length, newText });
        }

        matches.sort((a, b) => a.start - b.start);
        for (let i = 1; i < matches.length; i++) {
          if (matches[i].start < matches[i - 1].end) {
            throw new Error("edits overlap; make them non-overlapping");
          }
        }

        let updated = original;
        for (let i = matches.length - 1; i >= 0; i--) {
          const m = matches[i];
          updated = updated.slice(0, m.start) + m.newText + updated.slice(m.end);
        }

        await fs.promises.writeFile(target, updated, "utf-8");
      });

      const n = params.edits.length;
      return {
        content: [{ type: "text", text: `Edited file: ${rel} (${n} change${n === 1 ? "" : "s"})` }],
        details: { path: rel, edits: n },
      };
    },
  });
}

/** Strip leading '@' (some models prefix tool paths) and surrounding whitespace. */
function normalizePathInput(raw: string): string {
  let value = raw.trim();
  if (value.startsWith("@")) value = value.slice(1).trim();
  return value;
}

/** Validate a workspace-relative path and return its relative form and absolute target. */
function resolveWorkspacePath(raw: string, cwd: string): { rel: string; target: string } {
  const rel = normalizePathInput(raw);
  if (!rel) throw new Error("path must not be empty");
  if (path.isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel)) {
    throw new Error(`absolute paths are not allowed, use a workspace-relative path: ${raw}`);
  }
  if (rel.startsWith("~")) {
    throw new Error(`home-relative paths are not allowed, use a workspace-relative path: ${raw}`);
  }
  if (rel.split(/[\\/]/).includes("..")) {
    throw new Error(`'..' segments are not allowed: ${raw}`);
  }
  if (rel.endsWith("/") || rel.endsWith("\\")) {
    throw new Error(`trailing slashes are not allowed (this tool operates on files): ${raw}`);
  }
  const target = path.resolve(cwd, rel);
  assertInsideWorkspace(target, cwd);
  return { rel, target };
}

/**
 * Throw if `target` escapes the workspace root.
 * Resolves symlinks of the deepest existing ancestor so symlinked
 * intermediate directories cannot point outside the workspace.
 */
function assertInsideWorkspace(target: string, cwd: string): void {
  const workspace = fs.realpathSync(cwd);
  let current = target;
  for (;;) {
    let exists = true;
    try {
      fs.statSync(current);
    } catch {
      exists = false;
    }
    if (exists) {
      const real = fs.realpathSync(current);
      if (real !== workspace && !real.startsWith(workspace + path.sep)) {
        throw new Error(`path resolves outside the workspace: ${target}`);
      }
      return;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`path resolves outside the workspace: ${target}`);
    }
    current = parent;
  }
}

/** Count lines: 0 for empty content, otherwise newline-terminated lines plus a final partial line. */
function countLines(content: string): number {
  if (content === "") return 0;
  let lines = 1;
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10) lines++;
  }
  if (content.endsWith("\n")) lines--;
  return lines;
}

/** Count (possibly overlapping) occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + 1);
  }
  return count;
}

/** Reject files in formats pi-lens supports, pointing to pi-lens instead. */
function assertNotLensFormat(rel: string): void {
  const ext = path.extname(rel).slice(1).toLowerCase();
  if (LENS_EXTENSIONS.has(ext)) {
    throw new Error(
      `this file (.${ext}) is supported by pi-lens; use pi-lens tools instead ` +
        `(read_symbol / module_report to read, ast_grep_replace to edit)`,
    );
  }
}

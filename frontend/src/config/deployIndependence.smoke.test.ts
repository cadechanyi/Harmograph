/**
 * Deployment smoke test (task 18.1) — the Frontend builds and deploys
 * independently of the Demucs_Service (Req 4.7, 12.1, 12.2).
 *
 * The Frontend is a separate deployment artifact: building or deploying it must
 * not require the Demucs_Service to be present or running. Rather than spawn a
 * full `next build` from inside the test runner (slow, and exercised separately
 * — see the note below), this smoke test asserts the structural guarantees that
 * make the build independent:
 *
 *   1. No Frontend source module statically imports backend code. A build-time
 *      dependency would manifest as an `import`/`require` that reaches out of
 *      `frontend/` into the `backend/` tree (or its Python sources). Such an
 *      import would couple the build to the service.
 *   2. The Frontend reaches the Demucs_Service only through the configurable
 *      runtime endpoint (`NEXT_PUBLIC_DEMUCS_ENDPOINT`), never by importing it.
 *   3. The package defines a standalone production build command (`next build`)
 *      and declares itself independently deployable.
 *
 * NOTE ON FULL BUILD VERIFICATION: an actual production build is verified out
 * of band by running `npm run build` once (it completes with no backend present
 * or running). The full Next.js build is intentionally not invoked from within
 * Vitest because it is heavy and spawns its own toolchain; this mirrors how the
 * browser-only suites document jsdom limits rather than booting a real browser.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, "..", ".."); // .../frontend
const srcRoot = join(frontendRoot, "src");
const appRoot = join(frontendRoot, "app");

/** Recursively collect all TypeScript/TSX source files under a directory. */
function collectSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if ([".ts", ".tsx"].includes(extname(full))) out.push(full);
  }
  return out;
}

/** Extract the module specifier from every static import/require/dynamic import. */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g, // import x from "..."
    /import\s+['"]([^'"]+)['"]/g, // import "..."
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import("...")
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // require("...")
    /export\s+[^'"]*from\s+['"]([^'"]+)['"]/g, // export ... from "..."
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specifiers.push(m[1]);
  }
  return specifiers;
}

describe("deployment smoke: Frontend builds independently of the Demucs_Service (Req 4.7, 12.1, 12.2)", () => {
  const sourceFiles = [
    ...collectSourceFiles(srcRoot),
    ...collectSourceFiles(appRoot),
  ].filter((f) => !/\.(test|spec)\.[tj]sx?$/.test(f));

  it("finds Frontend source to scan", () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it("no source module statically imports the backend / Demucs_Service code", () => {
    const offenders: { file: string; specifier: string }[] = [];

    for (const file of sourceFiles) {
      const source = readFileSync(file, "utf8");
      for (const spec of extractImportSpecifiers(source)) {
        // A relative import that escapes the frontend dir, or any specifier
        // pointing at the backend tree / a Python module, is a build-time
        // coupling to the service.
        const reachesBackend =
          /(^|\/)backend(\/|$)/.test(spec) ||
          /modal_app|fastapi|uvicorn|demucs_service/i.test(spec) ||
          spec.endsWith(".py");

        if (reachesBackend) {
          offenders.push({ file, specifier: spec });
          continue;
        }

        // Resolve relative imports and ensure they stay inside frontend/.
        if (spec.startsWith(".")) {
          const resolved = resolve(dirname(file), spec);
          if (!resolved.startsWith(frontendRoot)) {
            offenders.push({ file, specifier: spec });
          }
        }
      }
    }

    expect(
      offenders,
      `Frontend source must not import backend code. Offenders: ${JSON.stringify(
        offenders,
        null,
        2,
      )}`,
    ).toEqual([]);
  });

  it("reaches the Demucs_Service only through the configurable runtime endpoint", () => {
    const appConfigSource = readFileSync(
      join(srcRoot, "config", "appConfig.ts"),
      "utf8",
    );
    // The endpoint is read from a public env var (configurable at deploy time),
    // not imported from the backend.
    expect(appConfigSource).toContain("NEXT_PUBLIC_DEMUCS_ENDPOINT");
    expect(appConfigSource).toMatch(/demucsEndpoint/);
  });

  it("declares a standalone production build command and independent artifact", () => {
    const pkg = JSON.parse(
      readFileSync(join(frontendRoot, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, string>;
      description?: string;
      dependencies?: Record<string, string>;
    };

    // A self-contained Next.js production build — no backend orchestration.
    expect(pkg.scripts?.build).toBe("next build");
    // The build toolchain is Next.js, owned entirely by the Frontend artifact.
    expect(pkg.dependencies?.next).toBeTruthy();
    // Documented as independently deployable.
    expect((pkg.description ?? "").toLowerCase()).toContain(
      "independently deployable",
    );
  });
});

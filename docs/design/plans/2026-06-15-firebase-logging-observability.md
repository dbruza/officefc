# Firebase Logging & Performance Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured backend logging, an authenticated client→Cloud Logging sink, best-effort client error capture, and latency instrumentation on the slow read paths.

**Architecture:** Pure, unit-testable cores (error classification, payload sanitization, rate-limit, buffering, timing) separated from thin Firebase/React-Native glue. Backend callables adopt a `loggedOnCall` wrapper; the client logs locally everywhere and forwards `warn`/`error` to an authenticated `ingestLog` callable that re-emits into Google Cloud Logging.

**Tech Stack:** TypeScript, Firebase Functions v2 (`firebase-functions/logger`), Firebase JS SDK v10, Expo / React Native, `node:test` (functions, already in use) + `tsx` + `node:test` (new mobile runner).

**Spec:** [docs/design/specs/2026-06-15-firebase-logging-observability-design.md](../specs/2026-06-15-firebase-logging-observability-design.md)

---

## File Structure

**Backend (`functions/`)**
- Create `functions/src/logging.ts` — `classifyCallableError`, `instrumentCallable`, `loggedOnCall`.
- Create `functions/src/clientLogs.ts` — `ingestLog` callable (glue).
- Create `functions/src/clientLogs/sanitize.ts` — pure `sanitizeLogBatch`.
- Create `functions/src/clientLogs/rateLimit.ts` — pure `checkRateLimit`.
- Create tests `functions/test/logging.test.js`, `functions/test/clientLogs.test.js`.
- Modify each domain module to use `loggedOnCall`; modify `functions/src/index.ts` to export `ingestLog`; replace `console.*` in `scheduled.ts` and `notify.ts`.

**Client (`mobile/`)**
- Create `mobile/src/lib/logger/core.ts` — pure: levels, `sanitizeContext`, `LogBuffer`, `isSlow`.
- Create `mobile/src/lib/logger/index.ts` — adapter: console + buffer + `flush` + `timed` + context setters.
- Create `mobile/src/lib/logger/globalHandler.ts` — `installGlobalErrorLogging`.
- Create `mobile/src/components/LogErrorBoundary.tsx` — render-error boundary.
- Create `mobile/src/lib/logger/core.test.ts` — pure-core tests.
- Modify `mobile/package.json` (test runner), `mobile/src/lib/league.ts` (instrument reads), `mobile/src/lib/auth.tsx` (`auth_bootstrap_ready` + uid context), `mobile/app/_layout.tsx` (route context + global handler + boundary), `mobile/.env.example` (flag).

---

## Phase 1 — Backend structured logging

### Task 1: `loggedOnCall` factory + error classification

**Files:**
- Create: `functions/src/logging.ts`
- Test: `functions/test/logging.test.js`

- [ ] **Step 1: Write the failing test**

```js
// functions/test/logging.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { HttpsError } = require("firebase-functions/v2/https");
const { classifyCallableError, instrumentCallable } = require("../lib/logging.js");

function makeFakeLog(calls) {
  const rec = (level) => (...args) => calls.push({ level, args });
  return { debug: rec("debug"), info: rec("info"), warn: rec("warn"), error: rec("error") };
}

test("classifyCallableError: expected HttpsError is a rejection", () => {
  assert.deepEqual(classifyCallableError(new HttpsError("invalid-argument", "bad")), {
    outcome: "rejected",
    code: "invalid-argument",
  });
});

test("classifyCallableError: unknown HttpsError code is a server error", () => {
  assert.deepEqual(classifyCallableError(new HttpsError("internal", "boom")), { outcome: "error" });
});

test("classifyCallableError: non-HttpsError is a server error", () => {
  assert.deepEqual(classifyCallableError(new Error("kaboom")), { outcome: "error" });
});

test("instrumentCallable logs one ok completion and returns the result", async () => {
  const calls = [];
  let t = 1000;
  const wrapped = instrumentCallable("demo", async () => ({ ok: true }), {
    log: makeFakeLog(calls),
    now: () => (t += 5),
  });
  const result = await wrapped({ auth: { uid: "u1" } });
  assert.deepEqual(result, { ok: true });
  const done = calls.find((c) => c.level === "info" && c.args[0] === "callable_done");
  assert.equal(done.args[1].fn, "demo");
  assert.equal(done.args[1].uid, "u1");
  assert.equal(done.args[1].outcome, "ok");
  assert.equal(typeof done.args[1].durationMs, "number");
});

test("instrumentCallable logs expected rejection at warn and rethrows", async () => {
  const calls = [];
  const wrapped = instrumentCallable(
    "demo",
    async () => {
      throw new HttpsError("permission-denied", "no");
    },
    { log: makeFakeLog(calls), now: () => 0 },
  );
  await assert.rejects(() => wrapped({ auth: { uid: "u1" } }), /no/);
  const warn = calls.find((c) => c.level === "warn");
  assert.equal(warn.args[1].outcome, "rejected");
  assert.equal(warn.args[1].code, "permission-denied");
  assert.ok(!calls.some((c) => c.level === "error"));
});

test("instrumentCallable logs unexpected error at error severity, passing the real Error", async () => {
  const calls = [];
  const boom = new Error("kaboom");
  const wrapped = instrumentCallable("demo", async () => {
    throw boom;
  }, { log: makeFakeLog(calls), now: () => 0 });
  await assert.rejects(() => wrapped({ auth: null }), /kaboom/);
  const err = calls.find((c) => c.level === "error");
  assert.equal(err.args[0], boom); // real Error → stack preserved by Cloud Logging
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix functions run build && node --test functions/test/logging.test.js`
Expected: FAIL — `Cannot find module '../lib/logging.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// functions/src/logging.ts
import {
  onCall,
  HttpsError,
  type CallableRequest,
  type CallableOptions,
} from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

/** Functions error codes we treat as *expected* client-facing rejections, not server faults. */
const EXPECTED_CODES = new Set([
  "invalid-argument",
  "failed-precondition",
  "out-of-range",
  "not-found",
  "already-exists",
  "permission-denied",
  "unauthenticated",
]);

export type CallableOutcome =
  | { outcome: "rejected"; code: string }
  | { outcome: "error" };

/** Pure: decide how a thrown value should be logged. */
export function classifyCallableError(error: unknown): CallableOutcome {
  if (error instanceof HttpsError && EXPECTED_CODES.has(error.code)) {
    return { outcome: "rejected", code: error.code };
  }
  return { outcome: "error" };
}

type LoggerLike = {
  debug: (...a: unknown[]) => void;
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
};

interface InstrumentDeps {
  log?: LoggerLike;
  now?: () => number;
}

/**
 * Wrap a callable handler with ONE structured completion log + error classification.
 * Entry logging is debug-only (the runtime already emits request logs with trace IDs).
 */
export function instrumentCallable<T, R>(
  name: string,
  handler: (req: CallableRequest<T>) => R | Promise<R>,
  deps: InstrumentDeps = {},
): (req: CallableRequest<T>) => Promise<R> {
  const log = deps.log ?? logger;
  const now = deps.now ?? Date.now;
  return async (req: CallableRequest<T>): Promise<R> => {
    const start = now();
    const uid = req.auth?.uid ?? null;
    log.debug("callable_start", { fn: name, uid });
    try {
      const result = await handler(req);
      log.info("callable_done", { fn: name, uid, durationMs: now() - start, outcome: "ok" });
      return result;
    } catch (error) {
      const durationMs = now() - start;
      const classified = classifyCallableError(error);
      if (classified.outcome === "rejected") {
        log.warn("callable_done", {
          fn: name,
          uid,
          durationMs,
          outcome: "rejected",
          code: classified.code,
        });
      } else {
        // Pass the real Error first so Cloud Logging keeps the original stack.
        log.error(error instanceof Error ? error : new Error(String(error)), {
          event: "callable_failed",
          fn: name,
          uid,
          durationMs,
        });
      }
      throw error;
    }
  };
}

/** Drop-in for `onCall` that adds structured logging. Use INSIDE domain modules. */
export function loggedOnCall<T = unknown, R = unknown>(
  name: string,
  options: CallableOptions,
  handler: (req: CallableRequest<T>) => R | Promise<R>,
) {
  return onCall<T>(options, instrumentCallable(name, handler));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix functions run build && node --test functions/test/logging.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add functions/src/logging.ts functions/test/logging.test.js
git commit -m "feat(functions): loggedOnCall wrapper with error classification"
```

---

### Task 2: Adopt `loggedOnCall` in every callable + replace `console.*`

There are 19 `onCall(...)` sites. The edit is mechanical and identical:
`onCall(OPTIONS, HANDLER)` → `loggedOnCall("<exportName>", OPTIONS, HANDLER)`, plus an import.

**Files (modify):** `joinCodes.ts`, `membership.ts`, `teams.ts`, `matchLifecycle.ts`, `readModels.ts`, `seasonAdmin.ts`, `extract/abandonMatchDraft.ts`, `extract/getMatchPhotoUrl.ts`, `extract/submitAiAssistedMatch.ts`, `extract/extractMatchStats.ts`, `scheduled.ts`, `notify.ts`.

- [ ] **Step 1: Worked example — `functions/src/joinCodes.ts`**

Change the import line `import { onCall, HttpsError } from "firebase-functions/v2/https";` to:

```ts
import { HttpsError } from "firebase-functions/v2/https";
import { loggedOnCall } from "./logging";
```

Then convert both callables (note `loggedOnCall` keeps the **same options object**):

```ts
export const getSeasonJoinCode = loggedOnCall("getSeasonJoinCode", { cors: true }, async (req) => {
  // ... body unchanged ...
});

export const rotateSeasonJoinCode = loggedOnCall(
  "rotateSeasonJoinCode",
  { cors: true },
  async (req) => {
    // ... body unchanged ...
  },
);
```

- [ ] **Step 2: Apply the identical change to the remaining callables**

Use the export name as the logging name. Exact sites (file → export):

```
membership.ts            → redeemInvite, ensureLeagueSetup
teams.ts                 → seedTeams
matchLifecycle.ts        → confirmMatch, disputeMatch, deleteMatchPhoto
readModels.ts            → rebuildLeagueReadModels
seasonAdmin.ts           → finalizeSeason, createSeason, activateSeason, manageTeam, resolveMatch, listSeasons
extract/abandonMatchDraft.ts   → abandonMatchDraft
extract/getMatchPhotoUrl.ts    → getMatchPhotoUrl
extract/submitAiAssistedMatch.ts → submitAiAssistedMatch
```

For modules that no longer reference `onCall` directly, drop `onCall` from the `firebase-functions/v2/https` import (keep `HttpsError` etc.) and add `import { loggedOnCall } from "./logging";` (extract modules use `../logging`).

**Secrets are forwarded** — `extract/extractMatchStats.ts` keeps its options object intact:

```ts
// import line: remove onCall, add loggedOnCall (note: from "../logging")
import { loggedOnCall } from "../logging";
// ...
export const extractMatchStats = loggedOnCall(
  "extractMatchStats",
  { cors: true, secrets: [ANTHROPIC_API_KEY] },
  async (req) => {
    // ... body unchanged ...
  },
);
```

- [ ] **Step 3: Replace the 3 ad-hoc `console.*` calls**

In `functions/src/scheduled.ts` add `import * as logger from "firebase-functions/logger";` and replace:

```ts
// line ~127
logger.info("reminders_sent", { sent });
// line ~189
logger.info("stale_drafts_deleted", { deleted });
```

In `functions/src/notify.ts` add `import * as logger from "firebase-functions/logger";` and replace the `console.warn(...)`:

```ts
logger.warn("expo_push_failed", { error: error instanceof Error ? error.message : String(error) });
```

- [ ] **Step 4: Verify build + existing tests + no stray console/onCall**

Run: `npm --prefix functions run build`
Expected: compiles clean.

Run: `npm --prefix functions test`
Expected: all existing tests PASS.

Run: `grep -rn "console\.\|[^a-zA-Z]onCall(" functions/src`
Expected: only the `onCall` *inside* `functions/src/logging.ts`; no `console.` matches.

- [ ] **Step 5: Commit**

```bash
git add functions/src
git commit -m "refactor(functions): route all callables + logs through structured logging"
```

---

### Task 3: Verify structured logs in the emulator

**Files:** none (verification only).

- [ ] **Step 1: Start the functions emulator**

Run: `npm --prefix functions run serve`
Expected: emulator boots, lists the callables incl. `getSeasonJoinCode`.

- [ ] **Step 2: Invoke a callable and confirm a single completion log**

In the emulator logs, invoke any callable from the app (or the Emulator UI). Confirm a `callable_done` entry appears with `fn`, `uid`, `durationMs`, `outcome` — and that there is exactly one completion log per call (no duplicate entry+done at info level).

- [ ] **Step 3: Commit (docs note only, if anything changed)**

No code change expected. Skip commit if nothing changed.

---

## Phase 2 — Client logger (pure core + adapter + capture) & test runner

### Task 4: Mobile test runner

**Files:**
- Modify: `mobile/package.json`

- [ ] **Step 1: Add `tsx` and a `test` script**

Add to `devDependencies`: `"tsx": "^4.20.6"`. Add to `scripts`:

```json
"test": "node --import tsx --test src/lib/logger/core.test.ts"
```

- [ ] **Step 2: Install**

Run: `npm --prefix mobile install`
Expected: `tsx` added to the lockfile.

- [ ] **Step 3: Sanity-check the runner with a trivial test**

Create `mobile/src/lib/logger/core.test.ts` with a placeholder that the next task replaces:

```ts
import test from "node:test";
import assert from "node:assert/strict";

test("runner is wired", () => {
  assert.equal(1 + 1, 2);
});
```

Run: `npm --prefix mobile test`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add mobile/package.json mobile/package-lock.json mobile/src/lib/logger/core.test.ts
git commit -m "chore(mobile): add tsx + node:test runner"
```

---

### Task 5: Logger pure core

**Files:**
- Create: `mobile/src/lib/logger/core.ts`
- Test: `mobile/src/lib/logger/core.test.ts` (replace placeholder)

- [ ] **Step 1: Write the failing tests**

```ts
// mobile/src/lib/logger/core.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeContext, LogBuffer, isSlow } from "./core";

test("sanitizeContext keeps bounded scalars and redacts sensitive keys", () => {
  const out = sanitizeContext({ uid: "u1", count: 3, ok: true, authToken: "secret", note: null });
  assert.deepEqual(out, { uid: "u1", count: 3, ok: true, authToken: "[redacted]", note: null });
});

test("sanitizeContext drops non-scalar values", () => {
  const out = sanitizeContext({ nested: { a: 1 }, list: [1, 2] });
  assert.deepEqual(out, { nested: "[unsupported]", list: "[unsupported]" });
});

test("sanitizeContext truncates long strings", () => {
  const out = sanitizeContext({ blob: "x".repeat(600) });
  assert.equal((out.blob as string).length, 501); // 500 + ellipsis
});

test("LogBuffer drops oldest on overflow and drains", () => {
  const b = new LogBuffer(2);
  const e = (n: number) => ({ level: "warn" as const, event: "e" + n, context: {}, clientTs: n });
  b.push(e(1));
  b.push(e(2));
  b.push(e(3));
  assert.deepEqual(b.drain().map((x) => x.event), ["e2", "e3"]);
  assert.equal(b.size, 0);
});

test("isSlow compares against the threshold", () => {
  assert.equal(isSlow(1500), true);
  assert.equal(isSlow(1499), false);
  assert.equal(isSlow(50, 40), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix mobile test`
Expected: FAIL — `Cannot find module './core'` exports.

- [ ] **Step 3: Write the core**

```ts
// mobile/src/lib/logger/core.ts
export type LogLevel = "debug" | "info" | "warn" | "error";
export type ScalarOrNull = string | number | boolean | null;

export interface LogEntry {
  level: LogLevel;
  event: string;
  context: Record<string, ScalarOrNull>;
  durationMs?: number;
  clientTs: number;
}

export const DEFAULT_SLOW_MS = 1500;

const REDACT_KEY = /token|secret|password|auth|email|credential|cookie|key/i;
const MAX_CONTEXT_KEYS = 20;
const MAX_STRING_LEN = 500;

/** Pure: reduce arbitrary context to bounded, safe scalars. */
export function sanitizeContext(input: unknown): Record<string, ScalarOrNull> {
  const out: Record<string, ScalarOrNull> = {};
  if (!input || typeof input !== "object") return out;
  let keys = 0;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (keys >= MAX_CONTEXT_KEYS) break;
    keys++;
    out[key] = REDACT_KEY.test(key) ? "[redacted]" : toScalar(value);
  }
  return out;
}

function toScalar(value: unknown): ScalarOrNull {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) + "…" : value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    default:
      return "[unsupported]";
  }
}

/** Fixed-size FIFO buffer; drops the oldest entry on overflow. */
export class LogBuffer {
  private items: LogEntry[] = [];
  constructor(private readonly max: number) {}
  push(entry: LogEntry): void {
    this.items.push(entry);
    if (this.items.length > this.max) this.items.shift();
  }
  get size(): number {
    return this.items.length;
  }
  drain(): LogEntry[] {
    const out = this.items;
    this.items = [];
    return out;
  }
}

/** Pure: should a completed op be flagged slow? */
export function isSlow(durationMs: number, thresholdMs: number = DEFAULT_SLOW_MS): boolean {
  return durationMs >= thresholdMs;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm --prefix mobile test`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/logger/core.ts mobile/src/lib/logger/core.test.ts
git commit -m "feat(mobile): pure logger core (sanitize, buffer, isSlow)"
```

---

### Task 6: Logger adapter (console + remote flush + `timed`)

**Files:**
- Create: `mobile/src/lib/logger/index.ts`
- Modify: `mobile/.env.example`

- [ ] **Step 1: Write the adapter**

```ts
// mobile/src/lib/logger/index.ts
import { Platform } from "react-native";
import Constants from "expo-constants";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import {
  LogBuffer,
  sanitizeContext,
  isSlow,
  DEFAULT_SLOW_MS,
  type LogEntry,
  type LogLevel,
  type ScalarOrNull,
} from "./core";

const REMOTE_ENABLED = process.env.EXPO_PUBLIC_REMOTE_LOGGING === "1";
const APP_VERSION = Constants.expoConfig?.version ?? "unknown";
const FLUSH_AT = 10; // entries
const BUFFER_MAX = 50;

const buffer = new LogBuffer(BUFFER_MAX);
let ctxUid: string | null = null;
let ctxRoute: string | null = null;

/** Wired from the auth provider so every entry carries the signed-in uid. */
export function setLogUid(uid: string | null): void {
  ctxUid = uid;
  if (uid) void flush(); // drain anything buffered before sign-in
}

/** Wired from navigation so entries record the active screen. */
export function setLogRoute(route: string | null): void {
  ctxRoute = route;
}

function baseContext(extra?: unknown): Record<string, ScalarOrNull> {
  return {
    platform: Platform.OS,
    appVersion: APP_VERSION,
    uid: ctxUid,
    route: ctxRoute,
    ...sanitizeContext(extra),
  };
}

function emit(level: LogLevel, event: string, context?: unknown, durationMs?: number): void {
  const entry: LogEntry = { level, event, durationMs, context: baseContext(context), clientTs: Date.now() };
  const dev = typeof __DEV__ !== "undefined" && __DEV__;
  if (level === "error") console.error(`[${event}]`, entry.context);
  else if (level === "warn") console.warn(`[${event}]`, entry.context);
  else if (dev) console.log(`[${level}] ${event}`, entry.context);

  if (REMOTE_ENABLED && (level === "warn" || level === "error")) {
    buffer.push(entry);
    if (buffer.size >= FLUSH_AT) void flush();
  }
}

export const logger = {
  debug: (event: string, context?: unknown) => emit("debug", event, context),
  info: (event: string, context?: unknown) => emit("info", event, context),
  warn: (event: string, context?: unknown) => emit("warn", event, context),
  error: (event: string, context?: unknown) => emit("error", event, context),
};

let flushing = false;
/** Best-effort: forward buffered warn/error entries to the authenticated sink. Never throws. */
export async function flush(): Promise<void> {
  if (flushing || !REMOTE_ENABLED || !ctxUid) return; // authenticated-only sink
  const batch = buffer.drain();
  if (batch.length === 0) return;
  flushing = true;
  try {
    await httpsCallable(functions, "ingestLog")({ entries: batch });
  } catch {
    // A logging failure must never affect the app.
  } finally {
    flushing = false;
  }
}

/** Time an async op; logs a `slow_read` warning past the threshold. Never alters the result. */
export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  thresholdMs: number = DEFAULT_SLOW_MS,
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const count = Array.isArray(result) ? result.length : undefined;
    if (isSlow(durationMs, thresholdMs)) logger.warn("slow_read", { label, durationMs, count });
    else if (typeof __DEV__ !== "undefined" && __DEV__) logger.debug("read", { label, durationMs, count });
    return result;
  } catch (error) {
    logger.warn("read_failed", {
      label,
      durationMs: Date.now() - start,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
```

- [ ] **Step 2: Add the flag to `mobile/.env.example`**

Append:

```
# Forward client warn/error logs to the authenticated ingestLog sink (Cloud Logging).
EXPO_PUBLIC_REMOTE_LOGGING=0
```

- [ ] **Step 3: Typecheck**

Run: `npm --prefix mobile run typecheck`
Expected: no new type errors from `src/lib/logger/index.ts`.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/lib/logger/index.ts mobile/.env.example
git commit -m "feat(mobile): logger adapter with best-effort remote flush + timed()"
```

---

### Task 7: Best-effort global error capture + boundary

**Files:**
- Create: `mobile/src/lib/logger/globalHandler.ts`
- Create: `mobile/src/components/LogErrorBoundary.tsx`

- [ ] **Step 1: Global handler (chains, never swallows)**

```ts
// mobile/src/lib/logger/globalHandler.ts
import { logger, flush } from "./index";

let installed = false;

type ErrorUtilsShape = {
  getGlobalHandler?: () => (e: unknown, isFatal?: boolean) => void;
  setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
};

/**
 * Best-effort, NON-FATAL capture. A fatal crash usually terminates before the async flush
 * lands; this chains (never replaces) the existing handler so the original fatal path runs.
 */
export function installGlobalErrorLogging(): void {
  if (installed) return;
  installed = true;
  const errorUtils = (globalThis as unknown as { ErrorUtils?: ErrorUtilsShape }).ErrorUtils;
  const prev = errorUtils?.getGlobalHandler?.();
  errorUtils?.setGlobalHandler?.((error, isFatal) => {
    try {
      logger.error("uncaught_error", {
        isFatal: !!isFatal,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      void flush();
    } finally {
      prev?.(error, isFatal); // never swallow the original handler
    }
  });
}
```

- [ ] **Step 2: Render-error boundary**

```tsx
// mobile/src/components/LogErrorBoundary.tsx
import React from "react";
import { logger } from "@/lib/logger";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/** Catches render errors only (NOT event-handler or async errors) and logs them best-effort. */
export class LogErrorBoundary extends React.Component<Props, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    logger.error("render_error", {
      message: error instanceof Error ? error.message : String(error),
      componentStack: info?.componentStack,
    });
  }

  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm --prefix mobile run typecheck`
Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/lib/logger/globalHandler.ts mobile/src/components/LogErrorBoundary.tsx
git commit -m "feat(mobile): best-effort global error capture + render boundary"
```

---

### Task 8: Wire capture, uid context, and route context into the app shell

**Files:**
- Modify: `mobile/app/_layout.tsx`
- Modify: `mobile/src/lib/auth.tsx`

- [ ] **Step 1: Install the global handler + boundary in `_layout.tsx`**

Add imports near the existing ones:

```ts
import { useSegments } from "expo-router"; // already imported alongside useRouter
import { installGlobalErrorLogging } from "@/lib/logger/globalHandler";
import { setLogRoute } from "@/lib/logger";
import { LogErrorBoundary } from "@/components/LogErrorBoundary";
```

In `RootNavigator`, after `const segments = useSegments();`, record the active route:

```ts
useEffect(() => {
  setLogRoute(segments.join("/") || "/");
}, [segments]);
```

In `RootLayout`, install the handler once:

```ts
useEffect(() => {
  installGlobalErrorLogging();
}, []);
```

Wrap the returned tree's `<Slot />`/providers in the boundary. Inside `RootNavigator`'s final `return <Slot />;`:

```tsx
return (
  <LogErrorBoundary>
    <Slot />
  </LogErrorBoundary>
);
```

- [ ] **Step 2: Emit `auth_bootstrap_ready` + set uid in `auth.tsx`**

Add `import { logger, setLogUid } from "./logger";` and a module-level start stamp captured at provider mount. Replace the `onAuthStateChanged` effect (lines ~75–82) with:

```ts
useEffect(() => {
  const bootStart = Date.now();
  let reported = false;
  return onAuthStateChanged(auth, async (u) => {
    setUser(u);
    setEmailVerified(!!u?.emailVerified);
    setLogUid(u?.uid ?? null);
    await loadProfileAndMembership(u);
    setInitializing(false);
    if (!reported) {
      reported = true;
      // NOTE: profile + membership ready — not first-screen data. Hence the name.
      logger.info("auth_bootstrap_ready", { durationMs: Date.now() - bootStart, signedIn: !!u });
    }
  });
}, [loadProfileAndMembership]);
```

Also clear the uid on sign-out — in `signOutUser`:

```ts
const signOutUser = useCallback(async () => {
  await signOut(auth);
  setLogUid(null);
}, []);
```

- [ ] **Step 3: Typecheck + verify the app boots**

Run: `npm --prefix mobile run typecheck`
Expected: clean.

Run the app (`npm --prefix mobile run web`) and confirm in the console: an `auth_bootstrap_ready` entry with `durationMs` after sign-in, and `[debug] read ...` entries as screens load (dev only).

- [ ] **Step 4: Commit**

```bash
git add mobile/app/_layout.tsx mobile/src/lib/auth.tsx
git commit -m "feat(mobile): wire global capture, uid + route context, auth_bootstrap_ready"
```

---

## Phase 3 — Authenticated `ingestLog` sink

> Deploy this sink (Task 9–10) BEFORE enabling `EXPO_PUBLIC_REMOTE_LOGGING=1` anywhere.

### Task 9: Pure sanitizer + rate-limit core

**Files:**
- Create: `functions/src/clientLogs/sanitize.ts`
- Create: `functions/src/clientLogs/rateLimit.ts`
- Test: `functions/test/clientLogs.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// functions/test/clientLogs.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeLogBatch } = require("../lib/clientLogs/sanitize.js");
const { checkRateLimit } = require("../lib/clientLogs/rateLimit.js");

test("sanitizeLogBatch caps batch size and counts the overflow as rejected", () => {
  const entries = Array.from({ length: 25 }, (_, i) => ({ level: "warn", event: "e" + i, clientTs: 1000 }));
  const r = sanitizeLogBatch({ entries }, { now: 1000, maxBatch: 20 });
  assert.equal(r.accepted.length, 20);
  assert.equal(r.rejected, 5);
});

test("sanitizeLogBatch clamps unknown severity to info and requires an event", () => {
  const r = sanitizeLogBatch(
    { entries: [{ level: "catastrophe", event: "x", clientTs: 1000 }, { level: "warn" }] },
    { now: 1000 },
  );
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].level, "info");
  assert.equal(r.rejected, 1);
});

test("sanitizeLogBatch redacts sensitive keys and drops non-scalars", () => {
  const r = sanitizeLogBatch(
    { entries: [{ level: "error", event: "boom", context: { authToken: "abc", nested: { a: 1 }, n: 2 }, clientTs: 1000 }] },
    { now: 1000 },
  );
  assert.deepEqual(r.accepted[0].context, { authToken: "[redacted]", nested: "[unsupported]", n: 2 });
});

test("sanitizeLogBatch nulls implausible client timestamps", () => {
  const r = sanitizeLogBatch({ entries: [{ level: "warn", event: "e", clientTs: 0 }] }, { now: 5 * 24 * 60 * 60 * 1000 });
  assert.equal(r.accepted[0].clientTs, null);
});

test("sanitizeLogBatch rejects when there is no entries array", () => {
  const r = sanitizeLogBatch({}, { now: 1000 });
  assert.deepEqual(r, { accepted: [], rejected: 0, reason: "no-entries" });
});

test("checkRateLimit allows under the cap, blocks at it, and prunes old hits", () => {
  const under = checkRateLimit([1, 2, 3], 1000, 60000, 5);
  assert.equal(under.allowed, true);
  assert.deepEqual(under.next, [1, 2, 3, 1000]);

  const pruned = checkRateLimit([1, 2], 100000, 60000, 5); // both outside the window
  assert.deepEqual(pruned.next, [100000]);

  const full = checkRateLimit([10, 20, 30, 40, 50], 60, 60000, 5);
  assert.equal(full.allowed, false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm --prefix functions run build && node --test functions/test/clientLogs.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `rateLimit.ts`**

```ts
// functions/src/clientLogs/rateLimit.ts
/** Pure sliding-window check. Returns whether allowed + the pruned timestamps to store. */
export function checkRateLimit(
  recent: number[],
  now: number,
  windowMs: number,
  max: number,
): { allowed: boolean; next: number[] } {
  const pruned = recent.filter((t) => now - t < windowMs);
  if (pruned.length >= max) return { allowed: false, next: pruned };
  return { allowed: true, next: [...pruned, now] };
}
```

- [ ] **Step 4: Write `sanitize.ts`**

```ts
// functions/src/clientLogs/sanitize.ts
export type Severity = "debug" | "info" | "warn" | "error";
const SEVERITIES: Severity[] = ["debug", "info", "warn", "error"];

export interface CleanEntry {
  level: Severity;
  event: string;
  context: Record<string, string | number | boolean | null>;
  durationMs: number | null;
  clientTs: number | null;
}

export interface SanitizeOptions {
  now: number;
  maxBatch?: number;
  maxBytes?: number;
  maxSkewMs?: number;
}

export interface SanitizeResult {
  accepted: CleanEntry[];
  rejected: number;
  reason?: string;
}

const MAX_BATCH = 20;
const MAX_BYTES = 8 * 1024;
const MAX_SKEW = 24 * 60 * 60 * 1000;
const MAX_EVENT = 80;
const MAX_KEYS = 20;
const MAX_STR = 500;
const REDACT = /token|secret|password|auth|email|credential|cookie|key/i;

export function sanitizeLogBatch(input: unknown, opts: SanitizeOptions): SanitizeResult {
  const maxBatch = opts.maxBatch ?? MAX_BATCH;
  const maxBytes = opts.maxBytes ?? MAX_BYTES;
  const maxSkew = opts.maxSkewMs ?? MAX_SKEW;
  const raw = (input as { entries?: unknown })?.entries;
  if (!Array.isArray(raw)) return { accepted: [], rejected: 0, reason: "no-entries" };

  let rejected = Math.max(0, raw.length - maxBatch);
  const accepted: CleanEntry[] = [];
  for (const item of raw.slice(0, maxBatch)) {
    const clean = cleanEntry(item, opts.now, maxSkew);
    if (!clean || Buffer.byteLength(JSON.stringify(clean), "utf8") > maxBytes) {
      rejected++;
      continue;
    }
    accepted.push(clean);
  }
  return { accepted, rejected };
}

function cleanEntry(raw: unknown, now: number, maxSkew: number): CleanEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const event = typeof r.event === "string" && r.event ? r.event.slice(0, MAX_EVENT) : null;
  if (!event) return null;
  const level = SEVERITIES.includes(r.level as Severity) ? (r.level as Severity) : "info";
  const durationMs =
    typeof r.durationMs === "number" && Number.isFinite(r.durationMs) ? r.durationMs : null;
  let clientTs =
    typeof r.clientTs === "number" && Number.isFinite(r.clientTs) ? r.clientTs : null;
  if (clientTs !== null && Math.abs(now - clientTs) > maxSkew) clientTs = null;
  return { level, event, context: cleanContext(r.context), durationMs, clientTs };
}

function cleanContext(input: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  if (!input || typeof input !== "object") return out;
  let keys = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (keys >= MAX_KEYS) break;
    keys++;
    out[k] = REDACT.test(k) ? "[redacted]" : scalar(v);
  }
  return out;
}

function scalar(v: unknown): string | number | boolean | null {
  if (v === null) return null;
  if (typeof v === "string") return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  return "[unsupported]";
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm --prefix functions run build && node --test functions/test/clientLogs.test.js`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add functions/src/clientLogs/sanitize.ts functions/src/clientLogs/rateLimit.ts functions/test/clientLogs.test.js
git commit -m "feat(functions): pure sanitize + rate-limit cores for client log sink"
```

---

### Task 10: `ingestLog` callable + export

**Files:**
- Create: `functions/src/clientLogs.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the callable (glue over the pure cores)**

```ts
// functions/src/clientLogs.ts
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { sanitizeLogBatch, type Severity } from "./clientLogs/sanitize";
import { checkRateLimit } from "./clientLogs/rateLimit";

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60; // accepted batches per uid per minute (per instance — best effort)
const hits = new Map<string, number[]>();

const EMIT: Record<Severity, (msg: string, data: unknown) => void> = {
  debug: (m, d) => logger.debug(m, d),
  info: (m, d) => logger.info(m, d),
  warn: (m, d) => logger.warn(m, d),
  error: (m, d) => logger.error(m, d),
};

/** Authenticated-only client→Cloud Logging sink. Treats all payload fields as untrusted. */
export const ingestLog = onCall({ cors: true }, async (req: CallableRequest) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const uid = req.auth.uid; // the ONLY authoritative uid
  const now = Date.now();

  const decision = checkRateLimit(hits.get(uid) ?? [], now, RATE_WINDOW_MS, RATE_MAX);
  if (!decision.allowed) {
    logger.warn("client_log_ratelimited", { uid });
    return { accepted: 0, rejected: 0, rateLimited: true };
  }
  hits.set(uid, decision.next);

  const { accepted, rejected } = sanitizeLogBatch(req.data, { now });
  for (const entry of accepted) {
    EMIT[entry.level]("client_event", {
      source: "client",
      uid,
      event: entry.event,
      durationMs: entry.durationMs,
      clientTs: entry.clientTs,
      context: entry.context,
    });
  }
  return { accepted: accepted.length, rejected };
});
```

- [ ] **Step 2: Export from `index.ts`**

Add under a new comment block:

```ts
// Client log sink
export { ingestLog } from "./clientLogs";
```

- [ ] **Step 3: Build + full functions test suite**

Run: `npm --prefix functions test`
Expected: all PASS, `ingestLog` compiles into `lib/`.

- [ ] **Step 4: Emulator check — auth enforced**

Run: `npm --prefix functions run serve`
Call `ingestLog` **without** auth (Emulator UI) → expect an `unauthenticated` error. Call it authenticated with `{ entries: [{ level: "error", event: "test", clientTs: <now> }] }` → expect `{ accepted: 1, rejected: 0 }` and a `client_event` error log.

- [ ] **Step 5: Commit**

```bash
git add functions/src/clientLogs.ts functions/src/index.ts
git commit -m "feat(functions): authenticated ingestLog client log sink"
```

---

### Task 11: Deploy the sink, then enable remote transport

**Files:**
- Modify: `mobile/.env` (local) / deployment env (not committed)

- [ ] **Step 1: Deploy functions**

Run: `npm run deploy:backend`
Expected: `ingestLog` and the re-wrapped callables deploy successfully.

- [ ] **Step 2: Enable the flag and smoke-test end to end**

Set `EXPO_PUBLIC_REMOTE_LOGGING=1` in the mobile env, sign in, and trigger a `warn` (e.g. force a slow read by throttling). Confirm a `client_event` appears in **Cloud Logging** (Logs Explorer, filter `jsonPayload.source="client"`).

- [ ] **Step 3: Commit (env example already documents the flag)**

No code commit; the flag default stays `0` in `.env.example`.

---

## Phase 4 — Performance instrumentation on slow reads

### Task 12: Wrap the slow league.ts reads with `timed()`

**Files:**
- Modify: `mobile/src/lib/league.ts`

- [ ] **Step 1: Import `timed`**

Add near the top imports:

```ts
import { timed } from "./logger";
```

- [ ] **Step 2: Wrap each target read (worked examples)**

`getStandings` (line ~375) — wrap the body:

```ts
export async function getStandings(seasonId: string): Promise<Standing[]> {
  return timed("getStandings", async () => {
    // ... existing body ...
  });
}
```

`getLeaguePlayers` (line ~352):

```ts
export async function getLeaguePlayers(): Promise<LeaguePlayer[]> {
  return timed("getLeaguePlayers", async () => {
    // ... existing body ...
  });
}
```

- [ ] **Step 3: Apply the same wrap to the remaining targets**

Same `return timed("<name>", async () => { <existing body> });` transform for:

```
getActiveSeason           (line ~245)
getPlayerStats            (line ~394)
getPlayerMatches          (line ~459)
getHeadToHeadsForPlayer   (line ~432)   // instrument only — query rewrite is a separate follow-up
```

- [ ] **Step 4: Typecheck + run the app**

Run: `npm --prefix mobile run typecheck`
Expected: clean.

Load the leaderboard and a profile; confirm `[debug] read { label: "getStandings", durationMs, count }` entries appear (dev), and that a forced slow read logs `slow_read`.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/lib/league.ts
git commit -m "feat(mobile): timing instrumentation on slow league reads"
```

---

### Task 13: Final verification & docs note

**Files:**
- Modify: `docs/firebase-setup.md` (add a short "Logging & observability" section)

- [ ] **Step 1: Run all checks**

Run: `npm --prefix functions test && npm --prefix mobile test && npm --prefix mobile run typecheck`
Expected: all PASS.

- [ ] **Step 2: Document where logs live**

Add a short section to `docs/firebase-setup.md`: callable latency/errors → Cloud Logging (`jsonPayload.fn`, `outcome`, `durationMs`); client warn/error → `jsonPayload.source="client"`; the `EXPO_PUBLIC_REMOTE_LOGGING` flag; and that fatal-crash capture and App Check are documented future work in the spec.

- [ ] **Step 3: Commit**

```bash
git add docs/firebase-setup.md
git commit -m "docs: where logs land + remote-logging flag"
```

---

## Self-Review

**Spec coverage:**
- Backend `loggedOnCall` + classification + single completion log → Task 1, 2.
- Replace 3 `console.*` → Task 2 Step 3.
- Authenticated-only `ingestLog`, untrusted payload, caps/redaction/skew, per-uid rate limit, `req.auth.uid` authoritative → Task 9, 10.
- No Firestore writes (logger-only sink) → Task 10.
- Client logger pure core / adapter split → Task 5, 6.
- Hybrid local + remote (warn/error), best-effort, buffer-before-auth/flush-after → Task 6 (`setLogUid` flush) + Task 8.
- Best-effort global capture chaining the handler; boundary → Task 7, 8.
- `timed()` route-aware + result count; `auth_bootstrap_ready` naming → Task 6, 8, 12.
- Build-time `EXPO_PUBLIC_*` flag (no Remote Config) → Task 6, 11.
- New mobile test runner → Task 4.
- Phased rollout incl. "deploy sink before enabling transport" → Phase 3 note, Task 11.
- `getHeadToHeadsForPlayer` instrument-now / fix-later → Task 12 Step 3 (rewrite explicitly out of scope; see spec Future work).

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The repeated `loggedOnCall` and `timed()` transforms list exact call sites with the full transform shown once — mechanical, not logic placeholders.

**Type consistency:** `LogEntry`/`ScalarOrNull`/`LogLevel` shared from `core.ts`; `CleanEntry`/`Severity` from `sanitize.ts`; `setLogUid`/`setLogRoute`/`flush`/`timed`/`logger` names consistent across adapter, auth wiring, and league instrumentation; `instrumentCallable`/`classifyCallableError`/`loggedOnCall` consistent across `logging.ts` and its test.

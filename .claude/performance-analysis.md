# Performance Analysis: VSCode Daily Bullet Notes Extension

**Date:** 2026-03-16

---

## Executive Summary

The extension has several significant performance issues that will manifest as keystroke lag and UI stutter in large documents. The core problems are: (1) unbounded full-document parsing triggered on every keystroke, (2) no caching anywhere in the codebase, and (3) unthrottled event listeners. Low-hanging fruit fixes could yield a 20–30% performance improvement.

---

## Critical Issues

### 1. Full Document Parse on Every Keystroke
**Files:** `src/editListener.ts:79`, `src/foldingRangeProvider.ts:8`

`new Parser(document).parseDocument()` is called synchronously on every matching text change. `updateStatusesForFullDay()` is called up to **4 times within a single edit event** (lines 38, 45, 52, 58). The folding range provider also parses the entire document on every folding request with zero caching.

**Fix:** Cache the last parse result keyed by document version. Invalidate only when the document version changes.

### 2. Cascading and Duplicate Status Updates
**File:** `src/editListener.ts:200–249`

`updateStatusesForFullDay()` is called redundantly in multiple branches:
- `processNewLine()` calls it at line 225
- `processBackspace()` calls it at lines 241 **and** 247
- `processUpdatedBox()` can trigger it alongside a direct call in the parent

Each call re-parses the entire current day section.

**Fix:** Deduplicate with a flag or by coalescing to a single deferred call per event.

---

## High Priority Issues

### 3. Unthrottled Event Listeners
**File:** `src/extension.ts:27,31`

Both `onDidChangeTextEditorSelection` and `onDidChangeTextDocument` are registered without any debouncing or throttling. On every keystroke or cursor move, expensive logic runs synchronously.

**Fix:** Debounce document change handler at 200–300ms; debounce selection change handler at 100ms.

### 4. Completion Triggered on Every Mouse Click
**File:** `src/selectionListener.ts:36`

`editor.action.triggerSuggest` is called on every selection change, even ordinary cursor movement. This invokes the completion engine unnecessarily.

**Fix:** Only trigger suggest when the cursor moves into a box context that wasn't already active.

### 5. Synchronous Configuration Read on Every Keystroke
**File:** `src/settings.ts:4`

`vscode.workspace.getConfiguration()` is called synchronously from `automaticStatusUpdates()`, which is invoked on every edit. Workspace configuration reads are not free.

**Fix:** Cache the config value and invalidate via `onDidChangeConfiguration`.

### 6. O(n²) Task Hierarchy Algorithm
**File:** `src/editListener.ts:86–150`

The task hierarchy is rebuilt by iterating all lines in a day section, with a `previousTaskStack` that is manipulated in a nested loop. For deeply nested task trees this is O(n²).

**Fix:** Use a single-pass stack-based algorithm that processes each line exactly once.

---

## Medium Priority Issues

### 7. Regex Recompiled on Every Parser Instantiation
**File:** `src/documentParser.ts:7–13`

Five regex patterns are compiled as instance properties, meaning they are recompiled every time `new Parser()` is called — which happens dozens of times per document edit.

```ts
// Current (recompiles every time)
private monthBoxTitleLineRegex = /.../ ;

// Fix: make static
private static readonly monthBoxTitleLineRegex = /.../;
```

### 8. Double Regex Match on Same Line
**File:** `src/documentParser.ts:195,199,207`

`line.text.match(this.monthBoxTitleLineRegex)` is called twice on the same line — once to check truthiness and again to extract the capture group. Use a local variable.

### 9. Completion Items Rebuilt Every Invocation
**File:** `src/completionsProvider.ts:9–64`

Static completion items (the bullet type list) are recreated as new objects on every call to `provideCompletionItems()`. These never change and should be built once.

---

## Low Priority Issues

### 10. Inefficient Indent Level Calculation
**File:** `src/utilities.ts:196`

```ts
match[0].split('').length  // allocates an array just to get string length
// Should be:
match[0].length
```

### 11. Multiple Regex Passes Per Line in Filter
**File:** `src/utilities.ts:69–81`

`removeCompleteAndCancelledContent()` does `split()` + multiple `replace()` + multiple `match()` per line. These could be reduced to fewer passes.

### 12. String Repetition on Every Header Generation
**File:** `src/strings.ts:4,6`

`'-'.repeat(n)` is called every time `getBoxHeader()` is invoked. These strings are constant and should be pre-computed.

### 13. Linear Month Array Search
**File:** `src/strings.ts:26`

`months.indexOf(month)` is a linear O(n) search on every `getMonthFromString()` call. Use a `Map` for O(1) lookup.

---

## No Issues Found

- **Bundle size**: Minimal external dependencies; esbuild correctly configured with `external: ['vscode']`, minification in production, no unnecessary libraries.
- **Async patterns**: All VSCode API calls that return Promises are properly awaited.
- **Memory leaks**: Disposables are correctly pushed to `context.subscriptions`.

---

## Recommended Priority Order

| # | Fix | Effort | Impact |
|---|-----|--------|--------|
| 1 | Cache Parser results keyed by document version | Medium | Critical |
| 2 | Deduplicate `updateStatusesForFullDay()` calls per event | Low | Critical |
| 3 | Debounce document + selection change listeners | Low | High |
| 4 | Only trigger completions when entering a new box context | Low | High |
| 5 | Cache workspace configuration, invalidate on change | Low | High |
| 6 | Static regex patterns on Parser class | Low | Medium |
| 7 | Build completion items once as a constant | Low | Medium |
| 8 | Single-pass task hierarchy algorithm | Medium | Medium |
| 9 | Fix `split('').length` → `.length` | Trivial | Low |
| 10 | Pre-compute separator strings in strings.ts | Trivial | Low |
| 11 | Use Map for month lookups | Trivial | Low |

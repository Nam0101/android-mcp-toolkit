# Android MCP Toolkit for AI Agents

MCP server with tools for Android development and internationalization:
- Fast SVG → Android VectorDrawable conversion (cached, file or inline).
- adb logcat reader with package/pid/tag filters for quick crash triage.
- Semantic translation with character length preservation for i18n.

## Why this exists
**The Mission: Bringing Native Android to the AI Agent Era**

While the AI ecosystem flourishes with web-first tools, Android development often feels left behind. This MCP server is my answer to that gap—a dedicated bridge connecting AI Agents directly to the Android toolchain.

⚡ Zero-Friction Asset Conversion: Convert SVGs to VectorDrawables instantly without the overhead of launching Android Studio.

🔍 Direct Diagnostic Access: Empower agents to pull, filter, and analyze adb logcat streams (by package, PID, or tag) in real-time.

🤖 Agent-Native Architecture: Deliver structured, scriptable outputs that LLMs can parse and act upon efficiently.

🌐 Internationalization Support: Translate strings with character length awareness for UI consistency across languages.

🚀 Built for Extensibility: A solid foundation designed to grow, paving the way for future utilities like bitmap helpers and asset validation.

## Pairing ideas
- **Figma MCP**: grab SVGs from designs, feed to `convert-svg-to-android-drawable` to get XML for Android resources.
- **Debugging**: while running the app, call `read-adb-logcat` with package name or tag to capture crashes and filtered logs without leaving the MCP client.
- **Localization**: use `semantic-translate` to generate translations for strings.xml while maintaining similar character counts for consistent UI layouts.

### Previews
**SVG to VectorDrawable**
- Figma request → SVG extraction  
  ![Figma request via MCP](assets/figma/figma-request.png)
- Flag conversion preview (single)  
  ![Flag conversion preview](assets/figma/flag-uk-preview.png)
- Batch flag review (side-by-side)  
  ![Batch flag review](assets/figma/flag-batch-review.png)
- Batch run via MCP (console)  
  ![Batch run via MCP](assets/figma/flag-batch-runs.png)

**ADB logcat tool**
- Crash capture prompt (inputs + filters)  
  ![Crash logcat prompt](assets/figma/my%20app%20just.png)
- Response preview (summarized logcat)  
  ![Response gap prompt](assets/figma/Isease%20gap.png)

## Current tools
- `convert-svg-to-android-drawable`
  - Inputs: `svg` (inline) **or** `svgPath` (file path). Optional: `outputPath`, `floatPrecision` (default 2), `fillBlack` (default false), `xmlTag` (default false), `tint`, `cache` (default true).
  - Output: VectorDrawable XML text; also writes to disk when `outputPath` is provided.
  - Performance: LRU cache (32 entries) keyed by SVG + options plus fast reuse in-session.
  - Converter: vendored fork in `vendor/svg2vectordrawable` with fixes for `rgb()/rgba()`, `hsl()/hsla()`, and named colors. Upstream license: `vendor/svg2vectordrawable/LICENSE` (MIT).

- `read-adb-logcat`
  - Inputs: `packageName` (resolve pid via `adb shell pidof -s`), `pid` (explicit), `tag`, `priority` (`V|D|I|W|E|F|S`, default `V`), `maxLines` (tail count, default `200`, max `2000`), `timeoutMs` (default `5000`, max `15000`).
  - Behavior: Runs `adb logcat -d -t <maxLines>` with optional `--pid=<pid>` and `-s tag:priority`.
  - Output: Returns the logcat text; if no lines are returned, responds with a short message.
  - Notes: Requires `adb` available in PATH and a connected device/emulator. Provide at least one of `packageName`, `pid`, or `tag` to scope logs.

- `get-pid-by-package`
  - Inputs: `packageName` (required), `timeoutMs` (default `5000`, max `15000`).
  - Behavior: Resolves pid via `adb shell pidof -s <package>`.
  - Notes: Use this first, then pass pid to other logcat tools for noise-free filtering.

- `get-current-activity`
  - Inputs: `timeoutMs` (default `5000`, max `15000`).
  - Behavior: Parses `adb shell dumpsys window` for `mCurrentFocus` / `mFocusedApp` to reveal the currently focused window (useful even in single-activity setups to confirm top window).

- `fetch-crash-stacktrace`
  - Inputs: `packageName` (optional, resolves pid), `maxLines` (default `400`, max `2000`), `timeoutMs` (default `5000`, max `15000`).
  - Behavior: Pulls crash buffer via `adb logcat -b crash -d -t <maxLines>`; filters by `--pid` when package is provided.

- `check-anr-state`
  - Inputs: `maxLines` (default `400`, max `2000`), `timeoutMs` (default `5000`, max `15000`).
  - Behavior: Fetches `ActivityManager:E *:S` (recent ANR logs) and best-effort reads `/data/anr/traces.txt` (stat + tail 200 lines). May require root/debuggable.

- `clear-logcat-buffer`
  - Inputs: `timeoutMs` (default `5000`, max `15000`).
  - Behavior: Runs `adb logcat -c` to clear buffers before a new scenario.

- `semantic-translate`
  - Inputs: `text` (required), `target_language` (required, e.g., `vi`, `zh-CN`, `ja`, `ko`, `es`, `fr`, `de`), `source_language` (default `auto`), `max_length_variance` (percentage, default `20`).
  - Behavior: Translates text between languages while attempting to preserve character length similar to the original. Returns translated text with character count comparison and length variance metrics.
  - Output: Translated text, character counts (original vs translated), variance percentage, and compliance status.
  - Use cases: Localization of Android strings.xml, UI text translation with layout constraints, internationalization testing.
  - Notes: Character length variance is informational; some language pairs (e.g., English to Chinese/Japanese) naturally have different character densities. Adjust `max_length_variance` as needed for your use case.

## Roadmap (planned)
- Additional MCP tools for Android assets (e.g., batch conversions, validations, optimizers).
- Optional resource prompts for common Android drawables/templates.
- Upcoming MCP utilities (planned):
  - Logcat reader: stream and filter Android logcat output via MCP.
  - Asset checkers: flag common drawable issues (size, alpha, color profile).
  - Batch conversions: multi-SVG to VectorDrawable with consistent options.
  - Template prompts: quick-start drawable/XML snippets for common patterns.

## Quick start
- `npm install`
- `npm run build`
- `node dist/index.js` (stdio MCP server)

## Run via npx
- Global: `npx android-mcp-toolkit`

## Use in Cursor (MCP config)
Add to your Cursor settings JSON:
```json
{
  "mcpServers": {
    "figma-desktop": {
      "url": "http://127.0.0.1:3845/mcp"
    },
    "android-mcp-toolkit": {
      "command": "npx",
      "args": [
        "-y",
        "android-mcp-toolkit"
      ]
    }
  }
}
```
The npx call downloads the published package; no local path required.

Quick install via Cursor deep link:
- `cursor://anysphere.cursor-deeplink/mcp/install?name=android-mcp-toolkit&config=eyJjb21tYW5kIjoibnB4IC15IGFuZHJvaWQtbWNwLXRvb2xraXQifQ%3D%3D`

## Examples
- Input SVG: `sample_svg.svg`
- Output VectorDrawable: `examples/sample_svg.xml`

## Notes
- Transport: stdio via `@modelcontextprotocol/sdk`.
- Base deps kept minimal; everything needed to convert SVGs is vendored/included.

## Contact
- nam.nv205106@gmail.com

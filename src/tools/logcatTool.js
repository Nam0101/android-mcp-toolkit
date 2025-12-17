const z = require('zod/v4');
const { runAdbCommand } = require('../utils/adb');

const logcatToolInstructions = [
  'Use read-adb-logcat to tail device logs for a package, pid, or tag; default tail=200 lines.',
  'Use get-pid-by-package to resolve pid quickly via adb shell pidof -s.',
  'Use get-current-activity to inspect current focus (Activity/Window) via dumpsys window.',
  'Use fetch-crash-stacktrace to pull the latest crash buffer (-b crash) optionally filtered by pid.',
  'Use check-anr-state to inspect ActivityManager ANR logs and /data/anr/traces.txt (best-effort).',
  'Use clear-logcat-buffer to reset logcat (-c) before running new scenarios.'
].join('\n');

const logcatInputSchema = z
  .object({
    packageName: z
      .string()
      .min(1)
      .describe('Android package name; resolves pid via adb shell pidof')
      .optional(),
    pid: z.string().min(1).describe('Explicit process id for logcat --pid').optional(),
    tag: z.string().min(1).describe('Logcat tag to include (uses -s tag)').optional(),
    priority: z
      .enum(['V', 'D', 'I', 'W', 'E', 'F', 'S'])
      .default('V')
      .describe('Minimum priority when tag is provided (e.g., D for debug)'),
    maxLines: z
      .number()
      .int()
      .min(1)
      .max(2000)
      .default(200)
      .describe('Tail line count via logcat -t'),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(15000)
      .default(5000)
      .describe('Timeout per adb call in milliseconds')
  })
  .refine(data => data.packageName || data.pid || data.tag, {
    message: 'Provide packageName, pid, or tag to avoid unfiltered logs'
  });

const pidInputSchema = z.object({
  packageName: z.string().min(1).describe('Android package name to resolve pid via adb shell pidof -s'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(15000)
    .default(5000)
    .describe('Timeout per adb call in milliseconds')
});

const currentActivityInputSchema = z.object({
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(15000)
    .default(5000)
    .describe('Timeout per adb call in milliseconds')
});

const crashStackInputSchema = z.object({
  packageName: z
    .string()
    .min(1)
    .describe('Optional package to resolve pid; filters crash buffer with --pid')
    .optional(),
  maxLines: z
    .number()
    .int()
    .min(50)
    .max(2000)
    .default(400)
    .describe('Tail line count from crash buffer (-b crash -t)'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(15000)
    .default(5000)
    .describe('Timeout per adb call in milliseconds')
});

const anrStateInputSchema = z.object({
  maxLines: z
    .number()
    .int()
    .min(50)
    .max(2000)
    .default(400)
    .describe('Tail line count from ActivityManager:E'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(15000)
    .default(5000)
    .describe('Timeout per adb call in milliseconds')
});

const clearLogcatInputSchema = z.object({
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(15000)
    .default(5000)
    .describe('Timeout per adb call in milliseconds')
});

async function resolvePid(packageName, timeoutMs) {
  const output = await runAdbCommand(['shell', 'pidof', '-s', packageName], timeoutMs);
  const pid = output.split(/\s+/).find(Boolean);
  if (!pid) {
    throw new Error(`Could not resolve pid for package ${packageName}`);
  }
  return pid;
}

function buildLogcatArgs(params, pid) {
  const args = ['logcat', '-d', '-t', String(params.maxLines)];
  if (pid) {
    args.push(`--pid=${pid}`);
  }
  if (params.tag) {
    const filterSpec = `${params.tag}:${params.priority}`;
    args.push('-s', filterSpec);
  }
  return args;
}

function registerLogcatTool(server) {
  server.registerTool(
    'read-adb-logcat',
    {
      title: 'Read adb logcat',
      description:
        'Dump recent adb logcat output scoped by package, pid, or tag with tail and timeout controls.',
      inputSchema: logcatInputSchema
    },
    async (params, extra) => {
      const timeoutMs = params.timeoutMs;
      const pid = params.pid || (params.packageName ? await resolvePid(params.packageName, timeoutMs) : null);
      const args = buildLogcatArgs(params, pid);
      const startTime = process.hrtime.bigint();

      const output = await runAdbCommand(args, timeoutMs);
      const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      if (extra && typeof extra.sessionId === 'string') {
        server
          .sendLoggingMessage(
            {
              level: 'info',
              data:
                `Read logcat (${params.maxLines} lines` +
                (pid ? `, pid=${pid}` : '') +
                (params.tag ? `, tag=${params.tag}:${params.priority}` : '') +
                `) in ${elapsedMs.toFixed(2)}ms`
            },
            extra.sessionId
          )
          .catch(() => {
            /* best-effort logging */
          });
      }

      if (!output) {
        return { content: [{ type: 'text', text: 'Logcat returned no lines.' }] };
      }

      return { content: [{ type: 'text', text: output }] };
    }
  );

  server.registerTool(
    'get-pid-by-package',
    {
      title: 'Get pid by package',
      description: 'Resolve process id for a package via adb shell pidof -s.',
      inputSchema: pidInputSchema
    },
    async params => {
      const pid = await resolvePid(params.packageName, params.timeoutMs);
      return { content: [{ type: 'text', text: pid }] };
    }
  );

  server.registerTool(
    'get-current-activity',
    {
      title: 'Get current activity/window focus',
      description:
        'Inspect current focused app/window via dumpsys window (mCurrentFocus/mFocusedApp). Useful even in single-activity apps to verify top window.',
      inputSchema: currentActivityInputSchema
    },
    async params => {
      const dump = await runAdbCommand(['shell', 'dumpsys', 'window'], params.timeoutMs);
      const lines = dump
        .split('\n')
        .filter(line => line.includes('mCurrentFocus') || line.includes('mFocusedApp'));
      const trimmed = lines.slice(0, 8).join('\n').trim();
      if (!trimmed) {
        return { content: [{ type: 'text', text: 'No focus info found in dumpsys window.' }] };
      }
      return { content: [{ type: 'text', text: trimmed }] };
    }
  );

  server.registerTool(
    'fetch-crash-stacktrace',
    {
      title: 'Fetch crash stacktrace (crash buffer)',
      description:
        'Pull recent crash buffer (-b crash -d -t) optionally filtered by pid resolved from package.',
      inputSchema: crashStackInputSchema
    },
    async params => {
      const pid = params.packageName ? await resolvePid(params.packageName, params.timeoutMs) : null;
      const args = ['logcat', '-b', 'crash', '-d', '-t', String(params.maxLines)];
      if (pid) {
        args.push(`--pid=${pid}`);
      }
      const output = await runAdbCommand(args, params.timeoutMs);
      if (!output) {
        return { content: [{ type: 'text', text: 'No crash entries found.' }] };
      }
      return { content: [{ type: 'text', text: output }] };
    }
  );

  server.registerTool(
    'check-anr-state',
    {
      title: 'Check ANR state (ActivityManager + traces)',
      description:
        'Check recent ActivityManager ANR logs and tail /data/anr/traces.txt when accessible (best-effort, may require root/debuggable).',
      inputSchema: anrStateInputSchema
    },
    async params => {
      const sections = [];

      try {
        const amLogs = await runAdbCommand(
          ['logcat', '-d', '-t', String(params.maxLines), 'ActivityManager:E', '*:S'],
          params.timeoutMs
        );
        if (amLogs) {
          sections.push('ActivityManager (recent):\n' + amLogs);
        } else {
          sections.push('ActivityManager (recent): no entries.');
        }
      } catch (error) {
        sections.push(`ActivityManager: ${error.message}`);
      }

      try {
        const stat = await runAdbCommand(['shell', 'ls', '-l', '/data/anr/traces.txt'], params.timeoutMs);
        sections.push('traces.txt stat:\n' + stat);
      } catch (error) {
        sections.push(`traces.txt stat: ${error.message}`);
      }

      try {
        const tail = await runAdbCommand(
          ['shell', 'tail', '-n', '200', '/data/anr/traces.txt'],
          params.timeoutMs
        );
        if (tail) {
          sections.push('traces.txt tail (200 lines):\n' + tail);
        } else {
          sections.push('traces.txt tail: empty.');
        }
      } catch (error) {
        sections.push(`traces.txt tail: ${error.message}`);
      }

      return { content: [{ type: 'text', text: sections.join('\n\n') }] };
    }
  );

  server.registerTool(
    'clear-logcat-buffer',
    {
      title: 'Clear logcat buffer',
      description: 'Run adb logcat -c to clear buffers before a new scenario.',
      inputSchema: clearLogcatInputSchema
    },
    async params => {
      await runAdbCommand(['logcat', '-c'], params.timeoutMs);
      return { content: [{ type: 'text', text: 'Cleared logcat buffers.' }] };
    }
  );
}

module.exports = {
  registerLogcatTool,
  logcatToolInstructions
};

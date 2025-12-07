const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const z = require('zod/v4');

const execFileAsync = promisify(execFile);

const logcatToolInstructions = [
  'Use read-adb-logcat to tail device logs for a package, pid, or tag; default tail=200 lines.',
  'Provide packageName (resolves pid via adb shell pidof -s), pid, or tag to scope logs.',
  'Supports priority filter with -s tag:priority and tail via -t <maxLines>.'
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

async function runAdbCommand(args, timeoutMs) {
  try {
    const { stdout } = await execFileAsync('adb', args, {
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024
    });
    return stdout.trimEnd();
  } catch (error) {
    const stderr = error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const message = [`adb ${args.join(' ')} failed`, error.message].filter(Boolean).join(': ');
    if (stderr) {
      throw new Error(`${message} | stderr: ${stderr}`);
    }
    throw new Error(message);
  }
}

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
}

module.exports = {
  registerLogcatTool,
  logcatToolInstructions
};

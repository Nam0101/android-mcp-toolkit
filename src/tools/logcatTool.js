const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const z = require('zod/v4');

const execFileAsync = promisify(execFile);

const logcatToolInstructions = [
  'Use manage-logcat to read logs, fetch crash stacktraces, check ANR state, or clear logcat buffers.',
  'Use get-current-activity to inspect current focus (Activity/Window) via dumpsys window.'
].join('\n');

const manageLogcatSchema = z.object({
  action: z.enum(['read', 'crash', 'anr', 'clear']).default('read').describe('Action to perform: read logs, get crash buffer, check ANR, or clear buffer.'),
  packageName: z.string().min(1).describe('Android package name; resolves pid via adb shell pidof').optional(),
  pid: z.string().min(1).describe('Explicit process id for logcat --pid').optional(),
  tag: z.string().min(1).describe('Logcat tag to include (uses -s tag)').optional(),
  priority: z.enum(['V', 'D', 'I', 'W', 'E', 'F', 'S']).default('V').describe('Minimum priority (e.g. D for debug).'),
  maxLines: z.number().int().min(1).max(2000).default(200).describe('Tail line count (logcat -t).'),
  timeoutMs: z.number().int().min(1000).max(15000).default(5000).describe('Timeout per adb call in milliseconds')
});

const currentActivityInputSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(15000).default(5000).describe('Timeout per adb call in milliseconds')
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
  try {
    const output = await runAdbCommand(['shell', 'pidof', '-s', packageName], timeoutMs);
    const pid = output.split(/\s+/).find(Boolean);
    return pid || null;
  } catch (e) {
    return null; // Return null if pidof failed or not found
  }
}

function registerLogcatTool(server) {
  server.registerTool(
    'manage-logcat',
    {
      title: 'Manage ADB Logcat',
      description: 'Unified tool to read logs, capture crashes, check ANRs, and clear buffers.',
      inputSchema: manageLogcatSchema
    },
    async (params) => {
      const { action, timeoutMs } = params;

      if (action === 'clear') {
        await runAdbCommand(['logcat', '-c'], timeoutMs);
        return { content: [{ type: 'text', text: 'Cleared logcat buffers.' }] };
      }

      // Resolve PID if packageName is provided
      let pid = params.pid;
      if (!pid && params.packageName) {
        pid = await resolvePid(params.packageName, timeoutMs);
      }

      // 1. ANR Check
      if (action === 'anr') {
        const sections = [];
        try {
           const logArgs = ['logcat', '-d', '-t', String(params.maxLines), 'ActivityManager:E', '*:S'];
           const amLogs = await runAdbCommand(logArgs, timeoutMs);
           sections.push('ActivityManager (recent):\n' + (amLogs || 'No entries.'));
        } catch (e) { sections.push('ActivityManager error: ' + e.message); }

        try {
           const tail = await runAdbCommand(['shell', 'tail', '-n', '200', '/data/anr/traces.txt'], timeoutMs);
           sections.push('traces.txt tail (200 lines):\n' + (tail || 'Empty.'));
        } catch (e) { sections.push('traces.txt error: ' + e.message); }
        
        return { content: [{ type: 'text', text: sections.join('\n\n') }] };
      }

      // 2. Crash Buffer
      if (action === 'crash') {
        const args = ['logcat', '-b', 'crash', '-d', '-t', String(params.maxLines)];
        if (pid) args.push(`--pid=${pid}`);
        const output = await runAdbCommand(args, timeoutMs);
        return { content: [{ type: 'text', text: output || 'No crash entries found.' }] };
      }

      // 3. Normal Read (Default)
      const args = ['logcat', '-d', '-t', String(params.maxLines)];
      if (pid) args.push(`--pid=${pid}`);
      if (params.tag) {
         args.push('-s', `${params.tag}:${params.priority}`);
      }
      
      const output = await runAdbCommand(args, timeoutMs);
      return { content: [{ type: 'text', text: output || 'Logcat returned no lines.' }] };
    }
  );

  server.registerTool(
    'get-current-activity',
    {
      title: 'Get current activity/window focus',
      description: 'Inspect current focused app/window via dumpsys window.',
      inputSchema: currentActivityInputSchema
    },
    async (params) => {
      const dump = await runAdbCommand(['shell', 'dumpsys', 'window'], params.timeoutMs);
      const lines = dump.split('\n').filter(line => line.includes('mCurrentFocus') || line.includes('mFocusedApp'));
      const trimmed = lines.slice(0, 8).join('\n').trim();
      return { content: [{ type: 'text', text: trimmed || 'No focus info found.' }] };
    }
  );
}

module.exports = {
  registerLogcatTool,
  logcatToolInstructions
};

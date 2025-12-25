const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const z = require('zod/v4');

const execFileAsync = promisify(execFile);

const deviceToolInstructions = [
  'Use dump-ui-hierarchy to capture the current screen structure (XML) via uiautomator.',
  'Use take-screenshot to capture the device screen to a local file (PNG).',
  'Use inject-input to send interactions like tap, text, swipe, or key events to the device.'
].join('\n');

const dumpUiSchema = z.object({
  timeoutMs: z.number().int().min(1000).max(20000).default(10000).describe('Timeout in milliseconds')
});

const screenshotSchema = z.object({
  outputPath: z.string().min(1).describe('Local path to save the screenshot (e.g. screenshot.png)'),
  timeoutMs: z.number().int().min(1000).max(20000).default(10000).describe('Timeout in milliseconds')
});

const injectInputSchema = z.object({
  command: z.enum(['tap', 'text', 'swipe', 'keyevent', 'back', 'home']).describe('Input command type'),
  args: z.array(z.string().or(z.number())).optional().describe('Arguments for the command (e.g. [x, y] for tap, ["text"] for text). Optional if elementId/elementText provided.'),
  elementId: z.string().optional().describe('Find element by resource-id and tap its center (e.g. "com.example:id/button")'),
  elementText: z.string().optional().describe('Find element by text content and tap its center (e.g. "Login")'),
  timeoutMs: z.number().int().min(1000).max(20000).default(10000).describe('Timeout in milliseconds')
});

// Helper to parse bounds string "[x1,y1][x2,y2]" into center coordinates
function getCenterFromBounds(bounds) {
  const match = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const x1 = parseInt(match[1], 10);
  const y1 = parseInt(match[2], 10);
  const x2 = parseInt(match[3], 10);
  const y2 = parseInt(match[4], 10);
  return {
    x: Math.round((x1 + x2) / 2),
    y: Math.round((y1 + y2) / 2)
  };
}

async function runAdbCommand(args, timeoutMs, options = {}) {
  try {
    const { stdout } = await execFileAsync('adb', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      ...options
    });
    return stdout;
  } catch (error) {
    const stderr = error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
    const message = [`adb ${args.join(' ')} failed`, error.message].filter(Boolean).join(': ');
    if (stderr) {
      throw new Error(`${message} | stderr: ${stderr}`);
    }
    throw new Error(message);
  }
}

async function runAdbCommandBinary(args, timeoutMs) {
  try {
    const { stdout } = await execFileAsync('adb', args, {
      timeout: timeoutMs,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024
    });
    return stdout;
  } catch (error) {
    throw new Error(`adb ${args.join(' ')} failed: ${error.message}`);
  }
}

function registerDeviceTool(server) {
  server.registerTool(
    'dump-ui-hierarchy',
    {
      title: 'Dump UI Hierarchy (XML)',
      description: 'Capture the current UI hierarchy as XML using uiautomator.',
      inputSchema: dumpUiSchema
    },
    async (params) => {
      const devicePath = '/data/local/tmp/mcp_window_dump.xml';
      await runAdbCommand(['shell', 'uiautomator', 'dump', devicePath], params.timeoutMs);
      const content = await runAdbCommand(['shell', 'cat', devicePath], params.timeoutMs);
      return { content: [{ type: 'text', text: content.trim() }] };
    }
  );

  server.registerTool(
    'take-screenshot',
    {
      title: 'Take User Screenshot',
      description: 'Capture device screenshot and save to a local file.',
      inputSchema: screenshotSchema
    },
    async (params) => {
      const buffer = await runAdbCommandBinary(['exec-out', 'screencap', '-p'], params.timeoutMs);
      const absPath = path.resolve(params.outputPath);
      fs.writeFileSync(absPath, buffer);
      return { content: [{ type: 'text', text: `Screenshot saved to ${absPath}` }] };
    }
  );

  server.registerTool(
    'inject-input',
    {
      title: 'Inject Input Events',
      description: 'Simulate user input interactions (tap, text, swipe, keyevents) or click by UI element.',
      inputSchema: injectInputSchema
    },
    async (params) => {
      let { command, args } = params;
      const { elementId, elementText, timeoutMs } = params;
      args = args || [];

      // Logic to resolve element click
      if (elementId || elementText) {
        if (command !== 'tap') {
          throw new Error('elementId/elementText can only be used with command="tap".');
        }
        
        // 1. Dump UI
        const devicePath = '/data/local/tmp/mcp_input_dump.xml';
        await runAdbCommand(['shell', 'uiautomator', 'dump', devicePath], timeoutMs);
        const xmlContent = await runAdbCommand(['shell', 'cat', devicePath], timeoutMs);

        // 2. Find Node
        // Simple Regex search avoids heavy XML parser deps.
        // We look for a <node ... resource-id="..." ... bounds="..." /> or text="..."
        // Note: Attributes order isn't guaranteed, so we scan for the tag.
        
        let targetBounds = null;
        
        // We split by <node to iterate simpler
        const nodes = xmlContent.split('<node ');
        for (const nodeStr of nodes) {
           // Check if this node matches our criteria
           let matches = false;
           if (elementId && nodeStr.includes(`resource-id="${elementId}"`)) matches = true;
           if (elementText && nodeStr.includes(`text="${elementText}"`)) matches = true;

           if (matches) {
              // Extract bounds
              const boundsMatch = nodeStr.match(/bounds="(\[\d+,\d+\]\[\d+,\d+\])"/);
              if (boundsMatch) {
                  targetBounds = boundsMatch[1];
                  break; // Found first match
              }
           }
        }

        if (!targetBounds) {
            throw new Error(`Could not find element with id="${elementId}" or text="${elementText}" in current UI.`);
        }

        const center = getCenterFromBounds(targetBounds);
        if (!center) {
             throw new Error(`Invalid bounds found: ${targetBounds}`);
        }

        // 3. Update args to be a tap at these coordinates
        args = [String(center.x), String(center.y)];
      }

      // Check args for standard commands
      let adbArgs = ['shell', 'input'];
      
      switch (command) {
        case 'tap':
          if (args.length !== 2) throw new Error('tap requires x and y coordinates (or use elementId/elementText)');
          adbArgs.push('tap', args[0], args[1]);
          break;
        case 'text':
          if (args.length !== 1) throw new Error('text requires a single string argument');
          let safeText = String(args[0]).replace(/\s/g, '%s');
          adbArgs.push('text', safeText);
          break;
        case 'swipe':
          if (args.length < 4) throw new Error('swipe requires at least x1, y1, x2, y2');
          adbArgs.push('swipe', ...args);
          break;
        case 'keyevent':
        case 'back':
        case 'home':
           // Allow command='back' without args to mean keyevent 4
           if (command === 'back') { adbArgs.push('keyevent', '4'); }
           else if (command === 'home') { adbArgs.push('keyevent', '3'); }
           else {
               if (args.length < 1) throw new Error('keyevent requires keycode');
               adbArgs.push('keyevent', ...args);
           }
           break;
        default:
          throw new Error(`Unknown command: ${command}`);
      }
      
      await runAdbCommand(adbArgs, timeoutMs);
      return { content: [{ type: 'text', text: `Executed input ${command} ${JSON.stringify(args)}` }] };
    }
  );
}

module.exports = {
  registerDeviceTool,
  deviceToolInstructions
};

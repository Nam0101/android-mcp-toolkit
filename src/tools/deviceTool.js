const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const z = require('zod/v4');
const { runAdbCommand } = require('../utils/adb');

// Android battery status constants from BatteryManager
const BATTERY_STATUS = {
  UNKNOWN: 1,
  CHARGING: 2,
  DISCHARGING: 3,
  NOT_CHARGING: 4,
  FULL: 5
};

const BATTERY_STATUS_LABELS = {
  [BATTERY_STATUS.UNKNOWN]: 'Unknown',
  [BATTERY_STATUS.CHARGING]: 'Charging',
  [BATTERY_STATUS.DISCHARGING]: 'Discharging',
  [BATTERY_STATUS.NOT_CHARGING]: 'Not charging',
  [BATTERY_STATUS.FULL]: 'Full'
};

// Device path prefix for temporary screenshot storage (random UUID appended at runtime)
const DEVICE_SCREENSHOT_PREFIX = '/sdcard/mcp_screenshot_';

/**
 * Generate a unique temporary screenshot path on the device.
 * @returns {string} Unique device path for screenshot
 */
function generateDeviceScreenshotPath() {
  return `${DEVICE_SCREENSHOT_PREFIX}${randomUUID()}.png`;
}

/**
 * Get battery status label from status code.
 * @param {string} statusCode - Status code string from adb
 * @returns {string} Human-readable battery status
 */
function getBatteryStatusLabel(statusCode) {
  const code = parseInt(statusCode, 10);
  if (Number.isNaN(code) || code < BATTERY_STATUS.UNKNOWN || code > BATTERY_STATUS.FULL) {
    return 'Unknown';
  }
  return BATTERY_STATUS_LABELS[code] || 'Unknown';
}

const deviceToolInstructions = [
  'Use get-device-info to retrieve comprehensive Android device/emulator information (model, API level, screen density, etc.).',
  'Use list-connected-devices to see all connected devices/emulators with their serial numbers and states.',
  'Use get-installed-packages to list installed packages on the device, optionally filtered by keyword.',
  'Use take-screenshot to capture a screenshot from the device and save it to a specified path.'
].join('\n');

const deviceInfoInputSchema = z.object({
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(15000)
    .default(5000)
    .describe('Timeout per adb call in milliseconds')
});

const listDevicesInputSchema = z.object({
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(15000)
    .default(5000)
    .describe('Timeout per adb call in milliseconds')
});

const installedPackagesInputSchema = z.object({
  filter: z
    .string()
    .min(1)
    .describe('Optional keyword to filter package names')
    .optional(),
  systemOnly: z
    .boolean()
    .default(false)
    .describe('Show only system packages'),
  thirdPartyOnly: z
    .boolean()
    .default(false)
    .describe('Show only third-party (non-system) packages'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(15000)
    .default(5000)
    .describe('Timeout per adb call in milliseconds')
}).refine(data => !(data.systemOnly && data.thirdPartyOnly), {
  message: 'Cannot set both systemOnly and thirdPartyOnly to true'
});

const screenshotInputSchema = z.object({
  outputPath: z
    .string()
    .min(1)
    .describe('Local file path to save the screenshot (e.g., ./screenshot.png)'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(30000)
    .default(10000)
    .describe('Timeout per adb call in milliseconds')
});

async function getDeviceProperty(prop, timeoutMs) {
  try {
    return await runAdbCommand(['shell', 'getprop', prop], timeoutMs);
  } catch {
    return null;
  }
}

function registerDeviceTool(server) {
  server.registerTool(
    'get-device-info',
    {
      title: 'Get device information',
      description:
        'Retrieve comprehensive Android device/emulator info including model, manufacturer, API level, screen density, and more.',
      inputSchema: deviceInfoInputSchema
    },
    async params => {
      const timeoutMs = params.timeoutMs;

      const props = {
        'Device Model': 'ro.product.model',
        'Manufacturer': 'ro.product.manufacturer',
        'Brand': 'ro.product.brand',
        'Device Name': 'ro.product.device',
        'Android Version': 'ro.build.version.release',
        'API Level': 'ro.build.version.sdk',
        'Build ID': 'ro.build.id',
        'Build Fingerprint': 'ro.build.fingerprint',
        'Hardware': 'ro.hardware',
        'CPU ABI': 'ro.product.cpu.abi',
        'Screen Density': 'ro.sf.lcd_density',
        'Language': 'persist.sys.language',
        'Country': 'persist.sys.country',
        'Timezone': 'persist.sys.timezone',
        'Serial Number': 'ro.serialno'
      };

      const results = [];
      for (const [label, prop] of Object.entries(props)) {
        const value = await getDeviceProperty(prop, timeoutMs);
        if (value) {
          results.push(`${label}: ${value}`);
        }
      }

      // Get screen resolution via wm size
      try {
        const wmSize = await runAdbCommand(['shell', 'wm', 'size'], timeoutMs);
        const match = wmSize.match(/Physical size:\s*(\d+x\d+)/);
        if (match) {
          results.push(`Screen Resolution: ${match[1]}`);
        }
      } catch {
        // Ignore wm size errors
      }

      // Get available memory
      try {
        const memInfo = await runAdbCommand(['shell', 'cat', '/proc/meminfo'], timeoutMs);
        const memTotalMatch = memInfo.match(/MemTotal:\s*(\d+)\s*kB/);
        const memAvailMatch = memInfo.match(/MemAvailable:\s*(\d+)\s*kB/);
        if (memTotalMatch) {
          const totalMB = Math.round(parseInt(memTotalMatch[1], 10) / 1024);
          results.push(`Total Memory: ${totalMB} MB`);
        }
        if (memAvailMatch) {
          const availMB = Math.round(parseInt(memAvailMatch[1], 10) / 1024);
          results.push(`Available Memory: ${availMB} MB`);
        }
      } catch {
        // Ignore meminfo errors
      }

      // Get battery level
      try {
        const batteryInfo = await runAdbCommand(['shell', 'dumpsys', 'battery'], timeoutMs);
        const levelMatch = batteryInfo.match(/level:\s*(\d+)/);
        const statusMatch = batteryInfo.match(/status:\s*(\d+)/);
        if (levelMatch) {
          const status = statusMatch ? getBatteryStatusLabel(statusMatch[1]) : '';
          results.push(`Battery: ${levelMatch[1]}%${status ? ` (${status})` : ''}`);
        }
      } catch {
        // Ignore battery errors
      }

      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No device information could be retrieved. Is a device connected?' }] };
      }

      return { content: [{ type: 'text', text: results.join('\n') }] };
    }
  );

  server.registerTool(
    'list-connected-devices',
    {
      title: 'List connected devices',
      description: 'List all connected Android devices and emulators with their serial numbers and connection states.',
      inputSchema: listDevicesInputSchema
    },
    async params => {
      const output = await runAdbCommand(['devices', '-l'], params.timeoutMs);
      const lines = output.split('\n').filter(line => line.trim() && !line.startsWith('List of'));

      if (lines.length === 0) {
        return { content: [{ type: 'text', text: 'No devices connected.' }] };
      }

      const devices = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        const serial = parts[0];
        const state = parts[1] || 'unknown';
        const details = parts.slice(2).join(' ');
        return `${serial} (${state})${details ? ' - ' + details : ''}`;
      });

      return { content: [{ type: 'text', text: `Connected devices:\n${devices.join('\n')}` }] };
    }
  );

  server.registerTool(
    'get-installed-packages',
    {
      title: 'Get installed packages',
      description:
        'List installed packages on the device. Optionally filter by keyword or show only system/third-party apps.',
      inputSchema: installedPackagesInputSchema
    },
    async params => {
      const args = ['shell', 'pm', 'list', 'packages'];

      if (params.systemOnly) {
        args.push('-s');
      } else if (params.thirdPartyOnly) {
        args.push('-3');
      }

      const output = await runAdbCommand(args, params.timeoutMs);
      let packages = output
        .split('\n')
        .map(line => line.replace('package:', '').trim())
        .filter(Boolean);

      if (params.filter) {
        const filterLower = params.filter.toLowerCase();
        packages = packages.filter(pkg => pkg.toLowerCase().includes(filterLower));
      }

      packages.sort();

      if (packages.length === 0) {
        return { content: [{ type: 'text', text: 'No packages found matching criteria.' }] };
      }

      const typeLabel = params.systemOnly ? 'system' : params.thirdPartyOnly ? 'third-party' : 'all';
      const header = `Installed packages (${typeLabel})${params.filter ? ` matching "${params.filter}"` : ''}: ${packages.length} found`;

      return { content: [{ type: 'text', text: `${header}\n\n${packages.join('\n')}` }] };
    }
  );

  server.registerTool(
    'take-screenshot',
    {
      title: 'Take screenshot',
      description: 'Capture a screenshot from the connected device and save it to the specified local path.',
      inputSchema: screenshotInputSchema
    },
    async params => {
      // Basic path validation - ensure it ends with .png and doesn't contain path traversal
      const resolvedPath = path.resolve(params.outputPath);
      if (!resolvedPath.endsWith('.png')) {
        throw new Error('Output path must end with .png extension');
      }
      if (params.outputPath.includes('..')) {
        throw new Error('Output path cannot contain path traversal (..)');
      }

      // Generate unique device path to avoid conflicts with other apps
      const devicePath = generateDeviceScreenshotPath();

      // Capture screenshot on device
      await runAdbCommand(['shell', 'screencap', '-p', devicePath], params.timeoutMs);

      // Ensure output directory exists
      const outputDir = path.dirname(resolvedPath);
      await fs.mkdir(outputDir, { recursive: true });

      // Pull screenshot to local path
      await runAdbCommand(['pull', devicePath, params.outputPath], params.timeoutMs);

      // Clean up device file
      try {
        await runAdbCommand(['shell', 'rm', devicePath], params.timeoutMs);
      } catch {
        // Ignore cleanup errors
      }

      return { content: [{ type: 'text', text: `Screenshot saved to: ${resolvedPath}` }] };
    }
  );
}

module.exports = {
  registerDeviceTool,
  deviceToolInstructions
};

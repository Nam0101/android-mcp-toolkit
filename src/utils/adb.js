const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

/**
 * Run an adb command with timeout and error handling.
 * @param {string[]} args - Arguments to pass to adb
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<string>} - Command output (trimmed)
 */
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

module.exports = {
  runAdbCommand
};

import { spawn } from 'node:child_process';
import {
  ProgressLogger,
} from './os-util';

/**
 * Runs a child process and streams stdout/stderr lines to the UI logger while
 * still returning accumulated output for downstream parsing.
 * @param executable The command to run.
 * @param args The arguments to pass to the command.
 * @param options Options for running the command, including working directory, environment variables, logger, and timeout.
 * @returns A promise that resolves with the accumulated stdout and stderr output.
  * @throws An error if the command fails or times out. The error object may include stdout and stderr properties with the command output.
 */
export async function runCommandWithLiveLogs(
  executable: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    log?: ProgressLogger;
    timeoutMs?: number;
  }
): Promise<{ stdout: string; stderr: string }> {
  const { cwd, env, log, timeoutMs = 0 } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutHandle = timeoutMs > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs)
      : undefined;

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          log?.(trimmed);
        }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) {
          log?.(trimmed);
        }
      }
    });

    child.on('error', (error) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      reject(error);
    });

    child.on('close', (code) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

      if (timedOut) {
        const timeoutError = new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s: ${executable} ${args.join(' ')}`) as NodeJS.ErrnoException & {
          code?: string;
          stdout?: string;
          stderr?: string;
        };
        timeoutError.code = 'ETIMEDOUT';
        timeoutError.stdout = stdout;
        timeoutError.stderr = stderr;
        reject(timeoutError);
        return;
      }

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const error = new Error(`Command failed (${code}): ${executable} ${args.join(' ')}`) as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}


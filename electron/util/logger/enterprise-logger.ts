import fs from 'fs';
import path from 'path';

export interface EnterpriseLoggerOptions {
  baseDir?: string;
}

export class EnterpriseLogger {
  private logDir: string;
  private runDir: string;
  private logFile: string;
  private resultFile: string;
  private logs: string[] = [];
  private summary: string[] = [];
  private startTime: Date;
  private endTime?: Date;

  constructor(options?: EnterpriseLoggerOptions) {
    this.startTime = new Date();
    const baseDir = options?.baseDir || path.join(process.cwd(), 'logs');
    const dateDir = path.join(baseDir, this.getDateString(this.startTime));
    this.runDir = path.join(dateDir, this.getTimeString(this.startTime));
    this.logDir = baseDir;
    this.logFile = path.join(this.runDir, 'log.txt');
    this.resultFile = path.join(this.runDir, 'result.txt');
    this.ensureDir(this.runDir);
    this.log(`Logger started at ${this.startTime.toISOString()}`);
  }

  private ensureDir(dir: string) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private getDateString(date: Date) {
    return date.toISOString().split('T')[0];
  }

  private getTimeString(date: Date) {
    return date.toISOString().replace(/:/g, '-').split('.')[0].replace('T', '_');
  }

  log(message: string) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}`;
    this.logs.push(entry);
    fs.appendFileSync(this.logFile, entry + '\n');
  }

  error(message: string, error?: Error) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ERROR: ${message}${error ? ' - ' + error.stack : ''}`;
    this.logs.push(entry);
    fs.appendFileSync(this.logFile, entry + '\n');
  }

  addSummary(message: string) {
    this.summary.push(message);
  }

  finish(success: boolean) {
    this.endTime = new Date();
    this.addSummary(`Start Time: ${this.startTime.toISOString()}`);
    this.addSummary(`End Time: ${this.endTime.toISOString()}`);
    this.addSummary(`Status: ${success ? 'Success' : 'Failure'}`);
    fs.writeFileSync(this.resultFile, this.summary.join('\n'));
    this.log(`Logger finished at ${this.endTime.toISOString()} with status: ${success ? 'Success' : 'Failure'}`);
  }
}

export function createEnterpriseLogger(options?: EnterpriseLoggerOptions) {
  return new EnterpriseLogger(options);
}

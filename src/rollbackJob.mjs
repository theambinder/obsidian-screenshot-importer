import { randomUUID } from 'node:crypto';
import { rollbackRun, rollbackRunItem } from './rollback.mjs';

export class RollbackJob {
  constructor(config, { runId, sourceFolderName }) {
    this.config = config;
    this.id = `rollback-${randomUUID()}`;
    this.kind = 'rollback';
    this.runId = runId;
    this.sourceFolderName = sourceFolderName || null;
    this.status = 'queued';
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.totalFiles = 0;
    this.doneFiles = 0;
    this.current = 'Rollback: preparing...';
    this.result = null;
    this.error = null;
  }

  async run() {
    this.status = 'running';
    try {
      const options = { onProgress: (progress) => Object.assign(this, progress) };
      this.result = this.sourceFolderName
        ? await rollbackRunItem(this.config, this.runId, this.sourceFolderName, options)
        : await rollbackRun(this.config, this.runId, options);
      this.status = this.result.status;
      this.current = this.status === 'done' ? 'Rollback complete' : 'Rollback completed with errors';
    } catch (error) {
      this.status = 'error';
      this.error = error.message;
    } finally {
      this.finishedAt = new Date().toISOString();
    }
  }

  progress() {
    const elapsedMs = Date.now() - Date.parse(this.startedAt);
    const remaining = Math.max(0, this.totalFiles - this.doneFiles);
    return {
      id: this.id, kind: this.kind, runId: this.runId, sourceFolderName: this.sourceFolderName,
      status: this.status, current: this.current, error: this.error,
      totalFiles: this.totalFiles, doneFiles: this.doneFiles,
      percent: ['done', 'partial'].includes(this.status) ? 100 : this.totalFiles ? Math.min(99, Math.round(this.doneFiles / this.totalFiles * 100)) : 0,
      etaSeconds: this.doneFiles && remaining ? Math.round(elapsedMs / this.doneFiles * remaining / 1000) : null,
      startedAt: this.startedAt, finishedAt: this.finishedAt, result: this.result,
    };
  }
}

import { readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Job } from "./backup.js";

export interface ScheduledJob {
  id: string;
  name: string;
  paths: string[];
  time: string;
  recurrence: "once" | "daily" | "weekly";
  daysOfWeek?: number[];
  enabled: boolean;
  createdAt: string;
  lastRunAt?: string;
  lastRunStatus?: "done" | "failed";
  nextRunAt?: string;
}

export interface ScheduleStore {
  version: 1;
  schedules: ScheduledJob[];
}

export async function loadSchedules(file: string): Promise<ScheduleStore> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as ScheduleStore;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, schedules: [] };
    throw err;
  }
}

export async function saveSchedules(file: string, store: ScheduleStore): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2));
  await rename(tmp, file);
}

export function computeNextRun(job: ScheduledJob, after?: Date): Date | null {
  const now = after ?? new Date();
  const [hours, minutes] = job.time.split(":").map(Number);

  if (job.recurrence === "once") {
    if (job.lastRunAt) return null;
    const candidate = new Date(now);
    candidate.setHours(hours, minutes, 0, 0);
    if (candidate.getTime() <= now.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }
    return candidate;
  }

  const days = job.recurrence === "daily"
    ? (job.daysOfWeek ?? [])
    : (job.daysOfWeek ?? [new Date(job.createdAt).getDay()]);

  if (days.length === 0) return null;

  for (let offset = 0; offset < 8; offset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (days.includes(candidate.getDay()) && candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }
  return null;
}

export interface JobRegistry {
  active: Job | null;
  jobs: Map<string, Job>;
}

interface SchedulerDeps {
  schedulesFile: string;
  jobRegistry: JobRegistry;
  runBackupFn: (paths: string[]) => Promise<Job>;
}

export class Scheduler {
  private store: ScheduleStore = { version: 1, schedules: [] };
  private timer: ReturnType<typeof setInterval> | null = null;
  private deps: SchedulerDeps;

  constructor(deps: SchedulerDeps) {
    this.deps = deps;
  }

  async start(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.store = await loadSchedules(this.deps.schedulesFile);
    for (const s of this.store.schedules) {
      if (s.enabled && !s.nextRunAt) s.nextRunAt = computeNextRun(s)?.toISOString();
    }
    await saveSchedules(this.deps.schedulesFile, this.store);
    this.timer = setInterval(() => void this.tick(), 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    const now = new Date();
    let changed = false;
    for (const s of this.store.schedules) {
      if (!s.enabled || !s.nextRunAt) continue;
      if (new Date(s.nextRunAt).getTime() > now.getTime()) continue;
      if (this.deps.jobRegistry.active) continue;

      try {
        const job = await this.deps.runBackupFn(s.paths);
        s.lastRunAt = new Date().toISOString();
        s.lastRunStatus = job.status === "failed" ? "failed" : "done";
      } catch {
        s.lastRunAt = new Date().toISOString();
        s.lastRunStatus = "failed";
      }

      if (s.recurrence === "once") {
        s.enabled = false;
        s.nextRunAt = undefined;
      } else {
        s.nextRunAt = computeNextRun(s)?.toISOString();
      }
      changed = true;
    }
    if (changed) await saveSchedules(this.deps.schedulesFile, this.store);
  }

  async add(data: Omit<ScheduledJob, "id" | "createdAt" | "lastRunAt" | "lastRunStatus" | "nextRunAt">): Promise<ScheduledJob> {
    const job: ScheduledJob = {
      ...data,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    if (job.enabled) job.nextRunAt = computeNextRun(job)?.toISOString();
    this.store.schedules.push(job);
    await saveSchedules(this.deps.schedulesFile, this.store);
    return job;
  }

  async update(id: string, data: Partial<Omit<ScheduledJob, "id" | "createdAt" | "lastRunAt" | "lastRunStatus" | "nextRunAt">>): Promise<ScheduledJob | null> {
    const s = this.store.schedules.find((s) => s.id === id);
    if (!s) return null;
    Object.assign(s, data);
    if (s.enabled) {
      s.nextRunAt = computeNextRun(s)?.toISOString();
    } else {
      s.nextRunAt = undefined;
    }
    await saveSchedules(this.deps.schedulesFile, this.store);
    return s;
  }

  async remove(id: string): Promise<boolean> {
    const idx = this.store.schedules.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this.store.schedules.splice(idx, 1);
    await saveSchedules(this.deps.schedulesFile, this.store);
    return true;
  }

  get(id: string): ScheduledJob | undefined {
    return this.store.schedules.find((s) => s.id === id);
  }

  list(): ScheduledJob[] {
    return this.store.schedules;
  }
}

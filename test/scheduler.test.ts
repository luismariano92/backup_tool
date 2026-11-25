import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJob, runBackup } from "../src/server/backup.js";
import { WebDavClient } from "../src/server/webdav.js";
import {
  computeNextRun,
  loadSchedules,
  saveSchedules,
  Scheduler,
  type JobRegistry,
  type ScheduledJob,
  type ScheduleStore,
} from "../src/server/scheduler.js";
import { startFakeDav } from "./fake-webdav.js";

function makeJob(overrides: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id: "test-id",
    name: "Test",
    paths: ["/tmp/test"],
    time: "09:00",
    recurrence: "daily",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    enabled: true,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("computeNextRun", () => {
  it("once that hasn't run returns next occurrence", () => {
    const now = new Date("2025-06-15T08:00:00");
    const job = makeJob({ recurrence: "once", time: "09:00" });
    const result = computeNextRun(job, now);
    expect(result).not.toBeNull();
    expect(result!.getHours()).toBe(9);
    expect(result!.getMinutes()).toBe(0);
    expect(result!.getDate()).toBe(15);
  });

  it("once that has run returns null", () => {
    const job = makeJob({ recurrence: "once", lastRunAt: new Date().toISOString() });
    expect(computeNextRun(job)).toBeNull();
  });

  it("daily with specific days skips non-matching days", () => {
    // 2025-06-15 is a Sunday (day 0)
    const now = new Date("2025-06-15T10:00:00");
    const job = makeJob({ recurrence: "daily", daysOfWeek: [1, 3], time: "09:00" });
    const result = computeNextRun(job, now);
    expect(result).not.toBeNull();
    // Next Monday is June 16
    expect(result!.getDay()).toBe(1);
    expect(result!.getDate()).toBe(16);
  });

  it("daily time already passed today returns next matching day", () => {
    // 2025-06-16 is Monday, time 10:00 already past 09:00
    const now = new Date("2025-06-16T10:00:00");
    const job = makeJob({ recurrence: "daily", daysOfWeek: [1], time: "09:00" });
    const result = computeNextRun(job, now);
    expect(result).not.toBeNull();
    // Next Monday is June 23
    expect(result!.getDate()).toBe(23);
  });

  it("daily future time today on matching day returns today", () => {
    // 2025-06-16 is Monday, time 08:00 before 09:00
    const now = new Date("2025-06-16T08:00:00");
    const job = makeJob({ recurrence: "daily", daysOfWeek: [1], time: "09:00" });
    const result = computeNextRun(job, now);
    expect(result).not.toBeNull();
    expect(result!.getDate()).toBe(16);
    expect(result!.getHours()).toBe(9);
  });

  it("weekly returns same weekday next week if today's time passed", () => {
    // 2025-06-16 is Monday, createdAt is on a Monday
    const now = new Date("2025-06-16T10:00:00");
    const job = makeJob({
      recurrence: "weekly",
      daysOfWeek: undefined,
      time: "09:00",
      createdAt: "2025-06-16T08:00:00.000Z",
    });
    const result = computeNextRun(job, now);
    expect(result).not.toBeNull();
    expect(result!.getDay()).toBe(1); // Monday
    expect(result!.getDate()).toBe(23);
  });
});

describe("Schedule CRUD", () => {
  let work: string;
  let schedFile: string;

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "sched-test-"));
    schedFile = path.join(work, "schedules.json");
  });

  it("add schedule appears in list with computed nextRunAt", async () => {
    const registry: JobRegistry = { active: null, jobs: new Map() };
    const scheduler = new Scheduler({
      schedulesFile: schedFile,
      jobRegistry: registry,
      runBackupFn: async () => createJob([]),
    });
    await scheduler.start();

    const added = await scheduler.add({
      name: "Test",
      paths: ["/tmp"],
      time: "09:00",
      recurrence: "daily",
      daysOfWeek: [1, 2, 3, 4, 5],
      enabled: true,
    });

    expect(added.id).toBeTruthy();
    expect(added.nextRunAt).toBeTruthy();
    expect(scheduler.list()).toHaveLength(1);
    scheduler.stop();
  });

  it("update schedule updates nextRunAt", async () => {
    const registry: JobRegistry = { active: null, jobs: new Map() };
    const scheduler = new Scheduler({
      schedulesFile: schedFile,
      jobRegistry: registry,
      runBackupFn: async () => createJob([]),
    });
    await scheduler.start();

    const added = await scheduler.add({
      name: "Test",
      paths: ["/tmp"],
      time: "09:00",
      recurrence: "daily",
      daysOfWeek: [1],
      enabled: true,
    });
    const oldNext = added.nextRunAt;
    const updated = await scheduler.update(added.id, { time: "15:00" });
    expect(updated).not.toBeNull();
    expect(updated!.time).toBe("15:00");
    // nextRunAt should be recalculated (may differ)
    expect(updated!.nextRunAt).toBeTruthy();
    scheduler.stop();
  });

  it("remove schedule removes from list", async () => {
    const registry: JobRegistry = { active: null, jobs: new Map() };
    const scheduler = new Scheduler({
      schedulesFile: schedFile,
      jobRegistry: registry,
      runBackupFn: async () => createJob([]),
    });
    await scheduler.start();

    const added = await scheduler.add({
      name: "Test",
      paths: ["/tmp"],
      time: "09:00",
      recurrence: "once",
      enabled: true,
    });
    expect(scheduler.list()).toHaveLength(1);
    await scheduler.remove(added.id);
    expect(scheduler.list()).toHaveLength(0);
    scheduler.stop();
  });

  it("persistence: reload from file preserves data", async () => {
    const registry: JobRegistry = { active: null, jobs: new Map() };
    const scheduler = new Scheduler({
      schedulesFile: schedFile,
      jobRegistry: registry,
      runBackupFn: async () => createJob([]),
    });
    await scheduler.start();
    await scheduler.add({
      name: "Persist Me",
      paths: ["/tmp"],
      time: "12:00",
      recurrence: "daily",
      daysOfWeek: [0, 6],
      enabled: true,
    });
    scheduler.stop();

    const store = await loadSchedules(schedFile);
    expect(store.schedules).toHaveLength(1);
    expect(store.schedules[0].name).toBe("Persist Me");
  });
});

describe("Scheduler tick", () => {
  let dav: Awaited<ReturnType<typeof startFakeDav>> | undefined;
  let work: string;

  beforeEach(async () => {
    work = await mkdtemp(path.join(tmpdir(), "sched-tick-"));
  });

  afterEach(async () => {
    await dav?.close();
    dav = undefined;
  });

  it("triggers backup when nextRunAt is in the past", async () => {
    dav = await startFakeDav();
    const source = path.join(work, "src");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "file.txt"), "hello");

    const stateFile = path.join(work, "state.json");
    const schedFile = path.join(work, "schedules.json");
    const registry: JobRegistry = { active: null, jobs: new Map() };

    const scheduler = new Scheduler({
      schedulesFile: schedFile,
      jobRegistry: registry,
      runBackupFn: async (paths: string[]) => {
        const job = createJob(paths);
        registry.active = job;
        registry.jobs.set(job.id, job);
        await runBackup(job, {
          client: new WebDavClient({ url: dav!.url }),
          remoteRoot: "/backups/",
          stateFile,
        });
        registry.active = null;
        return job;
      },
    });
    await scheduler.start();

    const pastTime = new Date(Date.now() - 60_000);
    const hh = String(pastTime.getHours()).padStart(2, "0");
    const mm = String(pastTime.getMinutes()).padStart(2, "0");

    const added = await scheduler.add({
      name: "Past Schedule",
      paths: [source],
      time: `${hh}:${mm}`,
      recurrence: "daily",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      enabled: true,
    });

    // Force nextRunAt into past
    const store = await loadSchedules(schedFile);
    store.schedules[0].nextRunAt = new Date(Date.now() - 30_000).toISOString();
    await saveSchedules(schedFile, store);
    // Reload scheduler's internal state
    await scheduler.start();

    await scheduler.tick();

    const s = scheduler.get(added.id);
    expect(s).toBeTruthy();
    expect(s!.lastRunAt).toBeTruthy();
    expect(s!.lastRunStatus).toBe("done");
    expect(s!.nextRunAt).toBeTruthy();

    scheduler.stop();
  });

  it("skips when busy (active job exists)", async () => {
    dav = await startFakeDav();
    const schedFile = path.join(work, "schedules.json");
    const registry: JobRegistry = { active: createJob(["/tmp"]), jobs: new Map() };
    let ran = false;

    const scheduler = new Scheduler({
      schedulesFile: schedFile,
      jobRegistry: registry,
      runBackupFn: async () => { ran = true; return createJob([]); },
    });
    await scheduler.start();

    await scheduler.add({
      name: "Busy Test",
      paths: ["/tmp"],
      time: "00:00",
      recurrence: "daily",
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      enabled: true,
    });

    // Force nextRunAt into past
    const store = await loadSchedules(schedFile);
    store.schedules[0].nextRunAt = new Date(Date.now() - 30_000).toISOString();
    await saveSchedules(schedFile, store);
    await scheduler.start();

    await scheduler.tick();
    expect(ran).toBe(false);

    scheduler.stop();
  });

  it("once auto-disables after run", async () => {
    dav = await startFakeDav();
    const source = path.join(work, "src2");
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, "f.txt"), "data");
    const stateFile = path.join(work, "state2.json");
    const schedFile = path.join(work, "schedules2.json");
    const registry: JobRegistry = { active: null, jobs: new Map() };

    const scheduler = new Scheduler({
      schedulesFile: schedFile,
      jobRegistry: registry,
      runBackupFn: async (paths: string[]) => {
        const job = createJob(paths);
        registry.active = job;
        registry.jobs.set(job.id, job);
        await runBackup(job, {
          client: new WebDavClient({ url: dav!.url }),
          remoteRoot: "/backups/",
          stateFile,
        });
        registry.active = null;
        return job;
      },
    });
    await scheduler.start();

    const added = await scheduler.add({
      name: "Once Job",
      paths: [source],
      time: "00:00",
      recurrence: "once",
      enabled: true,
    });

    // Force nextRunAt into past
    const store = await loadSchedules(schedFile);
    store.schedules[0].nextRunAt = new Date(Date.now() - 30_000).toISOString();
    store.schedules[0].lastRunAt = undefined;
    await saveSchedules(schedFile, store);
    await scheduler.start();

    await scheduler.tick();

    const s = scheduler.get(added.id);
    expect(s!.enabled).toBe(false);
    expect(s!.nextRunAt).toBeUndefined();

    scheduler.stop();
  });
});

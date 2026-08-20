"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CompileOutput } from "@/lib/scad/compile";

/** How long a confirmed-alive worker may spend on one compile. */
const COMPILE_TIMEOUT_MS = 30000;
/** How long we wait for a fresh worker to announce it booted. */
const BOOT_TIMEOUT_MS = 5000;

interface Job {
  source: string;
  files: Record<string, string>;
}

export function useCompiler() {
  const workerRef = useRef<Worker | null>(null);
  const workerAlive = useRef(false); // set once the worker's ready-handshake arrives
  const workerBroken = useRef(false); // permanent main-thread fallback
  const jobId = useRef(0);
  const inFlight = useRef<{ id: number; job: Job; timer: ReturnType<typeof setTimeout> } | null>(null);
  const queued = useRef<Job | null>(null);
  const [result, setResult] = useState<CompileOutput | null>(null);
  const [busy, setBusy] = useState(false);
  // bumps every time a new result lands — usable as a viewer frame token
  const [generation, setGeneration] = useState(0);

  const runJobRef = useRef<(job: Job) => void>(() => {});
  const armTimerRef = useRef<(id: number, job: Job, ms: number) => ReturnType<typeof setTimeout>>(
    () => setTimeout(() => {}, 0),
  );

  const finishJob = useCallback((id: number, r: CompileOutput) => {
    if (inFlight.current?.id === id) {
      clearTimeout(inFlight.current.timer);
      inFlight.current = null;
    }
    if (id === jobId.current) {
      setResult(r);
      setBusy(false);
      setGeneration((g) => g + 1);
    }
    if (queued.current) {
      const next = queued.current;
      queued.current = null;
      runJobRef.current(next);
    }
  }, []);

  const runOnMainThread = useCallback((id: number, job: Job) => {
    import("@/lib/scad/compile").then(({ compileSource }) => {
      // yield a frame so the UI can show the busy state
      setTimeout(() => {
        const r = compileSource(job.source, job.files);
        finishJob(id, r);
      }, 16);
    });
  }, [finishJob]);

  const killWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    workerAlive.current = false;
  }, []);

  const makeWorker = useCallback((): Worker | null => {
    if (workerBroken.current) return null;
    try {
      const w = new Worker(new URL("../lib/scad/compile.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ ready?: boolean; id?: number; result?: CompileOutput }>) => {
        if (e.data.ready) {
          workerAlive.current = true;
          // the in-flight job was armed with the short boot timeout —
          // now that the worker is confirmed up, give it the full budget
          if (inFlight.current) {
            clearTimeout(inFlight.current.timer);
            inFlight.current.timer = armTimerRef.current(inFlight.current.id, inFlight.current.job, COMPILE_TIMEOUT_MS);
          }
          return;
        }
        if (e.data.id !== undefined && e.data.result) {
          workerAlive.current = true;
          finishJob(e.data.id, e.data.result);
        }
      };
      w.onerror = (e) => {
        console.warn("WebSCAD: compile worker failed, falling back to main thread.", e.message ?? e);
        workerBroken.current = true;
        killWorker();
        if (inFlight.current) {
          const { id, job, timer } = inFlight.current;
          clearTimeout(timer);
          inFlight.current = null;
          runOnMainThread(id, job);
        }
      };
      return w;
    } catch (e) {
      console.warn("WebSCAD: could not create compile worker, using main thread.", e);
      workerBroken.current = true;
      return null;
    }
  }, [finishJob, killWorker, runOnMainThread]);

  /** Watchdog for a job posted to the worker. */
  const armTimer = useCallback((id: number, job: Job, ms: number) => {
    return setTimeout(() => {
      const booted = workerAlive.current;
      inFlight.current = null;
      killWorker();
      if (id !== jobId.current) return;
      if (!booted) {
        // the worker never came up — run this job on the main thread instead
        // (the next job will try a fresh worker again)
        runOnMainThread(id, job);
      } else {
        setResult({
          ok: false,
          meshes: [],
          echo: [],
          warnings: [],
          error: `Render timed out after ${COMPILE_TIMEOUT_MS / 1000}s — model may be too complex. Try lowering $fn.`,
          errorLine: null,
          stats: { vertices: 0, triangles: 0, timeMs: COMPILE_TIMEOUT_MS },
        });
        setBusy(false);
      }
    }, ms);
  }, [killWorker, runOnMainThread]);

  const runJob = useCallback((job: Job) => {
    const id = ++jobId.current;
    setBusy(true);

    if (!workerRef.current && !workerBroken.current) workerRef.current = makeWorker();
    const w = workerRef.current;

    if (w && !workerBroken.current) {
      const timeout = workerAlive.current ? COMPILE_TIMEOUT_MS : BOOT_TIMEOUT_MS;
      const timer = armTimer(id, job, timeout);
      inFlight.current = { id, job, timer };
      w.postMessage({ id, source: job.source, files: job.files });
    } else {
      runOnMainThread(id, job);
    }
  }, [makeWorker, armTimer, runOnMainThread]);

  useEffect(() => {
    runJobRef.current = runJob;
    armTimerRef.current = armTimer;
  }, [runJob, armTimer]);

  const compile = useCallback((source: string, files: Record<string, string>) => {
    if (inFlight.current) {
      queued.current = { source, files }; // keep only the latest request
      return;
    }
    runJob({ source, files });
  }, [runJob]);

  useEffect(() => {
    return () => {
      // full reset — StrictMode remounts must not leave a phantom in-flight job
      if (inFlight.current) {
        clearTimeout(inFlight.current.timer);
        inFlight.current = null;
      }
      queued.current = null;
      killWorker();
    };
  }, [killWorker]);

  return { compile, result, busy, generation };
}

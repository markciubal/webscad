"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CompileOutput } from "@/lib/scad/compile";

const COMPILE_TIMEOUT_MS = 30000;

interface Job {
  source: string;
  files: Record<string, string>;
}

export function useCompiler() {
  const workerRef = useRef<Worker | null>(null);
  const workerBroken = useRef(false);
  const jobId = useRef(0);
  const inFlight = useRef<{ id: number; job: Job; timer: ReturnType<typeof setTimeout> } | null>(null);
  const queued = useRef<Job | null>(null);
  const [result, setResult] = useState<CompileOutput | null>(null);
  const [busy, setBusy] = useState(false);

  // stable refs to avoid stale closures inside worker callbacks
  const runJobRef = useRef<(job: Job) => void>(() => {});

  const finishJob = useCallback((id: number, r: CompileOutput) => {
    if (inFlight.current?.id === id) {
      clearTimeout(inFlight.current.timer);
      inFlight.current = null;
    }
    if (id === jobId.current) {
      setResult(r);
      setBusy(false);
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

  const makeWorker = useCallback((): Worker | null => {
    if (workerBroken.current) return null;
    try {
      const w = new Worker(new URL("../lib/scad/compile.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; result: CompileOutput }>) => {
        finishJob(e.data.id, e.data.result);
      };
      w.onerror = (e) => {
        console.warn("WebSCAD: compile worker failed, falling back to main thread.", e.message ?? e);
        workerBroken.current = true;
        workerRef.current = null;
        w.terminate();
        // re-run whatever was in flight on the main thread
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
  }, [finishJob, runOnMainThread]);

  const runJob = useCallback((job: Job) => {
    const id = ++jobId.current;
    setBusy(true);

    if (!workerRef.current && !workerBroken.current) workerRef.current = makeWorker();
    const w = workerRef.current;

    if (w && !workerBroken.current) {
      const timer = setTimeout(() => {
        // hung worker: kill and report
        w.terminate();
        workerRef.current = null;
        inFlight.current = null;
        if (id === jobId.current) {
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
      }, COMPILE_TIMEOUT_MS);
      inFlight.current = { id, job, timer };
      w.postMessage({ id, source: job.source, files: job.files });
    } else {
      runOnMainThread(id, job);
    }
  }, [makeWorker, runOnMainThread]);

  useEffect(() => {
    runJobRef.current = runJob;
  }, [runJob]);

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
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  return { compile, result, busy };
}

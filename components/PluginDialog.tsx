"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ParamValue, ToolPlugin } from "@/lib/plugins";
import { useCompiler } from "./useCompiler";

const Viewer = dynamic(() => import("./Viewer"), { ssr: false });

interface PluginDialogProps {
  plugin: ToolPlugin;
  onInsert: (code: string) => void;
  onClose: () => void;
}

export default function PluginDialog({ plugin, onInsert, onClose }: PluginDialogProps) {
  const [values, setValues] = useState<Record<string, ParamValue>>(() =>
    Object.fromEntries(plugin.params.map((p) => [p.key, p.default])),
  );
  const [showCode, setShowCode] = useState(false);
  const { compile, result, busy, generation } = useCompiler();

  const code = useMemo(() => plugin.generate(values), [plugin, values]);
  const previewCode = useMemo(() => plugin.preview(values), [plugin, values]);

  // debounced live preview
  useEffect(() => {
    const t = setTimeout(() => compile(previewCode, {}), 300);
    return () => clearTimeout(t);
  }, [previewCode, compile]);

  // Esc closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setValue = (key: string, v: ParamValue) =>
    setValues((prev) => ({ ...prev, [key]: v }));

  const meshes = result?.meshes ?? [];

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel" role="dialog" aria-label={plugin.name}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{plugin.name}</div>
            <div className="modal-blurb">{plugin.blurb}</div>
          </div>
          <button className="btn modal-close" onClick={onClose} title="Close (Esc)">✕</button>
        </div>

        <div className="modal-body">
          <div className="modal-params">
            {plugin.params.map((p) => (
              <label key={p.key} className="param-row" title={p.help}>
                <span className="param-label">{p.label}</span>
                {p.type === "bool" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(values[p.key])}
                    onChange={(e) => setValue(p.key, e.target.checked)}
                  />
                ) : p.type === "select" ? (
                  <select
                    className="select param-select"
                    value={String(values[p.key])}
                    onChange={(e) => setValue(p.key, e.target.value)}
                  >
                    {(p.options ?? []).map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : (
                  <span className="param-inputs">
                    {p.min !== undefined && p.max !== undefined && (
                      <input
                        type="range"
                        min={p.min}
                        max={p.max}
                        step={p.step ?? (p.type === "int" ? 1 : 0.1)}
                        value={Number(values[p.key])}
                        onChange={(e) => setValue(p.key, Number(e.target.value))}
                      />
                    )}
                    <input
                      className="param-number"
                      type="number"
                      min={p.min}
                      max={p.max}
                      step={p.step ?? (p.type === "int" ? 1 : 0.1)}
                      value={Number(values[p.key])}
                      onChange={(e) => {
                        const num = Number(e.target.value);
                        if (!Number.isNaN(num)) setValue(p.key, p.type === "int" ? Math.round(num) : num);
                      }}
                    />
                  </span>
                )}
              </label>
            ))}

            <button className="btn code-toggle" onClick={() => setShowCode((s) => !s)}>
              {showCode ? "Hide code" : "Show code"}
            </button>
            {showCode && <pre className="code-preview">{code}</pre>}
          </div>

          <div className="modal-preview">
            <Viewer meshes={meshes} frameToken={generation} />
            {result && !result.ok && (
              <div className="preview-error">ERROR: {result.error}</div>
            )}
            {busy && <div className="preview-busy">rendering…</div>}
          </div>
        </div>

        <div className="modal-footer">
          <span className="modal-hint">
            {result?.ok ? `${result.stats.triangles.toLocaleString()} triangles` : ""}
          </span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onInsert(code)}>
            Insert code
          </button>
        </div>
      </div>
    </div>
  );
}

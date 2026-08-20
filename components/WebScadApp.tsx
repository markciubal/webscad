"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import CodeMirror, { ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { openscadLanguage } from "./scadLanguage";
import { useCompiler } from "./useCompiler";
import PluginDialog from "./PluginDialog";
import { DEFAULT_FILE, loadWorkspace, normalizeFilename, saveActive, saveFiles } from "@/lib/storage";
import { EXAMPLES, findExample } from "@/lib/examples";
import { PLUGINS, findPlugin } from "@/lib/plugins";
import { downloadBlob, toBinaryStl, toObj } from "@/lib/export/exporters";

const Viewer = dynamic(() => import("./Viewer"), { ssr: false });

const AUTO_RENDER_DEBOUNCE_MS = 700;

export default function WebScadApp() {
  // this component is client-only (ssr: false), so localStorage is available
  // during the lazy state initializer
  const [workspace] = useState(loadWorkspace);
  const [files, setFiles] = useState<Record<string, string>>(workspace.files);
  const [active, setActive] = useState<string>(workspace.active);
  const [autoRender, setAutoRender] = useState(true);
  const [frameToken, setFrameToken] = useState(0);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [editorWidth, setEditorWidth] = useState(46); // percent
  const [activePluginId, setActivePluginId] = useState<string | null>(null);
  const cmRef = useRef<ReactCodeMirrorRef>(null);

  const { compile, result, busy } = useCompiler();
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // when true, the next compile result should re-frame the camera
  const pendingFrame = useRef(true);
  const filesRef = useRef(workspace.files);
  const activeRef = useRef(workspace.active);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const source = files[active] ?? "";

  // initial render of the loaded workspace
  useEffect(() => {
    compile(workspace.files[workspace.active] ?? "", workspace.files);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-frame the camera once the compile a file-switch/example-load triggered lands
  useEffect(() => {
    if (result && result.ok && pendingFrame.current) {
      pendingFrame.current = false;
      setFrameToken((t) => t + 1);
    }
  }, [result]);

  // persist to localStorage
  useEffect(() => {
    saveFiles(files);
  }, [files]);

  useEffect(() => {
    saveActive(active);
  }, [active]);

  const render = useCallback(() => {
    compile(filesRef.current[activeRef.current] ?? "", filesRef.current);
  }, [compile]);

  const onSourceChange = useCallback((value: string) => {
    setFiles((prev) => ({ ...prev, [activeRef.current]: value }));
    if (autoRender) {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        compile(filesRef.current[activeRef.current] ?? "", filesRef.current);
      }, AUTO_RENDER_DEBOUNCE_MS);
    }
  }, [autoRender, compile]);

  // file management
  const selectFile = (name: string) => {
    setActive(name);
    pendingFrame.current = true;
    compile(filesRef.current[name] ?? "", filesRef.current);
  };

  const newFile = () => {
    const name = normalizeFilename(prompt("New file name:", "untitled.scad") ?? "");
    if (!name) return;
    if (files[name] !== undefined && !confirm(`'${name}' exists. Overwrite?`)) return;
    setFiles((prev) => ({ ...prev, [name]: "// " + name + "\n\ncube(10);\n" }));
    setActive(name);
  };

  const renameFile = () => {
    const name = normalizeFilename(prompt("Rename file to:", active) ?? "");
    if (!name || name === active) return;
    if (files[name] !== undefined && !confirm(`'${name}' exists. Overwrite?`)) return;
    setFiles((prev) => {
      const next = { ...prev };
      next[name] = next[active];
      delete next[active];
      return next;
    });
    setActive(name);
  };

  const deleteFile = () => {
    if (!confirm(`Delete '${active}'? This cannot be undone.`)) return;
    setFiles((prev) => {
      const next = { ...prev };
      delete next[active];
      if (Object.keys(next).length === 0) next[DEFAULT_FILE] = "// empty\ncube(10);\n";
      const nextActive = Object.keys(next)[0];
      setActive(nextActive);
      setTimeout(() => compile(next[nextActive] ?? "", next), 0);
      return next;
    });
  };

  const loadExample = (name: string) => {
    if (!name) return;
    const code = findExample(name);
    if (!code) return;
    const fileName = normalizeFilename(name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    setFiles((prev) => ({ ...prev, [fileName]: code }));
    setActive(fileName);
    pendingFrame.current = true;
    setTimeout(() => {
      compile(code, { ...filesRef.current, [fileName]: code });
    }, 0);
  };

  const uploadScad = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".scad,.txt";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const text = await f.text();
      const name = normalizeFilename(f.name);
      setFiles((prev) => ({ ...prev, [name]: text }));
      setActive(name);
      pendingFrame.current = true;
      setTimeout(() => {
        compile(text, { ...filesRef.current, [name]: text });
      }, 0);
    };
    input.click();
  };

  // tool plugins: insert generated code at the cursor's line end
  const insertPluginCode = (code: string) => {
    const snippet = "\n" + code.trim() + "\n";
    const view = cmRef.current?.view;
    if (view) {
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      view.dispatch({
        changes: { from: line.to, insert: snippet },
        selection: { anchor: line.to + snippet.length },
        scrollIntoView: true,
      });
      view.focus();
    } else {
      onSourceChange(source + snippet);
    }
    setActivePluginId(null);
  };

  // exports
  const meshes = useMemo(() => result?.meshes ?? [], [result]);
  const canExport = result?.ok && meshes.some((m) => !m.background);

  const exportStl = () => {
    if (!result?.ok) return;
    downloadBlob(toBinaryStl(meshes), active.replace(/\.scad$/i, "") + ".stl");
  };
  const exportObj = () => {
    if (!result?.ok) return;
    downloadBlob(toObj(meshes), active.replace(/\.scad$/i, "") + ".obj");
  };
  const exportScad = () => {
    downloadBlob(new Blob([source], { type: "text/plain" }), active);
  };

  // keyboard: Ctrl+Enter / F5 renders
  const renderKeymap = useMemo(
    () =>
      Prec.highest(
        // eslint-disable-next-line react-hooks/refs -- run callbacks fire on key events, not during render
        keymap.of([
          { key: "Ctrl-Enter", run: () => { render(); return true; } },
          { key: "F5", run: () => { render(); return true; } },
        ]),
      ),
    [render],
  );

  // divider drag
  const onDividerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = editorWidth;
    const total = window.innerWidth;
    const onMove = (ev: PointerEvent) => {
      const pct = startWidth + ((ev.clientX - startX) / total) * 100;
      setEditorWidth(Math.min(75, Math.max(20, pct)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const extensions = useMemo(() => [openscadLanguage(), renderKeymap], [renderKeymap]);

  const fileNames = Object.keys(files).sort();
  const stats = result?.stats;

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">◧</span> WebSCAD
        </div>

        <div className="toolbar-group">
          <select className="select" value={active} onChange={(e) => selectFile(e.target.value)} title="Workspace files (stored in your browser)">
            {fileNames.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <button className="btn" onClick={newFile} title="New file">New</button>
          <button className="btn" onClick={renameFile} title="Rename current file">Rename</button>
          <button className="btn" onClick={deleteFile} title="Delete current file">Delete</button>
          <button className="btn" onClick={uploadScad} title="Open a .scad file from disk">Open…</button>
        </div>

        <div className="toolbar-group">
          <select
            className="select"
            value=""
            onChange={(e) => setActivePluginId(e.target.value || null)}
            title="Code-generating tools: configure in a dialog, insert into the editor"
          >
            <option value="" disabled>Tools…</option>
            {PLUGINS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select className="select" value="" onChange={(e) => loadExample(e.target.value)} title="Load an example">
            <option value="" disabled>Examples…</option>
            {Object.entries(EXAMPLES).map(([group, items]) => (
              <optgroup key={group} label={group}>
                {Object.keys(items).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="toolbar-group">
          <button className="btn btn-primary" onClick={render} disabled={busy} title="Render (Ctrl+Enter)">
            {busy ? "Rendering…" : "▶ Render"}
          </button>
          <label className="checkbox">
            <input type="checkbox" checked={autoRender} onChange={(e) => setAutoRender(e.target.checked)} />
            auto
          </label>
          <button className="btn" onClick={() => setFrameToken((t) => t + 1)} title="Fit view to model">⌖ Fit</button>
        </div>

        <div className="toolbar-group toolbar-right">
          <button className="btn" onClick={exportScad} title="Download the .scad source">.scad</button>
          <button className="btn btn-export" onClick={exportStl} disabled={!canExport} title="Export binary STL">⬇ STL</button>
          <button className="btn btn-export" onClick={exportObj} disabled={!canExport} title="Export Wavefront OBJ">⬇ OBJ</button>
        </div>
      </header>

      <main className="main" style={{ gridTemplateColumns: `${editorWidth}% 6px 1fr` }}>
        <section className="editor-pane">
          <CodeMirror
            ref={cmRef}
            value={source}
            onChange={onSourceChange}
            theme={oneDark}
            extensions={extensions}
            height="100%"
            style={{ height: "100%" }}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              highlightActiveLine: true,
              autocompletion: true,
              bracketMatching: true,
              closeBrackets: true,
              indentOnInput: true,
            }}
          />
        </section>

        <div className="divider" onPointerDown={onDividerDown} />

        <section className="viewer-pane">
          <Viewer meshes={meshes} frameToken={frameToken} />
          {stats && (
            <div className="stats-overlay">
              {stats.triangles.toLocaleString()} tris · {stats.timeMs} ms
              {busy ? " · rendering…" : ""}
            </div>
          )}
        </section>
      </main>

      <section className={"console" + (consoleOpen ? "" : " console-closed")}>
        <div className="console-header" onClick={() => setConsoleOpen((o) => !o)}>
          <span>Console</span>
          {result && !result.ok && <span className="badge badge-error">error</span>}
          {result && result.ok && result.warnings.length > 0 && (
            <span className="badge badge-warn">{result.warnings.length} warning{result.warnings.length > 1 ? "s" : ""}</span>
          )}
          <span className="console-toggle">{consoleOpen ? "▾" : "▸"}</span>
        </div>
        {consoleOpen && (
          <div className="console-body">
            {!result && <div className="console-line console-muted">Ready.</div>}
            {result?.error && (
              <div className="console-line console-error">
                ERROR: {result.error}
                {result.errorLine != null ? ` (line ${result.errorLine})` : ""}
              </div>
            )}
            {result?.warnings.map((w, i) => (
              <div key={"w" + i} className="console-line console-warn">WARNING: {w}</div>
            ))}
            {result?.echo.map((line, i) => (
              <div key={"e" + i} className="console-line">{line}</div>
            ))}
            {result?.ok && (
              <div className="console-line console-muted">
                Rendered {result.stats.triangles.toLocaleString()} triangles in {result.stats.timeMs} ms.
              </div>
            )}
          </div>
        )}
      </section>

      {activePluginId && (() => {
        const plugin = findPlugin(activePluginId);
        if (!plugin) return null;
        return (
          <PluginDialog
            plugin={plugin}
            onInsert={insertPluginCode}
            onClose={() => setActivePluginId(null)}
          />
        );
      })()}
    </div>
  );
}

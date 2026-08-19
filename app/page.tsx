"use client";

import dynamic from "next/dynamic";

const WebScadApp = dynamic(() => import("@/components/WebScadApp"), {
  ssr: false,
  loading: () => (
    <div className="boot-screen">
      <div className="boot-logo">◧ WebSCAD</div>
      <div className="boot-sub">loading workspace…</div>
    </div>
  ),
});

export default function Home() {
  return <WebScadApp />;
}

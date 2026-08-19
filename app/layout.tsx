import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebSCAD — OpenSCAD in your browser",
  description:
    "A browser-based OpenSCAD-compatible 3D CAD environment. Write parametric models in OpenSCAD language, render them with WebGL, and export STL/OBJ — everything runs locally, files live in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

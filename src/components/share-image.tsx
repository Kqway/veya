import { ImageResponse } from "next/og";
import type { InvitePreview } from "@/features/entry/preview";
export function shareImage(preview: InvitePreview) {
  // The bundled font guarantees printable ASCII. Other names stay in metadata;
  // the image uses generic copy to avoid external emoji/font fetches entirely.
  const normalized = preview.title
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .trim();
  const title = /^[\x20-\x7E]{1,100}$/.test(normalized)
    ? normalized
    : "Good plans start with your people.";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 76px",
          background: "#f8f6ef",
          color: "#252720",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", fontSize: 48, fontWeight: 700 }}>
          <span style={{ color: "#c7432b", marginRight: 14 }}>*</span>veya.
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.12,
              letterSpacing: "-2px",
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 29,
              color: "#696b60",
              marginTop: 30,
              lineHeight: 1.45,
            }}
          >
            {preview.description}
          </div>
        </div>
        <div style={{ display: "flex", color: "#c7432b", fontSize: 23 }}>
          Less planning. More living. · No account needed.
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "no-store" } },
  );
}

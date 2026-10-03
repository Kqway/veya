import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InvitePreview } from "@/features/entry/preview";
let fontData: Promise<[Buffer, Buffer]> | undefined;
export async function shareImage(preview: InvitePreview) {
  // Local fonts cover Latin and Russian without tracking or network font fetches.
  // Unsupported scripts/emoji remain in metadata and use generic image copy.
  fontData ??= Promise.all([
    readFile(join(process.cwd(), "public/fonts/DejaVuSans.ttf")),
    readFile(join(process.cwd(), "public/fonts/DejaVuSans-Bold.ttf")),
  ]);
  const [regular, bold] = await fontData;
  const normalized = preview.title
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .trim();
  const title = /^[\x20-\x7EА-Яа-яЁё—–«»…№]{1,100}$/u.test(normalized)
    ? normalized
    : "Хорошие встречи начинаются с идеи.";
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
          fontFamily: "DejaVu Sans",
        }}
      >
        <div style={{ display: "flex", fontSize: 48, fontWeight: 700 }}>
          <span style={{ color: "#c7432b", marginRight: 14 }}>*</span>intavro.
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
          Меньше планирования. Больше жизни. · Без регистрации.
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "no-store" }, fonts: [
      { name: "DejaVu Sans", data: regular, weight: 400, style: "normal" },
      { name: "DejaVu Sans", data: bold, weight: 700, style: "normal" },
    ] },
  );
}

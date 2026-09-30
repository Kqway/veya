export type ExampleIconKind = "friends" | "tonight" | "trip" | "games" | "study";

const paths: Record<ExampleIconKind, string> = {
  friends: "M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2m0-15a4 4 0 0 1 0 7m3 2a5 5 0 0 1 3 4v2",
  tonight: "M20 15A9 9 0 0 1 9 3a9 9 0 1 0 11 12Z",
  trip: "m2 19 7-13 4 7 3-5 6 11H2Zm4-7 3 2 3-3",
  games: "M8 7h8a5 5 0 0 1 5 4l1 6c.5 3-3 4-5 1l-2-2H9l-2 2c-2 3-5.5 2-5-1l1-6a5 5 0 0 1 5-4Zm-1 3v5m-2.5-2.5h5M16 11h.01M18 14h.01",
  study: "M12 6C9 3 5 3 2 4v15c3-1 7-1 10 2m0-15c3-3 7-3 10-2v15c-3-1-7-1-10 2V6Z",
};

/** SVG icons stay legible on systems without a Unicode symbol fallback font. */
export function ExampleIcon({ kind }: { kind: ExampleIconKind }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d={paths[kind]} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

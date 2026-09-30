import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Veya home">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <path d="m16 2 3.1 8.5L27 5l-5.5 7.9L30 16l-8.5 3.1L27 27l-7.9-5.5L16 30l-3.1-8.5L5 27l5.5-7.9L2 16l8.5-3.1L5 5l7.9 5.5L16 2Z" fill="currentColor" />
        <circle cx="16" cy="16" r="3" fill="var(--paper)" />
      </svg>
      <span>veya<span className="brand-dot">.</span></span>
    </Link>
  );
}

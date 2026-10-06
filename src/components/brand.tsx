import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="Главная Veya">
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.3"/>
        <ellipse cx="16" cy="16" rx="14" ry="5.5" stroke="currentColor" strokeWidth="1.3" transform="rotate(-38 16 16)"/>
        <circle cx="24" cy="8" r="2.4" fill="currentColor"/>
      </svg>
      <span>veya</span>
    </Link>
  );
}

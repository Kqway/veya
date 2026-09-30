/** Local decorative artwork. No remote assets or personal photos. */
export function PlanDoodle({ variant }: { variant: "sun" | "orbit" }) {
  return variant === "sun" ? (
    <svg className="plan-doodle doodle-sun" width="110" height="110" viewBox="0 0 110 110" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <circle cx="55" cy="55" r="25" />
        <path d="M55 9v12m0 68v12M9 55h12m68 0h12M23 23l9 9m46 46 9 9M23 87l9-9m46-46 9-9" />
        <path d="M44 51v4m22-4v4m-23 8q12 13 24 0" />
      </g>
    </svg>
  ) : (
    <svg className="plan-doodle doodle-orbit" width="140" height="140" viewBox="0 0 140 140" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <ellipse cx="70" cy="70" rx="54" ry="21" transform="rotate(-28 70 70)" />
        <ellipse cx="70" cy="70" rx="54" ry="21" transform="rotate(38 70 70)" />
        <circle cx="70" cy="70" r="8" fill="currentColor" />
        <circle cx="113" cy="48" r="6" fill="var(--paper)" />
      </g>
    </svg>
  );
}

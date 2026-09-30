export function LoadingPlan({ results = false }: { results?: boolean }) {
  return (
    <section
      className="message-page loading-plan"
      aria-busy="true"
      aria-label={results ? "Loading results" : "Loading invite"}
    >
      <p className="eyebrow">A little less back-and-forth</p>
      <h1>{results ? "Finding a good time…" : "Finding your plan…"}</h1>
      <p role="status">
        {results
          ? "Bringing everyone's times together."
          : "Getting your invite ready."}
      </p>
      <div className="loading-shapes" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </section>
  );
}

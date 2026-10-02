import { PlanDoodle } from "@/components/plan-doodle";
import { IntentComposer } from "@/features/intents/components/intent-composer";

const steps = [
  {
    title: "Say the thing",
    copy: "Dinner, a game night, a little adventure. Start with what you want to do.",
  },
  {
    title: "Bring your people",
    copy: "Find people who want the same activity. Send Interested; a private chat opens after they accept.",
  },
  {
    title: "Find your moment",
    copy: "Choose Plan it in your chat, add availability, and agree on a time. Or invite friends to your own plan.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <PlanDoodle variant="sun" />
        <PlanDoodle variant="orbit" />
        <p className="hero-badge">
          <span aria-hidden="true" />
          Less planning. More living.
        </p>
        <h1 id="hero-title">
          Less “we should.”
          <br />
          More <span>“let’s do it.”</span>
        </h1>
        <p className="hero-description">
          Something you want to do?
          <br className="mobile-break" /> Find your people. Make it happen
          together.
        </p>
        <div className="composer-container">
          <IntentComposer />
        </div>
        <p className="hero-postscript">
          For the plans that deserve to leave the group chat.
        </p>
      </section>
      <section
        className="how-it-works"
        id="how-it-works"
        aria-labelledby="how-title"
      >
        <div className="how-heading">
          <p className="eyebrow">From a thought to a good time</p>
          <h2 id="how-title">
            Big on possibility.
            <br />
            Small on planning.
          </h2>
        </div>
        <ol className="steps">
          {steps.map((step, index) => (
            <li key={step.title}>
              <span className="step-number" aria-hidden="true">
                0{index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.copy}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

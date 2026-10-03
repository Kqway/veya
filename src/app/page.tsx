import { PlanDoodle } from "@/components/plan-doodle";
import { IntentComposer } from "@/features/intents/components/intent-composer";

const steps = [
  {
    title: "Расскажите об идее",
    copy: "Шахматы, прогулка, ужин или небольшое приключение. Начните с того, чем хотите заняться.",
  },
  {
    title: "Найдите компанию",
    copy: "Найдите людей с похожими планами. Отправьте запрос — после принятия откроется личный чат.",
  },
  {
    title: "Договоритесь о встрече",
    copy: "Нажмите «Организовать встречу» в чате, укажите свободное время и выберите подходящий вариант. Или пригласите друзей в свой план.",
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
          Меньше планирования. Больше жизни.
        </p>
        <h1 id="hero-title">
          От «надо бы»
          <br />
          к <span>«давай сделаем».</span>
        </h1>
        <p className="hero-description">
          Есть идея, чем заняться?
          <br className="mobile-break" /> Найдите компанию и воплотите её вместе.
        </p>
        <div className="composer-container">
          <IntentComposer />
        </div>
        <p className="hero-postscript">
          Для планов, которым пора выйти за пределы переписки.
        </p>
      </section>
      <section
        className="how-it-works"
        id="how-it-works"
        aria-labelledby="how-title"
      >
        <div className="how-heading">
          <p className="eyebrow">От идеи к хорошей встрече</p>
          <h2 id="how-title">
            Больше возможностей.
            <br />
            Меньше хлопот.
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

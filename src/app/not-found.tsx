import Link from "next/link";
import { ArrowIcon } from "@/components/arrow-icon";

export default function NotFound() {
  return (
    <section className="message-page">
      <p className="eyebrow">Небольшой поворот</p>
      <h1>Страница не найдена.</h1>
      <p>Вернёмся к вашей следующей идее.</p>
      <Link href="/" className="button button-primary">На главную Veya <ArrowIcon /></Link>
    </section>
  );
}

import Link from "next/link";
import { ArrowIcon } from "@/components/arrow-icon";

export default function NotFound() {
  return (
    <section className="message-page">
      <p className="eyebrow">A little detour</p>
      <h1>This page wandered off.</h1>
      <p>Let&apos;s get you back to a good idea.</p>
      <Link href="/" className="button button-primary">Back to Veya <ArrowIcon /></Link>
    </section>
  );
}

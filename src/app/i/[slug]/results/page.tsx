import type { Metadata } from "next";
import { ResultsScreen } from "@/features/scheduling/components/results-screen";
export const metadata: Metadata = {
  title: "План встречи",
  robots: { index: false, follow: false },
};
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ResultsScreen key={slug} slug={slug} />;
}

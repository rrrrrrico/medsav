"use client";

import { CalculatorView } from "@/components/calculator-view";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-background to-background/90">
      <CalculatorView />
    </main>
  );
}

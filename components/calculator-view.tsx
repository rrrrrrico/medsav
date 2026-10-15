"use client";

import React from "react";
import { useState } from "react";
import { Calculator } from "@/components/calculator";
import { AppHeader } from "@/components/app-header";
import { cn } from "@/lib/utils";

export function CalculatorView() {
  const [language, setLanguage] = useState<'en' | 'zh'>('zh');
  
  return (
    <div className={cn(
      "flex flex-col w-full min-h-screen",
      "animate-in fade-in duration-500"
    )}>
      <AppHeader language={language} setLanguage={setLanguage} />
      <div className="container max-w-7xl mx-auto px-4 py-6 flex-1">
        <Calculator language={language} />
      </div>
      <footer className="border-t bg-background/50 backdrop-blur-sm">
        <div className="container max-w-7xl mx-auto px-4 py-4 text-center text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} MedSav
        </div>
      </footer>
    </div>
  );
}
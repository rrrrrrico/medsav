"use client";

import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface AppHeaderProps {
  language: 'en' | 'zh';
  setLanguage: (language: 'en' | 'zh') => void;
}

export function AppHeader({ language, setLanguage }: AppHeaderProps) {
  const pathname = usePathname();
  const linkClass = (href: string) =>
    cn(
      "text-sm px-2 py-1 rounded-md hover:bg-accent",
      pathname === href ? "bg-accent font-medium" : "text-muted-foreground"
    );

  return (
    <header className={cn(
      "sticky top-0 z-50",
      "border-b bg-background/50 backdrop-blur-sm"
    )}>
      <div className="container max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-5 text-primary"
            >
              <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
              <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
              <path d="M18 15h-4" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              MedSav
            </h1>
            <p className="text-xs text-muted-foreground">
              {language === 'en' ? 'Medical Finance Calculator' : '醫療融資計算機'}
            </p>
          </div>
        </Link>
        
        <nav className="flex items-center gap-1">
          <Link href="/" className={linkClass("/")}>
            {language === "en" ? "Calculator" : "計算機"}
          </Link>
          <Link href="/insights" className={linkClass("/insights")}>
            {language === "en" ? "Insights" : "數據分析"}
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Languages className="size-5" />
                <span className="sr-only">Toggle language</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setLanguage('en')}>
                English
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setLanguage('zh')}>
                中文
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
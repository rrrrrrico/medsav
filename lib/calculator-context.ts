import { createContext, useContext } from "react";

export interface PlanState {
  company: string;
  planName: string;
  planType: string;
  monthlyPremium: number;
  additionalPremium: number;
  enabled: boolean;
  hasRider: boolean;
  premium: Record<string, Record<number, number>>;
  statusString: string;
  currency: string;
}

export interface SavingsPlanState {
  monthlySavings: number;
  years: number;
  returnRate: number;
  useMedicalSavings: number;
  inflationRate: number;
  showInflation: boolean;
}

export interface CalculatorState {
  name: string;
  gender: "male" | "female";
  birthDate: string;  // YYYY-MM-DD format
  currentAge: number;
  retirementAge: number;
  maxAge: number;
  isSmoker: boolean;
  planA: PlanState;
  planB: PlanState;
  savingsPlan: SavingsPlanState;
}

// Helper function to calculate age from birth date
export function calculateAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

// Get today's date in YYYY-MM-DD format
function getTodayString(): string {
  const today = new Date();
  const year = today.getFullYear() - 30; // Default to 30 years ago
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const defaultCalculatorState: CalculatorState = {
  name: "",
  gender: "female",
  birthDate: getTodayString(),
  currentAge: calculateAge(getTodayString()),
  retirementAge: 65,
  maxAge: 90,
  isSmoker: false,
  planA: {
    company: "AIA",
    planName: "Self-Protection Plan A",
    planType: "Standard Housing",
    monthlyPremium: 0,
    additionalPremium: 0,
    enabled: true,
    hasRider: false,
    premium: {},
    statusString: "",
    currency: "HKD"
  },
  planB: {
    company: "AIA",
    planName: "Self-Protection Plan B",
    planType: "Self-Pay 25000",
    monthlyPremium: 0,
    additionalPremium: 0,
    enabled: true,
    hasRider: false,
    premium: {},
    statusString: "",
    currency: "HKD"
  },
  savingsPlan: {
    monthlySavings: 5000,
    years: 5,
    returnRate: 6.5,
    useMedicalSavings: 65,
    inflationRate: 2,
    showInflation: true
  }
};

export interface CalculatorContextType {
  state: CalculatorState;
  setState: React.Dispatch<React.SetStateAction<CalculatorState>>;
}

export const CalculatorContext = createContext<CalculatorContextType | undefined>(undefined);

export function useCalculator() {
  const context = useContext(CalculatorContext);
  if (context === undefined) {
    throw new Error("useCalculator must be used within a CalculatorProvider");
  }
  return context;
}
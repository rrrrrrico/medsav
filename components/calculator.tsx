"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { PlanCalculator } from "@/components/plan-calculator";
import { Results } from "@/components/results";
import { PersonalInfoForm } from "@/components/personal-info-form";
import { CalculatorContext, defaultCalculatorState } from "@/lib/calculator-context";
import { translations } from "@/lib/translations";

interface CalculatorProps {
  language: 'en' | 'zh';
}

export function Calculator({ language }: CalculatorProps) {
  const t = translations[language];
  const [state, setState] = useState(defaultCalculatorState);
  
  // Calculate results based on current state
  const calculateResults = () => {
    // Currency conversion rate
    const getConvertedAmount = (amount: number, currency: string) => {
      return currency === 'USD' ? amount * 7.8 : amount;
    };

    const inflationRate = state.savingsPlan.inflationRate / 100;

    // Plan A results
    const planAPremiums = state.planA.premium[state.planA.statusString] || {};
    
    // Calculate total premiums for each phase for Plan A
    let earlyPhaseA = 0;
    let latePhaseA = 0;
    let earlyPhaseInflatedA = 0;
    let latePhaseInflatedA = 0;
    
    // Split based on Medical Savings Usage Age
    const splitAge = state.savingsPlan.useMedicalSavings;
    
    // Early phase (current age to splitAge - 1)
    for (let age = state.currentAge; age < splitAge; age++) {
      try {
        const premium = planAPremiums[age];
        if (premium) {
          const totalPremium = premium * (1 + state.planA.additionalPremium / 100);
          const converted = getConvertedAmount(totalPremium, state.planA.currency);
          earlyPhaseA += converted;
          
          const yearsFromCurrent = age - state.currentAge;
          earlyPhaseInflatedA += converted * Math.pow(1 + inflationRate, Math.max(0, yearsFromCurrent));
        }
      } catch {
        // Skip if premium not found for this age
      }
    }
    
    // Late phase (splitAge to max age)
    for (let age = splitAge; age <= state.maxAge; age++) {
      try {
        const premium = planAPremiums[age];
        if (premium) {
          const totalPremium = premium * (1 + state.planA.additionalPremium / 100);
          const converted = getConvertedAmount(totalPremium, state.planA.currency);
          latePhaseA += converted;
          
          const yearsFromCurrent = age - state.currentAge;
          latePhaseInflatedA += converted * Math.pow(1 + inflationRate, Math.max(0, yearsFromCurrent));
        }
      } catch {
        // Skip if premium not found for this age
      }
    }
    
    const totalA = earlyPhaseA + latePhaseA;
    const totalInflatedA = earlyPhaseInflatedA + latePhaseInflatedA;
    
    // Plan B results
    const planBPremiums = state.planB.premium[state.planB.statusString] || {};
    
    // Calculate total premiums for each phase for Plan B
    let earlyPhaseB = 0;
    let latePhaseB = 0;
    let earlyPhaseInflatedB = 0;
    let latePhaseInflatedB = 0;
    
    // Early phase (current age to splitAge - 1)
    for (let age = state.currentAge; age < splitAge; age++) {
      try {
        const premium = planBPremiums[age];
        if (premium) {
          const totalPremium = premium * (1 + state.planB.additionalPremium / 100);
          const converted = getConvertedAmount(totalPremium, state.planB.currency);
          earlyPhaseB += converted;
          
          const yearsFromCurrent = age - state.currentAge;
          earlyPhaseInflatedB += converted * Math.pow(1 + inflationRate, Math.max(0, yearsFromCurrent));
        }
      } catch {
        // Skip if premium not found for this age
      }
    }
    
    // Late phase (splitAge to max age)
    for (let age = splitAge; age <= state.maxAge; age++) {
      try {
        const premium = planBPremiums[age];
        if (premium) {
          const totalPremium = premium * (1 + state.planB.additionalPremium / 100);
          const converted = getConvertedAmount(totalPremium, state.planB.currency);
          latePhaseB += converted;
          
          const yearsFromCurrent = age - state.currentAge;
          latePhaseInflatedB += converted * Math.pow(1 + inflationRate, Math.max(0, yearsFromCurrent));
        }
      } catch {
        // Skip if premium not found for this age
      }
    }
    
    const totalB = earlyPhaseB + latePhaseB;
    const totalInflatedB = earlyPhaseInflatedB + latePhaseInflatedB;
    
    return {
      planA: {
        basePremium: getConvertedAmount(planAPremiums[state.currentAge] || 0, state.planA.currency),
        earlyPhase: earlyPhaseA,
        latePhase: latePhaseA,
        total: totalA,
        earlyPhaseInflated: Math.round(earlyPhaseInflatedA),
        latePhaseInflated: Math.round(latePhaseInflatedA),
        totalInflated: Math.round(totalInflatedA)
      },
      planB: {
        basePremium: getConvertedAmount(planBPremiums[state.currentAge] || 0, state.planB.currency),
        earlyPhase: earlyPhaseB,
        latePhase: latePhaseB,
        total: totalB,
        earlyPhaseInflated: Math.round(earlyPhaseInflatedB),
        latePhaseInflated: Math.round(latePhaseInflatedB),
        totalInflated: Math.round(totalInflatedB)
      }
    };
  };
  
  const results = calculateResults();
  
  return (
    <CalculatorContext.Provider value={{ state, setState }}>
      <div className="space-y-6">
        <PersonalInfoForm language={language} />
        
        <Card>
          <CardHeader>
            <CardTitle>{t.insurancePlans}</CardTitle>
            <CardDescription>{t.planSettings}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <PlanCalculator plan="A" language={language} />
                <PlanCalculator plan="B" language={language} />
              </div>
              
              <Results results={results} language={language} />
            </div>
          </CardContent>
        </Card>
      </div>
    </CalculatorContext.Provider>
  );
}

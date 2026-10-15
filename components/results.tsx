"use client";

import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ChevronDown } from "lucide-react";
import { translations } from "@/lib/translations";
import { useCalculator } from "@/lib/calculator-context";
import dynamic from 'next/dynamic';
import React, { useState, useCallback } from 'react';
import * as XLSX from 'xlsx';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface ResultsProps {
  results: {
    planA: {
      basePremium: number;
      earlyPhase: number;
      latePhase: number;
      total: number;
      earlyPhaseInflated: number;
      latePhaseInflated: number;
      totalInflated: number;
    };
    planB: {
      basePremium: number;
      earlyPhase: number;
      latePhase: number;
      total: number;
      earlyPhaseInflated: number;
      latePhaseInflated: number;
      totalInflated: number;
    };
  };
  language: 'en' | 'zh';
}

export function Results({ results, language }: ResultsProps) {
  const { state } = useCalculator();
  const t = translations[language];
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [searchTerm] = useState('');

  type TableRow = {
    age: number;
    savings: number;
    planAStandard: number;
    planBStandard: number;
    planAInflated: number;
    planBInflated: number;
    totalStandardPremium: number;
    totalInflatedPremium: number;
    remainingStandard: number;
    remainingInflated: number;
  };

  // Filter function for insurance companies
  const filterByInsuranceCompany = useCallback((data: TableRow[]) => {
    if (!searchTerm) return data;
    const company = state.planA.company.toLowerCase();
    if (!company.includes(searchTerm.toLowerCase())) return [];
    return data;
  }, [searchTerm, state.planA.company]);

  // Sort function
  const sortData = (data: TableRow[], key: keyof TableRow, direction: 'asc' | 'desc') => {
    return [...data].sort((a, b) => {
      const aValue = a[key];
      const bValue = b[key];
      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return direction === 'asc' ? aValue - bValue : bValue - aValue;
      }
      return direction === 'asc' 
        ? String(aValue).localeCompare(String(bValue))
        : String(bValue).localeCompare(String(aValue));
    });
  };

  // Handle sort click
  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Get sort indicator
  const getSortIndicator = (key: string) => {
    if (!sortConfig || sortConfig.key !== key) return '↕';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-HK', {
      style: 'decimal',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Currency conversion rate
  const getConvertedAmount = (amount: number, currency: string) => {
    return currency === 'USD' ? amount * 7.8 : amount;
  };

  // Generate age range labels
  const getAgeRanges = () => {
    const { currentAge, maxAge, savingsPlan } = state;
    const splitAge = savingsPlan.useMedicalSavings;
    const earlyPhase = `${currentAge} - ${splitAge - 1} ${language === 'en' ? 'years' : '歲'}`;
    const latePhase = `${splitAge} - ${maxAge} ${language === 'en' ? 'years' : '歲'}`;
    return { earlyPhase, latePhase };
  };

  const ageRanges = getAgeRanges();

  const renderPlanResults = (plan: 'planA' | 'planB', planResults: typeof results.planA) => {
    const isEnabled = plan === 'planA' ? state.planA.enabled : state.planB.enabled;
    const displayResults = isEnabled ? planResults : {
      basePremium: 0,
      earlyPhase: 0,
      latePhase: 0,
      total: 0,
      earlyPhaseInflated: 0,
      latePhaseInflated: 0,
      totalInflated: 0
    };

    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-sm text-muted-foreground">{ageRanges.earlyPhase}</div>
          <div className="text-sm text-right">{t.currency} {formatCurrency(displayResults.earlyPhase)}</div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-sm text-muted-foreground">{ageRanges.latePhase}</div>
          <div className="text-sm text-right">{t.currency} {formatCurrency(displayResults.latePhase)}</div>
        </div>
        <Separator />
        <div className="grid grid-cols-2 gap-4">
          <div className="text-sm font-semibold">{t.total}</div>
          <div className="text-sm text-right font-semibold">{t.currency} {formatCurrency(displayResults.total)}</div>
        </div>
        {state.savingsPlan.showInflation && (
          <>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="text-sm text-muted-foreground">{ageRanges.earlyPhase} ({t.afterInflation})</div>
              <div className="text-sm text-right">{t.currency} {formatCurrency(displayResults.earlyPhaseInflated)}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-sm text-muted-foreground">{ageRanges.latePhase} ({t.afterInflation})</div>
              <div className="text-sm text-right">{t.currency} {formatCurrency(displayResults.latePhaseInflated)}</div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="text-sm font-semibold">{t.total} ({t.afterInflation})</div>
              <div className="text-sm text-right font-semibold">{t.currency} {formatCurrency(displayResults.totalInflated)}</div>
            </div>
          </>
        )}
      </div>
    );
  };

  // Calculate total yearly premium
  const getTotalYearlyPremium = () => {
    return (state.planA.enabled ? results.planA.total : 0) + 
           (state.planB.enabled ? results.planB.total : 0);
  };

  // Calculate medical savings
  const calculateMedicalSavings = () => {
    const { monthlySavings, returnRate, years: contributionYears } = state.savingsPlan;
    const annualRate = returnRate / 100;
    
    // Calculate accumulated savings at usage age
    let savings = 0;
    let prevSavings = 0;
    
    for (let age = state.currentAge; age <= state.savingsPlan.useMedicalSavings; age++) {
      if (age === state.currentAge) {
        savings = monthlySavings * 12;
      } else {
        const isInContributionPeriod = age - state.currentAge < contributionYears;
        const annualContribution = isInContributionPeriod ? monthlySavings * 12 : 0;
        savings = (prevSavings + annualContribution) * (1 + annualRate);
      }
      prevSavings = savings;
    }

    // Calculate total medical reserve payments
    const medicalReservePayments = getTotalYearlyPremium();

    // Calculate principal
    const principal = monthlySavings * 12 * contributionYears;

    return {
      principal,
      medicalReservePayments,
      accumulatedSavings: savings
    };
  };

  const medicalSavings = calculateMedicalSavings();

  const calculateAccumulatedSavings = () => medicalSavings.accumulatedSavings;

  // Calculate total premiums AFTER useMedicalSavings
  const calculateTotalPremiumAfterUsage = (useInflation: boolean = false) => {
    let total = 0;
    const inflationRate = state.savingsPlan.inflationRate / 100;

    for (let age = state.savingsPlan.useMedicalSavings; age <= state.maxAge; age++) {
      const getPremium = (plan: 'planA' | 'planB') => {
        if (state[plan].enabled && state[plan].statusString && state[plan].premium[state[plan].statusString]?.[age]) {
          let premium = state[plan].premium[state[plan].statusString][age];
          premium = premium * (1 + state[plan].additionalPremium / 100);
          return getConvertedAmount(premium, state[plan].currency);
        }
        return 0;
      };

      const planAPremium = getPremium('planA');
      const planBPremium = getPremium('planB');
      
      let yearlyPremium = planAPremium + planBPremium;
      
      if (useInflation) {
         const yearsFromCurrent = age - state.currentAge;
         yearlyPremium = yearlyPremium * Math.pow(1 + inflationRate, Math.max(0, yearsFromCurrent));
      }
      
      total += yearlyPremium;
    }
    return total;
  };
  
  const totalPremiumAfterUsageStandard = calculateTotalPremiumAfterUsage(false);
  const totalPremiumAfterUsageInflated = calculateTotalPremiumAfterUsage(true);


  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.results}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div>
              <h3 className="text-lg font-semibold mb-4">{t.planA}</h3>
              {renderPlanResults('planA', results.planA)}
            </div>
            <div>
              <h3 className="text-lg font-semibold mb-4">{t.planB}</h3>
              {renderPlanResults('planB', results.planB)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.medicalFinancing}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-sm text-muted-foreground">{t.principal}</div>
              <div className="text-sm text-right">{t.currency} {formatCurrency(medicalSavings.principal)}</div>
            </div>
            {state.planA.enabled && results.planA.total > 0 && (
              <div className="grid grid-cols-2 gap-4">
                <div className="text-sm text-muted-foreground">
                  {language === 'en' 
                    ? `Plan A Last Age`
                    : '計劃A最後年齡'
                  }
                </div>
                <div className="text-sm text-right">
                  {(() => {
                    const planA = state.planA;
                    if (planA.statusString && planA.premium[planA.statusString]) {
                      const ages = Object.keys(planA.premium[planA.statusString]).map(Number).filter(n => !isNaN(n));
                      if (ages.length > 0) {
                      const lastAge = Math.max(...ages);
                      return `${lastAge} ${language === 'en' ? 'years old' : '歲'}`;
                      }
                    }
                    return '-';
                  })()}
                </div>
              </div>
            )}
            {state.planB.enabled && results.planB.total > 0 && (
              <div className="grid grid-cols-2 gap-4">
                <div className="text-sm text-muted-foreground">
                  {language === 'en' 
                    ? `Plan B Last Age`
                    : '計劃B最後年齡'
                  }
                </div>
                <div className="text-sm text-right">
                  {(() => {
                    const planB = state.planB;
                    if (planB.statusString && planB.premium[planB.statusString]) {
                      const ages = Object.keys(planB.premium[planB.statusString]).map(Number).filter(n => !isNaN(n));
                      if (ages.length > 0) {
                      const lastAge = Math.max(...ages);
                      return `${lastAge} ${language === 'en' ? 'years old' : '歲'}`;
                      }
                    }
                    return '-';
                  })()}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="text-sm text-muted-foreground">
                {language === 'en' 
                  ? `Accumulated Savings Before Age ${state.savingsPlan.useMedicalSavings}`
                  : `${state.savingsPlan.useMedicalSavings}歲前累計儲備`
                }
              </div>
              <div className="text-sm text-right">{t.currency} {formatCurrency(calculateAccumulatedSavings())}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-sm text-muted-foreground">
                {language === 'en' 
                  ? `Total Premiums After Age ${state.savingsPlan.useMedicalSavings}${state.savingsPlan.showInflation ? ' (Standard)' : ''}`
                  : `${state.savingsPlan.useMedicalSavings}歲後總保費${state.savingsPlan.showInflation ? '（標準）' : ''}`
                }
              </div>
              <div className="text-sm text-right">{t.currency} {formatCurrency(totalPremiumAfterUsageStandard)}</div>
            </div>
            {state.savingsPlan.showInflation && (
              <div className="grid grid-cols-2 gap-4">
                <div className="text-sm text-muted-foreground">
                  {language === 'en' 
                    ? `Total Premiums After Age ${state.savingsPlan.useMedicalSavings} (Inflation Adjusted)`
                    : `${state.savingsPlan.useMedicalSavings}歲後總保費（通脹調整後）`
                  }
                </div>
                <div className="text-sm text-right">{t.currency} {formatCurrency(totalPremiumAfterUsageInflated)}</div>
              </div>
            )}
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="text-sm text-muted-foreground">
                {language === 'en' 
                  ? 'Leverage Ratio (Standard)'
                  : '槓桿比率（標準）'
                }
              </div>
              <div className="text-sm text-right">
                {(() => {
                  const leverageRatio = (totalPremiumAfterUsageStandard / medicalSavings.principal * 100).toFixed(2);
                  return `${leverageRatio}%`;
                })()}
              </div>
            </div>
            {state.savingsPlan.showInflation && (
              <div className="grid grid-cols-2 gap-4">
                <div className="text-sm text-muted-foreground">
                  {language === 'en' 
                    ? 'Leverage Ratio (Inflation Adjusted)'
                    : '槓桿比率（通脹調整後）'
                  }
                </div>
                <div className="text-sm text-right">
                  {(() => {
                    const leverageRatio = (totalPremiumAfterUsageInflated / medicalSavings.principal * 100).toFixed(2);
                    return `${leverageRatio}%`;
                  })()}
                </div>
              </div>
            )}
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="text-sm text-muted-foreground">
                {language === 'en' 
                  ? 'Age When Standard Savings Reach Zero'
                  : '剩餘儲備（標準）耗盡年齡'
                }
              </div>
              <div className="text-sm text-right">
                {(() => {
                  const { returnRate } = state.savingsPlan;
                  const annualRate = returnRate / 100;
                  let savings = 0;
                  let prevSavings = 0;
                  let remainingStandard = 0;
                  let prevRemainingStandard = 0;

                  for (let age = state.currentAge; age <= state.maxAge; age++) {
                    // Calculate savings (compound interest, annual deposit)
                    if (age === state.currentAge) {
                      savings = state.savingsPlan.monthlySavings * 12;
                      prevSavings = savings;
                      remainingStandard = savings;
                      prevRemainingStandard = savings;
                    } else {
                      // Only add monthly savings during contribution years
                      const isInContributionPeriod = age - state.currentAge < state.savingsPlan.years;
                      const annualContribution = isInContributionPeriod ? state.savingsPlan.monthlySavings * 12 : 0;
                      savings = (prevSavings + annualContribution) * (1 + annualRate);
                      prevSavings = savings;
                    }

                    // Calculate plan premiums
                    const getPremium = (plan: 'planA' | 'planB') => {
                      if (state[plan].enabled && state[plan].statusString && state[plan].premium[state[plan].statusString]?.[age]) {
                        let premium = state[plan].premium[state[plan].statusString][age];
                        premium = premium * (1 + state[plan].additionalPremium / 100);
                        return getConvertedAmount(premium, state[plan].currency);
                      }
                      return 0;
                    };

                    const totalStandardPremium = getPremium('planA') + getPremium('planB');

                    // Calculate remaining savings (standard)
                    if (age < state.savingsPlan.useMedicalSavings) {
                      remainingStandard = savings;
                    } else {
                      // First subtract current year's premium, then apply compound interest
                      remainingStandard = (prevRemainingStandard - totalStandardPremium) * (1 + annualRate);
                    }

                    if (remainingStandard <= 0 && prevRemainingStandard > 0) {
                      return <span className="text-destructive font-medium">{`${age} ${language === 'en' ? 'years old' : '歲'}`}</span>;
                    }

                    prevRemainingStandard = remainingStandard;
                  }

                  return (
                    <div className="space-y-1">
                      <div className="text-green-500">{language === 'en' ? 'Savings last beyond max age' : '儲備足夠至預期壽命'}</div>
                      <div className="text-sm text-muted-foreground">
                        {language === 'en' 
                          ? `Remaining at age ${state.maxAge}: ${t.currency} ${formatCurrency(remainingStandard)}`
                          : `${state.maxAge}歲時剩餘儲備：${t.currency} ${formatCurrency(remainingStandard)}`
                        }
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
            {state.savingsPlan.showInflation && (
              <div className="grid grid-cols-2 gap-4">
                <div className="text-sm text-muted-foreground">
                  {language === 'en' 
                    ? 'Age When Inflation Adjusted Savings Reach Zero'
                    : '剩餘儲備（通脹調整後）耗盡年齡'
                  }
                </div>
                <div className="text-sm text-right">
                  {(() => {
                    const { returnRate, inflationRate } = state.savingsPlan;
                    const annualRate = returnRate / 100;
                    const infRate = inflationRate / 100;
                    let savings = 0;
                    let prevSavings = 0;
                    let remainingInflated = 0;
                    let prevRemainingInflated = 0;

                    for (let age = state.currentAge; age <= state.maxAge; age++) {
                      // Calculate savings (compound interest, annual deposit)
                      if (age === state.currentAge) {
                        savings = state.savingsPlan.monthlySavings * 12;
                        prevSavings = savings;
                        remainingInflated = savings;
                        prevRemainingInflated = savings;
                      } else {
                        // Only add monthly savings during contribution years
                        const isInContributionPeriod = age - state.currentAge < state.savingsPlan.years;
                        const annualContribution = isInContributionPeriod ? state.savingsPlan.monthlySavings * 12 : 0;
                        savings = (prevSavings + annualContribution) * (1 + annualRate);
                        prevSavings = savings;
                      }

                      // Calculate plan premiums
                      const getPremium = (plan: 'planA' | 'planB') => {
                        if (state[plan].enabled && state[plan].statusString && state[plan].premium[state[plan].statusString]?.[age]) {
                          let premium = state[plan].premium[state[plan].statusString][age];
                          premium = premium * (1 + state[plan].additionalPremium / 100);
                          return getConvertedAmount(premium, state[plan].currency);
                        }
                        return 0;
                      };

                      const totalInflatedPremium = (() => {
                        const pA = getPremium('planA');
                        const pB = getPremium('planB');
                      const yearsFromCurrent = age - state.currentAge;
                        const pAInf = pA * Math.pow(1 + infRate, Math.max(0, yearsFromCurrent));
                        const pBInf = pB * Math.pow(1 + infRate, Math.max(0, yearsFromCurrent));
                        return pAInf + pBInf;
                      })();

                      // Calculate remaining savings (inflation adjusted)
                      if (age < state.savingsPlan.useMedicalSavings) {
                        remainingInflated = savings;
                      } else {
                        // First subtract current year's premium, then apply compound interest
                        remainingInflated = (prevRemainingInflated - totalInflatedPremium) * (1 + annualRate);
                      }

                      if (remainingInflated <= 0 && prevRemainingInflated > 0) {
                        return <span className="text-destructive font-medium">{`${age} ${language === 'en' ? 'years old' : '歲'}`}</span>;
                      }

                      prevRemainingInflated = remainingInflated;
                    }

                    return (
                      <div className="space-y-1">
                        <div className="text-green-500">{language === 'en' ? 'Savings last beyond max age' : '儲備足夠至預期壽命'}</div>
                        <div className="text-sm text-muted-foreground">
                          {language === 'en' 
                            ? `Remaining at age ${state.maxAge}: ${t.currency} ${formatCurrency(remainingInflated)}`
                            : `${state.maxAge}歲時剩餘儲備：${t.currency} ${formatCurrency(remainingInflated)}`
                          }
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Data Visualization Section */}
      {(state.planA.enabled && results.planA.total > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>{language === 'en' ? 'Data Visualization' : '數據視覺化'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-6">
              {/* Savings Accumulation Chart */}
              <div>
                <h3 className="text-sm font-medium mb-2">
                  {language === 'en' ? 'Key Financial Metrics' : '主要財務指標'}
                </h3>
                <Plot
                  data={[
                    {
                      y: [
                        language === 'en' ? 'Medical Savings Principal' : '醫療儲蓄本金',
                        language === 'en' 
                          ? `Total Premiums After ${state.savingsPlan.useMedicalSavings} (Standard)` 
                          : `${state.savingsPlan.useMedicalSavings}歲後總保費（標準）`,
                        ...(state.savingsPlan.showInflation ? [
                          language === 'en' 
                            ? `Total Premiums After ${state.savingsPlan.useMedicalSavings} (Inflation Adjusted)` 
                            : `${state.savingsPlan.useMedicalSavings}歲後總保費（通脹調整後）`
                        ] : [])
                      ],
                      x: [
                        medicalSavings.principal,
                        totalPremiumAfterUsageStandard,
                        ...(state.savingsPlan.showInflation ? [
                          totalPremiumAfterUsageInflated
                        ] : [])
                      ],
                      type: 'bar',
                      orientation: 'h',
                      marker: {
                        color: ['#22c55e', '#3b82f6', '#f97316']
                      }
                    }
                  ]}
                  layout={{
                    autosize: true,
                    height: 300,
                    margin: { l: 200, r: 20, t: 20, b: 50 },
                    xaxis: {
                      title: language === 'en' ? 'Amount' : '金額',
                      showgrid: true,
                      gridcolor: 'rgba(0,0,0,0.1)',
                      tickformat: ',.0f'
                    },
                    yaxis: {
                      title: '',
                      showgrid: true,
                      gridcolor: 'rgba(0,0,0,0.1)',
                      automargin: true
                    },
                    showlegend: false,
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)'
                  }}
                  config={{ responsive: true }}
                  className="w-full"
                />
              </div>

              {/* Premium Payments Chart */}
              <div>
                <h3 className="text-sm font-medium mb-2">
                  {language === 'en' ? 'Premium Payments' : '保費支出'}
                </h3>
                <Plot
                  data={[
                    {
                      x: Array.from({ length: state.maxAge - state.currentAge + 1 }, (_, i) => state.currentAge + i),
                      y: Array.from({ length: state.maxAge - state.currentAge + 1 }, (_, i) => {
                        const age = state.currentAge + i;
                        const getPremium = (plan: 'planA' | 'planB') => {
                          if (state[plan].enabled && state[plan].statusString && state[plan].premium[state[plan].statusString]?.[age]) {
                            let premium = state[plan].premium[state[plan].statusString][age];
                            premium = premium * (1 + state[plan].additionalPremium / 100);
                            return getConvertedAmount(premium, state[plan].currency);
                          }
                          return 0;
                        };
                        return getPremium('planA') + getPremium('planB');
                      }),
                      type: 'bar',
                      name: language === 'en' ? 'Standard' : '標準',
                      marker: { color: '#3b82f6' }
                    },
                    ...(state.savingsPlan.showInflation ? [{
                      x: Array.from({ length: state.maxAge - state.currentAge + 1 }, (_, i) => state.currentAge + i),
                      y: Array.from({ length: state.maxAge - state.currentAge + 1 }, (_, i) => {
                        const age = state.currentAge + i;
                        const getPremium = (plan: 'planA' | 'planB') => {
                          if (state[plan].enabled && state[plan].statusString && state[plan].premium[state[plan].statusString]?.[age]) {
                            let premium = state[plan].premium[state[plan].statusString][age];
                            premium = premium * (1 + state[plan].additionalPremium / 100);
                            return getConvertedAmount(premium, state[plan].currency);
                          }
                          return 0;
                        };
                        const yearsFromCurrent = age - state.currentAge;
                        const infRate = state.savingsPlan.inflationRate / 100;
                        
                        const planAInflated = getPremium('planA') * Math.pow(1 + infRate, Math.max(0, yearsFromCurrent));
                        const planBInflated = getPremium('planB') * Math.pow(1 + infRate, Math.max(0, yearsFromCurrent));
                        return planAInflated + planBInflated;
                      }),
                      type: 'bar',
                      name: language === 'en' ? 'Inflation Adjusted' : '通脹調整後',
                      marker: { color: '#f97316' }
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    height: 300,
                    margin: { l: 50, r: 20, t: 20, b: 50 },
                    barmode: 'group',
                    xaxis: {
                      title: language === 'en' ? 'Age' : '年齡',
                      showgrid: true,
                      gridcolor: 'rgba(0,0,0,0.1)'
                    },
                    yaxis: {
                      title: language === 'en' ? 'Amount' : '金額',
                      showgrid: true,
                      gridcolor: 'rgba(0,0,0,0.1)',
                      tickformat: ',.0f'
                    },
                    showlegend: true,
                    legend: {
                      orientation: 'h',
                      y: 1.1
                    },
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)'
                  }}
                  config={{ responsive: true }}
                  className="w-full"
                />
              </div>

              {/* Remaining Savings Chart */}
              <div>
                <h3 className="text-sm font-medium mb-2">
                  {language === 'en' ? 'Remaining Savings' : '剩餘儲備'}
                </h3>
                <Plot
                  data={[
                    {
                      x: Array.from({ length: state.maxAge - state.currentAge + 1 }, (_, i) => state.currentAge + i),
                      y: Array.from({ length: state.maxAge - state.currentAge + 1 }, (_, i) => {
                        const age = state.currentAge + i;
                        const { monthlySavings, returnRate, years: contributionYears, useMedicalSavings } = state.savingsPlan;
                        const annualRate = returnRate / 100;
                        let savings = 0;
                        let prevSavings = 0;
                        let remainingStandard = 0;
                        let prevRemainingStandard = 0;
                        
                        for (let a = state.currentAge; a <= age; a++) {
                          if (a === state.currentAge) {
                            savings = monthlySavings * 12;
                            prevSavings = savings;
                            remainingStandard = savings;
                            prevRemainingStandard = savings;
                          } else {
                            const isInContributionPeriod = a - state.currentAge < contributionYears;
                            const annualContribution = isInContributionPeriod ? monthlySavings * 12 : 0;
                            savings = (prevSavings + annualContribution) * (1 + annualRate);
                            prevSavings = savings;
                          }

                          const getPremium = (plan: 'planA' | 'planB') => {
                            if (state[plan].enabled && state[plan].statusString && state[plan].premium[state[plan].statusString]?.[a]) {
                              let premium = state[plan].premium[state[plan].statusString][a];
                              premium = premium * (1 + state[plan].additionalPremium / 100);
                              return getConvertedAmount(premium, state[plan].currency);
                            }
                            return 0;
                          };
                          const totalStandardPremium = getPremium('planA') + getPremium('planB');

                          if (a < useMedicalSavings) {
                            remainingStandard = savings;
                          } else {
                            // First subtract current year's premium, then apply compound interest
                            remainingStandard = (prevRemainingStandard - totalStandardPremium) * (1 + annualRate);
                          }
                          prevRemainingStandard = remainingStandard;
                        }
                        return remainingStandard;
                      }),
                      type: 'bar',
                      name: language === 'en' ? 'Standard' : '標準',
                      marker: { color: '#8b5cf6' }
                    },
                    ...(state.savingsPlan.showInflation ? [{
                      x: Array.from({ length: state.maxAge - state.currentAge + 1 }, (_, i) => state.currentAge + i),
                      y: Array.from({ length: state.maxAge - state.currentAge + 1 }, (_, i) => {
                        const age = state.currentAge + i;
                        const { monthlySavings, returnRate, years: contributionYears, useMedicalSavings, inflationRate } = state.savingsPlan;
                        const annualRate = returnRate / 100;
                        const infRate = inflationRate / 100;
                        let savings = 0;
                        let prevSavings = 0;
                        let remainingInflated = 0;
                        let prevRemainingInflated = 0;
                        
                        for (let a = state.currentAge; a <= age; a++) {
                          if (a === state.currentAge) {
                            savings = monthlySavings * 12;
                            prevSavings = savings;
                            remainingInflated = savings;
                            prevRemainingInflated = savings;
                          } else {
                            const isInContributionPeriod = a - state.currentAge < contributionYears;
                            const annualContribution = isInContributionPeriod ? monthlySavings * 12 : 0;
                            savings = (prevSavings + annualContribution) * (1 + annualRate);
                            prevSavings = savings;
                          }

                          const getPremium = (plan: 'planA' | 'planB') => {
                            if (state[plan].enabled && state[plan].statusString && state[plan].premium[state[plan].statusString]?.[a]) {
                              let premium = state[plan].premium[state[plan].statusString][a];
                              premium = premium * (1 + state[plan].additionalPremium / 100);
                              return getConvertedAmount(premium, state[plan].currency);
                            }
                            return 0;
                          };
                          const yearsFromCurrent = a - state.currentAge;
                          const totalInflatedPremium = (getPremium('planA') + getPremium('planB')) * Math.pow(1 + infRate, Math.max(0, yearsFromCurrent));

                          if (a < useMedicalSavings) {
                            remainingInflated = savings;
                          } else {
                            // First subtract current year's premium, then apply compound interest
                            remainingInflated = (prevRemainingInflated - totalInflatedPremium) * (1 + annualRate);
                          }
                          prevRemainingInflated = remainingInflated;
                        }
                        return remainingInflated;
                      }),
                      type: 'bar',
                      name: language === 'en' ? 'Inflation Adjusted' : '通脹調整後',
                      marker: { color: '#ec4899' }
                    }] : [])
                  ]}
                  layout={{
                    autosize: true,
                    height: 300,
                    margin: { l: 50, r: 20, t: 20, b: 50 },
                    barmode: 'group',
                    xaxis: {
                      title: language === 'en' ? 'Age' : '年齡',
                      showgrid: true,
                      gridcolor: 'rgba(0,0,0,0.1)'
                    },
                    yaxis: {
                      title: language === 'en' ? 'Amount' : '金額',
                      showgrid: true,
                      gridcolor: 'rgba(0,0,0,0.1)',
                      tickformat: ',.0f'
                    },
                    showlegend: true,
                    legend: {
                      orientation: 'h',
                      y: 1.1
                    },
                    paper_bgcolor: 'rgba(0,0,0,0)',
                    plot_bgcolor: 'rgba(0,0,0,0)'
                  }}
                  config={{ responsive: true }}
                  className="w-full"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Savings Table Section */}
      {(state.planA.enabled && results.planA.total > 0) && (
        <Card>
          <Collapsible>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle>{language === 'en' ? 'Savings & Premium Table' : '儲蓄與保費明細表'}</CardTitle>
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200" />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const table = document.querySelector('table');
                      if (table) {
                        const wb = XLSX.utils.table_to_book(table);
                        XLSX.writeFile(wb, `${language === 'en' ? 'savings_premium_table' : '儲蓄與保費明細表'}.xlsx`);
                      }
                    }}
                    className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-input bg-background hover:bg-accent hover:text-accent-foreground h-9 px-3"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    {language === 'en' ? 'Export' : '匯出'}
                  </button>
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-xs text-left border border-gray-200 dark:border-gray-700">
                    <thead>
                      <tr className="bg-muted">
                        <th 
                          className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                          onClick={() => handleSort('age')}
                        >
                          {language === 'en' ? 'Age' : '年齡'} {getSortIndicator('age')}
                        </th>
                        <th 
                          className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                          onClick={() => handleSort('savings')}
                        >
                          {language === 'en' ? 'Savings' : '儲蓄'} {getSortIndicator('savings')}
                        </th>
                        {state.planA.enabled && results.planA.total > 0 && (
                          <th 
                            className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                            onClick={() => handleSort('planAStandard')}
                          >
                            {language === 'en' ? 'Plan A Standard Premium' : '計劃A標準保費'} {getSortIndicator('planAStandard')}
                          </th>
                        )}
                        {state.planB.enabled && results.planB.total > 0 && (
                          <th 
                            className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                            onClick={() => handleSort('planBStandard')}
                          >
                            {language === 'en' ? 'Plan B Standard Premium' : '計劃B標準保費'} {getSortIndicator('planBStandard')}
                          </th>
                        )}
                        {state.savingsPlan.showInflation && state.planA.enabled && results.planA.total > 0 && (
                          <th 
                            className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                            onClick={() => handleSort('planAInflated')}
                          >
                            {language === 'en' ? 'Plan A Inflation Adjusted Premium' : '計劃A通脹調整後保費'} {getSortIndicator('planAInflated')}
                          </th>
                        )}
                        {state.savingsPlan.showInflation && state.planB.enabled && results.planB.total > 0 && (
                          <th 
                            className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                            onClick={() => handleSort('planBInflated')}
                          >
                            {language === 'en' ? 'Plan B Inflation Adjusted Premium' : '計劃B通脹調整後保費'} {getSortIndicator('planBInflated')}
                          </th>
                        )}
                        {(state.planA.enabled && results.planA.total > 0) || (state.planB.enabled && results.planB.total > 0) ? (
                          <>
                            <th 
                              className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                              onClick={() => handleSort('totalStandard')}
                            >
                              {language === 'en' ? 'Total Standard Premium' : '總標準保費'} {getSortIndicator('totalStandard')}
                            </th>
                            {state.savingsPlan.showInflation && (
                              <th 
                                className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                                onClick={() => handleSort('totalInflated')}
                              >
                                {language === 'en' ? 'Total Inflation Adjusted Premium' : '總通脹調整後保費'} {getSortIndicator('totalInflated')}
                              </th>
                            )}
                          </>
                        ) : null}
                        <th 
                          className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                          onClick={() => handleSort('remainingStandard')}
                        >
                          {language === 'en' ? 'Remaining Savings (Standard)' : '剩餘儲備（標準）'} {getSortIndicator('remainingStandard')}
                        </th>
                        {state.savingsPlan.showInflation && (
                          <th 
                            className="px-2 py-1 border-b cursor-pointer hover:bg-muted/80 transition-colors"
                            onClick={() => handleSort('remainingInflated')}
                          >
                            {language === 'en' ? 'Remaining Savings (Inflation Adjusted)' : '剩餘儲備（通脹調整後）'} {getSortIndicator('remainingInflated')}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const rows: React.ReactNode[] = [];
                        const { currentAge, maxAge, savingsPlan } = state;
                        const { monthlySavings, returnRate, years: contributionYears, useMedicalSavings, inflationRate } = savingsPlan;
                        const annualRate = returnRate / 100;
                        const infRate = inflationRate / 100;
                        let savings = 0;
                        let prevSavings = 0;
                        let prevRemainingStandard = 0;
                        let prevRemainingInflated = 0;
                        let remainingStandard = 0;
                        let remainingInflated = 0;
                        // Helper to get plan premiums
                        const getPlanPremium = (plan: 'planA' | 'planB', age: number) => {
                          if (state[plan].enabled && state[plan].statusString && state[plan].premium[state[plan].statusString]?.[age]) {
                            let premium = state[plan].premium[state[plan].statusString][age];
                            premium = premium * (1 + state[plan].additionalPremium / 100);
                            return getConvertedAmount(premium, state[plan].currency);
                          }
                          return 0;
                        };
                        const tableData: TableRow[] = [];
                        for (let age = currentAge; age <= maxAge; age++) {
                          // Calculate savings (compound interest, annual deposit)
                          if (age === currentAge) {
                            savings = monthlySavings * 12;
                            prevSavings = savings;
                            remainingStandard = savings;
                            remainingInflated = savings;
                            prevRemainingStandard = savings;
                            prevRemainingInflated = savings;
                          } else {
                            // Only add monthly savings during contribution years
                            const isInContributionPeriod = age - currentAge < contributionYears;
                            const annualContribution = isInContributionPeriod ? monthlySavings * 12 : 0;
                            savings = (prevSavings + annualContribution) * (1 + annualRate);
                            prevSavings = savings;
                          }

                          // Calculate plan premiums
                          const planAStandard = getPlanPremium('planA', age);
                          const planBStandard = getPlanPremium('planB', age);
                          const yearsFromCurrent = age - currentAge;
                          const planAInflated = planAStandard * Math.pow(1 + infRate, Math.max(0, yearsFromCurrent));
                          const planBInflated = planBStandard * Math.pow(1 + infRate, Math.max(0, yearsFromCurrent));
                          const totalStandardPremium = planAStandard + planBStandard;
                          const totalInflatedPremium = planAInflated + planBInflated;

                          // Calculate remaining savings (standard)
                          if (age < useMedicalSavings) {
                            remainingStandard = savings;
                          } else {
                            // First subtract current year's premium, then apply compound interest
                            remainingStandard = (prevRemainingStandard - totalStandardPremium) * (1 + annualRate);
                          }

                          // Calculate remaining savings (inflation adjusted)
                          if (age < useMedicalSavings) {
                            remainingInflated = savings;
                          } else {
                            // First subtract current year's premium, then apply compound interest
                            remainingInflated = (prevRemainingInflated - totalInflatedPremium) * (1 + annualRate);
                          }

                          tableData.push({
                            age,
                            savings,
                            planAStandard,
                            planBStandard,
                            planAInflated,
                            planBInflated,
                            totalStandardPremium,
                            totalInflatedPremium,
                            remainingStandard,
                            remainingInflated
                          });

                          prevRemainingStandard = remainingStandard;
                          prevRemainingInflated = remainingInflated;
                        }
                        // Sort data if sortConfig exists
                        const sortedData = sortConfig 
                          ? sortData(tableData, sortConfig.key as keyof TableRow, sortConfig.direction)
                          : tableData;
                        // Filter data by insurance company
                        const filteredData = filterByInsuranceCompany(sortedData);
                        // Generate rows from sorted data
                        filteredData.forEach(data => {
                          rows.push(
                            <tr key={data.age} className={`border-b last:border-b-0 hover:bg-muted/50 transition-colors ${
                              data.age === state.savingsPlan.useMedicalSavings 
                                ? 'bg-green-50 dark:bg-green-950/20' 
                                : (data.remainingStandard <= 0 && prevRemainingStandard > 0) || 
                                  (state.savingsPlan.showInflation && data.remainingInflated <= 0 && prevRemainingInflated > 0) 
                                    ? 'bg-destructive/10' 
                                    : ''
                            }`}>
                              <td className="px-2 py-1">{data.age}</td>
                              <td className="px-2 py-1">{t.currency} {formatCurrency(Math.max(0, data.savings))}</td>
                              {state.planA.enabled && results.planA.total > 0 && (
                                <td className="px-2 py-1">
                                  {data.planAStandard > 0 ? (
                                    <div>
                                      <div>{t.currency} {formatCurrency(data.planAStandard)}</div>
                                      <div className="text-xs text-muted-foreground">
                                        {state.planA.company || ''}
                                      </div>
                                    </div>
                                  ) : '-'}
                                </td>
                              )}
                              {state.planB.enabled && results.planB.total > 0 && (
                                <td className="px-2 py-1">{data.planBStandard > 0 ? `${t.currency} ${formatCurrency(data.planBStandard)}` : '-'}</td>
                              )}
                              {state.savingsPlan.showInflation && state.planA.enabled && results.planA.total > 0 && (
                                <td className="px-2 py-1">{data.planAInflated > 0 ? `${t.currency} ${formatCurrency(data.planAInflated)}` : '-'}</td>
                              )}
                              {state.savingsPlan.showInflation && state.planB.enabled && results.planB.total > 0 && (
                                <td className="px-2 py-1">{data.planBInflated > 0 ? `${t.currency} ${formatCurrency(data.planBInflated)}` : '-'}</td>
                              )}
                              {(state.planA.enabled && results.planA.total > 0) || (state.planB.enabled && results.planB.total > 0) ? (
                                <>
                                  <td className="px-2 py-1">{data.totalStandardPremium > 0 ? `${t.currency} ${formatCurrency(data.totalStandardPremium)}` : '-'}</td>
                                  {state.savingsPlan.showInflation && (
                                    <td className="px-2 py-1">{data.totalInflatedPremium > 0 ? `${t.currency} ${formatCurrency(data.totalInflatedPremium)}` : '-'}</td>
                                  )}
                                </>
                              ) : null}
                              <td className="px-2 py-1">{t.currency} {formatCurrency(Math.max(0, data.remainingStandard))}</td>
                              {state.savingsPlan.showInflation && (
                                <td className="px-2 py-1">{t.currency} {formatCurrency(Math.max(0, data.remainingInflated))}</td>
                              )}
                            </tr>
                          );
                          prevRemainingStandard = data.remainingStandard;
                          prevRemainingInflated = data.remainingInflated;
                        });
                        return rows;
                      })()}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </CollapsibleContent>
          </Collapsible>
        </Card>
      )}
    </div>
  );
}

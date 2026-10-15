"use client";

import { useEffect, useState } from "react";
import { useCalculator } from "@/lib/calculator-context";
import { translations } from "@/lib/translations";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InsurancePlan, PlanPremium, getInsurancePlans, getPlanPremium } from "@/lib/data";

interface PlanCalculatorProps {
  plan: "A" | "B";
  language: 'en' | 'zh';
}

export function PlanCalculator({ plan, language }: PlanCalculatorProps) {
  const { state, setState } = useCalculator();
  const t = translations[language];
  const [plans, setPlans] = useState<InsurancePlan[]>([]);
  const [premiumData, setPremiumData] = useState<PlanPremium | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const planKey = plan === "A" ? "planA" : "planB";
  const planData = state[planKey];

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const plansData = await getInsurancePlans();
        if (!Array.isArray(plansData)) {
          throw new Error('Invalid plans data received');
        }
        setPlans(plansData);
      } catch (err) {
        console.error('Error loading plan data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load plan data');
        setPlans([]);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);
  
  const updatePlan = (updates: Partial<typeof planData>) => {
    setState((prev) => ({
      ...prev,
      [planKey]: {
        ...prev[planKey],
        ...updates,
      },
    }));
  };

  const companies = Array.from(new Set(plans.map(plan => 
    language === 'en' ? plan.company_name_en : plan.company_name_zh
  )))
    .filter(Boolean)
    .sort((a, b) => {
      const manulifeZh = "宏利";
      const manulifeEn = "Manulife";
      const prefix = language === 'en' ? manulifeEn : manulifeZh;

      const aStarts = a.startsWith(prefix);
      const bStarts = b.startsWith(prefix);

      if (aStarts && !bStarts) return -1;
      if (bStarts && !aStarts) return 1;
      return a.localeCompare(b, language === 'en' ? 'en' : 'zh-Hant');
    });

  const companyPlans = plans.filter(p => 
    language === 'en' 
      ? p.company_name_en === planData.company 
      : p.company_name_zh === planData.company
  );

  const planNames = Array.from(new Set(companyPlans.map(p => 
    language === 'en' ? p.plan_name_en : p.plan_name_zh
  ))).filter(Boolean);

  const planTypes = Array.from(new Set(
    companyPlans
      .filter(p => 
        language === 'en' 
          ? p.plan_name_en === planData.planName 
          : p.plan_name_zh === planData.planName
      )
      .map(p => language === 'en' ? p.type_en : p.type_zh)
  )).filter(Boolean);

  // Load the selected plan's independent premium CSV
  useEffect(() => {
    if (!plans.length || !planData.company || !planData.planName || !planData.planType) {
      setPremiumData(null);
      return;
    }

    const selectedPlan = plans.find(p =>
      (language === 'en'
        ? p.company_name_en === planData.company
        : p.company_name_zh === planData.company) &&
      (language === 'en'
        ? p.plan_name_en === planData.planName
        : p.plan_name_zh === planData.planName) &&
      (language === 'en'
        ? p.type_en === planData.planType
        : p.type_zh === planData.planType)
    );

    if (!selectedPlan) {
      setPremiumData(null);
      return;
    }

    let cancelled = false;
    getPlanPremium(selectedPlan.certification_no)
      .then((data) => {
        if (!cancelled) setPremiumData(data);
      })
      .catch((err) => {
        console.error('Error loading plan premium CSV:', err);
        if (!cancelled) setPremiumData(null);
      });

    return () => {
      cancelled = true;
    };
  }, [
    plans,
    planData.company,
    planData.planName,
    planData.planType,
    language,
  ]);

  // Apply status / age / loading % onto loaded premium table
  useEffect(() => {
    if (!premiumData?.premium) return;

    const statusString = (planData.hasRider ? "R" : "S") +
      (state.gender === "male" ? "M" : "F") +
      (state.isSmoker ? "Y" : "N");
    const basePremium = premiumData.premium[statusString]?.[state.currentAge] || 0;
    const additionalPremiumAmount = basePremium * (planData.additionalPremium / 100);
    const totalPremium = basePremium + additionalPremiumAmount;

    updatePlan({
      premium: premiumData.premium,
      monthlyPremium: totalPremium,
      currency: premiumData.currency || 'HKD',
      statusString,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    premiumData,
    planData.hasRider,
    planData.additionalPremium,
    state.gender,
    state.isSmoker,
    state.currentAge,
  ]);
  
  if (error) {
    return (
      <Card className="bg-destructive/10">
        <CardHeader>
          <CardTitle>{t.error}</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={`transition-all duration-300 ${planData.enabled ? "" : "opacity-70"}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{plan === "A" ? t.planA : t.planB}</CardTitle>
          <div className="flex items-center space-x-2">
            <Switch
              id={`enable-${plan}`}
              checked={planData.enabled}
              onCheckedChange={(checked) => updatePlan({ enabled: checked })}
            />
            <Label htmlFor={`enable-${plan}`} className="text-sm">{t.enabled}</Label>
          </div>
        </div>
        <CardDescription>{t.planSettings}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`company-${plan}`}>{t.insuranceCompany}</Label>
          <Select
            value={planData.company}
            onValueChange={(value) => updatePlan({ 
              company: value,
              planName: '',
              planType: '',
              monthlyPremium: 0,
              premium: {}
            })}
            disabled={!planData.enabled || loading}
          >
            <SelectTrigger id={`company-${plan}`}>
              <SelectValue placeholder={language === 'en' ? "Select company" : "選擇保險公司"} />
            </SelectTrigger>
            <SelectContent>
              {companies.map((company) => (
                <SelectItem key={company} value={company}>{company}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor={`plan-name-${plan}`}>{t.planName}</Label>
          <Select
            value={planData.planName}
            onValueChange={(value) => updatePlan({ 
              planName: value,
              planType: '',
              monthlyPremium: 0,
              premium: {}
            })}
            disabled={!planData.enabled || !planData.company || loading}
          >
            <SelectTrigger id={`plan-name-${plan}`}>
              <SelectValue placeholder={language === 'en' ? "Select plan" : "選擇計劃"} />
            </SelectTrigger>
            <SelectContent>
              {planNames.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor={`plan-type-${plan}`}>{t.planType}</Label>
          <Select
            value={planData.planType}
            onValueChange={(value) => updatePlan({ 
              planType: value,
              monthlyPremium: 0,
              premium: {}
            })}
            disabled={!planData.enabled || !planData.company || !planData.planName || loading}
          >
            <SelectTrigger id={`plan-type-${plan}`}>
              <SelectValue placeholder={language === 'en' ? "Select type" : "選擇類型"} />
            </SelectTrigger>
            <SelectContent>
              {planTypes.map((type) => (
                <SelectItem key={type} value={type}>{type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <div className="flex items-center space-x-2 pt-2">
            <Switch
              id={`rider-${plan}`}
              checked={planData.hasRider}
              onCheckedChange={(checked) => updatePlan({ hasRider: checked })}
              disabled={!planData.enabled || !planData.planType}
            />
            <Label htmlFor={`rider-${plan}`} className="text-sm">
              {language === 'en' ? 'Rider' : '附加契約'}
            </Label>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`additional-premium-${plan}`}>{t.additionalPremium}</Label>
          <Input
            id={`additional-premium-${plan}`}
            type="number"
            min="0"
            max="100"
            value={planData.additionalPremium}
            onChange={(e) => updatePlan({ additionalPremium: Number(e.target.value) })}
            disabled={!planData.enabled}
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor={`premium-${plan}`}>{t.monthlyPremium}</Label>
          <div className="relative">
            <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">
              {planData.currency}
            </span>
            <Input
              id={`premium-${plan}`}
              type="number"
              className="pl-12"
              value={planData.monthlyPremium}
              readOnly
              disabled={!planData.enabled}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
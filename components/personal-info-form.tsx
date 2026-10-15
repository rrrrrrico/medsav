"use client";

import { useCalculator, calculateAge } from "@/lib/calculator-context";
import { translations } from "@/lib/translations";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PersonalInfoFormProps {
  language: 'en' | 'zh';
}

export function PersonalInfoForm({ language }: PersonalInfoFormProps) {
  const { state, setState } = useCalculator();
  const t = translations[language];
  const currentAge = calculateAge(state.birthDate);
  
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t.personalInformation}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">{t.name}</Label>
            <Input
              id="name"
              value={state.name}
              onChange={(e) => setState({ ...state, name: e.target.value })}
              placeholder={language === 'en' ? "Enter your name" : "輸入姓名"}
            />
          </div>
          
          <div className="space-y-2">
            <Label>{t.gender}</Label>
            <RadioGroup
              value={state.gender}
              onValueChange={(value) => setState({ ...state, gender: value as "male" | "female" })}
              className="flex space-x-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="male" id="male" />
                <Label htmlFor="male">{t.male}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="female" id="female" />
                <Label htmlFor="female">{t.female}</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="smoker"
              checked={state.isSmoker}
              onCheckedChange={(checked) => setState({ ...state, isSmoker: checked })}
            />
            <Label htmlFor="smoker">{t.smoker}</Label>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="birthDate">{language === 'en' ? 'Date of Birth' : '出生日期'}</Label>
            <Input
              id="birthDate"
              type="date"
              value={state.birthDate}
              onChange={(e) => {
                const newBirthDate = e.target.value;
                const newAge = calculateAge(newBirthDate);
                setState({
                  ...state,
                  birthDate: newBirthDate,
                  currentAge: newAge,
                  retirementAge: Math.max(state.retirementAge, newAge),
                  savingsPlan: {
                    ...state.savingsPlan,
                    useMedicalSavings: Math.max(state.savingsPlan.useMedicalSavings, newAge),
                  },
                });
              }}
              max={new Date().toISOString().split('T')[0]}
            />
            <div className="text-sm text-muted-foreground">
              {language === 'en' ? 'Current Age: ' : '現時年齡：'}{state.currentAge}
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label htmlFor="retirementAge">{t.retirementAge}</Label>
              <span className="text-sm">{state.retirementAge}</span>
            </div>
            <Slider
              id="retirementAge"
              min={currentAge}
              max={75}
              step={1}
              value={[state.retirementAge]}
              onValueChange={(value) => setState({ ...state, retirementAge: value[0] })}
              className="py-2"
            />
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label htmlFor="maxAge">{t.maxAge}</Label>
              <span className="text-sm">{state.maxAge}</span>
            </div>
            <Slider
              id="maxAge"
              min={80}
              max={100}
              step={1}
              value={[state.maxAge]}
              onValueChange={(value) => setState({ ...state, maxAge: value[0] })}
              className="py-2"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.savingsPlan}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="monthlySavings">{t.monthlySavings}</Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-sm text-muted-foreground">
                {t.currency}
              </span>
              <Input
                id="monthlySavings"
                type="number"
                className="pl-12"
                value={state.savingsPlan.monthlySavings}
                onChange={(e) => setState({
                  ...state,
                  savingsPlan: {
                    ...state.savingsPlan,
                    monthlySavings: Number(e.target.value)
                  }
                })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label htmlFor="savingsYears">{t.years}</Label>
              <span className="text-sm">{state.savingsPlan.years}</span>
            </div>
            <Slider
              id="savingsYears"
              min={1}
              max={10}
              step={1}
              value={[state.savingsPlan.years]}
              onValueChange={(value) => setState({
                ...state,
                savingsPlan: {
                  ...state.savingsPlan,
                  years: value[0]
                }
              })}
              className="py-2"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label htmlFor="returnRate">{t.returnRate}</Label>
              <span className="text-sm">{state.savingsPlan.returnRate}%</span>
            </div>
            <Slider
              id="returnRate"
              min={1}
              max={10}
              step={0.1}
              value={[state.savingsPlan.returnRate]}
              onValueChange={(value) => setState({
                ...state,
                savingsPlan: {
                  ...state.savingsPlan,
                  returnRate: value[0]
                }
              })}
              className="py-2"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label htmlFor="useMedicalSavings">{t.useMedicalSavings}</Label>
              <span className="text-sm">{state.savingsPlan.useMedicalSavings}</span>
            </div>
            <Slider
              id="useMedicalSavings"
              min={currentAge}
              max={80}
              step={1}
              value={[state.savingsPlan.useMedicalSavings]}
              onValueChange={(value) => setState({
                ...state,
                savingsPlan: {
                  ...state.savingsPlan,
                  useMedicalSavings: value[0]
                }
              })}
              className="py-2"
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label htmlFor="inflationRate">{t.inflationRate}</Label>
              <span className="text-sm">{state.savingsPlan.inflationRate}%</span>
            </div>
            <Slider
              id="inflationRate"
              min={0}
              max={20}
              step={0.1}
              value={[state.savingsPlan.inflationRate]}
              onValueChange={(value) => setState({
                ...state,
                savingsPlan: {
                  ...state.savingsPlan,
                  inflationRate: value[0]
                }
              })}
              className="py-2"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="showInflation"
              checked={state.savingsPlan.showInflation}
              onCheckedChange={(checked) => setState({
                ...state,
                savingsPlan: {
                  ...state.savingsPlan,
                  showInflation: checked
                }
              })}
            />
            <Label htmlFor="showInflation">{t.afterInflation}</Label>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
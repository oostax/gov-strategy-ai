"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { baseSystemPrompt } from "@/lib/prompts/base-system";

export function ModelSettingsForm({
  baseUrl,
  model,
  hasApiKey,
}: {
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
}) {
  const [temperature, setTemperature] = useState([0.2]);
  const [maxTokens, setMaxTokens] = useState([3000]);
  const setNumberArray = (setter: (value: number[]) => void) => (value: number | readonly number[]) => {
    setter(Array.isArray(value) ? [...value] : [value]);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Модель Cloud.ru Foundation Models</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field label="Базовый URL"><Input value={baseUrl} readOnly /></Field>
          <Field label="Название модели"><Input value={model} readOnly /></Field>
          <Field label="API-ключ"><Input value={hasApiKey ? "Подключен через CLOUD_RU_API_KEY" : "Не задан"} readOnly /></Field>
          <div className="flex items-center justify-between rounded-2xl border p-4">
            <div>
              <p className="font-medium">Режим генерации</p>
              <p className="text-sm text-muted-foreground">Только реальная Cloud.ru модель. Демо и mock-ответы отключены.</p>
            </div>
            <Badge variant={hasApiKey ? "secondary" : "destructive"}>{hasApiKey ? "готово" : "нет ключа"}</Badge>
          </div>
          <Field label={`Температура: ${temperature[0]}`}><Slider min={0} max={1} step={0.1} value={temperature} onValueChange={setNumberArray(setTemperature)} /></Field>
          <Field label={`Лимит токенов: ${maxTokens[0]}`}><Slider min={500} max={6000} step={250} value={maxTokens} onValueChange={setNumberArray(setMaxTokens)} /></Field>
          <Button>Сохранить локальные настройки</Button>
        </CardContent>
      </Card>
      <Card className="rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Предпросмотр системного промпта</CardTitle>
            <Badge variant="secondary">только чтение</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea className="min-h-80" value={baseSystemPrompt} readOnly />
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

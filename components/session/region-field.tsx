"use client";

import { useState } from "react";
import { Globe, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchRegions } from "@/lib/data/russian-regions";

/**
 * Поле выбора региона: популярные чипсы + ввод с автоподсказкой из всех 89
 * субъектов РФ. Подходит и для существующего, и для нового региона — на выборе
 * срабатывает обычный selectRegion (бэкенд найдёт или создаст карточку).
 */
export function RegionField({
  region,
  regionInput,
  popular,
  onType,
  onSelect,
}: {
  region?: string;
  regionInput: string;
  popular: string[];
  onType: (value: string) => void;
  onSelect: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const suggestions = searchRegions(regionInput, 8);
  // Не показываем дропдаун, если ввод уже точно совпал с выбранным регионом.
  const exactSelected =
    suggestions.length === 1 && suggestions[0] === regionInput && region === regionInput;
  const showDropdown = open && regionInput.trim().length >= 1 && suggestions.length > 0 && !exactSelected;

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <span className="text-muted-foreground">
          <Globe className="size-3.5" />
        </span>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Регион</h3>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {popular.map((r) => (
          <button
            type="button"
            key={r}
            onClick={() => onSelect(r)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-xs transition",
              region === r
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted/50",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="relative">
        <Input
          placeholder="Начните вводить регион — подскажем из 89 субъектов..."
          value={regionInput}
          onChange={(e) => {
            onType(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // Небольшая задержка, чтобы успел сработать onClick по подсказке.
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          autoComplete="off"
        />
        {showDropdown && (
          <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-xl border bg-popover p-1 shadow-lg">
            {suggestions.map((name) => (
              <button
                key={name}
                type="button"
                // onMouseDown до blur — иначе клик «теряется».
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(name);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-muted",
                  region === name && "bg-primary/10 text-primary",
                )}
              >
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                <span>{name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

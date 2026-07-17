"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ position, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  // На мобайле верхний тост перекрывает шапку карточки — уводим его вниз по центру,
  // на десктопе оставляем правый верхний угол. Позиция из пропа имеет приоритет.
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia("(max-width: 639px)")
    const sync = () => setIsMobile(mql.matches)
    sync()
    mql.addEventListener("change", sync)
    return () => mql.removeEventListener("change", sync)
  }, [])
  const resolvedPosition = position ?? (isMobile ? "bottom-center" : "top-right")

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={resolvedPosition}
      offset={16}
      mobileOffset={{ bottom: 16, left: 16, right: 16 }}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

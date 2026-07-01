"use client";

import { useState, useEffect, useRef } from "react";

const completedTexts = new Set<string>();

export function TypedText({ text, speed = 18, className = "" }: { text: string; speed?: number; className?: string }) {
  const [displayed, setDisplayed] = useState("");
  const isComplete = useRef(completedTexts.has(text));
  const animId = useRef(0);

  useEffect(() => {
    if (completedTexts.has(text)) {
      setDisplayed(text);
      return;
    }

    let idx = 0;
    let lastTime = 0;

    function tick(time: number) {
      if (!lastTime) lastTime = time;
      if (time - lastTime >= speed && idx < text.length) {
        const chunk = text.length > 500 ? 3 : text.length > 200 ? 2 : 1;
        idx = Math.min(idx + chunk, text.length);
        setDisplayed(text.slice(0, idx));
        lastTime = time;
      }
      if (idx < text.length) {
        animId.current = requestAnimationFrame(tick);
      } else {
        completedTexts.add(text);
      }
    }

    animId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId.current);
  }, [text, speed]);

  return (
    <span className={className}>
      {isComplete.current ? text : displayed}
      {!isComplete.current && displayed !== text && (
        <span className="inline-block w-0.5 h-[1em] bg-primary/60 animate-pulse ml-0.5 align-middle" />
      )}
    </span>
  );
}

export function StaticText({ text, className = "" }: { text: string; className?: string }) {
  return <span className={className}>{text}</span>;
}

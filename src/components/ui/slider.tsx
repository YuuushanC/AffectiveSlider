import * as React from "react";
import { cn } from "../../lib/utils";

interface SliderProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  label?: string;
}

export function Slider({ className, label, ...props }: SliderProps) {
  return (
    <label className={cn("grid gap-2", props.disabled && "opacity-45", className)}>
      {label ? <span className="text-sm font-medium">{label}</span> : null}
      <input
        type="range"
        className="h-8 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
        {...props}
      />
    </label>
  );
}

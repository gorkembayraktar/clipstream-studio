import type { ReactNode } from "react"

import { InfoIcon } from "lucide-react"

import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface InfoHintProps {
  label: string
  children: ReactNode
}

/** Small accessible trigger for long, non-essential explanations. */
export function InfoHint({ label, children }: InfoHintProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-grid size-5 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <InfoIcon className="size-3.5" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-64 text-[11px] leading-snug">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

interface FieldLabelProps {
  htmlFor?: string
  label: string
  hint?: ReactNode
  hintLabel?: string
}

/** Label plus an optional info tooltip. */
export function FieldLabel({
  htmlFor,
  label,
  hint,
  hintLabel,
}: FieldLabelProps) {
  return (
    <div className="flex min-w-0 items-center gap-0.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
      </Label>
      {hint ? <InfoHint label={hintLabel ?? label}>{hint}</InfoHint> : null}
    </div>
  )
}

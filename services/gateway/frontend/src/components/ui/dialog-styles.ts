import { cn } from "@/lib/utils"

// Button styles for dialogs (ConfirmDialog and hand-built ones like Add room).
const buttonBase =
  "min-h-11 flex-1 rounded-xl px-4 text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50"
export const dialogButton = {
  cancel: cn(buttonBase, "bg-neutral-800 text-neutral-200 hover:bg-neutral-700"),
  primary: cn(buttonBase, "bg-white text-neutral-900 hover:bg-neutral-200"),
  danger: cn(buttonBase, "bg-red-600 text-white hover:bg-red-500"),
}

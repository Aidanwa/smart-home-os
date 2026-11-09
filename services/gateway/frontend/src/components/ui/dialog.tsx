import * as React from "react"
import { Dialog as DialogPrimitive, AlertDialog as AlertDialogPrimitive } from "radix-ui"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { dialogButton } from "./dialog-styles"

// Radix dialogs: Escape and the backdrop close them, focus is trapped inside and
// returns to the opener afterwards. Styled to match the app's dark cards.

const overlayClass =
  "fixed inset-0 z-[80] bg-black/60 supports-backdrop-filter:backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
const contentClass =
  "fixed top-1/2 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-200 shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content className={cn(contentClass, className)} {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            className="absolute top-3 right-3 flex size-10 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white focus-visible:ring-2 focus-visible:ring-blue-500 outline-none"
          >
            <XIcon size={18} />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("pr-8 text-lg font-semibold text-white", className)} {...props} />
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("mt-1 text-sm leading-relaxed text-neutral-400", className)} {...props} />
}

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Shown under the title. Strings and JSX both work. */
  description?: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** Red confirm button for things that delete or can't be undone. */
  destructive?: boolean
  /** Shown on the confirm button while `onConfirm` is running. */
  busyLabel?: string
  /** Close happens after this resolves; throw or return false to keep the dialog open. */
  onConfirm: () => void | boolean | Promise<void | boolean>
  children?: React.ReactNode
}

/** A yes/no question. Replaces window.confirm and the hand-rolled confirm modals. */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel, cancelLabel = "Cancel",
  destructive, busyLabel, onConfirm, children,
}: ConfirmDialogProps) {
  const [busy, setBusy] = React.useState(false)
  const confirm = async (e: React.MouseEvent) => {
    e.preventDefault() // AlertDialog.Action would close before an async onConfirm finishes
    setBusy(true)
    try {
      if ((await onConfirm()) !== false) onOpenChange(false)
    } catch { /* the caller reports its own errors */ } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={overlayClass} />
        <AlertDialogPrimitive.Content className={cn(contentClass, "max-w-sm")}>
          <AlertDialogPrimitive.Title className={cn("text-lg font-semibold", destructive ? "text-red-400" : "text-white")}>
            {title}
          </AlertDialogPrimitive.Title>
          {description ? (
            <AlertDialogPrimitive.Description asChild>
              <div className="mt-2 text-sm leading-relaxed text-neutral-400">{description}</div>
            </AlertDialogPrimitive.Description>
          ) : (
            <AlertDialogPrimitive.Description className="sr-only">{title}</AlertDialogPrimitive.Description>
          )}
          {children}
          <div className="mt-6 flex gap-3">
            <AlertDialogPrimitive.Cancel className={dialogButton.cancel} disabled={busy}>{cancelLabel}</AlertDialogPrimitive.Cancel>
            <AlertDialogPrimitive.Action className={destructive ? dialogButton.danger : dialogButton.primary} disabled={busy} onClick={confirm}>
              {busy && busyLabel ? busyLabel : confirmLabel}
            </AlertDialogPrimitive.Action>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

export { Dialog, DialogTrigger, DialogClose, DialogContent, DialogTitle, DialogDescription }

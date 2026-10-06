import { Button, Modal } from '@/components/ui'

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
  loading,
  resultMessage,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  onClose: () => void
  onConfirm: () => void
  loading?: boolean
  resultMessage?: string | null
}) {
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p className="text-sm text-mist">{body}</p>
      {resultMessage ? (
        <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-paper">{resultMessage}</p>
      ) : null}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={onConfirm} disabled={loading}>
          {loading ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

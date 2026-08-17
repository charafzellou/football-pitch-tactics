/**
 * Toast helpers.
 *
 * Every call site was re-specifying `color` and `icon` by hand, which is how
 * the app ended up with three different icons for "something went wrong".
 * These wrappers fix the pairing and add the two behaviours the UI actually
 * needed: an undo action, and a "chatty" tier that the player can switch off
 * in Settings (the lineup builder used to fire a toast on every single tap).
 */
import { useSettingsStore } from '~/stores/settings'
import { useSfx } from './useSfx'

interface ToastOptions {
  title: string
  description?: string
  /** Suppressed unless the player has opted into verbose toasts. */
  chatty?: boolean
  duration?: number
}

interface UndoToastOptions extends ToastOptions {
  actionLabel?: string
  onUndo: () => void
}

export function useAppToast() {
  const toast = useToast()
  const settings = useSettingsStore()
  const sfx = useSfx()

  function shouldShow(options: ToastOptions) {
    return !options.chatty || settings.verboseToasts
  }

  function success(options: ToastOptions) {
    if (!shouldShow(options)) return
    sfx.play('success')
    toast.add({
      color: 'success',
      icon: 'i-lucide-circle-check',
      duration: options.duration ?? 3500,
      title: options.title,
      description: options.description,
    })
  }

  function error(options: ToastOptions) {
    // Failures are never suppressed — a silent error is the bug this replaces.
    sfx.play('error')
    toast.add({
      color: 'error',
      icon: 'i-lucide-octagon-x',
      duration: options.duration ?? 6000,
      title: options.title,
      description: options.description,
    })
  }

  function warn(options: ToastOptions) {
    if (!shouldShow(options)) return
    toast.add({
      color: 'warning',
      icon: 'i-lucide-triangle-alert',
      duration: options.duration ?? 4000,
      title: options.title,
      description: options.description,
    })
  }

  function info(options: ToastOptions) {
    if (!shouldShow(options)) return
    toast.add({
      color: 'info',
      icon: 'i-lucide-info',
      duration: options.duration ?? 3500,
      title: options.title,
      description: options.description,
    })
  }

  /** A confirmation the player can immediately take back. */
  function undoable(options: UndoToastOptions) {
    sfx.play('success')
    toast.add({
      color: 'success',
      icon: 'i-lucide-circle-check',
      duration: options.duration ?? 6000,
      title: options.title,
      description: options.description,
      actions: [{
        label: options.actionLabel ?? 'Undo',
        icon: 'i-lucide-undo-2',
        color: 'neutral',
        variant: 'outline',
        onClick: options.onUndo,
      }],
    })
  }

  /** Surfaces a failed `$fetch` without every call site re-parsing the error. */
  function fromRequestError(cause: unknown, title: string) {
    const detail = cause as {
      statusMessage?: string
      data?: { statusMessage?: string; message?: string }
    }

    error({
      title,
      description: detail?.data?.statusMessage
        ?? detail?.statusMessage
        ?? detail?.data?.message
        ?? 'Please try again.',
    })
  }

  return { success, error, warn, info, undoable, fromRequestError }
}

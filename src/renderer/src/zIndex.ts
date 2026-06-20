// Single source of truth for stacking order — pick the named level instead of
// a raw number so layers stay ordered as new overlays get added.
export const Z = {
  floating: 40, // persistent floating widgets (e.g. debate indicator)
  dropdown: 50, // menus, toasts, side panels, settings modal
  modal: 60, // blocking modal review (edit approval)
  overlay: 70 // top-most command palette / quick open
} as const

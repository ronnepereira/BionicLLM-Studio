export const INTERFACE_SCALES = [100, 110, 115, 120, 125, 130, 135, 140, 145, 150] as const
export type InterfaceScale = typeof INTERFACE_SCALES[number]
// Preserve the app's existing 1.15 layout scale for older profiles.
export const DEFAULT_INTERFACE_SCALE: InterfaceScale = 115

export function normalizeInterfaceScale(value: unknown): InterfaceScale {
  return INTERFACE_SCALES.includes(value as InterfaceScale) ? value as InterfaceScale : DEFAULT_INTERFACE_SCALE
}

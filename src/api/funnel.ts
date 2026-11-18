// LU commercial analytics are not sent by BionicLLM Studio.
import type { CloudSwitchAction } from '../lib/cloud-switch-guard'
export type FunnelEvent =
  | 'cloud_switch_gate'
  | 'cloud_switch_arm'
  | 'cloud_switch_enter'
  | 'cloud_switch_leave'
  | GateFunnelEvent

export type GateFunnelEvent =
  | 'cloud_gate_model_click'
  | 'cloud_gate_pick_sub'
  | 'cloud_gate_pick_credits'

export function funnelEventFor(action: CloudSwitchAction): FunnelEvent {
  switch (action) {
    case 'open-gate': return 'cloud_switch_gate'
    case 'arm': return 'cloud_switch_arm'
    case 'enter-cloud': return 'cloud_switch_enter'
    case 'leave-cloud': return 'cloud_switch_leave'
  }
}
export function reportCloudSwitch(_action: CloudSwitchAction): void {}
export function reportCloudGate(_event: GateFunnelEvent): void {}
export function reportCloudSwitchAnonymous(action: CloudSwitchAction): FunnelEvent { return funnelEventFor(action) }
export function reportCloudSwitchForAccount(_event: FunnelEvent): void {}

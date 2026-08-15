import type { QuotaSettings } from "./settings.js";

/**
 * The provider quota keys are also dispatch controls. Keep this order explicit:
 * it is a standing instruction to the focused harness, not a request to switch
 * the currently focused pane itself.
 */
export function providerStandingOrder(provider: NonNullable<QuotaSettings["provider"]>): string {
  const name = provider === "antigravity" ? "Antigravity (agy)" : provider[0].toUpperCase() + provider.slice(1);
  return [
    "Continue with the task.",
    `Standing order: spawn and delegate only to ${name} agents.`,
    `Use ${name} for all sub-agents and burn that provider's available quota.`,
    "Do not switch to another provider unless I explicitly tell you to.",
    "If that provider is unavailable, report the blocker instead of silently falling back.",
  ].join(" ");
}

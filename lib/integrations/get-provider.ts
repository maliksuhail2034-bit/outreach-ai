import type { Tables } from "@/types/database.types";
import type { IntegrationProvider } from "./provider";
import { WebhookIntegrationProvider, type WebhookIntegrationConfig } from "./providers/webhook";

// The one place that maps a stored integration row to its provider
// implementation — every caller (the digest worker, the settings page's
// "send test digest" action) depends only on this function and the
// IntegrationProvider interface, never on a concrete provider class
// directly. Adding a second provider (Slack, Zapier) means one more case
// here, not a change to any caller.
export function getIntegrationProvider(integration: Tables<"integrations">): IntegrationProvider {
  switch (integration.provider) {
    case "webhook":
      return new WebhookIntegrationProvider(integration.config as unknown as WebhookIntegrationConfig);
    default:
      throw new Error(`No integration provider registered for '${integration.provider}'.`);
  }
}

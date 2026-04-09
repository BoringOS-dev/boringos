/**
 * Notification system — sends emails on key events.
 * Uses Resend API. Silently disabled if RESEND_API_KEY is not set.
 */

export interface NotificationConfig {
  resendApiKey?: string;
  fromEmail?: string;
}

export interface NotificationService {
  notify(to: string, subject: string, body: string): Promise<void>;
  isEnabled(): boolean;
}

export function createNotificationService(config: NotificationConfig): NotificationService {
  const apiKey = config.resendApiKey ?? process.env.RESEND_API_KEY;
  const from = config.fromEmail ?? process.env.NOTIFICATION_FROM_EMAIL ?? "noreply@boringos.dev";

  return {
    isEnabled(): boolean {
      return !!apiKey;
    },

    async notify(to: string, subject: string, body: string): Promise<void> {
      if (!apiKey) return; // Silently disabled

      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            from,
            to,
            subject,
            text: body,
          }),
        });
      } catch {
        // Notification failure should never block the main flow
      }
    },
  };
}

// ── Pre-built notification templates ─────────────────────────────────────────

export function taskCompletedEmail(taskTitle: string, agentName: string): { subject: string; body: string } {
  return {
    subject: `Task completed: ${taskTitle}`,
    body: `Agent "${agentName}" has completed the task "${taskTitle}".`,
  };
}

export function runFailedEmail(agentName: string, error: string): { subject: string; body: string } {
  return {
    subject: `Agent run failed: ${agentName}`,
    body: `Agent "${agentName}" run failed with error:\n\n${error}`,
  };
}

export function approvalNeededEmail(agentName: string, approvalType: string): { subject: string; body: string } {
  return {
    subject: `Approval needed: ${approvalType}`,
    body: `Agent "${agentName}" is requesting approval for: ${approvalType}.\n\nPlease review and approve/reject in the dashboard.`,
  };
}

export function budgetWarningEmail(scope: string, spentCents: number, limitCents: number): { subject: string; body: string } {
  return {
    subject: `Budget warning: ${scope}`,
    body: `Budget warning for ${scope}: $${(spentCents / 100).toFixed(2)} spent of $${(limitCents / 100).toFixed(2)} limit.`,
  };
}

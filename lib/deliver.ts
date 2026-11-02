import type { AppDeps } from "@/lib/deps";
import { planReminders } from "@/lib/reminders";
import { safeLog } from "@/lib/security";

export async function deliverReminders(deps: AppDeps): Promise<number> {
  const state = await deps.store.load();
  const sent = new Set(await deps.store.sentReminderKeys());
  const due = planReminders(state, sent, deps.now());
  let count = 0;
  for (const message of due) {
    try {
      await deps.sendEmail({ subject: message.subject, text: message.text, html: message.html });
      const inserted = await deps.store.markReminder(message.key, message.kind);
      if (inserted) count += 1;
    } catch (error) {
      console.info(JSON.stringify(safeLog({ count, status: "email", errorCode: "email_failed" })));
      throw error;
    }
  }
  return count;
}

import { ConfigError } from "@/lib/security";

export async function sendMail(message: { subject: string; text: string }): Promise<{ sent: boolean; missing?: string }> {
  const key = process.env.RESEND_API_KEY;
  const to = process.env.ALLOWED_EMAIL;
  if (!key || !to) return { sent: false, missing: !key ? "RESEND_API_KEY" : "ALLOWED_EMAIL" };
  const { Resend } = await import("resend");
  const resend = new Resend(key);
  const { error } = await resend.emails.send({
    from: "Ciclo <onboarding@resend.dev>",
    to,
    subject: message.subject,
    text: message.text,
  });
  if (error) throw new ConfigError("RESEND_API_KEY");
  return { sent: true };
}

import { formatBrl } from "@/lib/format";

export const APP_URL = "https://ciclo-peach.vercel.app";

export type SummaryRow = { planName: string; priceLabel: string; nextChargeLabel: string };

export type SummaryEmail = {
  title: string;
  intro: string;
  rows: SummaryRow[];
  monthlyTotal: number;
  annualLabel: string;
};

// Same tokens as the login-code template in Supabase (Authentication → Email Templates).
const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const C = {
  page: "#f5f1ea",
  card: "#ffffff",
  ink: "#111",
  body: "#555",
  note: "#8a7f6e",
  faint: "#999",
  block: "#0b0b0b",
  line: "#eee8de",
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(item: SummaryRow, first: boolean): string {
  const border = first ? "" : `border-top:1px solid ${C.line};`;
  return `<tr>
<td style="padding:12px 0;${border}"><div style="font-size:15px;font-weight:600;color:${C.ink};">${esc(item.planName)}</div><div style="padding-top:2px;font-size:12px;color:${C.note};">${esc(item.nextChargeLabel)}</div></td>
<td align="right" style="padding:12px 0;${border}font-size:15px;font-weight:600;color:${C.ink};white-space:nowrap;">${esc(item.priceLabel)}</td>
</tr>`;
}

/** The app icon (same PNG as the PWA) next to the name. Shared with the login-code template. */
export function logoHeader(): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;"><img src="${APP_URL}/icons/logo-animado.gif" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;"></td><td style="font-family:${FONT};font-size:17px;font-weight:600;color:${C.ink};">Ciclo</td></tr></table>`;
}

/** Weekly/monthly summary in the same frame as the login-code e-mail. */
export function renderSummaryHtml(mail: SummaryEmail): string {
  const count = mail.rows.length === 1 ? "1 assinatura ativa" : `${mail.rows.length} assinaturas ativas`;
  const list = mail.rows.length
    ? mail.rows.map((item, index) => row(item, index === 0)).join("")
    : `<tr><td style="padding:12px 0;font-size:14px;color:${C.body};">Nenhuma assinatura confirmada.</td></tr>`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(mail.title)}</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:32px 0;font-family:${FONT};">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:${C.card};border-radius:16px;padding:32px;">
      <tr><td>${logoHeader()}</td></tr>
      <tr><td style="padding-top:24px;font-size:22px;font-weight:700;color:${C.ink};">${esc(mail.title)}</td></tr>
      <tr><td style="padding-top:8px;font-size:14px;color:${C.body};">${esc(mail.intro)}</td></tr>
      <tr><td align="center" style="padding-top:24px;">
        <div style="background:${C.block};border-radius:12px;padding:20px 12px;">
          <div style="font-size:12px;color:#b9b2a6;">Gasto mensal</div>
          <div style="padding-top:6px;font-size:36px;font-weight:700;color:#ffffff;">${esc(formatBrl(mail.monthlyTotal))}</div>
          <div style="padding-top:4px;font-size:12px;color:#b9b2a6;">${esc(mail.annualLabel)}</div>
        </div>
      </td></tr>
      <tr><td align="center" style="padding-top:12px;font-size:12px;color:${C.note};">${esc(count)}</td></tr>
      <tr><td style="padding-top:16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT};">${list}</table>
      </td></tr>
      <tr><td align="center" style="padding-top:24px;"><a href="${APP_URL}" style="display:inline-block;background:${C.block};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:12px;">Abrir o Ciclo</a></td></tr>
      <tr><td style="padding-top:24px;font-size:12px;color:${C.faint};">Você recebe este resumo porque usa o Ciclo.</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

import { createSupabaseStore } from "@/lib/supabase-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ merchantKey: string }> }): Promise<Response> {
  const { merchantKey } = await context.params;
  const key = decodeURIComponent(merchantKey);
  const record = await createSupabaseStore().getServiceLogo(key);
  if (!record?.sourceUrl) return new Response(null, { status: 404 });
  try {
    const response = await fetch(record.sourceUrl, { redirect: "follow" });
    if (!response.ok) return new Response(null, { status: 404 });
    const bytes = await response.arrayBuffer();
    return new Response(bytes, {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

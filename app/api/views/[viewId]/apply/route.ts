import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClient } from "../../../../../lib/supabase/admin";
import { ensureSpecQuality } from "../../../../../lib/view/spec-quality";
import type { PersistedViewSpec } from "../../../../../lib/types/view-builder";

const applySchema = z.object({
  spec: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().min(1),
  draftId: z.string().uuid().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ viewId: string }> },
) {
  const { viewId } = await params;
  const body = applySchema.parse(await request.json());
  const supabase = getSupabaseAdminClient();

  const { data: existingView, error: fetchError } = await supabase
    .from("views")
    .select("*")
    .eq("id", viewId)
    .single();

  if (fetchError || !existingView) {
    return NextResponse.json(
      { error: fetchError?.message ?? "View not found" },
      { status: 404 },
    );
  }

  let specToApply = body.spec as PersistedViewSpec | undefined;
  let draftSourceFingerprint: string | null = null;
  if (body.draftId) {
    const { data: draft, error: draftError } = await supabase
      .from("view_drafts")
      .select("*")
      .eq("id", body.draftId)
      .eq("view_id", viewId)
      .eq("status", "pending")
      .single();

    if (draftError || !draft) {
      return NextResponse.json(
        { error: draftError?.message ?? "Draft not found" },
        { status: 404 },
      );
    }
    specToApply = draft.spec as PersistedViewSpec;
    draftSourceFingerprint = draft.source_fingerprint as string;
  }

  if (!specToApply) {
    return NextResponse.json(
      { error: "spec or draftId is required." },
      { status: 400 },
    );
  }

  const qualityCheckedSpec = ensureSpecQuality(specToApply);

  const nextVersion = existingView.current_spec_version + 1;

  const { error: versionError } = await supabase.from("view_versions").insert({
    view_id: viewId,
    version_number: nextVersion,
    spec: qualityCheckedSpec,
    summary: body.summary,
  });

  if (versionError) {
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }

  const { data: updatedView, error: updateError } = await supabase
    .from("views")
    .update({
      spec: qualityCheckedSpec,
      current_spec_version: nextVersion,
      ui_state: {
        ...(existingView.ui_state ?? {}),
        source_fingerprint:
          draftSourceFingerprint ??
          (existingView.ui_state?.source_fingerprint ?? null),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", viewId)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (body.draftId) {
    await supabase
      .from("view_drafts")
      .update({ status: "applied" })
      .eq("id", body.draftId);
  }

  return NextResponse.json({
    view: updatedView,
    message: "Spec applied and version recorded.",
  });
}

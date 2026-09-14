"use server";

import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "");
  const params = new URLSearchParams();
  if (tokenHash) params.set("token_hash", tokenHash);
  if (type) params.set("type", type);
  if (password.length < 6 || password !== confirmation) {
    params.set("error", password.length < 6 ? "length" : "match");
    redirect(`/auth/set-password?${params}`);
  }

  const supabase = await createServerClient();
  if (tokenHash) {
    if (type !== "invite" && type !== "recovery") redirect("/login?error=invite");
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) redirect("/login?error=invite");
  }
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=invite");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/auth/set-password?error=save");
  redirect("/calendar");
}

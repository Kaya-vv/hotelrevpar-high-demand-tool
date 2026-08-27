"use server";

import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 12) redirect("/auth/set-password?error=length");
  if (password !== confirmation) redirect("/auth/set-password?error=match");

  const supabase = await createServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=invite");

  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/auth/set-password?error=save");
  redirect("/calendar");
}

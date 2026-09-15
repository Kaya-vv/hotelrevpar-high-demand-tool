"use server";

import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";
import { loginDestination } from "@/lib/auth/login-destination";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const destination = loginDestination(formData.get("next"));
  const failure = `/login?error=credentials${destination === "/calendar" ? "" : `&next=${encodeURIComponent(destination)}`}`;

  if (!email || !password) redirect(failure);

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(failure);

  redirect(destination);
}

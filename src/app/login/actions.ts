"use server";

import { redirect } from "next/navigation";

import { createServerClient } from "@/lib/supabase/server";
import { loginDestination } from "@/lib/auth/login-destination";
import { z } from "zod";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!z.email().safeParse(email).success) redirect("/login?reset=true&error=email");
  let failed = false;
  try {
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) throw new Error("Site URL missing");
    const base = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`;
    const supabase = await createServerClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: new URL("/auth/confirm?next=/auth/set-password", base).toString(),
    });
    failed = Boolean(error);
  } catch {
    failed = true;
  }
  redirect(failed ? "/login?reset=true&error=reset" : "/login?reset=true&sent=true");
}

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

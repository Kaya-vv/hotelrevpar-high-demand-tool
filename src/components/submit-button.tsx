"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, confirmation, primary = false }: {
  children: React.ReactNode;
  confirmation?: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={primary ? "primary" : "secondary"}
      disabled={pending}
      onClick={(event) => {
        if (confirmation && !window.confirm(confirmation)) event.preventDefault();
      }}
    >
      {pending ? "Even wachten…" : children}
    </button>
  );
}

"use client";
import { createContext, useContext, useEffect, useId } from "react";
export const RunStatusContext = createContext<{
  expired: boolean;
  register: (id: string, pending: boolean) => void;
  resume: () => void;
}>({
  expired: false,
  register: () => {},
  resume: () => {},
});
/** Views register interest; only the shell owns network requests. */
export function useRunStatusPoll(pending: boolean) {
  const { register, expired } = useContext(RunStatusContext);
  const id = useId();
  useEffect(() => {
    register(id, pending);
    return () => register(id, false);
  }, [id, pending, register]);
  return pending && expired;
}

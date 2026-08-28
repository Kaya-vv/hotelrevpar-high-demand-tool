import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  useFormStatus: () => ({ pending: true, data: null, method: null, action: null }),
}));

import { RefreshButton } from "./refresh-button";

describe("RefreshButton", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("disables itself and shows elapsed collection time", () => {
    render(<RefreshButton />);

    expect(screen.getByRole("button", { name: /bronnen verzamelen/i })).toBeDisabled();
    act(() => vi.advanceTimersByTime(2_000));
    expect(screen.getByRole("button", { name: /2s/i })).toBeInTheDocument();
  });
});

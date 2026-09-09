import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SourceHealthList } from "./source-health-list";
vi.mock("./source-health-table", () => ({
  SourceHealthDetails: () => <p>Full run details</p>,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("fetches details only for an expanded run", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "run" }) }),
  );
  const { container } = render(
    <SourceHealthList
      runs={[
        {
          id: "run",
          accountName: "Account",
          areaName: "Hotel",
          startedAt: "2026-09-09T12:00:00Z",
          finishedAt: null,
          label: "Bezig",
        },
      ]}
    />,
  );
  expect(fetch).not.toHaveBeenCalled();
  const details = container.querySelector("details")!;
  await act(async () => {
    details.open = true;
    fireEvent(details, new Event("toggle"));
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    "/api/source-health/run",
    expect.objectContaining({ cache: "no-store" }),
  );
  expect(screen.getByText("Full run details")).toBeVisible();
});

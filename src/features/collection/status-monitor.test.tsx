import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StatusMonitor } from "./status-monitor";
import { useRunStatusPoll } from "./use-run-status-poll";
import type { CollectionStatus } from "./status";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
  usePathname: () => "/calendar",
}));
const initial: CollectionStatus = {
  batch: { batchId: "batch", total: 2, completed: 0, failed: 0, active: true },
  pending: true,
  revision: "one",
  watchKey: "run",
};
let current: CollectionStatus;
const response = () =>
  Promise.resolve({ ok: true, status: 200, json: async () => current });
function View() {
  useRunStatusPoll(true);
  return <p>Saved calendar</p>;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T12:00:00Z"));
  current = initial;
  vi.stubGlobal("fetch", vi.fn(response));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  refresh.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

it("shares one monitor, updates counts without refreshing and refreshes a publication once", async () => {
  render(
    <StatusMonitor initial={initial}>
      <View />
      <View />
    </StatusMonitor>,
  );
  await advance(15_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
  current = { ...initial, batch: { ...initial.batch!, completed: 1 } };
  await advance(15_000);
  expect(screen.getByRole("status")).toHaveTextContent("1 van 2");
  expect(refresh).not.toHaveBeenCalled();
  current = { ...current, revision: "published" };
  await advance(30_000);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("pauses hidden/offline tabs and stops after terminal status", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  visibility.mockReturnValue("hidden");
  render(
    <StatusMonitor initial={initial}>
      <View />
    </StatusMonitor>,
  );
  await advance(60_000);
  expect(fetch).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(fetch).toHaveBeenCalledTimes(1);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fireEvent(window, new Event("offline"));
  await advance(60_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  current = {
    ...initial,
    revision: "done",
    pending: false,
    batch: { ...initial.batch!, active: false, completed: 2 },
  };
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event("online")));
  await advance(60_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("bounds an hour-long pending run despite re-renders, and allows explicit resume", async () => {
  const view = render(
    <StatusMonitor initial={initial}>
      <View />
    </StatusMonitor>,
  );
  await advance(5 * 60_000);
  view.rerender(
    <StatusMonitor initial={{ ...initial }}>
      <View />
    </StatusMonitor>,
  );
  await advance(55 * 60_000);
  expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(40);
  expect(refresh).not.toHaveBeenCalled();
  expect(screen.getByText(/Automatisch bijwerken is gestopt/)).toBeVisible();
  const before = vi.mocked(fetch).mock.calls.length;
  await act(async () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Status opnieuw volgen" }),
    ),
  );
  expect(fetch).toHaveBeenCalledTimes(before + 1);
});

it("backs off errors, preserves the calendar and stops when authorization expires", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("Unavailable"));
  render(
    <StatusMonitor initial={initial}>
      <View />
    </StatusMonitor>,
  );
  await advance(44_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Saved calendar")).toBeVisible();
  await advance(1_000);
  expect(fetch).toHaveBeenCalledTimes(2);
  vi.mocked(fetch).mockResolvedValue({ status: 401 } as Response);
  await advance(60_000);
  await advance(60_000);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(screen.getByText(/Sessie verlopen/)).toBeVisible();
});

it("does not overlap requests and aborts on unmount", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementation((_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise((_resolve, reject) =>
      signal?.addEventListener("abort", () => reject(new Error("aborted"))),
    );
  });
  const view = render(
    <StatusMonitor initial={initial}>
      <View />
    </StatusMonitor>,
  );
  await advance(20_000);
  expect(fetch).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(signal?.aborted).toBe(true);
  await advance(60_000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("checks once on returning after expiry without restarting periodic polling", async () => {
  render(
    <StatusMonitor initial={initial}>
      <View />
    </StatusMonitor>,
  );
  await advance(60 * 60_000);
  const before = vi.mocked(fetch).mock.calls.length;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(fetch).toHaveBeenCalledTimes(before + 1);
  await advance(60_000);
  expect(fetch).toHaveBeenCalledTimes(before + 1);
});

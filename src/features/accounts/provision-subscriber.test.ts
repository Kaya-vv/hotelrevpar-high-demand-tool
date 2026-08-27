import { describe, expect, it, vi } from "vitest";

import { provisionSubscriber } from "./provision-subscriber";

describe("provisionSubscriber", () => {
  it("removes the invited user when account creation fails", async () => {
    const removeUser = vi.fn().mockResolvedValue(undefined);

    await expect(
      provisionSubscriber(
        { accountName: "Hotelgroep", email: "manager@example.com" },
        {
          inviteUser: vi.fn().mockResolvedValue("user-1"),
          createAccount: vi.fn().mockRejectedValue(new Error("database unavailable")),
          removeUser,
        },
      ),
    ).rejects.toThrow("database unavailable");

    expect(removeUser).toHaveBeenCalledWith("user-1");
  });
});

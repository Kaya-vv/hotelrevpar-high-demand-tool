import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddressCombobox } from "./address-combobox";

describe("AddressCombobox", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stores a suggestion and clears its identifier after text changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      suggestions: [{ id: "address-1", label: "Kleine Berg 43, 5611JS Eindhoven" }],
    }), { status: 200 })));
    const { container } = render(<AddressCombobox defaultAddress="" defaultAddressId="" />);
    const input = screen.getByRole("combobox", { name: "Volledig adres" });
    const identifier = container.querySelector<HTMLInputElement>('input[name="addressId"]')!;

    fireEvent.change(input, { target: { value: "Kleine Berg 43" } });
    const option = await screen.findByRole("option", { name: "Kleine Berg 43, 5611JS Eindhoven" });
    fireEvent.mouseDown(option);

    expect(input).toHaveValue("Kleine Berg 43, 5611JS Eindhoven");
    expect(identifier).toHaveValue("address-1");

    fireEvent.change(input, { target: { value: "Kleine Berg 43, 5611JT Eindhoven" } });
    await waitFor(() => expect(identifier).toHaveValue(""));
  });
});

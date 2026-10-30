import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("keeps working after browser page translation has replaced its text", async () => {
    // A real search takes a moment, so "searching…" replaces the translated hint before results arrive.
    vi.stubGlobal("fetch", vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new Response(JSON.stringify({
        suggestions: [{ id: "address-1", label: "Eerste Ringdijkstraat 4, 1097BC Amsterdam" }],
      }), { status: 200 });
    }));
    const { container } = render(<AddressCombobox defaultAddress="" defaultAddressId="" />);
    // Chrome "Translate this page" swaps every text node for its own wrapper element.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const texts: Node[] = [];
    while (walker.nextNode()) texts.push(walker.currentNode);
    for (const text of texts) {
      const wrapper = document.createElement("span");
      wrapper.textContent = `EN ${text.textContent}`;
      text.parentNode!.replaceChild(wrapper, text);
    }
    const view = within(container);

    fireEvent.change(view.getByRole("combobox"), { target: { value: "Eerste Ringdijkstraat 4" } });

    expect(await view.findByRole("option", { name: "Eerste Ringdijkstraat 4, 1097BC Amsterdam" })).toBeInTheDocument();
  });
});

import { render } from "@testing-library/react";
import { expect, it } from "vitest";

import "./instrumentation-client";

function Notice({ busy }: { busy: boolean }) {
  return <p>{busy && "Bezig"}{!busy && "Klaar"}</p>;
}

it("lets React update text that browser page translation has taken over", () => {
  const { container, rerender } = render(<Notice busy />);
  const paragraph = container.querySelector("p")!;
  const font = document.createElement("font");
  font.textContent = "Busy";
  paragraph.replaceChild(font, paragraph.firstChild!);

  expect(() => rerender(<Notice busy={false} />)).not.toThrow();
  expect(paragraph.textContent).toContain("Klaar");
});

import { describe, expect, it } from "vitest";

import { renderEventNotification } from "./email";

describe("event notification email", () => {
  it("renders one Dutch hotel digest and escapes event content", () => {
    const message = renderEventNotification(
      {
        id: "hotel-1",
        name: "Hotel & Spa",
        events: [],
      },
      [
        {
          id: "event-1",
          title: "Design <Week>",
          venue: 'Hal "A"',
          startAt: "2027-10-10T10:00:00Z",
          endAt: "2027-10-12T22:00:00Z",
          level: "Hoog",
        },
        {
          id: "event-2",
          title: "Marathon",
          venue: null,
          startAt: "2027-11-01T10:00:00Z",
          endAt: "2027-11-01T22:00:00Z",
          level: "Aangekondigd",
        },
      ],
      "https://app.example",
    );

    expect(message.subject).toBe("2 nieuwe events voor Hotel & Spa");
    expect(message.html).toContain("Design &lt;Week&gt;");
    expect(message.html).toContain("Hal &quot;A&quot;");
    expect(message.html).toContain("background:#f26522");
    expect(message.html).toContain("Robert van Vliet");
    expect(message.html).toContain("10 oktober 2027 tot 13 oktober 2027");
    expect(message.html).toContain("https://app.example/open-calendar/hotel-1");
    expect(message.text).toContain("Locatie: nog niet bekend");
    expect(message.text).toContain("Aangekondigd");
  });
});

import { describe, expect, it } from "vitest";

import type { EventCandidate } from "./types";
import { automatedExclusionReason, resolvedReviewState, reviewFingerprint } from "./review-fingerprint";

const candidate: EventCandidate = {
  provider: "ticketmaster",
  providerEventId: "tm-1",
  sourceUrl: "https://example.com/event",
  title: "Dutch Design Week",
  category: "festival",
  venue: "Klokgebouw",
  latitude: 51.448,
  longitude: 5.458,
  regionScope: null,
  startAt: "2027-10-16T10:00:00+02:00",
  endAt: "2027-10-24T22:00:00+02:00",
  sourceState: "cancelled",
  certainty: "confirmed",
  localRank: null,
  attendance: null,
  venueCapacity: null,
  evidenceText: null,
  primarySourceConfirmed: true,
};

describe("reviewFingerprint", () => {
  it("stays stable for unchanged evidence and changes with the proposal", () => {
    const original = reviewFingerprint(candidate, "cancelled", "event-1");
    expect(reviewFingerprint(candidate, "cancelled", "event-1")).toBe(original);
    expect(
      reviewFingerprint(
        { ...candidate, startAt: "2027-10-17T10:00:00+02:00" },
        "cancelled",
        "event-1"
      )
    ).not.toBe(original);
  });

  it("keeps an unchanged decision but accepts changed evidence", () => {
    expect(
      resolvedReviewState({
        validationState: "needs_review",
        existingState: "excluded",
        existingFingerprint: "same",
        fingerprint: "same",
        conflict: false,
      })
    ).toBe("excluded");
    expect(
      resolvedReviewState({
        validationState: "active",
        existingState: "excluded",
        existingFingerprint: "old",
        fingerprint: null,
        conflict: false,
      })
    ).toBe("active");
  });

  it("reactivates an event when an automated provider exclusion recovers", () => {
    expect(
      resolvedReviewState({
        validationState: "active",
        existingState: "excluded",
        existingFingerprint: null,
        fingerprint: null,
        conflict: false,
        automatedExclusion: true,
      })
    ).toBe("active");
  });

  it("records a reason for every automated exclusion so later evidence can reverse it", () => {
    // Production: the Marathon verified on its official page yet stayed excluded, because
    // missing_primary_evidence wrote a null reason and read back as a human decision.
    expect(automatedExclusionReason("excluded", "missing_primary_evidence", false))
      .toBe("missing_primary_evidence");
    expect(automatedExclusionReason("excluded", "cancelled", false)).toBe("provider_cancelled");
    expect(automatedExclusionReason("excluded", "out_of_window", false)).toBe("out_of_window");

    // A human exclusion stays sticky, and an active decision carries no reason.
    expect(automatedExclusionReason("excluded", "missing_primary_evidence", true)).toBeNull();
    expect(automatedExclusionReason("active", null, false)).toBeNull();
  });
});

/** Email destinations are restricted to the hotel-selection route, never an external URL. */
export function loginDestination(value: unknown) {
  return typeof value === "string" && /^\/open-calendar\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : "/calendar";
}

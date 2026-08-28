"use client";

import { type KeyboardEvent, useEffect, useId, useState } from "react";

type Suggestion = { id: string; label: string };
type Status = "idle" | "loading" | "empty" | "error";

export function AddressCombobox({
  defaultAddress,
  defaultAddressId,
  error,
}: {
  defaultAddress: string;
  defaultAddressId: string;
  error?: string;
}) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const [value, setValue] = useState(defaultAddress);
  const [selectedId, setSelectedId] = useState(defaultAddressId);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    const query = value.trim();
    if (selectedId || query.length < 3) {
      setSuggestions([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const response = await fetch(`/api/addresses?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json() as { suggestions: Suggestion[] };
        setSuggestions(body.suggestions);
        setActiveIndex(body.suggestions.length ? 0 : -1);
        setStatus(body.suggestions.length ? "idle" : "empty");
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === "AbortError") return;
        setSuggestions([]);
        setStatus("error");
      }
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedId, value]);

  function select(suggestion: Suggestion) {
    setValue(suggestion.label);
    setSelectedId(suggestion.id);
    setSuggestions([]);
    setStatus("idle");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setSuggestions([]);
      return;
    }
    if (!suggestions.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + offset + suggestions.length) % suggestions.length);
    }
    if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      select(suggestions[activeIndex]);
    }
  }

  return (
    <div className="wide address-combobox">
      <label htmlFor={inputId}>Volledig adres</label>
      <input
        id={inputId}
        name="address"
        value={value}
        placeholder="Begin met straat, huisnummer of plaats"
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={suggestions.length > 0}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        required
        onChange={(event) => {
          setValue(event.target.value);
          setSelectedId("");
        }}
        onKeyDown={onKeyDown}
      />
      <input name="addressId" type="hidden" value={selectedId} />
      {suggestions.length > 0 && (
        <ul id={listId} className="address-suggestions" role="listbox">
          {suggestions.map((suggestion, index) => (
            <li
              id={`${listId}-${index}`}
              key={suggestion.id}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(event) => {
                event.preventDefault();
                select(suggestion);
              }}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {suggestion.label}
            </li>
          ))}
        </ul>
      )}
      <small role="status">
        {status === "loading" && "Adressen zoeken…"}
        {status === "empty" && "Geen adressen gevonden. Controleer je invoer."}
        {status === "error" && "Adreszoeken is niet beschikbaar. Probeer het later opnieuw."}
        {status === "idle" && "Typ en kies een adres uit de lijst."}
      </small>
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

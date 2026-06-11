import { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  formatPhotonLabel,
  formatPhotonPlaceCategory,
  searchPhotonAddresses,
  type PhotonFeature,
} from "../lib/addressSearch";

const defaultLabelClass =
  "mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]";
const defaultInputClass =
  "w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2.5 text-sm text-[#0F2C5C] placeholder:text-[#8694AC] focus:border-[#2F80ED]/60 focus:outline-none focus:ring-1 focus:ring-[#2F80ED]/25";

export type AddressAutocompleteInputProps = {
  id: string;
  label: string;
  value: string;
  /** Called with formatted address; `coords` is `[lat, lng]` when a suggestion is chosen, or `null` when the user edits the field manually. `feature` is set when a suggestion is picked. */
  onChange: (
    address: string,
    coords: [number, number] | null,
    feature?: PhotonFeature,
  ) => void;
  required?: boolean;
  placeholder?: string;
  labelClassName?: string;
  inputClassName?: string;
  /** Outer wrapper (use `relative` if you need positioning context for the dropdown). */
  className?: string;
  autoComplete?: string;
};

export function AddressAutocompleteInput({
  id,
  label,
  value,
  onChange,
  required = false,
  placeholder = "Search for a street or place…",
  labelClassName = defaultLabelClass,
  inputClassName = defaultInputClass,
  className = "relative",
  autoComplete = "off",
}: AddressAutocompleteInputProps) {
  const [addressSuggestions, setAddressSuggestions] = useState<PhotonFeature[]>(
    [],
  );
  const [addressSuggestOpen, setAddressSuggestOpen] = useState(false);
  const [addressSuggestLoading, setAddressSuggestLoading] = useState(false);
  const [addressHighlight, setAddressHighlight] = useState(0);
  const [addressFieldFocused, setAddressFieldFocused] = useState(false);
  const addressListId = useId();
  const addressBlurTimeout = useRef<number | null>(null);

  useEffect(() => {
    if (!addressFieldFocused) {
      setAddressSuggestions([]);
      setAddressSuggestLoading(false);
      setAddressSuggestOpen(false);
      return;
    }
    const q = value.trim();
    if (q.length < 2) {
      setAddressSuggestions([]);
      setAddressSuggestLoading(false);
      setAddressSuggestOpen(false);
      return;
    }
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      setAddressSuggestLoading(true);
      searchPhotonAddresses(q, ac.signal)
        .then((features) => {
          setAddressSuggestions(features);
          setAddressHighlight(0);
          setAddressSuggestOpen(features.length > 0);
        })
        .catch((err: Error) => {
          if (err.name === "AbortError") return;
          setAddressSuggestions([]);
          setAddressSuggestOpen(false);
        })
        .finally(() => setAddressSuggestLoading(false));
    }, 320);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [value, addressFieldFocused]);

  const selectAddressSuggestion = (feature: PhotonFeature) => {
    if (addressBlurTimeout.current != null) {
      window.clearTimeout(addressBlurTimeout.current);
      addressBlurTimeout.current = null;
    }
    const labelText = formatPhotonLabel(feature.properties);
    const [lon, lat] = feature.geometry.coordinates;
    onChange(labelText, [lat, lon], feature);
    setAddressSuggestOpen(false);
    setAddressSuggestions([]);
  };

  return (
    <div className={className}>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={addressSuggestOpen}
          aria-controls={addressListId}
          aria-autocomplete="list"
          value={value}
          onChange={(e) => {
            onChange(e.target.value, null);
          }}
          onFocus={() => {
            setAddressFieldFocused(true);
            if (addressSuggestions.length > 0) setAddressSuggestOpen(true);
          }}
          onBlur={() => {
            addressBlurTimeout.current = window.setTimeout(() => {
              setAddressSuggestOpen(false);
              setAddressFieldFocused(false);
            }, 180);
          }}
          onKeyDown={(e) => {
            if (!addressSuggestOpen || addressSuggestions.length === 0) {
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAddressHighlight((i) =>
                Math.min(i + 1, addressSuggestions.length - 1),
              );
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAddressHighlight((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const f = addressSuggestions[addressHighlight];
              if (f) selectAddressSuggestion(f);
            } else if (e.key === "Escape") {
              setAddressSuggestOpen(false);
            }
          }}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          className={`${inputClassName} ${addressSuggestLoading ? "pr-10" : ""}`}
        />
        {addressSuggestLoading && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#2F80ED]">
            <Loader2
              className="h-4 w-4 animate-spin"
              aria-hidden
              strokeWidth={2}
            />
          </span>
        )}
      </div>
      {addressSuggestOpen && addressSuggestions.length > 0 && (
        <ul
          id={addressListId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-[#DCE6F2] bg-white py-1 shadow-lg"
        >
          {addressSuggestions.map((feature, index) => {
            const mainLabel = formatPhotonLabel(feature.properties);
            const category = formatPhotonPlaceCategory(feature.properties);
            const sub = [
              category,
              feature.properties.city ||
                feature.properties.town ||
                feature.properties.village,
              feature.properties.country,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={`${feature.geometry.coordinates.join(",")}-${index}`}
                role="option"
                aria-selected={index === addressHighlight}
              >
                <button
                  type="button"
                  className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left text-sm transition ${
                    index === addressHighlight
                      ? "bg-[#EDF3FB] text-[#2F80ED]"
                      : "text-[#0F2C5C] hover:bg-[#EDF3FB]"
                  }`}
                  onMouseDown={(ev) => ev.preventDefault()}
                  onClick={() => selectAddressSuggestion(feature)}
                  onMouseEnter={() => setAddressHighlight(index)}
                >
                  <span className="font-medium">{mainLabel}</span>
                  {sub ? (
                    <span className="text-xs text-[#8694AC]">{sub}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

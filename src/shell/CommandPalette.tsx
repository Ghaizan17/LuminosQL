import { useEffect, useRef, useState } from "react";
import { COMMANDS, filterCommands } from "../state/commands";
import { useStore } from "../state/store";

export function CommandPalette() {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = filterCommands(query);

  useEffect(() => {
    if (state.paletteOpen) {
      setQuery("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [state.paletteOpen]);

  if (!state.paletteOpen) return null;
  const close = () => dispatch({ type: "set-palette", open: false });

  return (
    <div className="palette-backdrop" onClick={close}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="> Type a command…"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            if (e.key === "ArrowDown") setIndex((i) => Math.min(i + 1, results.length - 1));
            if (e.key === "ArrowUp") setIndex((i) => Math.max(i - 1, 0));
            if (e.key === "Enter" && results[index]) {
              results[index].run(dispatch);
              close();
            }
          }}
        />
        <ul>
          {(query ? results : COMMANDS).map((c, i) => (
            <li
              key={c.id}
              className={i === index ? "selected" : ""}
              onMouseEnter={() => setIndex(i)}
              onClick={() => {
                c.run(dispatch);
                close();
              }}
            >
              {c.title} <span className="phase">Phase {c.phase}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

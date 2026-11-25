"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import type { Row } from "@/lib/domain";
import styles from "./department-select.module.css";

export default function DepartmentSelect({
  departments,
  value,
  onChange,
  allowAll = false,
  label = "בחירת מחלקה",
}: {
  departments: Row[];
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const selection = departments.find((item) => item.id === value);
  const selectedLabel = selection
    ? String(selection.name)
    : allowAll
      ? "כל המחלקות"
      : label;
  const matches = departments.filter((item) =>
    String(item.name)
      .toLocaleLowerCase("he-IL")
      .includes(query.trim().toLocaleLowerCase("he-IL")),
  );

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    function closeOnOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !root.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeOnOutside);
    return () => document.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  function choose(id: string) {
    setOpen(false);
    trigger.current?.focus();
    if (id !== value) onChange(id);
  }

  const options =
    allowAll && !query.trim()
      ? [{ id: "", name: "כל המחלקות" }, ...matches]
      : matches;

  return (
    <div
      className={styles.picker}
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        className={styles.trigger}
        type="button"
        ref={trigger}
        aria-label={label + " · " + selectedLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => {
          setQuery("");
          setOpen(!open);
        }}
      >
        <span>{selectedLabel}</span>
        <ChevronDown aria-hidden size={17} />
      </button>
      {open && (
        <div
          className={styles.popover}
          id={panelId}
          role="group"
          aria-label={label}
        >
          <label className={styles.search}>
            <Search aria-hidden size={17} />
            <input
              ref={search}
              value={query}
              placeholder="חיפוש מחלקה"
              aria-label="חיפוש מחלקה"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches.length === 1) {
                  event.preventDefault();
                  choose(matches[0].id);
                }
              }}
            />
          </label>
          <ul className={styles.options}>
            {options.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={item.id === value}
                  onClick={() => choose(item.id)}
                >
                  <span>{String(item.name)}</span>
                  {item.id === value && <Check aria-hidden size={17} />}
                </button>
              </li>
            ))}
          </ul>
          {matches.length === 0 && (
            <p className={styles.empty}>לא נמצאה מחלקה</p>
          )}
        </div>
      )}
    </div>
  );
}

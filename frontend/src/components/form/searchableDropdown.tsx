"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useFormContext } from "react-hook-form";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface DropdownOption {
  key: string;
  value: string;
}

interface SearchableDropdownProps {
  name: string;
  label: string;
  options: DropdownOption[];
  placeholder?: string;
}

export default function SearchableDropdown({
  name,
  label,
  options,
  placeholder = "Search...",
}: SearchableDropdownProps) {
  const {
    setValue,
    watch,
    formState: { errors },
  } = useFormContext();

  const currentValue = (watch(name) as string) || "";
  const error = errors[name]?.message as string | undefined;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedOption = options.find((o) => o.value === currentValue);

  const filtered = debouncedSearch
    ? options.filter((o) =>
        o.key.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : options;

  const debounce = useCallback((value: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
    }, 500);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setSearch("");
        setDebouncedSearch("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus();
    }
  }, [open]);

  function handleSelect(value: string) {
    setValue(name, value, { shouldValidate: true });
    setOpen(false);
    setSearch("");
    setDebouncedSearch("");
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setSearch(val);
    debounce(val);
  }

  return (
    <Field data-invalid={Boolean(error)} className="relative w-full" ref={containerRef}>
      <FieldLabel htmlFor={name} className="sr-only">
        {label}
      </FieldLabel>

      <button
        type="button"
        id={name}
        aria-invalid={Boolean(error)}
        aria-expanded={open}
        className={cn(
          "flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 py-1 text-left text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30",
          !selectedOption && "text-muted-foreground",
        )}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate">{selectedOption ? selectedOption.key : placeholder}</span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="inset-x-0 top-full z-50 mt-1 flex max-h-72 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
          <div className="p-2">
            <Input
              ref={searchRef}
              type="text"
              className="h-7 text-sm"
              placeholder={placeholder}
              value={search}
              onChange={handleSearchChange}
            />
          </div>
          <ul className="flex-1 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <li className="py-2 text-center text-sm text-muted-foreground">
                No results found
              </li>
            )}
            {filtered.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    option.value === currentValue &&
                      "bg-accent font-medium text-accent-foreground",
                  )}
                  onClick={() => handleSelect(option.value)}
                >
                  {option.key}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <FieldError errors={error ? [{ message: error }] : undefined} />
    </Field>
  );
}

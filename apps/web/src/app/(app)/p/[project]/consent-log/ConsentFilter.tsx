"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@falorb/ui";

const LABELS = { "": "All decisions", yes: "Granted", no: "Denied" } as const;
type Key = keyof typeof LABELS;

export function ConsentFilter({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const key: Key = value === "yes" || value === "no" ? value : "";

  return (
    <Select
      size="sm"
      value={LABELS[key]}
      options={Object.values(LABELS)}
      onChange={(label: string) => {
        const entry = (Object.entries(LABELS) as [Key, string][]).find(([, l]) => l === label);
        const query = new URLSearchParams(params.toString());
        query.delete("page");
        if (!entry || entry[0] === "") query.delete("granted");
        else query.set("granted", entry[0]);
        const qs = query.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    />
  );
}

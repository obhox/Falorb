"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@falorb/ui";

const ALL = "All actions";

export function ActionFilter({ actions, value }: { actions: string[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  return (
    <Select
      size="sm"
      value={value || ALL}
      options={[ALL, ...actions]}
      onChange={(next: string) => {
        const query = new URLSearchParams(params.toString());
        query.delete("page");
        if (next === ALL) query.delete("action");
        else query.set("action", next);
        const qs = query.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    />
  );
}

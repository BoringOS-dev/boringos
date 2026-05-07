// SPDX-License-Identifier: BUSL-1.1
//
// Re-render hook that returns the current Date and updates at the
// given interval. Cheap — one setInterval per mounted component;
// shared between any list / detail surface that wants live relative
// timestamps (e.g. "in 47m" snooze countdown).

import { useEffect, useState } from "react";

export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

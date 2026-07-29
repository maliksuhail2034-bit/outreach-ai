// hourCycle: "h23" avoids an ICU quirk where hour12: false formats midnight
// as "24" instead of "0" for some locales, which would misclassify it below.
export function getGreeting(timeZone?: string, referenceDate: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).format(referenceDate),
  );

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

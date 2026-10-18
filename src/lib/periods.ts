/** Dashboard reporting periods (shared by server and client). */
export const PERIODS = [
  { value: "month", label: "This month" },
  { value: "3m", label: "Last 3 months" },
  { value: "12m", label: "Last 12 months" },
  { value: "fy", label: "Financial year to date" },
] as const;

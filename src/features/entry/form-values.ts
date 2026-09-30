import {
  participantSchema,
  type ParticipantInput,
} from "@/features/backend/validation";
export type Availability = ParticipantInput["availability"][number];
export interface ParticipantFields {
  displayName: string;
  budgetMin: string;
  budgetMax: string;
  currency: string;
  notes: string;
  activity: string;
  dietary: string;
  location: string;
}
export const currencies = ["USD", "EUR", "GBP", "RUB", "JPY", "KWD"];
const supportedCurrencies = new Set(Intl.supportedValuesOf("currency"));
export function currencyDigits(currency: string): number {
  if (!supportedCurrencies.has(currency))
    throw new Error("Choose a supported currency.");
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits!;
}
export function parseMoney(value: string, currency: string): number | null {
  if (!value.trim()) return null;
  const digits = currencyDigits(currency);
  if (!/^\d+(\.\d+)?$/.test(value.trim()))
    throw new Error("Enter a positive budget amount, or leave it blank.");
  const [whole, fraction = ""] = value.trim().split(".");
  if (fraction.length > digits || whole!.length > 12)
    throw new Error(`Use at most ${digits} decimal places for ${currency}.`);
  const minor =
    BigInt(whole!) * 10n ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0") || "0");
  if (minor > 100_000_000n)
    throw new Error("That budget is too large. Please use a smaller amount.");
  return Number(minor);
}
export function formatMoney(
  value: number | null,
  currency: string | null,
): string {
  if (value === null || !currency) return "";
  return (value / 10 ** currencyDigits(currency)).toFixed(
    currencyDigits(currency),
  );
}
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function nextDays(now = new Date()): { date: string; label: string }[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + index,
      12,
    );
    return {
      date: dateKey(date),
      label:
        index === 0
          ? "Today"
          : date.toLocaleDateString("en", {
              weekday: "short",
              month: "short",
              day: "numeric",
            }),
    };
  });
}
export function localWindow(
  date: string,
  start: string,
  end: string,
): Availability {
  function instant(time: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
      throw new Error("Choose a valid date and time.");
    const value = new Date(`${date}T${time}:00`);
    if (
      !Number.isFinite(value.getTime()) ||
      dateKey(value) !== date ||
      `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}` !==
        time
    )
      throw new Error("That local time doesn't exist. Choose another time.");
    return value;
  }
  const startAt = instant(start),
    endAt = instant(end);
  if (endAt <= startAt || endAt.getTime() - startAt.getTime() > 86_400_000)
    throw new Error("End time must be after start time, within 24 hours.");
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}
export function validateEntryAvailability(
  windows: Availability[],
  expiresAt: string,
  now = new Date(),
): void {
  if (!windows.length)
    throw new Error("Choose at least one time that works for you.");
  if (windows.length > 28) throw new Error("Choose at most 28 time ranges.");
  const sorted = windows
    .map((w) => ({ start: Date.parse(w.startAt), end: Date.parse(w.endAt) }))
    .sort((a, b) => a.start - b.start);
  let previousEnd = -Infinity;
  for (const w of sorted) {
    if (
      !Number.isFinite(w.start + w.end) ||
      w.start < now.getTime() ||
      w.end > w.start + 86_400_000 ||
      w.end <= w.start ||
      w.end > Math.min(Date.parse(expiresAt), now.getTime() + 30 * 86_400_000)
    )
      throw new Error(
        "Choose future times before this invite expires, within 24 hours each.",
      );
    if (w.start < previousEnd)
      throw new Error(
        "Your time ranges overlap. Remove or adjust one of them.",
      );
    previousEnd = w.end;
  }
}
export function parsePreferenceText(text: string): string[] {
  const values: string[] = [];
  let value = "",
    quoted = false,
    closed = false;
  function commit() {
    const clean = value.trim().toLowerCase();
    if (clean) values.push(clean);
    value = "";
    closed = false;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          value += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else value += char;
    } else if (char === ",") commit();
    else if (char === '"') {
      if (value.trim() || closed)
        throw new Error(
          "Put quotes around an entire preference containing commas.",
        );
      value = "";
      quoted = true;
    } else {
      if (closed && char.trim())
        throw new Error("Separate preferences with commas.");
      value += char;
    }
  }
  if (quoted) throw new Error("Close the quote around your preference.");
  commit();
  return [...new Set(values)];
}
function preferenceText(values: string[]): string {
  return values
    .map((v) => (/[,"]/.test(v) ? '"' + v.replaceAll('"', '""') + '"' : v))
    .join(", ");
}
export function participantFromForm(
  fields: ParticipantFields,
  availability: Availability[],
  own: ParticipantInput | null = null,
): ParticipantInput {
  const budgetMin = parseMoney(fields.budgetMin, fields.currency),
    budgetMax = parseMoney(fields.budgetMax, fields.currency);
  if (budgetMin !== null && budgetMax !== null && budgetMin > budgetMax)
    throw new Error("Minimum budget cannot exceed maximum budget.");
  const originalFields = own ? fieldsFromParticipant(own) : null;
  const preferences = (["activity", "dietary", "location"] as const).flatMap(
    (category) => {
      if (own && fields[category] === originalFields![category])
        return own.preferences.filter((p) => p.category === category);
      return parsePreferenceText(fields[category]).map((value) => ({
        category,
        value,
      }));
    },
  );
  const parsed = participantSchema.safeParse({
    displayName: fields.displayName,
    notes: fields.notes,
    budgetMin,
    budgetMax,
    currency: budgetMin === null && budgetMax === null ? null : fields.currency,
    preferences,
    availability,
  });
  if (!parsed.success)
    throw new Error(
      "Add your name (up to 60 characters), short preferences and a note up to 1000 characters.",
    );
  return parsed.data;
}
export function fieldsFromParticipant(
  own: ParticipantInput | null,
): ParticipantFields {
  return {
    displayName: own?.displayName ?? "",
    budgetMin: formatMoney(own?.budgetMin ?? null, own?.currency ?? null),
    budgetMax: formatMoney(own?.budgetMax ?? null, own?.currency ?? null),
    currency: own?.currency ?? "USD",
    notes: own?.notes ?? "",
    ...Object.fromEntries(
      (["activity", "dietary", "location"] as const).map((category) => [
        category,
        preferenceText(
          own?.preferences
            .filter((p) => p.category === category)
            .map((p) => p.value) ?? [],
        ),
      ]),
    ),
  } as ParticipantFields;
}

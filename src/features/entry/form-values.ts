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
    throw new Error("Выберите поддерживаемую валюту.");
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
  }).resolvedOptions().maximumFractionDigits!;
}
export function parseMoney(value: string, currency: string): number | null {
  if (!value.trim()) return null;
  const digits = currencyDigits(currency);
  if (!/^\d+(\.\d+)?$/.test(value.trim()))
    throw new Error("Введите положительную сумму бюджета или оставьте поле пустым.");
  const [whole, fraction = ""] = value.trim().split(".");
  if (fraction.length > digits || whole!.length > 12)
    throw new Error(`Для ${currency} укажите не более ${digits} знаков после точки.`);
  const minor =
    BigInt(whole!) * 10n ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0") || "0");
  if (minor > 100_000_000n)
    throw new Error("Сумма бюджета слишком велика. Укажите меньшую сумму.");
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
          ? "Сегодня"
          : date.toLocaleDateString("ru-RU", {
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
  endDate = date,
): Availability {
  function instant(time: string, localDate = date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !/^\d{2}:\d{2}$/.test(time))
      throw new Error("Укажите корректные дату и время.");
    const value = new Date(`${localDate}T${time}:00`);
    if (
      !Number.isFinite(value.getTime()) ||
      dateKey(value) !== localDate ||
      `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}` !==
        time
    )
      throw new Error("Такого местного времени не существует. Выберите другое время.");
    return value;
  }
  const startAt = instant(start),
    endAt = instant(end, endDate);
  if (endAt <= startAt || endAt.getTime() - startAt.getTime() > 86_400_000)
    throw new Error("Время окончания должно быть позже начала, в пределах 24 часов.");
  return { startAt: startAt.toISOString(), endAt: endAt.toISOString() };
}
export function validateEntryAvailability(
  windows: Availability[],
  expiresAt: string,
  now = new Date(),
  saved: Availability[] = [],
): void {
  if (!windows.length)
    throw new Error("Выберите хотя бы один подходящий промежуток времени.");
  if (windows.length > 28) throw new Error("Можно выбрать не более 28 промежутков времени.");
  const unchanged = new Set(
    saved.map((w) => `${Date.parse(w.startAt)}:${Date.parse(w.endAt)}`),
  );
  const sorted = windows
    .map((w) => ({ start: Date.parse(w.startAt), end: Date.parse(w.endAt) }))
    .sort((a, b) => a.start - b.start);
  let previousEnd = -Infinity;
  for (const w of sorted) {
    if (
      !Number.isFinite(w.start + w.end) ||
      (w.start < now.getTime() && !unchanged.has(`${w.start}:${w.end}`)) ||
      w.end > w.start + 86_400_000 ||
      w.end <= w.start ||
      w.end > Math.min(Date.parse(expiresAt), now.getTime() + 30 * 86_400_000)
    )
      throw new Error(
        "Выберите время в будущем до окончания срока приглашения. Каждый промежуток — не более 24 часов.",
      );
    if (w.start < previousEnd)
      throw new Error(
        "Промежутки времени пересекаются. Удалите или измените один из них.",
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
          "Возьмите в кавычки всё предпочтение, если оно содержит запятые.",
        );
      value = "";
      quoted = true;
    } else {
      if (closed && char.trim())
        throw new Error("Разделяйте предпочтения запятыми.");
      value += char;
    }
  }
  if (quoted) throw new Error("Закройте кавычки в предпочтении.");
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
    throw new Error("Минимальный бюджет не может превышать максимальный.");
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
      "Укажите имя (до 60 символов), краткие предпочтения и заметку до 1000 символов.",
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

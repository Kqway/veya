import { normalizeActivity } from "@/features/discovery/activity-normalization";
import {
  interpretInputSchema, interpretationSchema, partialSearchDraftSchema, searchDraftSchema,
  attributesForActivity, type ActivityAttributes, type Interpretation, type PartialSearchDraft,
} from "./schema";

const dayMs = 86400000;
const normalize = (text: string) => text.toLowerCase().replaceAll("ё", "е");
function addDays(date: string, days: number): string { return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10); }

/** Round-trip wall clocks through IANA offsets. DST gaps and ambiguous folds need clarification. */
export function resolveWallClock(date: string, hour: number, minute: number, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const local = Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`);
  if (!Number.isFinite(local) || new Date(local).toISOString().slice(0, 10) !== date) return null;
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); } catch { return null; }
  const partsAt = (instant: number) => {
    const p = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  };
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 12) { const sample = local + hours * 3600000; offsets.add(partsAt(sample) - sample); }
  const matches = [...offsets].map((offset) => local - offset).filter((instant) => partsAt(instant) === local);
  return matches.length === 1 ? new Date(matches[0]!).toISOString() : null;
}

function identifyActivity(text: string) {
  const activity = normalizeActivity(text);
  return activity ? { ...activity, online: activity.key === "dota2" || activity.key === "gaming" } : null;
}
const rankPatterns = [
  ["herald", /herald|рекрут/], ["guardian", /guardian|страж/], ["crusader", /crusader|рыцар/], ["archon", /archon|геро[йяе]/],
  ["legend", /legend|легенд/], ["ancient", /ancient|властелин/], ["divine", /divine|божеств/], ["immortal", /immortal|титан/],
] as const;
function extractAttributes(activity: string, text: string): ActivityAttributes {
  const result: Record<string, string> = {};
  if (activity === "dota2") {
    if (/саппорт|поддержк|\bsupport\b/.test(text)) result.role = "support";
    else if (/керри|кэрри|\bcarry\b/.test(text)) result.role = "carry";
    else if (/мид|\bmid\b/.test(text)) result.role = "mid";
    else if (/оффлейн|офлейн|\bofflane\b/.test(text)) result.role = "offlane";
    else if (/любая роль|any role/.test(text)) result.role = "any";
    const minimum = text.match(/(?:не ниже|минимум|minimum|min rank|at least)\s*(.*)/)?.[1];
    const minRank = minimum && rankPatterns.find(([, pattern]) => pattern.test(minimum));
    if (minRank) result.minRank = minRank[0];
    const ordinary = minimum ? text.slice(0, text.length - minimum.length) : text;
    const rank = rankPatterns.find(([, pattern]) => pattern.test(ordinary));
    if (rank) result.rank = rank[0];
    if (/любой рейтинг|рейтинг не важен|any rank|rank does not matter/.test(text)) {result.rank="any";result.minRank="any";}
    if (/без рейтинга|не рейтингов|unranked|casual/.test(text)) result.mode = "casual";
    else if (/рейтинговая|рейтинговый|ранкед|\branked\b/.test(text)) result.mode = "ranked";
  } else if (activity === "gym") {
    if (/силов|strength/.test(text)) result.trainingType = "strength";
    else if (/кардио|cardio/.test(text)) result.trainingType = "cardio";
    if (/нович|начинающ|beginner/.test(text)) result.experience = "beginner";
    else if (/средн|intermediate/.test(text)) result.experience = "intermediate";
    else if (/опытн|продвинут|advanced/.test(text)) result.experience = "advanced";
  } else if (activity === "study") {
    const subject = text.match(/(?:предмет|subject)\s*[:=]\s*([^,;.!]{1,60})/)?.[1]?.trim();
    if (subject) result.subject = subject;
    if (/начинающ|beginner/.test(text)) result.level = "beginner";
    else if (/средн|intermediate/.test(text)) result.level = "intermediate";
    else if (/продвинут|advanced/.test(text)) result.level = "advanced";
  } else if (activity === "movies") {
    const movie = text.match(/[«"]([^»"]{1,80})[»"]/)?.[1];
    if (movie) result.movie = movie;
  }
  return attributesForActivity(activity).parse(result);
}
function cityFrom(text: string): string | undefined {
  if (/(?:^|[^а-яa-z])(?:москв[аеуы]?|moscow)(?:$|[^а-яa-z])/.test(text)) return "Moscow";
  if (/санкт-петербург|петербург|\bsaint petersburg\b|\bst petersburg\b/.test(text)) return "Saint Petersburg";
  // An explicit coarse city answer is accepted; addresses and free prose are never inferred.
  const explicit = text.match(/^(?:город|city)\s*[:=]\s*([а-яa-z][а-яa-z -]{1,59})$/i)?.[1]?.trim();
  if (explicit && !/улиц|адрес|street|address|квартир|дом/.test(explicit)) return explicit;
  return undefined;
}
function availabilityFrom(text: string, referenceDate: string, timezone: string): { mentioned: boolean; availability?: { startAt: string; endAt: string }[] } {
  const explicitDate = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const dateMention = explicitDate || /сегодня|завтра|вчера|today|tomorrow|yesterday/.test(text);
  const range = text.match(/(?:с\s*|from\s*|(?:^|\s))([01]?\d|2[0-3])(?::([0-5]\d))?\s*(?:до|to|[-–])\s*([01]?\d|2[0-3])(?::([0-5]\d))?/);
  let hours: [number, number, number, number] | undefined;
  if (range) hours = [Number(range[1]), Number(range[2] ?? 0), Number(range[3]), Number(range[4] ?? 0)];
  else if (/вечер|evening/.test(text)) hours = [18, 0, 23, 0];
  else if (/утро|утром|morning/.test(text)) hours = [9, 0, 12, 0];
  else if (/днем|после обеда|afternoon/.test(text)) hours = [12, 0, 18, 0];
  const weekdayNames = [/воскресень|\bsunday\b/, /понедельник|\bmonday\b/, /вторник|\btuesday\b/, /сред[ау]|\bwednesday\b/, /четверг|\bthursday\b/, /пятниц|\bfriday\b/, /суббот|\bsaturday\b/];
  const weekday = weekdayNames.findIndex((pattern) => pattern.test(text));
  const mentioned = Boolean(dateMention || hours || weekday >= 0 || /\d{1,2}:\d{2}/.test(text));
  if (!mentioned) return { mentioned: false };
  if (!hours || /вчера|yesterday/.test(text)) return { mentioned: true };
  let date = explicitDate ?? referenceDate;
  if (!explicitDate && /послезавтра|day after tomorrow/.test(text)) date = addDays(referenceDate, 2);
  else if (!explicitDate && /завтра|tomorrow/.test(text)) date = addDays(referenceDate, 1);
  else if (!explicitDate && weekday >= 0) {
    const delta = (weekday - new Date(`${referenceDate}T00:00:00Z`).getUTCDay() + 7) % 7;
    date = addDays(referenceDate, delta || 7);
  }
  if (date < referenceDate || date > addDays(referenceDate, 30)) return { mentioned: true };
  const startAt = resolveWallClock(date, hours[0], hours[1], timezone);
  const endDate = hours[2] * 60 + hours[3] <= hours[0] * 60 + hours[1] ? addDays(date, 1) : date;
  const endAt = resolveWallClock(endDate, hours[2], hours[3], timezone);
  if (!startAt || !endAt || Date.parse(endAt) - Date.parse(startAt) > dayMs) return { mentioned: true };
  return { mentioned: true, availability: [{ startAt, endAt }] };
}
function clarify(field: "activity" | "time" | "city", partialDraft: PartialSearchDraft): Interpretation {
  const questions = {
    activity: { text: "Чем хотите заняться?", options: [{ label: "Dota 2", value: "Дота" }, { label: "Зал", value: "В зал" }, { label: "Учёба", value: "Учиться" }, { label: "Кино", value: "В кино" }] },
    time: { text: "Когда вам удобно? Укажите день и время.", options: [{ label: "Сегодня вечером", value: "Сегодня вечером" }, { label: "Завтра вечером", value: "Завтра вечером" }] },
    city: { text: "В каком городе? Можно указать: «город: Казань».", options: [{ label: "Москва", value: "Москва" }, { label: "Санкт-Петербург", value: "Санкт-Петербург" }] },
  };
  return interpretationSchema.parse({ kind: "clarification", question: { field, ...questions[field] }, draft: null, partialDraft: partialSearchDraftSchema.parse(partialDraft), summary: field === "activity" ? "Уточните занятие." : field === "time" ? "Уточните время встречи." : "Уточните город встречи." });
}
function preferenceFrom(text: string): Interpretation | undefined {
  if (/не присылай|не предлагай|don't send|do not send/.test(text) && /после полуночи|after midnight/.test(text)) return { kind: "preference", preference: { type: "quiet_hours", quietHours: {startHour:0,endHour:8} }, summary: "Тихие часы 00:00–08:00. Проверьте и подтвердите правило." };
  if (/предложени|\boffers?\b/.test(text)) {
    if (/не присылай|отключ|не получать|disable|stop|no offers/.test(text)) return { kind: "preference", preference: { type: "offers", offersEnabled: false }, summary: "Не получать предложения. Сохранить настройку?" };
    if (/присылай|включ|получать|enable|allow/.test(text)) return { kind: "preference", preference: { type: "offers", offersEnabled: true }, summary: "Получать предложения. Сохранить настройку?" };
  }
  if (/тихи[еих]|quiet hours/.test(text)) {
    if (/убери|удали|отключ|remove|disable/.test(text)) return { kind: "preference", preference: { type: "quiet_hours", quietHours: null }, summary: "Убрать тихие часы. Сохранить настройку?" };
    const hours = text.match(/(?:с|from)\s*(\d{1,2})(?::00)?\s*(?:до|to|[-–])\s*(\d{1,2})(?::00)?/);
    if (hours && Number(hours[1]) < 24 && Number(hours[2]) < 24 && hours[1] !== hours[2]) return { kind: "preference", preference: { type: "quiet_hours", quietHours: { startHour: Number(hours[1]), endHour: Number(hours[2]) } }, summary: `Тихие часы ${hours[1]}:00–${hours[2]}:00. Сохранить настройку?` };
  }
  const activity = identifyActivity(text);
  if (activity && /предпочита|всегда|обычно|настройк|prefer|preference|usually/.test(text)) return { kind: "preference", preference: { type: "activity", activityKey: activity.key, attributes: extractAttributes(activity.key, text) }, summary: `Предпочтения для «${activity.label}». Сохранить настройку?` };
  return undefined;
}

/** Only the actor's bounded text and own prior draft enter this deterministic translator. */
export function interpretConversation(input: unknown, now = new Date()): Interpretation {
  const data = interpretInputSchema.parse(input);
  const text = normalize(data.text);
  const preference = preferenceFrom(text);
  if (preference) return interpretationSchema.parse(preference);
  if (/уже нашли.*(?:заканчивай|заверши)|already found.*(?:stop|finish)/.test(text)) return interpretationSchema.parse({kind:"command",command:{type:"stop"},summary:"Остановить поиск и отменить ожидающие предложения."});
  if (/^(?:останови(?:ть)?|стоп|закрой|stop|cancel)(?:\s+(?:поиск|search))?[.!]?\s*$/.test(text)) return interpretationSchema.parse({ kind: "command", command: { type: "stop" }, summary: "Остановить поиск и отменить ожидающие предложения." });
  if (/^ищи (?:еще|ещё)|^search (?:for|another)/.test(text)) return interpretationSchema.parse({kind:"command",command:{type:"extend",minutes:(Number(text.match(/(\d+)\s*(?:час|hour|минут|minute)/)?.[1]??1))*(/час|hour/.test(text)?60:1)},summary:"Продлить текущий поиск. Подтвердите действие."});
  if (/^(?:продли(?:ть)?|extend)\b|^продли(?:ть)?(?:\s|$)/.test(text)) {
    const quantity = text.match(/(\d+)\s*(час|hour|минут|minute|mins?)/);
    const minutes = quantity ? Number(quantity[1]) * (/час|hour/.test(quantity[2]!) ? 60 : 1) : undefined;
    return interpretationSchema.parse({ kind: "command", command: { type: "extend", ...(minutes === undefined ? {} : { minutes }) }, summary: minutes ? `Продлить поиск на ${minutes} мин.` : "Продлить поиск." });
  }
  const own = data.draft ?? data.partialDraft;
  const partial: PartialSearchDraft = own ? structuredClone(own) : { timezone: data.timezone, seeking: { city: null, area: null }, neededPeople: 1, existingPeople: 1, attributes: {} };
  partial.timezone = data.timezone;
  partial.seeking.rawText = data.text;
  partial.seeking.area = null;
  const activity = identifyActivity(text);
  const changedActivity = activity && activity.key !== partial.seeking.activityKey;
  if (activity) {
    partial.seeking.activityKey = activity.key;
    partial.seeking.activityLabel = activity.label;
    if (changedActivity) { partial.attributes = {}; partial.seeking.interactionMode = activity.online ? "online" : "in_person"; if (own?.seeking.activityKey) partial.seeking.city = null; partial.existingPeople = 1; partial.neededPeople = 1; }
  }
  if (/онлайн|\bonline\b/.test(text)) partial.seeking.interactionMode = "online";
  else if (/очно|лично|in person|offline/.test(text)) partial.seeking.interactionMode = "in_person";
  if (partial.seeking.activityKey) partial.attributes = { ...partial.attributes, ...extractAttributes(partial.seeking.activityKey, text) };
  if (/пят(?:ый|ого)|\bfifth\b/.test(text) && partial.seeking.activityKey === "dota2") { partial.existingPeople = 4; partial.neededPeople = 1; }
  const needed = text.match(/(?:нуж(?:ен|но|ны)|need)\s*(\d{1,2})\s*(?:человек|игрок|players?|people)/);
  if (needed) partial.neededPeople = Number(needed[1]);
  const existing = text.match(/(?:нас|already|existing)\s*(\d{1,2})/);
  if (existing) partial.existingPeople = Number(existing[1]);
  const temporal = availabilityFrom(text, data.referenceDate, data.timezone);
  if (temporal.mentioned) partial.seeking.availability = temporal.availability;
  // Inherited windows also need a future local date, and must be re-entered after changing zone.
  if (own && own.timezone !== data.timezone && !temporal.mentioned) partial.seeking.availability = undefined;
  const todayStart = resolveWallClock(data.referenceDate, 0, 0, data.timezone);
  if (partial.seeking.availability?.some((w) => !todayStart || Date.parse(w.startAt) < Date.parse(todayStart))) partial.seeking.availability = undefined;
  if (partial.seeking.availability?.length) {
    const earliest = Math.ceil((now.getTime() + 1) / 900000) * 900000;
    partial.seeking.availability = partial.seeking.availability
      .filter(w => Date.parse(w.endAt) - earliest >= 900000)
      .map(w => ({ ...w, startAt: Date.parse(w.startAt) < earliest ? new Date(earliest).toISOString() : w.startAt }));
  }
  if (!partial.seeking.availability?.length) partial.seeking.availability = undefined;
  let city = cityFrom(text);
  const answeringCity = own?.seeking.activityKey && own.seeking.availability?.length && !own.seeking.city && own.seeking.interactionMode !== "online";
  if (!city && answeringCity && !activity && !temporal.mentioned && /^[\p{L}][\p{L}\p{M} '\-]{1,59}$/u.test(data.text) && !/улиц|адрес|street|address|квартир|\bдом\b|не знаю|любой|без разницы|unknown|anywhere|саппорт|support|rank|рейтинг/.test(text)) city = data.text.trim();
  if (city) partial.seeking.city = city;
  if (!partial.seeking.activityKey) return clarify("activity", partial);
  if (!partial.seeking.availability?.length) return clarify("time", partial);
  if (partial.seeking.interactionMode !== "online" && !partial.seeking.city) return clarify("city", partial);
  if (partial.seeking.interactionMode === "online") partial.seeking.city = null;
  const capacity = (partial.existingPeople ?? 1) + (partial.neededPeople ?? 1);
  partial.seeking.format = capacity > 2 || partial.seeking.activityKey === "dota2" ? "group" : "one_to_one";
  partial.seeking.groupSize = partial.seeking.format === "group" && capacity > 2 ? capacity : null;
  partial.seeking.skill ??= "any";
  partial.seeking.languages ??= /[а-я]/.test(text) ? ["ru"] : ["en"];
  partial.seeking.tags ??= [];
  partial.seeking.desiredAgeBands ??= [];
  const draft = searchDraftSchema.parse(partial);
  return interpretationSchema.parse({ kind: "draft", draft, summary: `${draft.seeking.activityLabel} · ${draft.seeking.interactionMode === "online" ? "онлайн" : draft.seeking.city} · ищем ${draft.neededPeople} · мест ${capacity}. Проверьте время и параметры перед стартом.` });
}

"use client";
import type { ActivityAttributes } from "../schema";
type AttributeField = { key: string; label: string; options?: string[]; maxLength?: number };
const ranks = ["any", "herald", "guardian", "crusader", "archon", "legend", "ancient", "divine", "immortal"];
const levels = ["any", "beginner", "intermediate", "advanced"];
const labels: Record<string, string> = { role: "Роль", rank: "Ранг", minRank: "Минимальный ранг", mode: "Режим", trainingType: "Тренировка", experience: "Опыт", subject: "Предмет", level: "Уровень", movie: "Фильм", any: "Любой", support: "Поддержка", carry: "Керри", mid: "Мид", offlane: "Офлейн", herald: "Рекрут", guardian: "Страж", crusader: "Рыцарь", archon: "Герой", legend: "Легенда", ancient: "Властелин", divine: "Божество", immortal: "Титан", ranked: "Рейтинговый", casual: "Обычный", strength: "Силовая", cardio: "Кардио", beginner: "Начинающий", intermediate: "Средний", advanced: "Продвинутый" };
function fields(activityKey: string): AttributeField[] {
  if (activityKey === "dota2") return [{ key: "role", label: labels.role!, options: ["any", "support", "carry", "mid", "offlane"] }, { key: "rank", label: labels.rank!, options: ranks }, { key: "minRank", label: labels.minRank!, options: ranks }, { key: "mode", label: labels.mode!, options: ["any", "ranked", "casual"] }];
  if (activityKey === "gym") return [{ key: "trainingType", label: labels.trainingType!, options: ["any", "strength", "cardio"] }, { key: "experience", label: labels.experience!, options: levels }];
  if (activityKey === "study") return [{ key: "subject", label: labels.subject!, maxLength: 60 }, { key: "level", label: labels.level!, options: levels }];
  if (activityKey === "movies") return [{ key: "movie", label: labels.movie!, maxLength: 80 }];
  return [];
}
export function AttributeSummary({ attributes }: { attributes: ActivityAttributes }) {
  if (!Object.keys(attributes).length) return null;
  return <p className="intent-attributes">{Object.entries(attributes).map(([key, value]) => `${labels[key] ?? key}: ${labels[String(value)] ?? String(value)}`).join(" · ")}</p>;
}
export function AttributeEditor({ activityKey, attributes, onChange }: { activityKey: string; attributes: ActivityAttributes; onChange: (attributes: ActivityAttributes) => void }) {
  const value = attributes as Record<string, string>;
  function update(key: string, next: string) {
    const result = { ...value };
    if (next) result[key] = next; else delete result[key];
    onChange(result as ActivityAttributes);
  }
  return <div className="intent-rule-fields">{fields(activityKey).map((field) => <label className="intent-field" key={field.key}>{field.label}{field.options ? <select value={value[field.key] ?? ""} onChange={(event) => update(field.key, event.target.value)}><option value="">Не задано</option>{field.options.map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}</select> : <input maxLength={field.maxLength} value={value[field.key] ?? ""} onChange={(event) => update(field.key, event.target.value)} />}</label>)}</div>;
}

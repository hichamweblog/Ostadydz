import type { ClassRoom } from "./types";

/**
 * لوحة ألوان تمييز الأقسام المعتمدة.
 * كل قسم يحصل على لون مختلف عن الأقسام الموجودة حتى يسهل التعرف عليه
 * في البطاقات والجداول، ويُزامن هذا اللون مع Supabase (عمود `classes.color`).
 */
export const CLASS_COLORS: readonly string[] = [
  "#0d9488", // تيل
  "#0284c7", // أزرق سماوي
  "#d97706", // كهرماني
  "#7c3aed", // بنفسجي
  "#e11d48", // وردي
  "#059669", // أخضر زمردي
  "#4f46e5", // نيلي
  "#ca8a04", // ذهبي
  "#2563eb", // أزرق
  "#db2777", // أرجواني
];

export const DEFAULT_CLASS_COLOR = CLASS_COLORS[0];

/**
 * يعيد أول لون من اللوحة غير مستعمل من قبل الأقسام الحالية.
 * إذا استُعملت كل الألوان (أكثر من 10 أقسام) يعود الدور على اللوحة
 * بترتيب ثابت حتى يبقى لكل قسم لون مختلف عمّا جاوره.
 */
export function pickClassColor(usedColors: readonly (string | undefined)[]): string {
  const normalized = new Set(
    usedColors
      .filter((color): color is string => typeof color === "string")
      .map((color) => color.trim().toLowerCase()),
  );
  const free = CLASS_COLORS.find((color) => !normalized.has(color.toLowerCase()));
  return free || CLASS_COLORS[normalized.size % CLASS_COLORS.length];
}

/** يوزّع ألواناً مختلفة على كل الأقسام، مع الحفاظ على الألوان المختارة يدوياً. */
export function assignDistinctClassColors(classes: readonly ClassRoom[]): ClassRoom[] {
  const used: string[] = [];
  return classes.map((classRoom) => {
    const current = classRoom.color?.trim();
    if (current && !used.some((color) => color.toLowerCase() === current.toLowerCase())) {
      used.push(current);
      return classRoom;
    }
    const next = pickClassColor(used);
    used.push(next);
    return { ...classRoom, color: next };
  });
}

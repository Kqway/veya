import { z } from "zod";

export const draftIntentSchema = z.string().trim()
  .min(1, "Расскажите, чем хотите заняться.")
  .max(500, "Опишите идею не более чем в 500 символах.");

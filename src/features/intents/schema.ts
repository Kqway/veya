import { z } from "zod";

export const draftIntentSchema = z.string().trim()
  .min(1, "Tell us what you'd like to do.")
  .max(500, "Keep your idea to 500 characters or fewer.");

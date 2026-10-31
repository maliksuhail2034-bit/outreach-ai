import { describe, expect, it } from "vitest";
import { fullNameSchema } from "./auth";

describe("fullNameSchema", () => {
  it.each(["Ada Lovelace", "Mary-Jane O'Neil", "José Álvarez", "Zoë", "Siân O’Brien", "  Ada Lovelace  "])(
    "accepts %s",
    (name) => {
      expect(fullNameSchema.safeParse(name).success).toBe(true);
    },
  );

  it.each(["testtt4account", "Ada 2", "Ada_Lovelace", "Ada  Lovelace", "-Ada", "Ada!", "A"])("rejects %s", (name) => {
    expect(fullNameSchema.safeParse(name).success).toBe(false);
  });
});

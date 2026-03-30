import { createHash } from "node:crypto";
import type { ScannedSkill } from "./schemas.js";

export function hashSkill(skill: ScannedSkill): string {
  const hash = createHash("sha256");
  hash.update(skill.rawContent);

  if (skill.files) {
    for (const file of skill.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      hash.update(file.relativePath);
      hash.update(file.content);
    }
  }

  return `sha256:${hash.digest("hex").substring(0, 12)}`;
}

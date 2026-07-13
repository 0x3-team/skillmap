import { ImageResponse } from "next/og";
import { SkillMapSocialImage } from "@/components/skillmap/social-image";

export const alt = "SkillMap — find agent skills with exact-source trust evidence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<SkillMapSocialImage />, size);
}

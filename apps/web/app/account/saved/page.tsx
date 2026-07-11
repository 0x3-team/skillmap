import { redirect } from "next/navigation";

export default function SavedSkillsRedirect() {
  redirect("/account#saved");
}

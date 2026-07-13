import type { SaveFlashStatus } from "@/lib/registry/save-flash";

export function SaveStatusNotice({ status }: { status: SaveFlashStatus }) {
  const copy = status === "saved"
    ? { title: "Skill saved", body: "The current account-owned saved-skill state confirms this skill is saved.", tone: "border-success/30 bg-success/10" }
    : status === "removed"
      ? { title: "Skill removed", body: "The current account-owned saved-skill state confirms this skill is no longer saved.", tone: "border-success/30 bg-success/10" }
      : { title: "Saved-skill action unavailable", body: "The requested write could not be confirmed. SkillMap does not claim that your saved-skill state changed.", tone: "border-warning/35 bg-warning/10" };
  return (
    <div className={`mt-5 rounded-xl border p-4 ${copy.tone}`} role="status">
      <p className="font-semibold">{copy.title}</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.body}</p>
    </div>
  );
}

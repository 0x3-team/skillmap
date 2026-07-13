export function SkillMapSocialImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#0b1014",
        color: "#f4f1e8",
        padding: "66px 72px",
        border: "1px solid #263039"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 28,
              height: 28,
              display: "flex",
              borderRadius: 7,
              background: "#78d7a8",
              boxShadow: "0 0 0 9px rgba(120,215,168,0.12)"
            }}
          />
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, letterSpacing: "0.16em" }}>
            SKILLMAP
          </div>
        </div>
        <div style={{ display: "flex", color: "#9caab3", fontSize: 22 }}>Free trust alpha</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", maxWidth: 980 }}>
        <div style={{ display: "flex", color: "#78d7a8", fontSize: 23, fontWeight: 650, letterSpacing: "0.08em" }}>
          VERSION-BOUND SKILL EVIDENCE
        </div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 65, lineHeight: 1.07, fontWeight: 700, letterSpacing: "-0.035em" }}>
          Find agent skills you can inspect, compare, and trust.
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, color: "#c5ced3", fontSize: 20 }}>
        {["Exact source", "Bounded audit", "Explainable grade", "No billing"].map((label) => (
          <div
            key={label}
            style={{
              display: "flex",
              padding: "11px 17px",
              border: "1px solid #34414a",
              borderRadius: 999,
              background: "#11181d"
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

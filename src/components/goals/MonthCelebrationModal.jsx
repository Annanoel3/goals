import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

const BASE = "https://rbxbrfewaxvhvlntxhuv.supabase.co/storage/v1/object/public/Month%20Gifs";

const MONTH_CONFIG = {
  1:  { gif: BASE+"/month1.gif",  textColor: "#ffffff", textTop: "78%" },
  2:  { gif: BASE+"/month2.gif",  textColor: "#12027b", textTop: "79%" },
  3:  { gif: BASE+"/month3.gif",  textColor: "#000000", textTop: "76%" },
  4:  { gif: BASE+"/month4.gif",  textColor: "#ffffff", textTop: "78%" },
  5:  { gif: BASE+"/month5.gif",  textColor: "#ffffff", textTop: "79%" },
  6:  { gif: BASE+"/month6.gif",  textColor: "#ff8200", textTop: "79%" },
  7:  { gif: BASE+"/month7.gif",  textColor: "#ffffff", textTop: "80%" },
  8:  { gif: BASE+"/month8.gif",  textColor: "#12027b", textTop: "79%" },
  9:  { gif: BASE+"/month9.gif",  textColor: "#ffffff", textTop: "77%" },
  10: { gif: BASE+"/month10.gif", textColor: "#000000", textTop: "79%" },
  11: { gif: BASE+"/month11.gif", textColor: "#ff8200", textTop: "79%" },
  12: { gif: BASE+"/month12.gif", textColor: "#ffffff", textTop: "79%" },
};

function buildBatches(steps) {
  const titles = (steps || []).map(s => s.title).filter(Boolean);
  const batches = [];
  // First batch: congratulations header
  batches.push([`You crushed Month ${steps?.[0]?.phase?.match(/Month\s*(\d+)/i)?.[1] || ""}! 🎉`]);
  // Then steps in pairs, max 4 more batches (so total ≤ 5 batches × 4s = 20s)
  for (let i = 0; i < titles.length && batches.length < 5; i += 2) {
    batches.push(titles.slice(i, i + 2));
  }
  return batches;
}

export default function MonthCelebrationModal({ monthNumber, completedSteps, onClose }) {
  const [phase, setPhase] = useState("intro"); // intro | text | done
  const [batchIndex, setBatchIndex] = useState(0);
  const [visible, setVisible] = useState(false);

  const config = MONTH_CONFIG[monthNumber] || MONTH_CONFIG[1];
  const batches = buildBatches(completedSteps);

  // After 4.5s, start text phase
  useEffect(() => {
    const t = setTimeout(() => {
      setPhase("text");
    }, 4500);
    return () => clearTimeout(t);
  }, []);

  // Cycle batches: each batch = 500ms fade in + 3000ms hold + 500ms fade out = 4000ms total
  useEffect(() => {
    if (phase !== "text") return;
    setVisible(true);
    const fadeOut = setTimeout(() => setVisible(false), 3500);
    const next = setTimeout(() => {
      if (batchIndex < batches.length - 1) {
        setBatchIndex(b => b + 1);
      } else {
        setPhase("done");
        setVisible(false);
      }
    }, 4000);
    return () => { clearTimeout(fadeOut); clearTimeout(next); };
  }, [phase, batchIndex]);

  if (!monthNumber) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
      {/* Fullscreen looping GIF */}
      <img
        src={config.gif}
        alt={`Month ${monthNumber} celebration`}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
      />

      {/* Tiny X to skip */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 14, right: 14, zIndex: 10001,
          background: "rgba(0,0,0,0.35)", border: "none", borderRadius: "50%",
          width: 30, height: 30, cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center", color: "white",
        }}
      >
        <X size={14} />
      </button>

      {/* Text overlay */}
      {(phase === "text" || phase === "done") && (
        <div style={{
          position: "absolute",
          top: config.textTop,
          left: 0,
          right: 0,
          bottom: "3%",
          zIndex: 10000,
          background: "rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 24px",
          borderRadius: "0 0 8px 8px",
        }}>
          {phase === "text" && (
            <div style={{
              textAlign: "center",
              opacity: visible ? 1 : 0,
              transition: "opacity 0.5s ease",
            }}>
              {batches[batchIndex]?.map((line, i) => (
                <p key={i} style={{
                  color: config.textColor,
                  fontSize: batchIndex === 0 ? "1.3rem" : "1.05rem",
                  fontWeight: batchIndex === 0 ? "800" : "600",
                  margin: "3px 0",
                  textShadow: "0 1px 4px rgba(0,0,0,0.6)",
                  lineHeight: 1.3,
                }}>{line}</p>
              ))}
            </div>
          )}
          {phase === "done" && (
            <button
              onClick={onClose}
              style={{
                background: "white", color: "#111",
                border: "none", borderRadius: "999px",
                padding: "13px 36px", fontSize: "1rem",
                fontWeight: "700", cursor: "pointer",
                boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
              }}
            >
              Keep going! 🎉
            </button>
          )}
        </div>
      )}
    </div>
  );
}
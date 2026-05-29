import React, { useState, useEffect } from "react";
import { X } from "lucide-react";

export default function WeekCelebrationModal({ weekNumber, onClose }) {
  const [gifUrl, setGifUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGif = async () => {
      try {
        const response = await fetch('/api/functions/getRandomCelebrationGif', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weekNumber })
        });
        const data = await response.json();
        setGifUrl(data.gif_url);
      } catch (error) {
        console.error('Failed to fetch GIF:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchGif();
  }, [weekNumber]);

  // Auto-close after 5 seconds
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  if (!weekNumber) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ position: "relative", maxWidth: "600px", width: "90%", borderRadius: "12px", overflow: "hidden" }}>
        {loading ? (
          <div style={{ background: "#fff", padding: "40px", textAlign: "center" }}>
            <p style={{ fontSize: "1.2rem", fontWeight: "600", color: "#000" }}>Loading celebration... 🎉</p>
          </div>
        ) : gifUrl ? (
          <img src={gifUrl} alt="Week celebration" style={{ width: "100%", height: "auto", display: "block" }} />
        ) : (
          <div style={{ background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", padding: "40px", textAlign: "center" }}>
            <p style={{ fontSize: "1.3rem", fontWeight: "700", color: "#fff", margin: 0 }}>🎉 Week {weekNumber} Crushed! 🎉</p>
          </div>
        )}
        
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 10, right: 10, zIndex: 10001,
            background: "rgba(0,0,0,0.5)", border: "none", borderRadius: "50%",
            width: 30, height: 30, cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "center", color: "white",
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
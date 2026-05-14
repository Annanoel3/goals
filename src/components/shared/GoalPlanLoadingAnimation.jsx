import React, { useState, useEffect } from 'react';

export default function GoalPlanLoadingAnimation() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStep(s => (s + 1) % 8); // 8 frames
    }, 600);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 py-8">
      {/* SVG Line Art Animation */}
      <svg
        width="120"
        height="140"
        viewBox="0 0 120 140"
        className="overflow-visible"
        style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))' }}
      >
        {/* Mountain */}
        <line x1="20" y1="100" x2="50" y2="50" stroke="#9333ea" strokeWidth="2" opacity="0.6" />
        <line x1="50" y1="50" x2="100" y2="80" stroke="#9333ea" strokeWidth="2" opacity="0.6" />
        <line x1="100" y1="80" x2="110" y2="100" stroke="#9333ea" strokeWidth="2" opacity="0.6" />

        {/* Summit flag */}
        <circle cx="50" cy="48" r="3" fill="#ec4899" />
        <line x1="53" y1="48" x2="62" y2="43" stroke="#ec4899" strokeWidth="1.5" opacity="0.7" />
        <path d="M 62 43 L 62 52 L 57 52 Z" fill="#ec4899" opacity="0.7" />

        {/* Character (cute animal - simplified) */}
        {step < 4 && (
          <>
            {/* Ascending phase - character climbing */}
            <g style={{ 
              transform: `translateY(${Math.max(0, (3 - step) * 15)}px)`,
              transition: 'transform 0.6s ease-out',
              transformOrigin: '60px 100px'
            }}>
              {/* Body */}
              <circle cx="35" cy={85 - (3 - step) * 15} r="5" fill="#6366f1" />
              {/* Head */}
              <circle cx="35" cy={75 - (3 - step) * 15} r="4" fill="#6366f1" />
              {/* Eyes */}
              <circle cx="33" cy={73 - (3 - step) * 15} r="1" fill="#fff" />
              <circle cx="37" cy={73 - (3 - step) * 15} r="1" fill="#fff" />
              {/* Smile */}
              <path d={`M 33 ${76 - (3 - step) * 15} Q 35 ${77 - (3 - step) * 15} 37 ${76 - (3 - step) * 15}`} 
                    stroke="#fff" strokeWidth="0.8" fill="none" />
              {/* Legs */}
              <line x1="33" y1={90 - (3 - step) * 15} x2="32" y2={97 - (3 - step) * 15} stroke="#6366f1" strokeWidth="1.5" />
              <line x1="37" y1={90 - (3 - step) * 15} x2="38" y2={97 - (3 - step) * 15} stroke="#6366f1" strokeWidth="1.5" />
            </g>
          </>
        )}

        {/* Celebration phase */}
        {step >= 4 && (
          <g>
            {/* Character at summit */}
            <circle cx="50" cy="35" r="5" fill="#6366f1" />
            <circle cx="50" cy="25" r="4" fill="#6366f1" />
            <circle cx="48" cy="23" r="1" fill="#fff" />
            <circle cx="52" cy="23" r="1" fill="#fff" />
            <path d="M 48 26 Q 50 27 52 26" stroke="#fff" strokeWidth="0.8" fill="none" />
            <line x1="48" y1="40" x2="47" y2="48" stroke="#6366f1" strokeWidth="1.5" />
            <line x1="52" y1="40" x2="53" y2="48" stroke="#6366f1" strokeWidth="1.5" />
            
            {/* Celebration arms up */}
            <line x1="45" y1="32" x2="38" y2="18" stroke="#6366f1" strokeWidth="1.5" />
            <line x1="55" y1="32" x2="62" y2="18" stroke="#6366f1" strokeWidth="1.5" />

            {/* Confetti stars */}
            {[0, 1, 2, 3].map(i => {
              const angles = [0, 90, 180, 270];
              const angle = (angles[i] + step * 15) * Math.PI / 180;
              const distance = 25;
              const x = 50 + Math.cos(angle) * distance;
              const y = 25 + Math.sin(angle) * distance;
              return (
                <g key={`star-${i}`}>
                  <circle cx={x} cy={y} r="1.5" fill="#ec4899" opacity={0.8} />
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* Loading text */}
      <div className="text-center">
        <p className="text-sm font-semibold text-gray-800">
          {step < 4 ? 'Building your plan' : 'Plan ready!'}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {step < 4 ? 'Crafting each step with care...' : 'Your journey awaits'}
        </p>
      </div>

      {/* Subtle progress bar */}
      <div className="w-24 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div 
          className="h-full bg-gradient-to-r from-indigo-500 to-pink-500 rounded-full transition-all duration-600"
          style={{ width: `${Math.min(95, ((step + 1) / 8) * 100)}%` }}
        />
      </div>
    </div>
  );
}
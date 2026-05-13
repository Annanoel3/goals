import React, { useState, useEffect } from 'react';

const QUOTES = [
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "A goal without a plan is just a wish.", author: "Antoine de Saint-Exupéry" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "You don't have to be great to start, but you have to start to be great.", author: "Zig Ziglar" },
  { text: "Dream big. Start small. Act now.", author: "Robin Sharma" },
  { text: "What you get by achieving your goals is not as important as what you become.", author: "Thoreau" },
  { text: "Small steps in the right direction can turn out to be the biggest step of your life.", author: "Unknown" },
  { text: "Success is the sum of small efforts, repeated day in and day out.", author: "Robert Collier" },
  { text: "The future belongs to those who believe in the beauty of their dreams.", author: "Eleanor Roosevelt" },
  { text: "Don't watch the clock; do what it does. Keep going.", author: "Sam Levenson" },
  { text: "You are never too old to set another goal or to dream a new dream.", author: "C.S. Lewis" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "Progress, not perfection.", author: "Unknown" },
  { text: "Your limitation—it's only your imagination.", author: "Unknown" },
  { text: "Push yourself, because no one else is going to do it for you.", author: "Unknown" },
  { text: "Great things never come from comfort zones.", author: "Unknown" },
  { text: "Strive for progress, not perfection.", author: "Unknown" },
  { text: "The harder you work for something, the greater you'll feel when you achieve it.", author: "Unknown" },
  { text: "Wake up with determination. Go to bed with satisfaction.", author: "Unknown" },
  { text: "Little by little, a little becomes a lot.", author: "Tanzanian Proverb" },
  { text: "You don't need to see the whole staircase, just take the first step.", author: "Martin Luther King Jr." },
  { text: "Discipline is choosing between what you want now and what you want most.", author: "Abraham Lincoln" },
  { text: "Don't stop when you're tired. Stop when you're done.", author: "Unknown" },
  { text: "Your only limit is your mind.", author: "Unknown" },
  { text: "The best way to predict your future is to create it.", author: "Abraham Lincoln" },
  { text: "Do something today that your future self will thank you for.", author: "Unknown" },
  { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
  { text: "A year from now you may wish you had started today.", author: "Karen Lamb" },
  { text: "Action is the foundational key to all success.", author: "Pablo Picasso" },
];

function getDailyQuote() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  return QUOTES[dayOfYear % QUOTES.length];
}

export default function DailyQuote({ theme }) {
  const [quote] = useState(getDailyQuote);

  const isDark = theme === 'dark';

  return (
    <div className={`rounded-2xl px-6 py-5 text-center ${isDark ? 'bg-gray-800/60' : 'bg-white/60'} backdrop-blur-sm`}>
      <p className={`text-lg leading-relaxed mb-2 ${isDark ? 'text-gray-100' : 'text-gray-800'}`}
        style={{ fontFamily: "'Playfair Display', 'Georgia', serif", fontStyle: 'italic' }}>
        "{quote.text}"
      </p>
      <p className={`text-sm font-medium tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        — {quote.author}
      </p>
    </div>
  );
}
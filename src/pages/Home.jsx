import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Plus, Sparkles, Target, ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import DailyQuote from "../components/home/DailyQuote";

export default function Home() {
  const [user, setUser] = useState(null);
  const [goals, setGoals] = useState([]);
  const [recentSteps, setRecentSteps] = useState([]);
  const [theme, setTheme] = useState(() => localStorage.getItem('adhd_theme') || 'minimalist');
  const navigate = useNavigate();

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      setTheme(localStorage.getItem('adhd_theme') || 'minimalist');
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await base44.auth.me();
      setUser(currentUser);
    } catch {}

    try {
      const allGoals = await base44.entities.Goal.filter({ status: 'active' }, '-updated_date', 5);
      setGoals(allGoals);

      // Load recent pending steps across all goals
      const stepPromises = allGoals.slice(0, 3).map(g =>
        base44.entities.GoalStep.filter({ goal_id: g.id, status: 'pending' }, 'order_index', 3)
      );
      const stepGroups = await Promise.all(stepPromises);
      const flat = stepGroups.flat().slice(0, 4);
      setRecentSteps(flat.map(s => ({
        ...s,
        goalTitle: allGoals.find(g => g.id === s.goal_id)?.title || ''
      })));
    } catch {}
  };

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  };

  const isDark = theme === 'dark';
  const isColorful = theme === 'colorful';

  return (
    <div className={`min-h-screen ${isDark ? 'bg-gray-950' : isColorful ? 'bg-gradient-to-br from-purple-200 via-pink-200 to-blue-200' : 'bg-gray-50'}`}
      style={{ paddingBottom: 'max(6rem, calc(6rem + env(safe-area-inset-bottom)))' }}>

      {/* Hero greeting */}
      <div className={`px-6 pt-8 pb-6 ${isDark ? 'bg-gray-900' : isColorful ? 'bg-gradient-to-r from-purple-300/90 to-pink-300/90' : 'bg-white'} border-b ${isDark ? 'border-gray-800' : isColorful ? 'border-purple-300/50' : 'border-gray-100'}`}>
        <div className="max-w-2xl mx-auto">
          <p className={`text-sm font-medium mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {getGreeting()}{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}
          </p>
          <h1 className={`text-3xl font-bold tracking-tight mb-4 ${isDark ? 'text-white' : 'text-gray-900'}`}>
            What are you working<br />toward today?
          </h1>

          <div className="flex gap-3">
            <Button
              onClick={() => navigate('/Planner')}
              className={`flex-1 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl h-12 text-base font-semibold shadow-lg ${isDark ? 'shadow-violet-900/30' : 'shadow-violet-200'}`}
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Plan a New Goal
            </Button>
            <Button
              onClick={() => navigate('/Goals')}
              variant="outline"
              className={`rounded-2xl h-12 px-5 ${isDark ? 'border-gray-700 text-gray-200 hover:bg-gray-800' : 'border-gray-200 text-gray-700'}`}
            >
              <Target className="w-4 h-4 mr-1" />
              My Goals
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">

        {/* Active goals */}
        {goals.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>Active Goals</h2>
              <Link to="/Goals" className="text-sm text-violet-600 font-medium flex items-center gap-1 hover:text-violet-700">
                See all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-3">
              {goals.map(goal => (
                <GoalCard key={goal.id} goal={goal} isDark={isDark} onClick={() => navigate(`/goal/${goal.id}`)} />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {goals.length === 0 && (
          <div className={`rounded-3xl p-8 text-center ${isDark ? 'bg-gray-900 border border-gray-800' : 'bg-white border border-gray-100'} shadow-sm`}>
            <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto mb-4">
              <Target className="w-8 h-8 text-violet-600" />
            </div>
            <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>No goals yet</h3>
            <p className={`text-sm mb-6 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Tell the AI your goal and it'll build a plan for you.
            </p>
            <Button
              onClick={() => navigate('/Planner')}
              className="bg-violet-600 hover:bg-violet-700 text-white rounded-2xl px-6"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Your First Goal
            </Button>
          </div>
        )}

        {/* Next steps */}
         {recentSteps.length > 0 && (
           <section>
             <h2 className={`text-lg font-bold mb-3 ${isDark ? 'text-white' : 'text-gray-900'}`}>Up Next</h2>
             <div className={`rounded-2xl overflow-hidden divide-y ${isDark ? 'bg-gray-900 border border-gray-800 divide-gray-800' : 'bg-white border border-gray-100 divide-gray-50'} shadow-sm`}>
               {recentSteps.map(step => (
                 <div key={step.id} className="flex items-center gap-3 px-4 py-3">
                   <div className={`w-7 h-7 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${isDark ? 'border-gray-600' : 'border-gray-200'}`}>
                     <Clock className={`w-3 h-3 ${isDark ? 'text-gray-500' : 'text-gray-400'}`} />
                   </div>
                   <div className="flex-1 min-w-0">
                     <p className={`text-sm font-medium truncate ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>{step.title}</p>
                     <p className={`text-xs truncate ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{step.goalTitle}</p>
                   </div>
                 </div>
               ))}
             </div>
           </section>
         )}

        {/* Daily quote at bottom */}
        <div className="mt-12 pt-8 border-t" style={{ borderColor: isDark ? 'rgb(31, 41, 55)' : 'rgb(229, 231, 235)' }}>
          <DailyQuote theme={theme} />
        </div>
        </div>
    </div>
  );
}

function GoalCard({ goal, isDark, onClick }) {
  const categoryColors = {
    learning: 'bg-blue-100 text-blue-700',
    health: 'bg-green-100 text-green-700',
    career: 'bg-amber-100 text-amber-700',
    finance: 'bg-emerald-100 text-emerald-700',
    relationships: 'bg-pink-100 text-pink-700',
    personal: 'bg-violet-100 text-violet-700',
    creative: 'bg-orange-100 text-orange-700',
    other: 'bg-gray-100 text-gray-600',
  };

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl p-4 border transition-all hover:shadow-md ${
        isDark ? 'bg-gray-900 border-gray-800 hover:border-gray-700' : 'bg-white border-gray-100 hover:border-violet-100'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${categoryColors[goal.category] || categoryColors.other}`}>
            {goal.category}
          </span>
          <h3 className={`font-semibold text-sm mt-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>{goal.title}</h3>
        </div>
        <ArrowRight className={`w-4 h-4 flex-shrink-0 ${isDark ? 'text-gray-600' : 'text-gray-300'}`} />
      </div>
    </button>
  );
}
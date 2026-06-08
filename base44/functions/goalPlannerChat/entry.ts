import { createClientFromRequest } from "npm:@base44/sdk@0.8.25";
import OpenAI from "npm:openai";

// ──────────────────────────────────────────────────────────────────────────
// Shared, reusable rule blocks. Defined once and injected into both the
// new-goal and edit system prompts so the model sees each rule a single time
// (gpt-4o follows a short, non-repetitive prompt far more reliably than a long
// one that repeats the same rule three times).
// ──────────────────────────────────────────────────────────────────────────

const NO_GROUPING_RULE = `WRITE EVERY MONTH IN FULL — NO GROUPING. This is the single most important rule.
- Generate every month from Month 1 to the final month, in sequence, with no gaps.
- Every month is its own section with the SAME detail as Month 1: a "**Month N — Title**" line, then "**Week 1**" through "**Week 4**", each followed by specific "- task" bullets.
- NEVER combine or use ranges for months or weeks. "Month 9-12", "Months 3-6", "Week 1-2", "Weeks 5-6" are all forbidden — one section per single month, one block per single week.
- NEVER write a placeholder or summary for later months. Phrases like "Months 4-15: titles TBD", "I'll continue selecting books", "book titles to be determined", "(repeat for the remaining months)", "subsequent months follow the same pattern", or "for the rest of the months" are CRITICAL FAILURES.
- If you are running low on space, shorten each individual task — but NEVER collapse months together. Detail per month wins over padding; completeness of every month is non-negotiable.`;

const NO_FABRICATION_RULE = `NO FABRICATED FACTS. Use the web_search tool before stating any specific fact you are not 100% certain of — chapter/page counts, prices, calorie or macro numbers, hardiness zones, interest rates, dosages, statistics, or any measurable claim. If search is unavailable, hedge ("generally", "typically", "many people find") instead of presenting a guess as fact. Applies to every goal type.`;

const NO_REPEAT_RULE = `NEVER RECOMMEND ALREADY-USED ITEMS. Before adding any book, resource, app, or activity, scan the ENTIRE conversation (including any original planning conversation) for anything the user said they already read, watched, tried, liked, enjoyed, or disliked. "I liked/enjoyed X" means they already experienced X. Every such item is permanently banned from the whole plan — not Month 1, not Month 9, not as a bonus resource.`;

const RESPECT_CONSTRAINTS_RULE = `RESPECT "LESS X" CONSTRAINTS. If the user said anything like "less X", "fewer X", "not so much X", "too many X", "cut back on X" (where X is any genre, activity, topic, exercise, food, or skill), cap it hard: "less/fewer X" → at most 1 instance in the entire plan; "way less / too much X" → 0–1; "no X / remove X" → zero. "I like X" is general interest, NOT a request for more of it — the explicit limit always wins. Count instances before sending and revise if over.`;

const TIME_MAPPING_RULE = `TIME-OF-DAY MAPPING. "morning/early" → 06:00–07:00, "afternoon/midday" → 12:00–14:00, "evening/late afternoon" → 18:00–19:00, "night/late evening" → 20:00–21:00. If the user gave an exact time (e.g. "6pm", "7:30am"), use it. Never map "evening" to 1 PM.`;

const READING_GOAL_RULE = `READING/BOOK GOALS. Never guess or invent chapter or page counts. Use web_search to look up the exact chapter count of EVERY specific book before splitting it into weekly chunks; divide evenly (total chapters ÷ 4 = chapters per week, balanced across all 4 weeks; if no chapters, use total pages ÷ 4). Assign a real, specific book title to every month — never "Book Title", "TBD", or a generic genre label. NO SPOILERS: a week's resource must match where the reader currently is — never a full-book/whole-plot summary, ending explainer, or review that reveals later events. Prefer spoiler-free aids (author background, "how to read X", character/vocabulary primers) or summaries explicitly limited to the chapters already assigned; if unsure a link is spoiler-free, omit it.`;

const WEEK_DETAIL_RULE = `WEEK DEPTH — every week must be RICH, never a bare one-liner. A week that just says "Read Chapters 1–5" or "Practice scales" is a CRITICAL FAILURE. Each week needs ~3–6 bullets that actually give the user something to do AND think about:
  • The concrete action/chunk for the week (the exact chapters, the exercises with sets/reps, the specific vocabulary set, etc.).
  • What to focus on or notice while doing it, tied to the REAL content — for a book, the actual themes, characters, conflicts, or arguments in those specific chapters; for fitness, form cues and what should feel hard; for language, the specific structures in play.
  • A reflection / thinking prompt: 1–2 concrete questions that make the user engage with the material (e.g. "How does Okonkwo's reaction in Ch 4 reflect the theme of masculinity and fear? Jot 3–4 sentences.").
  • A practice / application / discussion activity (journal entry, a short exercise, summarize a passage in your own words, connect it to last week, apply it to your own life, or a question to discuss with someone).
  • Optionally a relevant resource (follow the link rules).
For reading/book goals: use web_search to learn what those exact chapters are actually about, then build the focus points, reflection prompts, and activities around the real themes and plot — not generic "think about what you read" filler.`;

const RESOURCE_LINK_RULE = `RESOURCE LINKS — a broken link is worse than no link. Never guess article/blog URLs or invent paths. Use only safe search-style URLs with REAL terms: https://www.youtube.com/results?search_query=…, https://www.amazon.com/s?k=Title+Author, https://www.google.com/search?q=…, Udemy/Coursera search URLs, or a root domain you are 100% sure of. No Google Maps links. No placeholder words (TOPIC, CITY, AUTHOR) inside URLs. If no real URL exists, leave it blank and put the actionable detail in the description.`;

// web_search tool definition (shared by the initial draft and any continuation calls)
const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search the web for current, accurate information. MANDATORY USE CASES: (1) Any reading/book goal — you MUST search for the exact chapter count and page count of EVERY specific book before assigning weekly reading ranges. Never guess chapter counts. (2) Any purchase/savings goal — search for current prices. (3) Any factual claim you are not 100% certain of. Do NOT fabricate facts, chapter counts, prices, or URLs.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The search query" } },
      required: ["query"]
    }
  }
};

// ──────────────────────────────────────────────────────────────────────────
// Pure helpers for the plan-completeness safety net (no I/O — testable).
// ──────────────────────────────────────────────────────────────────────────

const MONTH_HEADER_RE = /^\s*#{0,4}\s*\*{0,2}\s*Month\s+(\d+)\b/i;

// A real month RANGE: plural "Months N..M" (any separator), OR singular "Month N-M"
// (plain hyphen only), OR "Month N to/through M". Deliberately does NOT match a title
// like "Month 1 — 1984" or "Month 3 — 100 Years of Solitude".
const MONTH_RANGE_RE = /Months\s+\d+\s*(?:[-–—]|to|through|&|,)\s*\d+|Month\s+\d+\s*-\s*\d+|Month\s+\d+\s+(?:to|through)\s+\d+/i;

// Softer deferral phrasing that ALSO means "I didn't actually write this out"
// (e.g. "book titles TBD", "I'll continue choosing them"). Kept narrow so it can't
// match ordinary task text — note there is NO bare "will continue" (that would catch
// legit lines like "we'll continue building strength next week").
const DEFERRAL_RE = /continue\s+(?:to\s+)?(?:select|choose|selecting|choosing|picking)\b|(?:titles?|books?)\s+(?:are\s+)?(?:tbd|to\s+be\s+determined)|\bTBD\b|for\s+the\s+(?:rest|remainder)\s+of\s+(?:the\s+)?(?:months|year|plan|timeline)|subsequent\s+months|remaining\s+months\s+(?:will|to|follow)|repeat\s+(?:this\s+)?(?:for\s+)?(?:every|each)\s+(?:remaining\s+)?month/i;

// A line that is filler rather than real plan content (a grouped range or a deferral).
const isPlaceholderLine = (ln) => MONTH_RANGE_RE.test(ln) || DEFERRAL_RE.test(ln);

// Inspect a plan draft and report:
//   maxPresent   — highest month written out as its own standalone header
//   maxMentioned — highest month referenced anywhere, incl. grouped ranges
//                  ("Months 4-15" → 15), i.e. how long the plan was meant to be
//   contig       — months 1..contig are ALL present with REAL (non-placeholder) content
//   rangePresent — a grouped month RANGE appears at/after the first header (the exact
//                  thing we must eliminate from the output)
//   groupingPresent — a range OR a soft deferral appears at/after the first header
//   sectionEnd(i)— line index where the month section starting at line i ends
//   headerIdx, lines, firstHeaderIdx — for slicing
function analyzePlan(text) {
  const lines = text.split('\n');
  const headerIdx = {};
  let maxPresent = 0, maxMentioned = 0, firstHeaderIdx = -1;

  lines.forEach((ln, i) => {
    // A grouped range tells us the intended length — pull its numbers (capped to avoid
    // years or numeric titles), but only from lines that are actually a range.
    if (MONTH_RANGE_RE.test(ln)) {
      const nums = (ln.match(MONTH_RANGE_RE)[0].match(/\d+/g) || []).map(Number).filter(x => x >= 1 && x <= 36);
      if (nums.length) maxMentioned = Math.max(maxMentioned, ...nums);
    }
    const m = ln.match(MONTH_HEADER_RE);
    if (m && !MONTH_RANGE_RE.test(ln)) {
      const n = parseInt(m[1], 10);
      if (!(n in headerIdx)) headerIdx[n] = i;
      if (firstHeaderIdx === -1) firstHeaderIdx = i;
      maxPresent = Math.max(maxPresent, n);
      maxMentioned = Math.max(maxMentioned, n);
    }
  });

  // A month section runs from its header to the next standalone header OR the next
  // placeholder line, whichever comes first. (Works for any format — weekly, daily, or
  // bullet-only soft-growth plans — because it does NOT require a "Week" header.)
  const sectionEnd = (startIdx) => {
    for (let k = startIdx + 1; k < lines.length; k++) {
      const isHeader = MONTH_HEADER_RE.test(lines[k]) && !MONTH_RANGE_RE.test(lines[k]);
      if (isHeader || isPlaceholderLine(lines[k])) return k;
    }
    return lines.length;
  };
  // "Real content" = at least one non-blank line that is NOT itself a placeholder, so a
  // header like "Month 12 — TBD" with nothing real under it does NOT count as written.
  const hasContent = (startIdx) => {
    const end = sectionEnd(startIdx);
    for (let k = startIdx + 1; k < end; k++) { if (lines[k].trim() && !isPlaceholderLine(lines[k])) return true; }
    return false;
  };

  // contig = largest M such that months 1..M all have a header AND real content.
  let contig = 0;
  for (let M = 1; (M in headerIdx) && hasContent(headerIdx[M]); M++) contig = M;

  // Look only from the first month header onward, so an intro summary like
  // "in Months 1-3 you build fundamentals" never triggers anything.
  let rangePresent = false, groupingPresent = false;
  if (firstHeaderIdx >= 0) {
    for (let k = firstHeaderIdx; k < lines.length; k++) {
      if (MONTH_RANGE_RE.test(lines[k])) { rangePresent = true; groupingPresent = true; break; }
      if (DEFERRAL_RE.test(lines[k])) groupingPresent = true;
    }
  }

  return { lines, headerIdx, maxPresent, maxMentioned, contig, rangePresent, groupingPresent, firstHeaderIdx, sectionEnd };
}

// Parse an already-written plan (markdown) into weeks + month titles — no AI.
// Returns { weeks: [{month, week, phase, bullets[]}], monthTitles: {n: "title"} }.
function parsePlanWeeks(text) {
  const lines = text.split('\n');
  const monthTitles = {};
  const registry = {};
  const weeks = [];
  let curMonth = null, curWeek = null, awaitingSubtitle = false;

  const monthRe    = /^#{0,4}\s*Month\s+(\d+)\b\s*(?:[-–—:]\s*(.*\S))?\s*$/i;
  const weekRe     = /^#{0,4}\s*Week\s+(\d+)\b\s*(?:[-–—:]\s*(.*\S))?\s*$/i;
  const combinedRe = /^#{0,4}\s*Month\s+(\d+)\s*[,\s]\s*Week\s+(\d+)\b/i;
  const rangeRe    = /Months?\s+\d+\s*(?:[-–—]|to|through|&)\s*\d+/i;
  const bulletRe   = /^(?:[-•*]\s+|\d+\.\s+)(.+\S)\s*$/;
  const dateOnlyRe = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i;
  const stripEmph  = (s) => s.replace(/\*/g, '').replace(/^[-–—:]\s*/, '').trim();

  const getWeek = (m, w) => {
    const key = m + '-' + w;
    if (!registry[key]) { const o = { month: m, week: w, phase: `Month ${m}, Week ${w}`, bullets: [] }; registry[key] = o; weeks.push(o); }
    return registry[key];
  };

  for (const raw of lines) {
    const clean = raw.replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (!clean) continue;

    const cm = clean.match(combinedRe);
    if (cm) { curMonth = parseInt(cm[1], 10); curWeek = getWeek(curMonth, parseInt(cm[2], 10)); awaitingSubtitle = false; continue; }

    const mh = clean.match(monthRe);
    if (mh && !rangeRe.test(clean) && !/Week\s+\d+/i.test(clean)) {
      curMonth = parseInt(mh[1], 10); curWeek = null;
      const sub = mh[2] ? stripEmph(mh[2]) : '';
      if (sub && !dateOnlyRe.test(sub) && !/^Month\s+\d+$/i.test(sub) && sub.length <= 120) { monthTitles[curMonth] = sub; awaitingSubtitle = false; }
      else awaitingSubtitle = true;
      continue;
    }

    const wh = clean.match(weekRe);
    if (wh && curMonth != null && !/Month\s+\d+/i.test(clean)) {
      curWeek = getWeek(curMonth, parseInt(wh[1], 10));
      awaitingSubtitle = false;
      const wsub = wh[2] ? stripEmph(wh[2]) : '';
      if (wsub) curWeek.bullets.push(wsub);
      continue;
    }

    const b = clean.match(bulletRe);
    if (b) {
      const content = b[1].replace(/\*/g, '').trim();
      if (content) {
        if (curWeek) curWeek.bullets.push(content);
        else if (curMonth != null) getWeek(curMonth, 1).bullets.push(content);
      }
      awaitingSubtitle = false;
      continue;
    }

    if (awaitingSubtitle && curMonth != null && !monthTitles[curMonth]) {
      const t = stripEmph(clean);
      if (t && !dateOnlyRe.test(t) && t.length <= 120) monthTitles[curMonth] = t;
    }
    awaitingSubtitle = false;
  }

  return { weeks, monthTitles };
}

Deno.serve(async (req) => {
  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { messages, mode, goal_id } = body;

    const conversationText = messages.map(m => `${m.role === 'user' ? 'User' : 'Planner'}: ${m.content}`).join('\n\n');
    const today = new Date().toISOString().split('T')[0];

    // ── Detect the timeline (in months) from natural language so we can enforce it ──
    const _mNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const _wNum = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
    const _now = new Date();
    let detectedMonths = null;
    const _em = conversationText.match(/(\d+)[- ]month/i);
    if (_em) detectedMonths = parseInt(_em[1], 10);
    if (!detectedMonths) { const m = conversationText.match(/in\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+years?/i); if (m) detectedMonths = (parseInt(m[1]) || _wNum[m[1].toLowerCase()] || 1) * 12; }
    if (!detectedMonths) { const m = conversationText.match(/in\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+months?/i); if (m) detectedMonths = parseInt(m[1]) || _wNum[m[1].toLowerCase()] || 1; }
    if (!detectedMonths) { const m = conversationText.match(/in\s+(\d+)\s+weeks?/i); if (m) detectedMonths = Math.max(1, Math.round(parseInt(m[1]) / 4)); }
    if (!detectedMonths) { const m = conversationText.match(/by\s+(?:next\s+|this\s+|end\s+of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)/i); if (m) { const ti = _mNames.indexOf(m[1].toLowerCase()); const isNext = /next/i.test(m[0]); let ty = _now.getFullYear(); if (ti <= _now.getMonth() || isNext) ty++; detectedMonths = Math.max(1, (ty - _now.getFullYear()) * 12 + (ti - _now.getMonth())); } }
    if (!detectedMonths) { const m = conversationText.match(/(?:by|before)\s+(?:(?:the\s+)?end\s+of\s+)?(\d{4})/i); if (m) { const ty = parseInt(m[1]); if (ty >= _now.getFullYear()) detectedMonths = Math.max(1, (ty - _now.getFullYear()) * 12 + (11 - _now.getMonth())); } }
    if (!detectedMonths && /(?:by|before)\s+(?:the\s+)?end\s+of\s+(?:(?:this|the)\s+)?year/i.test(conversationText)) detectedMonths = Math.max(1, 11 - _now.getMonth());
    if (!detectedMonths && /next\s+year/i.test(conversationText)) detectedMonths = Math.max(6, 12 - _now.getMonth() + 6);

    const monthsRule = detectedMonths
      ? `- Use EXACTLY ${detectedMonths} months for this plan (Month 1 through Month ${detectedMonths}). Do NOT recalculate or shorten it. Each month MUST have exactly 4 weeks (Week 1–Week 4) — ${detectedMonths * 4} week-blocks total. Never combine or skip weeks or months.`
      : `- Identify the exact duration from the conversation (a deadline, date, or duration phrase) and use that many months — do NOT shorten it. Each month has exactly 4 weeks.`;

    // ── EXTRACT PLAN: turn the already-written plan into structured JSON ─────────
    if (mode === 'extract_plan') {
      const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
      const planText = lastAssistantMessage?.content || conversationText;

      // FAST PATH — the plan is already fully written as markdown by the chat, so we
      // parse it into steps IN CODE instead of paying for a second AI pass to
      // re-generate every step. This is the big latency win (~40s → a few seconds).
      const parsed = parsePlanWeeks(planText);
      const parsedWeeks = parsed.weeks;
      const parsedMonthTitles = parsed.monthTitles;
      const weeksWithContent = parsedWeeks.filter(w => w.bullets.length > 0).length;

      if (weeksWithContent >= 3) {
        parsedWeeks.sort((a, b) => a.month - b.month || a.week - b.week);

        // Only the goal-level fields need inference, and their output is tiny — so this
        // gpt-4o-mini call is fast and constant-time no matter how long the plan is.
        const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
        let meta = {};
        try {
          const metaResp = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: `Return ONLY a small JSON object describing this goal at a high level (NO steps). Fields:
- title: short goal title (e.g. "Read 12 books in 12 months")
- description: one sentence
- plan_summary: 2-3 sentences
- category: one of learning|health|career|finance|relationships|personal|creative|other
- notification_frequency: one of daily|weekly|weekdays|3x_per_week|2x_per_week (daily for reading/fitness/language/practice habits; weekly for career/finance/project milestones)
- requires_daily_action: true for habit/practice/reading/fitness goals, else false
- weekdays_only: false unless the goal is explicitly work/career only
- include_weekend_reminders: false if the user said anything like "no weekends", "weekdays only", "not on weekends"; true otherwise (default true)
- preferred_time: Extract the user's stated preferred time for reminders/notifications. Parse time phrases like "9am", "6:00 PM", "morning", "evening", "noon" into 24h HH:MM format (e.g., "09:00", "18:00", "08:00" for morning, "17:00" for evening). If no time stated, null.
- start_date: The date the user wants to START, as YYYY-MM-DD. TODAY IS ${today}. Resolve loose/relative phrasing: "next month" → the 1st of next month; a bare month name ("July", "in July", "start in July") → the 1st of that month (this year if still upcoming, else next year); "now"/"today"/"asap" → ${today}. Only return null if no start timing is given at all.
${TIME_MAPPING_RULE}` },
              { role: "user", content: `User said:\n${userText}\n\nPlan intro:\n${planText.slice(0, 1200)}\n\nSearching the user's text above, extract their preferred time for reminders. Return the JSON.` }
            ],
            max_tokens: 500,
            response_format: { type: "json_object" }
          });
          meta = JSON.parse(metaResp.choices[0].message.content) || {};
        } catch (_) { meta = {}; }

        // Timeline + dates, computed in code.
        const monthNums = parsedWeeks.map(w => w.month);
        const titleNums = Object.keys(parsedMonthTitles).map(Number).filter(n => !isNaN(n));
        const N = Math.max(detectedMonths || 0, monthNums.length ? Math.max(...monthNums) : 0, titleNums.length ? Math.max(...titleNums) : 0, 1);
        const todayDate = new Date(today);
        const targetDate = new Date(todayDate); targetDate.setMonth(targetDate.getMonth() + N);
        const totalDays = Math.max(1, (targetDate - todayDate) / (1000 * 60 * 60 * 24));
        const T = parsedWeeks.length || 1;
        const dailyHabit = meta.requires_daily_action === true;

        const steps = parsedWeeks.map((wk, i) => {
          const bullets = wk.bullets.filter(Boolean);
          const first = bullets[0] || '';
          let focus = (first.includes(':') ? first.split(':')[0] : first).trim();
          if (focus.length > 60) focus = focus.slice(0, 60).trim();
          const d = new Date(todayDate); d.setDate(d.getDate() + Math.round((i + 1) * totalDays / T));
          return {
            title: focus ? `Week ${wk.week}: ${focus}` : `Week ${wk.week}`,
            description: bullets.join('\n'),
            phase: wk.phase,
            priority: "medium",
            due_date: d.toISOString().split('T')[0],
            order_index: i,
            step_resources: [],
            success_criteria: [],
            tips_and_guidance: "",
            is_daily_habit: dailyHabit
          };
        });

        const firstUser = messages.find(m => m.role === 'user')?.content || 'My Goal';
        const plan = {
          title: (meta.title || firstUser).toString().slice(0, 120),
          description: meta.description || "",
          plan_summary: meta.plan_summary || "",
          timeline: `${N} months`,
          target_date: targetDate.toISOString().split('T')[0],
          start_date: meta.start_date || null,
          category: meta.category || "personal",
          notification_frequency: meta.notification_frequency || (dailyHabit ? "daily" : "weekly"),
          requires_daily_action: dailyHabit,
          weekdays_only: meta.weekdays_only === true,
          include_weekend_reminders: meta.include_weekend_reminders !== false,
          habit_days_of_week: [],
          preferred_time: meta.preferred_time || null,
          month_titles: parsedMonthTitles,
          notification_schedule: [],
          steps
        };

        console.log(`[goalPlannerChat] extract_plan (code-parse) done: ${steps.length} steps, ${N} months`);
        return Response.json({ plan, month_titles: plan.month_titles, notification_schedule: plan.notification_schedule, requires_daily_action: plan.requires_daily_action, weekdays_only: plan.weekdays_only, include_weekend_reminders: plan.include_weekend_reminders, habit_days_of_week: plan.habit_days_of_week });
      }

      // FALLBACK — if the markdown wasn't in the expected shape, use the original AI
      // extraction so we still always produce a plan.
      const extractionResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You convert an already-written goal plan (in markdown) into structured JSON. Preserve ALL of the plan's content — never drop or summarize away detail. You may reorganize each week's bullets into the fields below and rephrase for clarity, but do NOT invent new facts. Return ONLY valid JSON, no markdown fences.

Rules:
- Each step = one week. phase = "Month X, Week Y". title = "Week N: [short focus from plan]".
- Include EVERY week of EVERY month present in the plan. Do not skip or merge any.
- description: capture the FULL detail of that week — the concrete action, focus points, reflection prompts, and activities. NEVER compress to one line.
- success_criteria: 2–4 concrete "done" checks for the week.
- tips_and_guidance: a short helpful note, or "".
- step_resources: leave as []. Put resource links inside the description text.
- is_daily_habit: true for reading/fitness/language/music/meditation; false for milestone/project goals.
- requires_daily_action: same logic as is_daily_habit.
- notification_frequency: "daily" for reading/fitness/language, "weekly" for career/finance/project.
- month_titles: extract the title after each "Month N —" heading.
- notification_schedule: 2-3 simple check-ins for Week 1 only (dates from today ${today}).
- due_dates: spread evenly from today ${today} across the timeline.
- weekdays_only: false unless explicitly work/career focused.
- ${TIME_MAPPING_RULE}`
          },
          {
            role: "user",
            content: `Convert this plan to JSON:\n\n${planText}\n\nReturn this structure:\n{ "title": "...", "description": "...", "timeline": "X months", "target_date": "YYYY-MM-DD", "category": "...", "plan_summary": "...", "notification_frequency": "daily", "requires_daily_action": true, "weekdays_only": false, "habit_days_of_week": [], "month_titles": {"1":"title"}, "notification_schedule": [], "steps": [{ "title": "Week N: focus", "description": "...", "phase": "Month X, Week Y", "priority": "medium", "due_date": "YYYY-MM-DD", "order_index": 0, "step_resources": [], "success_criteria": [], "tips_and_guidance": "", "is_daily_habit": false }] }`
          }
        ],
        max_tokens: 16000,
        response_format: { type: "json_object" }
      });

      const plan = JSON.parse(extractionResponse.choices[0].message.content);
      plan.steps = (plan.steps || []).map(step => ({
        ...step,
        step_resources: step.step_resources || [],
        success_criteria: step.success_criteria || [],
        tips_and_guidance: step.tips_and_guidance || ""
      }));
      plan.month_titles = plan.month_titles || {};
      plan.notification_schedule = plan.notification_schedule || [];
      plan.habit_days_of_week = plan.habit_days_of_week || [];

      const todayDate = new Date(today);
      const targetDate = plan.target_date ? new Date(plan.target_date) : null;
      const aiDueDates = plan.steps.filter(s => s.due_date).map(s => s.due_date).sort();
      const aiDatesAreValid = aiDueDates[0] && new Date(aiDueDates[0]) > todayDate;
      if (!aiDatesAreValid && targetDate && plan.steps.length > 0) {
        const daysAvailable = (targetDate - todayDate) / (1000 * 60 * 60 * 24);
        const daysPerStep = daysAvailable / plan.steps.length;
        plan.steps.forEach((step, idx) => {
          const d = new Date(todayDate);
          d.setDate(d.getDate() + Math.round((idx + 1) * daysPerStep));
          step.due_date = d.toISOString().split('T')[0];
        });
      }

      console.log(`[goalPlannerChat] extract_plan (AI fallback) done: ${plan.steps.length} steps, ${plan.timeline}`);
      return Response.json({ plan, month_titles: plan.month_titles, notification_schedule: plan.notification_schedule, requires_daily_action: plan.requires_daily_action, weekdays_only: plan.weekdays_only, include_weekend_reminders: plan.include_weekend_reminders, habit_days_of_week: plan.habit_days_of_week });
    }

    // ── APPLY EDIT: commit approved edits to an existing goal ─────────────────
    if (mode === 'apply_edit') {
      const existingGoal = await base44.entities.Goal.list().then(all => all.find(g => g.id === goal_id));
      const existingSteps = await base44.entities.GoalStep.filter({ goal_id });

      const completedSteps = existingSteps.filter(s => s.status === 'completed');
      const replaceableSteps = existingSteps.filter(s => s.status !== 'completed');

      const extractionResponse = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You extract the new goal plan proposed in a conversation. Return ONLY valid JSON, no markdown.
CRITICAL RULES:
1. Extract EVERY step the planner proposed in their latest plan. Do NOT omit any steps, and do NOT collapse months or weeks into ranges.
2. ENFORCE WEEK ORDERING: For each month, steps MUST appear in order Week 1, Week 2, Week 3, Week 4.
3. FOR READING GOALS: If the planner mentioned specific chapter ranges (e.g. "Ch 1-15"), include those exact ranges in the step titles/descriptions. Do NOT use vague percentages when a chapter count is available.
4. The output completely replaces all existing steps, so be exhaustive.
5. CAPTURE FULL DETAIL PER STEP: each step's "description" must include the full substance of that week — the concrete action, what to focus on, the reflection/thinking prompts, and the activities — never a one-liner like "Read chapters 1-5". Populate "success_criteria" with 2–4 concrete done-checks and "tips_and_guidance" with a short helpful note, drawn from the plan (do not invent unrelated facts).
6. NOTIFICATION FREQUENCY: infer from context and set "notification_frequency" to one of "daily", "weekdays", "weekly", "3x_per_week", "2x_per_week" (daily tasks/practice/reading → "daily"; weekday focus → "weekdays"; once a week → "weekly").
7. MONTH TITLES (if changed): include "month_titles" in goal_updates with real, specific titles (not placeholders).`
          },
          {
            role: "user",
            content: `Goal: "${existingGoal?.title || 'Unknown'}"

Conversation:
${conversationText}

Extract ALL steps from the planner's most recent proposed plan/changes. Include goal-level updates if the title, timeline, or description changed.

Return JSON:
{
  "goal_updates": {
    "title": "only if changed",
    "description": "only if changed",
    "plan_summary": "only if changed",
    "timeline": "only if changed",
    "target_date": "YYYY-MM-DD only if changed",
    "month_titles": { "1": "title", "2": "title" }
  },
  "new_steps": [
    { "title": "...", "description": "...", "phase": "Month X, Week Y", "priority": "low|medium|high|critical", "due_date": "YYYY-MM-DD", "order_index": 0, "step_resources": [], "success_criteria": [], "tips_and_guidance": "", "is_daily_habit": false }
  ]
}
today = ${today}
Extract every single step. If the planner listed 48 steps, return all 48.`
          }
        ],
        max_tokens: 16000,
        response_format: { type: "json_object" }
      });

      const extracted = JSON.parse(extractionResponse.choices[0].message.content);

      // Apply goal-level updates
      const goalUpdates = extracted.goal_updates || {};
      if (Object.keys(goalUpdates).length > 0) {
        const { month_titles, ...otherUpdates } = goalUpdates;
        if (Object.keys(otherUpdates).length > 0) {
          await base44.entities.Goal.update(goal_id, otherUpdates);
        }
        if (month_titles && Object.keys(month_titles).length > 0) {
          await base44.entities.Goal.update(goal_id, { month_titles });
        }
      }

      // Delete ALL replaceable (non-completed) steps
      for (const step of replaceableSteps) {
        await base44.entities.GoalStep.delete(step.id);
      }

      // Create all new steps, sorted so weeks appear in sequence within each month
      const newSteps = extracted.new_steps || [];
      newSteps.sort((a, b) => {
        const aMonth = parseInt(a.phase?.match(/Month (\d+)/i)?.[1] || 0);
        const bMonth = parseInt(b.phase?.match(/Month (\d+)/i)?.[1] || 0);
        if (aMonth !== bMonth) return aMonth - bMonth;
        const aWeek = parseInt(a.phase?.match(/Week (\d+)/i)?.[1] || 0);
        const bWeek = parseInt(b.phase?.match(/Week (\d+)/i)?.[1] || 0);
        return aWeek - bWeek;
      });

      for (let i = 0; i < newSteps.length; i++) {
        const step = newSteps[i];
        await base44.entities.GoalStep.create({
          goal_id,
          title: step.title,
          description: step.description || "",
          phase: step.phase || "",
          priority: step.priority || "medium",
          due_date: step.due_date || "",
          order_index: step.order_index ?? i,
          status: "pending",
          step_resources: step.step_resources || [],
          success_criteria: step.success_criteria || [],
          tips_and_guidance: step.tips_and_guidance || "",
          is_daily_habit: step.is_daily_habit === true
        });
      }

      return Response.json({ success: true, steps_replaced: replaceableSteps.length, steps_created: newSteps.length, completed_kept: completedSteps.length });
    }

    // ── CHAT: main conversational mode ────────────────────────────────────────
    // Load the user's existing goals (RLS scopes to their own).
    let existingGoalsList = [];
    try {
      existingGoalsList = await base44.entities.Goal.list('-created_date', 50);
    } catch (_) { /* ignore */ }

    // Load steps for every goal so the AI has full context.
    let allStepsMap = {};
    try {
      for (const g of existingGoalsList) {
        const steps = await base44.entities.GoalStep.filter({ goal_id: g.id });
        allStepsMap[g.id] = steps.sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      }
    } catch (_) { /* ignore */ }

    const goalsSummary = existingGoalsList.length > 0
      ? `The user has these existing goals (with their full step lists):\n${existingGoalsList.map(g => {
          const steps = allStepsMap[g.id] || [];
          const phaseMap = {};
          steps.forEach(s => {
            const p = s.phase || 'Uncategorized';
            if (!phaseMap[p]) phaseMap[p] = [];
            phaseMap[p].push(s.title);
          });
          const phaseSummary = Object.entries(phaseMap)
            .map(([phase, titles]) => `      ${phase}: ${titles.join(', ')}`)
            .join('\n');
          return `- ID: ${g.id} | Title: "${g.title}" | Status: ${g.status} | Timeline: ${g.timeline || 'N/A'}\n${phaseSummary || '      (no steps)'}`;
        }).join('\n\n')}`
      : 'The user has no existing goals yet.';

    const isEditSession = !!goal_id;

    // How many months the plan should span (used to enforce completeness later).
    let planMonths = detectedMonths;

    let systemPrompt;
    if (isEditSession) {
      const currentGoal = existingGoalsList.find(g => g.id === goal_id);
      const currentSteps = await base44.entities.GoalStep.filter({ goal_id });

      // Group steps by phase so the AI can see gaps clearly.
      const phaseMap = {};
      currentSteps.forEach(s => {
        const p = s.phase || 'Uncategorized';
        if (!phaseMap[p]) phaseMap[p] = [];
        phaseMap[p].push(s.title);
      });
      const phasesSummary = Object.entries(phaseMap)
        .map(([phase, titles]) => `  ${phase} (${titles.length} steps):\n${titles.map(t => `    - ${t}`).join('\n')}`)
        .join('\n');

      // Original planning conversation (stated constraints, preferences).
      const originalConversation = currentGoal?.conversation_history || [];
      const originalContextText = originalConversation.length > 0
        ? `\nORIGINAL PLANNING CONVERSATION (user's stated constraints, time availability, preferences):\n${originalConversation.slice(0, 10).map(m => `${m.role === 'user' ? 'User' : 'Planner'}: ${m.content}`).join('\n')}`
        : '';

      const parseMonthsFromTimeline = (timeline) => {
        const match = timeline?.match(/(\d+)\s*month/i);
        return match ? parseInt(match[1], 10) : null;
      };
      const targetMonths = parseMonthsFromTimeline(currentGoal?.timeline);
      planMonths = targetMonths;
      const monthsFromCreation = currentGoal?.created_date
        ? Math.round((new Date(today) - new Date(currentGoal.created_date)) / (1000 * 60 * 60 * 24 * 30.44))
        : null;
      const createdStr = currentGoal?.created_date ? new Date(currentGoal.created_date).toISOString().split('T')[0] : 'recently';

      systemPrompt = `You are an expert goal planner and ongoing accountability partner helping a user EDIT and EVOLVE an existing goal.

TODAY'S DATE: ${today}. Use it to calculate timelines accurately.

CURRENT GOAL: "${currentGoal?.title || 'Unknown'}"
DESCRIPTION: ${currentGoal?.description || 'N/A'}
PLAN SUMMARY: ${currentGoal?.plan_summary || 'N/A'}
TIMELINE: ${currentGoal?.timeline || 'N/A'} (Target Date: ${currentGoal?.target_date || 'N/A'})
GOAL CREATED: ${createdStr}
${monthsFromCreation !== null ? `MONTHS ELAPSED SINCE CREATION: ~${monthsFromCreation}` : ''}
${targetMonths !== null ? `PLAN SHOULD SPAN ${targetMonths} MONTHS TOTAL (Month 1 through Month ${targetMonths})` : ''}
${originalContextText}

FULL PLAN — ALL EXISTING STEPS BY PHASE:
${phasesSummary || '  (no steps yet)'}

HOW YOU WORK:

1. DEFAULT TO ACTION, NOT QUESTIONS. You already have the full step list, original conversation, description, timeline, and creation date. Respond to any edit request with a concrete proposal, not questions. The ONLY question you may ever ask is which goal the user means — and only if they have 2+ goals and it is genuinely ambiguous. Never ask "do these resonate?", "what resources do you prefer?", etc. End every proposal with "Want me to add this to your plan?" or "Say 'yes' to save this."

2. GAP-FILLING IS IMMEDIATE. If the plan shows e.g. Months 1–5 but should span 12, and the user says "fill in the rest", generate Month 6 through Month 12 in full detail right now — look at the surrounding months and infer the logical progression. If the user asks to add a single missing week/phase, respond with 5–8 specific steps immediately. Never ask a question first.

3. TIMELINE ACCURACY. The goal was created on ${createdStr}; today is ${today}. Use these to know where the user is — do not assume a specific month unless you can calculate it.

4. APPROVAL TRIGGER. When the user says "yes", "looks good", "do it", "apply it", "perfect", "save it", "go ahead", "ok", or "sure", start your response with EXACTLY "EDIT_APPROVED" followed by a summary of what changed.

TIMELINE EXTENSION ("add 2 more months", "extend by 3 months", "I need more time"): never silently append months to the end — that creates two endpoints and a disjointed plan. Offer ONE of:
- OPTION A — FULL RESTRUCTURE (recommend this when the user is behind, struggling, or short on time): recalculate the ENTIRE plan across the new total duration, redistribute the same goals/milestones, delete incomplete steps and replace them. "I'm restructuring your full plan to span [new total] months so everything flows naturally to the new end date."
- OPTION B — EXTEND WITH NEW ADVANCED CONTENT (only if the user explicitly wants MORE material/depth, not just more time): add genuinely advanced new phases BEYOND the original endpoint. "I've added [X] months of advanced content after your original completion point."
Present both clearly, recommend the one that fits, and wait for their choice before generating the extended plan. When in doubt, recommend Option A.

PROACTIVE COACHING — watch for and respond to these signals:
- "too easy / I already know this" → accelerate, remove beginner steps, add harder content.
- "too hard / overwhelmed" → break steps smaller, slow the pace, add foundational resources.
- "I don't have time" → extend timeline or reduce weekly step count (Option A restructure).
- "I finished early" → add advanced phases or a follow-on goal (Option B).
- "I need more resources" → add specific links/videos/books to relevant steps.
- "a week/phase is missing" → fill the gap logically from the surrounding phases.

${NO_GROUPING_RULE}

${WEEK_DETAIL_RULE}

${READING_GOAL_RULE}

${TIME_MAPPING_RULE}

${RESOURCE_LINK_RULE}

${NO_FABRICATION_RULE}

${NO_REPEAT_RULE}

${RESPECT_CONSTRAINTS_RULE}

Always be specific, warm, and treat the plan as a living document.`;
    } else {
      const userCity = body.city || null;

      systemPrompt = `You are an expert goal planner, life coach, and ongoing accountability partner. You help users create brand-new, detailed, actionable, realistic goal plans — and continuously refine them over time.

TODAY'S DATE: ${today}. Always use it to calculate timelines exactly. If a user says "by December 2026", compute the precise number of months from today — do NOT guess (e.g. May 2026 → December 2026 = 7 months).

${goalsSummary}
${userCity ? `USER'S CITY: ${userCity}` : ''}

═══ CREATING A NEW GOAL ═══

PHASE 0 — SKIP INFO-GATHERING WHEN POSSIBLE: If the user's CURRENT message already contains the goal, the timeline/duration, time commitment, and any budget/constraints, skip straight to Phase 2 and build the full plan immediately (no "are you ready?" question).
  EXCEPTION — READING/BOOK GOALS never skip Phase 1, even with a timeline given. You must first learn their genres/authors, books already read (so you don't repeat them), and book budget. Generic genre labels are not a substitute for real personalized picks.

PHASE 1 — GATHER INFO FIRST (required before any plan, unless Phase 0 applies):
Ask ALL your questions in ONE numbered list (never split across messages). Rules for questions:
  a) Never ask two questions covering the same topic — merge them.
  b) Every question states how the answer shapes the plan (e.g. "What obstacles or fears do you have? I'll build contingency steps for them.").
  c) For purchase/savings goals, look up the item's real price first and reference it ("The 2026 Camry is ~$29,000 — full price or just a down payment?") instead of a generic "how much do you need?".
  The questions to ask:
   - ONE combined experience + prior attempts question (MANDATORY, every goal): "What's your current experience with this? Have you tried before — and if so, what worked or didn't?"
   - Obstacles/fears (MANDATORY, every goal): "What obstacles or fears do you have? I'll build specific contingency steps to address them."
   - The target amount/outcome (for finance goals, reference the real price).
   - Realistic monthly commitment (time or money).
   - Deadline/target date — ONLY if they haven't already stated one.
   - Start date: "When do you want to start? I'll calculate the timeline from your start date to the end date."
   - Preferred time for notifications (MANDATORY for all goals): "What time of day should I send you reminders? (e.g., 9am, 6pm, morning, evening)"
   - DAILY-ACTION GOALS ONLY (practice, reading, exercise, learning): "Reminders on weekends too, or just weekdays?"
   - BUDGET (ask for almost all goals — books, courses, tools, classes all cost money): "Do you have a budget for things like books, courses, or tools? A rough idea helps — or I can stick to free resources only." Skip ONLY for pure save/pay-off-money goals. Use the answer to filter resources strictly: no budget / no answer / vague / question not asked → FREE resources only (never recommend paid books, courses, or tools). A stated budget → tailor to fit it.
   - LOCAL RESOURCES (only for goals where in-person options genuinely help — music lessons, clubs, dance, martial arts, classes, etc.): ${userCity ? `the user's city is ${userCity}; ask if they want local resources included.` : `ask "What city are you in? (optional — I can include local classes, clubs, and meetups near you)".`} Ask this once only.

DO NOT draft a plan until the user has replied at least TWICE with substantive answers. If they've replied only once, ask follow-ups on anything vague.

PHASE 2 — DRAFT THE FULL PLAN (once enough info is gathered):
Once the user has answered your Phase 1 questions, produce the COMPLETE plan in THIS response. Never defer ("I'll draft it next", "stay tuned", "coming up") — the plan appears now. Response structure, all in one message:
  1. A 2–3 sentence summary of what you heard.
  2. Immediately below it, the full month-by-month markdown plan (every month, no abbreviations).
  3. Then a direct approval question ("Does this plan look good? Ready to save it?").

${monthsRule}

MANDATORY MARKDOWN FORMAT — repeat this exact structure for every month the timeline requires (3-month plan = 3 months, 7-month plan = 7 months — never add or drop months). Each week has 3–6 detailed bullets (see WEEK DEPTH below), NOT a single line:

**Month 1 — [Descriptive Title]**
**Week 1**
- [The concrete action for the week — exact chapters / exercises with sets+reps / specific vocab set]
- Focus on: [what to notice this week, tied to the real content — e.g. the actual theme or technique in play]
- Reflect: [1–2 pointed questions that make them engage with the material]
- Activity: [a journaling / practice / application / discussion task]
- Resource: [optional, a real link per the link rules]

**Week 2**
- [concrete action]
- Focus on: [...]
- Reflect: [...]
- Activity: [...]

**Week 3**
- [concrete action]
- Focus on: [...]
- Reflect: [...]
- Activity: [...]

**Week 4**
- [concrete action]
- Focus on: [...]
- Reflect: [...]
- Activity: [...]

**Month 2 — [Descriptive Title]**
**Week 1**
- ...

(Continue this exact pattern for EVERY month, generated inline now — every month titled "**Month N — Title**" with all 4 weeks, and every week filled with the detailed bullets shown above.)

${NO_GROUPING_RULE}

GRANULARITY — match the goal type:
- DAILY-PRACTICE goals (instrument, language, fitness, coding, drawing): break each week into daily tasks; mark is_daily_habit: true.
- MILESTONE/PROJECT goals (finance, career, business, travel): 2–4 specific action steps per week.
- SOFT/PERSONAL-GROWTH goals (confidence, anxiety, boundaries, mindset, relationships): 3–7 gentle reflection prompts or practice goals per week, no rigid scheduling.

SPECIFICITY (every goal type): Every step title and month title must be specific, actionable, and grounded in what the user told you — their preferences, experience, equipment, and schedule. Generic filler is a critical failure: never "workout today", "practice today", "Week 3 training", "study session", "do your goal". Instead name real content — fitness: "3x10 goblet squats + 20 min incline walk"; language: "past-tense conjugations — 30 irregular verbs"; nutrition: "swap breakfast to Greek yogurt + berries"; skill-building: "build a CSS flexbox layout from scratch".

${WEEK_DETAIL_RULE}

RESOURCES: Include concrete resources where they add value (videos, books, apps, free tools, and — if the user opted in — specific local venues/clubs${userCity ? ` in ${userCity}` : ''}). Any resource, link, book, app, or tool mentioned during the conversation MUST appear in the relevant step. Follow the resource-link rules below.

TIMELINE & START DATE: Build the plan to fit the stated timeline AND start date. "Start immediately/now" → count months from today (${today}). A future start date (e.g. "June 1st") → count months from THAT date, and name phases from it (Month 1 = first month after the start date). Example: "start June 1, done Dec 31" → 7 months, Month 1 (June) through Month 7 (December).

NEVER ask follow-up questions mid-plan ("do these resonate?"). Commit to the full plan using everything the user told you.

APPROVAL: When the user approves ("looks great", "perfect", "save it", "let's do it", "yes", "looks good"), FIRST verify the plan in the conversation covers every month from Month 1 to the last with no gaps. If it's incomplete, present the missing months instead. Only when the complete plan has been presented, start your response with EXACTLY "PLAN_APPROVED" then a warm 2–3 sentence summary, then add: "Remember, this plan is a living document. Come back anytime to adjust the difficulty, add resources, extend the timeline, skip ahead if you're crushing it, or restructure a phase. Just tell me what's working and what isn't — I'll update your plan instantly."

═══ EDITING AN EXISTING GOAL (user says too easy/hard, wants more resources, skip ahead, restructure, add a week, etc.) ═══
- If the user has exactly ONE goal, assume they mean it — never ask which. Only ask if they have 2+ goals AND it's ambiguous.
- Propose SPECIFIC changes immediately — no questions first. Show the steps/changes clearly. End with "Say 'yes' to save these changes." or "Want me to apply this?"
- When the user approves, start your response with EXACTLY "EDIT_APPROVED:<goal_id>" using the actual ID from the list above.
- Coaching signals: "too easy" → accelerate/harder; "too hard/overwhelmed" → smaller steps, slower, more beginner resources; "no time" → extend timeline or reduce weekly load; "finished early" → advanced content or a new goal; "need resources" → add specific links/books/videos.

${READING_GOAL_RULE}

${TIME_MAPPING_RULE}

${RESOURCE_LINK_RULE}

${NO_FABRICATION_RULE}

${NO_REPEAT_RULE}

${RESPECT_CONSTRAINTS_RULE}

Always be specific, warm, encouraging, and treat the plan as a living document that evolves with the user.`;
    }

    // ── Helper: one chat turn with optional web_search (single tool round) ─────
    const chatWithTools = async (chatMessages) => {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: chatMessages,
        tools: [WEB_SEARCH_TOOL],
        tool_choice: "auto",
        max_tokens: 16000
      });
      const first = completion.choices[0];
      if (first.finish_reason === 'tool_calls' && first.message.tool_calls?.length > 0) {
        const toolMessages = [...chatMessages, first.message];
        for (const call of first.message.tool_calls) {
          const query = JSON.parse(call.function.arguments).query;
          let searchResult = '';
          try {
            const searchRes = await base44.integrations.Core.InvokeLLM({
              prompt: `Search the web and return a concise factual summary about: "${query}". Include specific facts, numbers, resources, and current best practices. Be specific and accurate.`,
              add_context_from_internet: true
            });
            searchResult = typeof searchRes === 'string' ? searchRes : (searchRes?.text || searchRes?.content || JSON.stringify(searchRes));
          } catch (_) {
            searchResult = 'Search unavailable — use best available knowledge.';
          }
          toolMessages.push({ role: "tool", tool_call_id: call.id, content: searchResult });
        }
        const followUp = await openai.chat.completions.create({ model: "gpt-4o", messages: toolMessages, max_tokens: 16000 });
        return followUp.choices[0].message.content || '';
      }
      return first.message.content || '';
    };

    // ── Helper: guarantee a plan draft is fully expanded into SEPARATE months ──
    // gpt-4o cannot fit a long plan in one 16k response, so it tends to collapse
    // later months into a grouped range ("Months 4-15: titles TBD"). We never want a
    // range in the final plan — every month must stand on its own with full structure.
    //
    // Each pass keeps every month already written in full, cuts the draft right after
    // the last complete month (dropping the grouped tail), and asks the model to write
    // the remaining months out separately. It loops until the plan is genuinely
    // complete. Two outcomes are guaranteed, and ONLY these two:
    //   1. (almost always) Every month 1..N is present as its own full section — no
    //      ranges, no gaps.
    //   2. (rare, only if the model repeatedly fails to continue) The real months it
    //      DID write are kept, any leftover range is removed, and an explicit plain-
    //      English note tells the user which months still need writing and how to
    //      finish them. Never a surviving range, never a silent gap.
    const HARD_CAP_MONTHS = 36; // guard against a stray large number read as a month count
    const expandPlan = async (text) => {
      let stalls = 0;
      for (let attempt = 0; attempt < 16; attempt++) {
        const a = analyzePlan(text);
        const expected = Math.min(HARD_CAP_MONTHS, Math.max(planMonths || 0, a.maxMentioned));

        // Fully written (months 1..expected all present with real content) and no
        // grouped range or deferral left — done.
        if (a.contig >= expected && !a.groupingPresent) break;

        const from = a.contig + 1;
        if (from > expected) break; // nothing genuinely missing

        // Keep everything through the end of the last complete month (preserves the
        // intro + every fully-written month, and drops the grouped tail). If even
        // Month 1 isn't real, keep just the intro and rebuild from Month 1.
        const cut = a.contig >= 1
          ? a.sectionEnd(a.headerIdx[a.contig])
          : (a.firstHeaderIdx >= 0 ? a.firstHeaderIdx : a.lines.length);
        const head = a.lines.slice(0, cut).join('\n');
        const target = Math.min(HARD_CAP_MONTHS, Math.max(expected, a.maxPresent));

        const addition = await chatWithTools([
          { role: "system", content: systemPrompt },
          ...messages,
          { role: "assistant", content: head },
          {
            role: "user",
            content: `Continue building this exact plan. Do NOT repeat, rewrite, or alter any month you already wrote — Month 1 through Month ${a.contig} are done. Now write Month ${from} through Month ${target}, EACH as its own separate section titled "**Month N — Title**" with all 4 weeks (Week 1–Week 4), in the same detailed format and depth as the earlier months. Every week must be detailed, not a one-liner: the concrete action PLUS what to focus on (tied to the actual content/themes), a reflection/thinking prompt, and a practice/application activity. NEVER write a month range like "Month ${from}-${target}", NEVER write "TBD"/"to be determined"/"I'll continue" — write every single month out in full and separately. Output ONLY Month ${from} through Month ${target}.`
          }
        ]);

        // Only commit if the continuation ACTUALLY produced at least one new written-out
        // month. An empty or junk continuation leaves the draft untouched (so we never
        // delete a grouped month and replace it with nothing); after a few consecutive
        // stalls we stop and let the final pass below handle it honestly.
        const candidate = (addition && addition.trim())
          ? head.replace(/\s+$/, '') + '\n\n' + addition.trim()
          : null;
        if (candidate && analyzePlan(candidate).contig > a.contig) {
          text = candidate;
          stalls = 0;
        } else if (++stalls >= 3) {
          break;
        }
      }

      // Final guarantee — the output is one of the two acceptable states, never a
      // surviving range and never a silent gap.
      const fin = analyzePlan(text);
      const finExpected = Math.min(HARD_CAP_MONTHS, Math.max(planMonths || 0, fin.maxMentioned));
      if (fin.contig < finExpected || fin.rangePresent) {
        // Trim anything after the last fully-written month (this removes any leftover
        // grouped range), then either close cleanly (if it turned out complete) or tell
        // the user exactly what's left to write.
        const cut = fin.contig >= 1
          ? fin.sectionEnd(fin.headerIdx[fin.contig])
          : (fin.firstHeaderIdx >= 0 ? fin.firstHeaderIdx : fin.lines.length);
        const head = fin.lines.slice(0, cut).join('\n').replace(/\s+$/, '');
        if (fin.contig >= finExpected) {
          text = head + '\n\nThat completes the full plan — does this look good and are you ready to save it?';
        } else {
          const wrote = fin.contig >= 1 ? `I've written Month 1 through Month ${fin.contig} above in full. ` : '';
          text = head + `\n\n${wrote}I still owe you Month ${fin.contig + 1} onward — each as its own separate month with the full week-by-week structure (no grouping). Reply "continue" and I'll write them out now.`;
        }
      } else if (!/\?\s*$/.test(text.trim())) {
        text = text.trim() + '\n\nThat completes the full plan — does this look good and are you ready to save it?';
      }
      return text;
    };

    // ── Generate the assistant turn ───────────────────────────────────────────
    let finalReply = await chatWithTools([{ role: "system", content: systemPrompt }, ...messages]);

    // If this turn is a plan draft (has month headers) and not an approval, make
    // sure every month is written out in full.
    const isApproval = /\b(?:PLAN_APPROVED|EDIT_APPROVED)\b/i.test(finalReply);
    const looksLikePlan = /^\s*#{0,4}\s*\*{0,2}\s*Month\s+\d+/im.test(finalReply);
    if (!isApproval && looksLikePlan) {
      finalReply = await expandPlan(finalReply);
    }

    // ── Parse the response type ───────────────────────────────────────────────
    if (isEditSession && finalReply.includes('EDIT_APPROVED')) {
      return Response.json({ message: finalReply.replace(/EDIT_APPROVED\s*/i, '').trim(), action: 'edit_approved', goal_id });
    }
    if (finalReply.includes('PLAN_APPROVED')) {
      return Response.json({ message: finalReply.replace(/PLAN_APPROVED\s*/i, '').trim(), action: 'plan_proposed' });
    }
    const editMatch = finalReply.match(/EDIT_APPROVED:([^\s]+)/i);
    if (editMatch) {
      const editGoalId = editMatch[1];
      return Response.json({ message: finalReply.replace(/EDIT_APPROVED:[^\s]+\s*/i, '').trim(), action: 'edit_approved', goal_id: editGoalId });
    }

    // Parse month titles from the chat response text.
    // Handles "Month 1 – Title", "**Month 1** – *Title*", and "Month 1" followed
    // by the title on the next non-empty line.
    const chatMonthTitles = {};
    const replyLines = finalReply.split('\n');
    const isDateOnly = (t) => /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i.test(t);
    const stripFormatting = (s) => s.replace(/\*+/g, '').replace(/^[#>\s-]+/, '').trim();
    const seenMonthNumbers = new Set();

    for (let li = 0; li < replyLines.length; li++) {
      const cleanLine = stripFormatting(replyLines[li]);

      // Format 1: "Month 1 – Title" on the same line.
      const inlineMatch = cleanLine.match(/^Month\s+(\d+)\s*[–—:\-]+\s*(.+)/i);
      if (inlineMatch) {
        const num = parseInt(inlineMatch[1], 10);
        const title = stripFormatting(inlineMatch[2]);
        if (title && !isDateOnly(title) && title.length <= 120 && !chatMonthTitles[num]) {
          chatMonthTitles[num] = title;
          seenMonthNumbers.add(num);
        }
        continue;
      }

      // Format 2: "Month 1" alone, title on a following non-empty line.
      const monthNumMatch = cleanLine.match(/^Month\s+(\d+)$/i);
      if (monthNumMatch) {
        const num = parseInt(monthNumMatch[1], 10);
        for (let nli = li + 1; nli < replyLines.length && nli < li + 6; nli++) {
          const candidate = stripFormatting(replyLines[nli]);
          if (!candidate) continue;
          const isWeekLine = /^Week\s+\d+/i.test(candidate);
          const isMonthLine = /^Month\s+\d+/i.test(candidate);
          const isTaskBullet = /^\d+\.\s/.test(candidate) && candidate.length < 60;
          const isGenericPlaceholder = /continue\s+to\s+select|will\s+continue|for\s+these\s+months/i.test(candidate);
          if (!isWeekLine && !isMonthLine && !isDateOnly(candidate) && !isGenericPlaceholder && candidate.length <= 150 && !isTaskBullet) {
            if (!chatMonthTitles[num]) {
              chatMonthTitles[num] = candidate;
              seenMonthNumbers.add(num);
            }
          }
          break;
        }
      }
    }

    return Response.json({ message: finalReply, action: 'chat', month_titles: chatMonthTitles });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
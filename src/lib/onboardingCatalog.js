/**
 * USR Onboarding Catalog — the canonical first-90-days playbook, in data.
 *
 * This is the SOURCE OF TRUTH for the onboarding checklist + email/text copy.
 * The Onboarding page renders straight from here, then merges any per-task edits
 * saved in Supabase (onboarding_templates) on top — so the page always works even
 * before the migration is run, and admins can finalize copy live without a deploy.
 *
 * Built 1:1 from the "Onboarding Tasks" doc (Sales→CS through 90-day QBR).
 *
 * Task kinds
 *   - 'action'      Operational step. Just check it off (no compose). Gates the stage.
 *   - 'email'       Single email/text. Opens the compose modal. Gates the stage.
 *   - 'auto_email'  Has variants; the page auto-picks the right one from data
 *                   (selector: 'recap' for TTV, 'transition' for activity emails).
 *                   The CSM can override the pick. 'recurring: true' variants
 *                   (the weekly 30-60 / 60-90 sends) do NOT gate the stage.
 *
 * Tokens (filled at render): {owner} {lab} {csm} {director} {score} {athletes}
 *   {day} {logins} {datapoints} {edu_link}
 */

// ─── The 8-step onboarding journey ────────────────────────────────────────────
export const OB_STAGES = [
  { key: 'handoff',   short: 'Hand-off',   label: 'Sales Hand-off',  d0: 0  },
  { key: 'kickoff',   short: 'Kick-off',   label: 'Kick-off Call',   d0: 1  },
  { key: 'ttv',       short: 'TTV Sprint', label: 'TTV Sprint',      d0: 3  },
  { key: 'impl',      short: 'Impl. Call', label: 'Implementation',  d0: 10 },
  { key: 'checkin30', short: '30-Day',     label: '30-Day Check-in', d0: 14 },
  { key: 'day3060',   short: '30–60',      label: 'Days 30–60',      d0: 30 },
  { key: 'day6090',   short: '60–90',      label: 'Days 60–90',      d0: 60 },
  { key: 'qbr',       short: 'QBR',        label: '90-Day QBR',      d0: 90 },
]
export const OB_INDEX = Object.fromEntries(OB_STAGES.map((s, i) => [s.key, i]))
export const OB_LABEL = Object.fromEntries(OB_STAGES.map(s => [s.key, s.label]))

export const STATUS_COLORS = { green: '#1DB271', yellow: '#FFD900', orange: '#F2810E', red: '#EC3642', unknown: '#C9CBCE' }

// Education resource referenced explicitly in the onboarding doc.
export const EDU_WEEK1 = 'https://app.universalspeedrating.com/education/week-1-why-collect-data'

// TTV rule: 5 session recaps inside a 7-day window from kick-off.
export const TTV_TARGET = 5
export const TTV_WINDOW_DAYS = 7

// Tokens admins can drop into any template (shown in the editor helper).
export const TOKENS = [
  { t: '{owner}',      d: "Contact's first name" },
  { t: '{lab}',        d: 'Customer / Speed Lab name' },
  { t: '{csm}',        d: 'You (logged-in CSM)' },
  { t: '{director}',   d: 'Assigned Speed Lab Director' },
  { t: '{score}',      d: 'Latest health score (0–9)' },
  { t: '{athletes}',   d: 'Athletes added (30d)' },
  { t: '{day}',        d: 'Day of 90' },
  { t: '{logins}',     d: 'Logins this week' },
  { t: '{datapoints}', d: 'Data points this week' },
  { t: '{edu_link}',   d: 'Week-1 education link' },
]

// ─── Activity-email variants (Days 30–60 & 60–90) ─────────────────────────────
// Keyed by week-over-week health-color transition. The page picks the matching
// variant automatically. Copy differs slightly by window (60–90 nods to the QBR).
const ACTIVITY_3060 = {
  selectorLabel: 'last week → this week health color',
  variants: {
    green_streak: { label: 'Green streak', tone: 'celebrate',
      subject: 'You\'re on a roll, {lab} 🔥',
      body: `Hi {owner},\n\n{lab} is stacking green weeks — {logins} logins and {datapoints} data points this week, sitting at a {score}/9. This is exactly what momentum looks like.\n\nKeep the rhythm: every week your athletes log, their scores get sharper and the culture gets louder. Tap Share on a PR this week and let your athletes see themselves on the board — nothing fuels a room like that.\n\nProud of the work.\n— {csm}` },
    yellow_green: { label: 'Yellow → Green', tone: 'celebrate',
      subject: 'That\'s the turn, {owner} — {lab} is climbing',
      body: `Hi {owner},\n\nLove this — {lab} jumped back to green this week ({logins} logins, {datapoints} data points). That's the climb. The hardest part is stringing weeks together, and you just did.\n\nLet's make it two in a row. Same cadence next week and you'll feel the scores move.\n— {csm}` },
    green_yellow: { label: 'Green → Yellow', tone: 'nudge',
      subject: 'Quick check-in on {lab}',
      body: `Hi {owner},\n\n{lab} dipped a little this week ({logins} logins, {datapoints} data points) after a strong run. Totally normal — weeks get busy. The fix is small: get a couple of sessions logged in the next few days and you're right back in green.\n\nAnything getting in the way I can clear? Just reply.\n— {csm}` },
    yellow_yellow: { label: 'Yellow → Yellow', tone: 'nudge',
      subject: 'Let\'s get {lab} back to green',
      body: `Hi {owner},\n\nTwo steady-but-quiet weeks for {lab} ({logins} logins, {datapoints} data points). You're in the platform — let's turn that into a rhythm your staff can feel.\n\nPick one fixed slot this week to rate athletes and log it. One consistent session beats five scattered ones. I'm here to help you build it.\n— {csm}` },
    yellow_orange: { label: 'Yellow → Orange', tone: 'concern',
      subject: 'Checking in on {lab} — everything okay?',
      body: `Hi {owner},\n\nActivity slipped this week for {lab} ({logins} logins, {datapoints} data points) and I want to get ahead of it. You invested in USR to move athletes faster, and the data is what makes that real.\n\nCan we grab 15 minutes this week? I'll help you set a cadence that fits your actual schedule so this runs without you thinking about it.\n— {csm}` },
    orange_orange: { label: 'Orange → Orange', tone: 'concern',
      subject: 'I don\'t want {lab} to lose this',
      body: `Hi {owner},\n\nTwo light weeks in a row for {lab} — I'd be doing my job poorly if I didn't reach out. You've got the platform and the athletes; we just need to get reps flowing again.\n\nReply with a time and I'll jump on a quick call. We'll make logging dead-simple and get your scores moving.\n— {csm}` },
    orange_red: { label: 'Orange → Red', tone: 'rescue',
      subject: 'Let\'s reset {lab} together',
      body: `Hi {owner},\n\n{lab} has gone quiet and I want to help before it stalls out. No guilt here — let's just reset.\n\nGive me 20 minutes this week. We'll strip it back to the one workflow that matters, get a session logged live together, and rebuild from there. You bought USR to win; I'm going to make sure you do.\n— {csm}` },
    red_red: { label: 'Red → Red', tone: 'rescue',
      subject: 'I\'m not letting {lab} slip',
      body: `Hi {owner},\n\nIt's been a couple of silent weeks for {lab} and you matter too much for me to let it ride. Whatever's in the way — time, staff, setup — we can solve it.\n\nCan you give me a time this week, even 15 minutes? I'll come with a plan to make USR effortless for your team. Let's get back to building.\n— {csm}` },
  },
}

const ACTIVITY_6090 = {
  selectorLabel: 'last week → this week health color',
  variants: {
    green_streak: { label: 'Green streak', tone: 'celebrate',
      subject: 'Heading into your QBR strong, {lab}',
      body: `Hi {owner},\n\nAnother green week for {lab} ({logins} logins, {datapoints} data points, {score}/9). You're walking into your 90-day QBR with real proof — and that makes our next-quarter game plan a fun conversation.\n\nKeep stacking weeks. I'll bring the results pulled straight from your data.\n— {csm}` },
    yellow_green: { label: 'Yellow → Green', tone: 'celebrate',
      subject: 'Great timing, {owner} — {lab} is back to green',
      body: `Hi {owner},\n\n{lab} climbed back to green this week ({logins} logins, {datapoints} data points) right as we approach your 90-day mark. Perfect timing — momentum into a QBR is everything.\n\nLet's keep it rolling and turn it into a strong quarter-two plan.\n— {csm}` },
    green_yellow: { label: 'Green → Yellow', tone: 'nudge',
      subject: 'Small dip before your QBR — easy fix',
      body: `Hi {owner},\n\n{lab} eased off a touch this week ({logins} logins, {datapoints} data points). With your QBR around the corner, let's finish the 90 days strong — a couple of logged sessions this week and you're back in green.\n\nWant me to tee anything up before we meet? Just say the word.\n— {csm}` },
    yellow_yellow: { label: 'Yellow → Yellow', tone: 'nudge',
      subject: 'Let\'s finish your first 90 days strong',
      body: `Hi {owner},\n\nA couple of quiet weeks for {lab} ({logins} logins, {datapoints} data points) as we close in on your QBR. Let's end the onboarding chapter on an upswing.\n\nLock one fixed session slot this week — I'll make sure the QBR shows the climb, not the plateau.\n— {csm}` },
    yellow_orange: { label: 'Yellow → Orange', tone: 'concern',
      subject: 'Before your QBR — let\'s reconnect on {lab}',
      body: `Hi {owner},\n\nActivity dipped this week for {lab} ({logins} logins, {datapoints} data points), and I want your 90-day QBR to be a celebration, not a catch-up.\n\nGrab 15 minutes with me this week. We'll reset the cadence so you head into quarter two with momentum.\n— {csm}` },
    orange_orange: { label: 'Orange → Orange', tone: 'concern',
      subject: 'Let\'s turn {lab} around before the QBR',
      body: `Hi {owner},\n\nTwo light weeks for {lab} with your QBR approaching. I don't want to walk into that meeting without showing you wins — so let's create some now.\n\nReply with a time and we'll get reps flowing again this week.\n— {csm}` },
    orange_red: { label: 'Orange → Red', tone: 'rescue',
      subject: 'Let\'s reset {lab} ahead of your QBR',
      body: `Hi {owner},\n\n{lab} has gone quiet right before your 90-day mark. Let's reset together — no guilt, just a plan.\n\nGive me 20 minutes this week. We'll rebuild the one workflow that matters and make your QBR a real game-planning session for the quarter ahead.\n— {csm}` },
    red_red: { label: 'Red → Red', tone: 'rescue',
      subject: 'I want your QBR to be a comeback story',
      body: `Hi {owner},\n\nIt's been a couple of silent weeks for {lab} as we reach 90 days. I'm not letting it end there — whatever's in the way, we can solve it.\n\nCan you give me 15 minutes this week? We'll make USR effortless again and set up a quarter-two plan worth getting excited about.\n— {csm}` },
  },
}

// ─── The catalog ──────────────────────────────────────────────────────────────
export const CATALOG = {
  // ── Sales → CS hand-off ─────────────────────────────────────────────────────
  handoff: [
    { key: 'respond_sales', kind: 'action', priority: 'high',
      label: 'Reply to the sales hand-off', channel: 'Internal',
      reason: 'Acknowledge the hand-off from sales within 24h so the customer never feels a gap.' },
    { key: 'update_hubspot_props', kind: 'action', priority: 'high',
      label: 'Update HubSpot deal properties', channel: 'HubSpot',
      reason: 'Set ARR, contract end date, customer segment, product, Speed Lab level, Speed Lab Director, hardware, payment processor, payment date, and payment status. The dashboard reads from these.' },
    { key: 'copy_survey_notes', kind: 'action', priority: 'medium',
      label: 'Copy survey responses into HubSpot notes', channel: 'HubSpot',
      reason: 'Paste their onboarding survey answers into the deal notes so the whole team has context. (AI automation for this is on the roadmap.)' },
    { key: 'welcome', kind: 'email', priority: 'high', channel: 'Email',
      label: 'Welcome + book kick-off',
      reason: 'First contact within 24h of hand-off — introduce yourself and book the kick-off call.',
      subject: "Welcome to USR, {owner} — let's get {lab} rolling",
      body: `Hi {owner},\n\nI'm {csm}, your onboarding lead at USR — thrilled to get {lab} up and running. Over your first 90 days my whole job is getting you to value fast: athletes rated, sessions logged, and a weekly rhythm your staff loves.\n\nFirst step is a quick 30-minute kick-off call. Grab whatever works this week and we'll map the plan together.\n\nTrain smarter, play faster.\n— {csm}, USR` },
    { key: 'launch_day_kit', kind: 'email', priority: 'high', channel: 'Email',
      label: 'Launch Day Kit', note: 'USR Speed Lab product only · send after first payment confirms',
      reason: 'After the first payment confirms, announce the partnership, nudge the survey if it\'s not done, and build excitement for kick-off.',
      subject: "It's official — welcome to the USR family, {lab} 🎉",
      body: `Hi {owner},\n\nYour first payment is in and it's official: {lab} is live with USR. Welcome to the family.\n\nHere's your Launch Day Kit to hit the ground running:\n- Your USR platform is ready — log in and look around\n- If you haven't finished the onboarding survey yet, knock it out here so I can tailor your plan: {edu_link}\n- Kick-off call next: that's where we map your first 90 days together\n\nWe're fired up to help {lab} get faster, measurably. Let's go.\n— {csm}, USR` },
  ],

  // ── Kick-off ────────────────────────────────────────────────────────────────
  kickoff: [
    { key: 'kickoff_reminder', kind: 'email', priority: 'high', channel: 'Email',
      label: 'Kick-off reminder (day-of)',
      reason: 'Morning-of reminder so the call starts ready.',
      subject: 'Today: your USR kick-off call',
      body: `Hi {owner},\n\nLooking forward to our kick-off today. Two minutes of prep makes it count:\n- Have 2-3 athletes in mind to rate live\n- Know your single biggest goal for the next 90 days\n- Loop in any staff who'll be in USR day-to-day\n\nSee you soon.\n— {csm}` },
    { key: 'kickoff_call', kind: 'action', priority: 'high', channel: 'Call',
      label: 'Run the kick-off call',
      reason: 'Map the 90-day plan, rate an athlete live, and set the week-one assignment. Completing kick-off starts the 7-day TTV clock.' },
    { key: 'kickoff_recap', kind: 'email', priority: 'medium', channel: 'Email',
      label: 'Kick-off recap + first assignment',
      reason: 'Send the recap and first-week assignment right after kick-off.',
      subject: 'Recap + your first week with USR',
      body: `Hi {owner},\n\nGreat kick-off — fired up to work with {lab}. Your move this week: get athletes into the platform and log your first sessions. That's the fastest way to feel USR's value — your scores start moving and athletes see it immediately.\n\nI'll be watching your progress and cheering you on. Anything you need, just reply.\n— {csm}` },
  ],

  // ── TTV Sprint ──────────────────────────────────────────────────────────────
  ttv: [
    { key: 'monitor_recaps', kind: 'action', priority: 'high', channel: 'Platform',
      label: 'Monitor session recaps daily',
      reason: 'Watch recap counts daily through the 7-day window — the goal is 5 session recaps before the implementation call.' },
    { key: 'ttv_checkin', kind: 'auto_email', selector: 'recap', priority: 'high', channel: 'Email',
      label: 'TTV check-in (auto-picks by recap count)',
      reason: '3–4 days before the next scheduled call, send the check-in that matches their recap count.',
      selectorLabel: 'session recaps completed',
      variants: {
        five_plus: { label: '5+ recaps — on track', tone: 'celebrate', min: 5,
          subject: 'You crushed week one, {owner} 🔥',
          body: `Hi {owner},\n\nGreat work — {lab} blew past the first goal of 5 session recaps. That's exactly the habit that makes USR pay off.\n\nLooking forward to setting our next goals together on our call. Come ready to talk about what you want the next 30 days to deliver.\n— {csm}` },
        three_plus: { label: '3–4 recaps — almost there', tone: 'nudge', min: 3,
          subject: "You're right on track, {owner}",
          body: `Hi {owner},\n\nNice momentum — {lab} is most of the way to our first goal of 5 session recaps before our call. A couple more this week and you're there.\n\nIf you want a quick refresher on why this data matters so much, this is a great 3-minute watch: {edu_link}\n\nYou've got this. See you soon.\n— {csm}` },
        zero_two: { label: '0–2 recaps — needs a nudge', tone: 'concern', min: 0,
          subject: 'Quick check-in before our call, {owner}',
          body: `Hi {owner},\n\nI noticed {lab} has only logged a couple of session recaps so far. No worries at all — I just want to make sure nothing's getting in the way before our call.\n\nIs there a roadblock I can clear? Here's a quick reminder of why these first recaps matter so much: {edu_link}\n\nLet's get back on track to hit 5 before we talk — even a couple of sessions this week makes the difference. Reply anytime and I'll jump in.\n— {csm}` },
      } },
  ],

  // ── Implementation ──────────────────────────────────────────────────────────
  impl: [
    { key: 'impl_reminder', kind: 'email', priority: 'high', channel: 'Email',
      label: 'Implementation reminder (day-of)',
      reason: 'Morning-of reminder for the implementation call.',
      subject: 'Today: building {lab} to run on rails',
      body: `Hi {owner},\n\nLooking forward to our implementation call today. We'll turn your week-one momentum into a system that runs itself — weekly cadence, athlete groups, and reporting your athletes and families can see.\n\nSee you soon.\n— {csm}` },
    { key: 'impl_call', kind: 'action', priority: 'high', channel: 'Call',
      label: 'Run the implementation call',
      reason: 'Lock the weekly evaluation cadence, set up athlete groups, and map reporting.' },
    { key: 'set_30_goals', kind: 'action', priority: 'high', channel: 'Call',
      label: 'Set 30-day goals on the call',
      reason: 'Agree on concrete 30-day goals together so the next check-in has a scoreboard.' },
    { key: 'schedule_30_checkin', kind: 'action', priority: 'high', channel: 'Calendar',
      label: 'Schedule the 30-day check-in',
      reason: 'Get the 30-day check-in on the calendar before you hang up.' },
    { key: 'impl_recap', kind: 'email', priority: 'medium', channel: 'Email',
      label: 'Implementation recap + resources',
      reason: 'Send the recap with the resources that match their 30-day goals (link to in-platform education where you can).',
      subject: "Your implementation plan + what's next",
      body: `Hi {owner},\n\nAwesome session — {lab} is set up to run on rails. Between now and our 30-day check-in, keep the weekly cadence going: logins, sessions, and data every week. I'll be watching your activity and cheering you on.\n\nHere are the resources tied to the goals we set:\n- {edu_link}\n\nAt the 30-day mark I'll bring results pulled from your own data.\n— {csm}` },
    { key: 'director_intro', kind: 'email', priority: 'high', channel: 'Email',
      label: 'Speed Lab Director introduction', note: 'Send same day as the implementation recap, as its own email',
      reason: 'Introduce them to their Speed Lab Director — separate from the recap, same day, so the relationship starts warm.',
      subject: 'Meet {director}, your Speed Lab Director',
      body: `Hi {owner},\n\nWant to put you in great hands: meet {director}, your USR Speed Lab Director. {director} works hands-on with labs like {lab} on the coaching and speed side — the perfect person to lean on as you build.\n\n{director}, meet {owner} from {lab} — they're off to a strong start and I know you two will hit it off. I'll let you take it from here on a time to connect.\n\nExcited for this.\n— {csm}` },
  ],

  // ── 30-Day Check-in / 30-day goals window ─────────────────────────────────────
  checkin30: [
    { key: 'monitor_activity_30', kind: 'action', priority: 'high', channel: 'Platform',
      label: 'Monitor activity weekly (logins, athletes, data points)',
      reason: 'Track logins, athletes added, and data points each week so you can coach to the numbers.' },
    { key: 'week3_activity_email', kind: 'email', priority: 'medium', channel: 'Email',
      label: 'Week-3 activity update + recommendations',
      reason: 'Around week 3, send their numbers with a recommendation on how to use the data — and prompt them to share wins.',
      subject: 'Three weeks in — here\'s how {lab} is tracking',
      body: `Hi {owner},\n\nThree weeks in, here's where {lab} stands:\n- Logins this week: {logins}\n- Athletes added: {athletes}\n- Data points this week: {datapoints}\n\nMy recommendation: pick your top few athletes and turn their recent gains into a moment — tap Share on a PR and post it. It builds a competitive culture fast and athletes love seeing themselves recognized.\n\nWe're closing in on your 30-day check-in. Keep it up — you're building real momentum.\n— {csm}` },
    { key: 'monitor_coursework', kind: 'action', priority: 'low', channel: 'Platform',
      label: 'Monitor education coursework',
      reason: 'Check what education they\'ve started or completed so you can recommend the next step.' },
    { key: 'director_connection_check', kind: 'email', priority: 'medium', channel: 'Email',
      label: 'Speed Lab Director connection check', note: 'Send ~1 week after implementation',
      reason: 'A week after implementation, check whether they\'ve connected with their Speed Lab Director yet.',
      subject: 'Did you and {director} get a chance to connect?',
      body: `Hi {owner},\n\nQuick check-in: were you able to connect with {director}, your Speed Lab Director? They're a fantastic resource for the coaching side of {lab}, and I want to make sure that relationship gets rolling.\n\nIf you haven't yet, I'm happy to re-introduce or help find a time. Just reply.\n— {csm}` },
    { key: 'checkin30_reminder', kind: 'email', priority: 'high', channel: 'Email',
      label: '30-day check-in reminder (day-of)',
      reason: 'Morning-of reminder for the 30-day check-in.',
      subject: 'Today: your 30-day check-in',
      body: `Hi {owner},\n\nLooking forward to our 30-day check-in today. We'll look at {lab}'s results so far, celebrate the wins, and set the plan for the next 30 days. See you soon.\n— {csm}` },
    { key: 'checkin30', kind: 'email', priority: 'high', channel: 'Email',
      label: '30-day check-in invite',
      reason: '30 days in — celebrate wins and set the 30-60 plan.',
      subject: "30 days in — let's look at {lab}'s results",
      body: `Hi {owner},\n\nHard to believe it's already been 30 days. {lab} is at a {score}/9 health score with {athletes} athletes rated — real momentum.\n\nOn our check-in we'll celebrate the wins and set the plan for days 30-60. Proud of the work so far.\n— {csm}` },
    { key: 'checkin30_recap', kind: 'email', priority: 'medium', channel: 'Email',
      label: '30-day check-in recap',
      reason: 'Send the recap after the 30-day check-in with the 30-60 plan you agreed on.',
      subject: 'Recap: your next 30 days with USR',
      body: `Hi {owner},\n\nGreat check-in. Here's the plan we set for days 30-60:\n- Keep the weekly cadence (logins, sessions, data)\n- Grow the athlete groups we discussed\n- Use the data to coach and to celebrate wins publicly\n\nI'll keep watching your activity and check in along the way. Onward.\n— {csm}` },
    { key: 'social_graphic_30', kind: 'action', priority: 'low', channel: 'Graphic',
      label: 'Generate + share a social graphic', note: 'Use the USR image-gen workflow with their platform activity',
      reason: 'Turn their first-month activity into a branded social graphic and send it to them to post. (Generate via the USR image-gen workflow.)' },
  ],

  // ── Days 30–60 (weekly activity emails) ──────────────────────────────────────
  day3060: [
    { key: 'monitor_activity_3060', kind: 'action', priority: 'high', channel: 'Platform',
      label: 'Monitor activity weekly',
      reason: 'Watch the weekly health color and metrics so the right activity email goes out each week.' },
    { key: 'activity_3060', kind: 'auto_email', selector: 'transition', recurring: true,
      priority: 'medium', channel: 'Email',
      label: 'Weekly activity email (auto-picks by health trend)',
      reason: 'Each week, the dashboard picks the email that matches their health-color trend. Recurring — it doesn\'t gate the stage.',
      selectorLabel: ACTIVITY_3060.selectorLabel, variants: ACTIVITY_3060.variants },
    { key: 'social_graphic_60', kind: 'action', priority: 'low', channel: 'Graphic',
      label: 'Day-60 social graphic', note: 'At ~60 days from kick-off',
      reason: 'At the 60-day mark, generate a graphic from their activity and send it to post on social. (USR image-gen workflow.)' },
  ],

  // ── Days 60–90 (weekly activity emails) ──────────────────────────────────────
  day6090: [
    { key: 'monitor_activity_6090', kind: 'action', priority: 'high', channel: 'Platform',
      label: 'Monitor activity weekly',
      reason: 'Keep watching the weekly trend through the run-up to the QBR.' },
    { key: 'activity_6090', kind: 'auto_email', selector: 'transition', recurring: true,
      priority: 'medium', channel: 'Email',
      label: 'Weekly activity email (auto-picks by health trend)',
      reason: 'Same weekly auto-pick as 30–60, with copy that nods to the upcoming QBR. Recurring — doesn\'t gate the stage.',
      selectorLabel: ACTIVITY_6090.selectorLabel, variants: ACTIVITY_6090.variants },
    { key: 'qbr_schedule_75', kind: 'email', priority: 'high', channel: 'Email',
      label: 'Schedule the 90-day QBR (day ~75)', note: 'If the QBR is already booked, confirm the time and share the agenda',
      reason: 'Around day 75, schedule the first QBR + goal-setting meeting. If it\'s already on the calendar, confirm the time still works and share the agenda.',
      subject: "Let's book your 90-day QBR, {owner}",
      body: `Hi {owner},\n\nYou're closing in on 90 days with USR — time to put your first Quarterly Business Review on the calendar. This is where we look back at everything {lab} has built, dig into where athletes improved, and game-plan the next quarter together.\n\nA few proposed agenda items:\n- Wins and results from your first 90 days (pulled from your data)\n- Where athletes improved most\n- Goals and plan for quarter two\n\nWhat does your calendar look like over the next couple of weeks? (If we've already got a time set, just confirming it still works — agenda above.)\n— {csm}` },
  ],

  // ── 90-Day QBR + ongoing ──────────────────────────────────────────────────────
  qbr: [
    { key: 'qbr_call', kind: 'action', priority: 'high', channel: 'Call',
      label: 'Run the 90-day QBR + goal-setting',
      reason: 'Review the first 90 days from their data, celebrate athlete improvement, and set quarter-two goals.' },
    { key: 'qbr_pre', kind: 'email', priority: 'high', channel: 'Email',
      label: '90-day QBR + game plan',
      reason: 'Approaching 90 days — frame the QBR and next-quarter plan.',
      subject: 'Your 90-day QBR + game plan for {lab}',
      body: `Hi {owner},\n\nYou've made it through your first 90 days — and {lab} is in a great spot at a {score}/9 health score with {athletes} athletes rated.\n\nTime for our Quarterly Business Review: we'll review everything you've built, look at where athletes improved, and map the next quarter together.\n\nProud of the work. Let's keep climbing.\n— {csm}` },
    { key: 'qbr_recap', kind: 'email', priority: 'medium', channel: 'Email',
      label: 'QBR recap + ongoing cadence',
      reason: 'Send the QBR recap with quarter-two goals and the ongoing check-in cadence.',
      subject: 'Recap: where {lab} goes from here',
      body: `Hi {owner},\n\nWhat a first 90 days. Here's the plan we set for quarter two:\n- The goals we agreed on for the next quarter\n- The cadence for our ongoing check-ins\n- The wins we'll keep sharing to grow your culture\n\nThis is the start of the fun part — compounding everything you've built. Let's keep climbing.\n— {csm}` },
  ],
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Keys whose completion gates stage advancement (everything except recurring tasks).
export function gatingKeys(stageKey) {
  return (CATALOG[stageKey] || []).filter(t => !t.recurring).map(t => t.key)
}

// Completing BOTH the kick-off call AND its recap starts the 7-day TTV clock.
export const KICKOFF_GATING = gatingKeys('kickoff')
export function kickoffComplete(doneSet) { return KICKOFF_GATING.every(k => doneSet.has(k)) }

// Map a week-over-week color pair to an activity-email variant key.
const T = (a, b) => `${a}_${b}`
export function transitionVariant(prevColor, currColor) {
  const p = prevColor || 'unknown'
  const c = currColor || 'unknown'
  if (c === 'green' && (p === 'green' || p === 'unknown')) return 'green_streak'
  if (c === 'green' && (p === 'yellow' || p === 'orange' || p === 'red')) return 'yellow_green'
  if (p === 'green' && c === 'yellow') return 'green_yellow'
  if (p === 'yellow' && c === 'yellow') return 'yellow_yellow'
  if (c === 'orange' && (p === 'yellow' || p === 'green')) return 'yellow_orange'
  if (p === 'orange' && c === 'orange') return 'orange_orange'
  if (c === 'red' && (p === 'orange' || p === 'yellow' || p === 'green')) return 'orange_red'
  if (p === 'red' && c === 'red') return 'red_red'
  // Sensible fallbacks for unseen pairs.
  if (c === 'green') return 'green_streak'
  if (c === 'yellow') return 'yellow_yellow'
  if (c === 'orange') return 'orange_orange'
  if (c === 'red') return 'red_red'
  return 'yellow_yellow'
}

// Pick the TTV variant from a recap count (null = unknown → needs manual pick).
export function recapVariant(recapCount) {
  if (recapCount == null) return null
  if (recapCount >= 5) return 'five_plus'
  if (recapCount >= 3) return 'three_plus'
  return 'zero_two'
}

export function fillTokens(text, ctx = {}) {
  if (!text) return ''
  return text
    .replace(/\{owner\}/g, ctx.owner || 'there')
    .replace(/\{lab\}/g, ctx.lab || 'your team')
    .replace(/\{csm\}/g, ctx.csm || 'your USR lead')
    .replace(/\{director\}/g, ctx.director || 'your Speed Lab Director')
    .replace(/\{score\}/g, ctx.score ?? '—')
    .replace(/\{athletes\}/g, ctx.athletes ?? '—')
    .replace(/\{day\}/g, ctx.day ?? '—')
    .replace(/\{logins\}/g, ctx.logins ?? '—')
    .replace(/\{datapoints\}/g, ctx.datapoints ?? '—')
    .replace(/\{edu_link\}/g, ctx.edu_link || EDU_WEEK1)
}

/**
 * Merge DB overrides (onboarding_templates rows) on top of the code catalog.
 * Overrides are keyed by task_key (+ optional variant_key for auto_email variants).
 * Returns a fresh catalog object; never mutates CATALOG.
 */
export function mergeOverrides(overrides = []) {
  const byKey = {}
  overrides.forEach(o => { (byKey[o.task_key] = byKey[o.task_key] || []).push(o) })
  const out = {}
  for (const [stage, tasks] of Object.entries(CATALOG)) {
    out[stage] = tasks.map(t => {
      const ovs = byKey[t.key]
      if (!ovs) return t
      const next = { ...t }
      ovs.forEach(o => {
        if (o.variant_key && next.variants && next.variants[o.variant_key]) {
          next.variants = {
            ...next.variants,
            [o.variant_key]: {
              ...next.variants[o.variant_key],
              ...(o.subject != null ? { subject: o.subject } : {}),
              ...(o.body != null ? { body: o.body } : {}),
              ...(o.label != null ? { label: o.label } : {}),
            },
          }
        } else if (!o.variant_key) {
          if (o.subject != null) next.subject = o.subject
          if (o.body != null) next.body = o.body
          if (o.label != null) next.label = o.label
          if (o.reason != null) next.reason = o.reason
        }
      })
      return next
    })
  }
  return out
}

import { Link } from 'react-router-dom';

interface DemoStep {
  step: number;
  title: string;
  role: string;
  targetPath: string;
  buttonText: string;
  objective: string;
  whatToShow: string[];
  honestNote?: string;
}

const STEPS: DemoStep[] = [
  {
    step: 1,
    title: 'Login as Institution Admin',
    role: 'Institution Admin (or Super Admin)',
    targetPath: '/login',
    buttonText: 'Open Login',
    objective: 'Demonstrate secure credential authentication, role gating, and session initialization.',
    whatToShow: [
      'Sign in using admin@mealguard.local / Admin12345!',
      'Verify session persistence and role badge in the top navigation bar',
      'Explain how rate limiting protects authentication endpoints against brute force',
    ],
    honestNote: 'Local prototype stores sessions via secure tokens; rate limit is 30 attempts per 15 minutes.',
  },
  {
    step: 2,
    title: 'Review Organization & Kitchen Configuration',
    role: 'Institution Admin',
    targetPath: '/organization',
    buttonText: 'View Organization',
    objective: 'Show organizational boundaries, institution profile (College Canteen), and kitchen units.',
    whatToShow: [
      'Inspect Sunrise College Canteen settings (1,200 people served daily, 450 kg kitchen capacity)',
      'Review Main Kitchen configuration and operating hours (Breakfast, Lunch, Dinner)',
      'Highlight organization isolation: data cannot leak across tenant organizations',
    ],
  },
  {
    step: 3,
    title: 'Review Menu & Food Item Catalog',
    role: 'Institution Admin / Kitchen Manager',
    targetPath: '/menu',
    buttonText: 'Open Menu Management',
    objective: 'Display weekly rotation, standard portion sizes, meal types, and special event items.',
    whatToShow: [
      'Review daily and weekly menu plans (Rice, Dal, Vegetable Curry, etc.)',
      'Inspect Friday Veg Biryani special item and standard portion metrics (kg)',
      'Demonstrate adding or editing menu items with validation',
    ],
  },
  {
    step: 4,
    title: 'Historical Data Ingestion & Quality Checks',
    role: 'Institution Admin / Kitchen Manager',
    targetPath: '/imports',
    buttonText: 'View Data Imports',
    objective: 'Verify historical dataset integrity (12+ weeks of daily kitchen records).',
    whatToShow: [
      'Review the pre-loaded 12-week dataset (~600 records across 84 days)',
      'Highlight data validation rules: no negative weights, sold cannot exceed prepared + remaining, etc.',
      'Show sample CSV/Excel import templates available for bulk loading',
    ],
    honestNote: 'Historical data is synthetically structured with deterministic seeded variation to reflect real-world campus demand patterns.',
  },
  {
    step: 5,
    title: 'Open AI Kitchen Digital Memory',
    role: 'Institution Admin / Kitchen Manager',
    targetPath: '/memory',
    buttonText: 'Open Digital Memory',
    objective: 'Show the deterministic, explainable AI model inspecting same-weekday historical baselines.',
    whatToShow: [
      'Select Rice for Lunch to see historical same-weekday distributions and trend analysis',
      'Examine the explainability breakdown: recent rolling averages, day-of-week seasonality, menu multiplier',
      'Point out confidence metrics calculated from sample variance and record density',
    ],
    honestNote: 'Forecasts are fully explainable, rule-grounded statistical projections — never opaque black-box predictions.',
  },
  {
    step: 6,
    title: "Generate Today's Production Target",
    role: 'Institution Admin / Kitchen Manager',
    targetPath: '/memory',
    buttonText: 'Generate Target',
    objective: 'Convert demand forecasts into operational cooking targets with configurable safety buffers.',
    whatToShow: [
      'Set or inspect the buffer rule (e.g. 10% safety buffer for Lunch)',
      'Generate today’s production targets for Rice, Dal, and Vegetable Curry',
      'Review the generated target figures and verify they match historical appetite patterns',
    ],
  },
  {
    step: 7,
    title: 'Explain Target Math & Human Self-Correction',
    role: 'Institution Admin / Kitchen Manager',
    targetPath: '/flow',
    buttonText: 'Inspect Target Feedback',
    objective: 'Demonstrate operational transparency and managerial override accountability.',
    whatToShow: [
      'Show exact arithmetic: Target = Forecast × (1 + Buffer %)',
      'Demonstrate the manager override capability: adjusting target kg requires an audit reason',
      'Review closed feedback loops from past days showing signed prediction error metrics',
    ],
    honestNote: 'All target adjustments require a logged reason and are recorded in the immutable audit log.',
  },
  {
    step: 8,
    title: 'Today vs Same Day Last Week Comparison',
    role: 'Institution Admin / Kitchen Manager',
    targetPath: '/dashboard',
    buttonText: 'Open Dashboard',
    objective: 'Provide kitchen leaders instant operational context against the same day last week.',
    whatToShow: [
      'Inspect the dashboard comparison card comparing today’s planned vs previous week actuals',
      'Identify variance drivers (e.g. attendance fluctuations, weekday patterns)',
      'Verify quick summary metrics for current production and remaining capacity',
    ],
  },
  {
    step: 9,
    title: 'Record Live Food Flow (Production & Sales)',
    role: 'Kitchen Manager / Staff',
    targetPath: '/flow',
    buttonText: 'Open Food Flow',
    objective: 'Show real-time logging of preparation batches, cafeteria service, and sales transactions.',
    whatToShow: [
      'Inspect the seeded live lunch run for Rice (40 kg produced, staggered sales recorded)',
      'Add a new live sale or consumption entry to show instant pace recalculation',
      'Explain how timestamped entries enable early warning before service ends',
    ],
  },
  {
    step: 10,
    title: 'Surplus-Before-Surplus™ Early Warning & Prevention Action',
    role: 'Kitchen Manager / Staff',
    targetPath: '/flow',
    buttonText: 'View Surplus Alert',
    objective: 'Demonstrate active mid-service surplus risk detection and suggested kitchen actions.',
    whatToShow: [
      'Show the HIGH SURPLUS RISK banner for Rice (pace projection indicates ~25 kg unsold)',
      'Explain the warning logic: elapsed service time vs remaining sales trajectory',
      'Review operational mitigation actions: pause secondary cook batch, offer late-service discount, notify redistribution coordinator',
    ],
    honestNote: 'Pace projections require at least 2 distinct sales timestamps over a minimal operational window.',
  },
  {
    step: 11,
    title: 'Close the Day (End-of-Day Reconciliation)',
    role: 'Kitchen Manager / Institution Admin',
    targetPath: '/eod',
    buttonText: 'Review End of Day',
    objective: 'Formalize daily totals, lock records against unauthorized tampering, and compute actual variances.',
    whatToShow: [
      'Review unclosed vs closed daily records for Main Kitchen',
      'Demonstrate the day-close checklist: verify produced, sold, and remaining quantities match',
      'Show day locking behavior: once closed, edits require supervisory reopening with audit trail',
    ],
  },
  {
    step: 12,
    title: 'Explainable Waste Analysis',
    role: 'Institution Admin / Kitchen Manager',
    targetPath: '/waste',
    buttonText: 'Open Waste Analysis',
    objective: 'Attribute causes to discarded or unsold food with normalized percentage breakdowns.',
    whatToShow: [
      'Open waste analysis for an overproduction day',
      'Review attributable root causes: Demand Overestimate, Preparation Timing, or Spoilage',
      'Examine historical recommendations to adjust future day-of-week target buffers',
    ],
    honestNote: 'Attributions are rule-grounded operational diagnostics based on recorded discrepancies and kitchen notes.',
  },
  {
    step: 13,
    title: 'Operational Food Eligibility Confirmation',
    role: 'Institution Admin / Kitchen Manager',
    targetPath: '/eligibility',
    buttonText: 'Confirm Eligibility',
    objective: 'Evaluate surplus food against operational donation criteria with mandatory human sign-off.',
    whatToShow: [
      'Inspect the recorded candidate surplus (15 kg Rice, safe storage, future pickup deadline)',
      'Explain the automated operational checks: minimum batch cutoff, temperature, shelf-life window',
      'Show the mandatory human confirmation checkbox and signature requirement before release',
    ],
    honestNote: 'Decision support tool only — NEVER a substitute for statutory food safety certification. Human visual and sensory check is strictly required.',
  },
  {
    step: 14,
    title: 'Match, Notify NGO & Complete Pickup Workflow',
    role: 'Institution Admin & NGO Partner',
    targetPath: '/redistribution',
    buttonText: 'Open Redistribution',
    objective: 'Demonstrate multi-criteria NGO scoring, notification dispatch, and chain-of-custody handover.',
    whatToShow: [
      'View matching recommendations: City Food Helpers scores highest (active, local, pickup-capable, accepts Cooked Veg/Grains)',
      'Compare against incompatible NGOs: Distant Hills Kitchen (inactive, wrong city) or Suburban Collective (no vehicle)',
      'Dispatch notification and demonstrate status workflow (NOTIFIED → ACCEPTED → SCHEDULED → COMPLETED)',
      'Show the NGO portal view (/redistribution logged in as ngo@mealguard.local)',
    ],
    honestNote: 'When SMTP is not configured, email notifications are logged to the system audit trail and in-app alerts.',
  },
  {
    step: 15,
    title: 'Impact Measurement, Analytics & Reports Export',
    role: 'Institution Admin / Super Admin',
    targetPath: '/reports',
    buttonText: 'View Reports & Exports',
    objective: 'Demonstrate measured social impact, carbon emissions avoided, and multi-format reporting.',
    whatToShow: [
      'Inspect the estimated impact metrics: meals rescued, CO2e emissions avoided, cost savings in INR',
      'Review Analytics trends (/analytics) for waste reduction trajectory over 12 weeks',
      'Download audit-ready reports in CSV, Excel (.xlsx), and PDF formats',
      'Inspect the System Audit Log (/audit) to prove end-to-end accountability',
    ],
    honestNote: 'Impact figures are calculated using transparent, configurable factors (e.g. 2.5 kg CO2e/kg food, Rs 120/kg) and are explicitly labeled as estimates.',
  },
];

export function DemoGuide() {
  return (
    <div className="space-y-8 pb-12">
      {/* Header Banner */}
      <div className="rounded-2xl bg-gradient-to-r from-leaf-800 to-leaf-950 p-6 text-white shadow-md">
        <div className="inline-block rounded-full bg-leaf-600/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-leaf-100">
          Smart India Hackathon (SIH) Showcase
        </div>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight">15-Step End-to-End Evaluation Guide</h1>
        <p className="mt-2 max-w-3xl text-sm text-leaf-100 leading-relaxed">
          Follow this guided walkthrough to evaluate the complete Surplus MealGuard AI pipeline from baseline AI kitchen memory
          and early surplus prevention, to human-confirmed food eligibility, algorithmic NGO matching, and verified impact analytics.
        </p>
      </div>

      {/* Honest Prototype Disclaimers Card */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 text-sm text-amber-900 shadow-sm space-y-2">
        <div className="flex items-center gap-2 font-bold text-amber-950">
          <span>ℹ</span>
          <span>Prototype Boundaries &amp; Integrity Disclaimers</span>
        </div>
        <ul className="list-disc pl-5 space-y-1 text-xs text-amber-900">
          <li><strong>Deterministic &amp; Explainable AI:</strong> Projections use explainable statistical time-series models with rolling averages and seasonality multipliers — no unverified black-box claims or fabricated 95%+ accuracy guarantees.</li>
          <li><strong>Operational Decision Support:</strong> Surplus food eligibility checks provide operational logistics guidance; they do not replace human sensory inspection or statutory food safety testing.</li>
          <li><strong>Documented Impact Estimates:</strong> Ecological and financial figures use transparent standard factors (2.5 kg CO2e / kg food, ₹120 / kg) clearly marked as estimates.</li>
          <li><strong>Local Testing Sandbox:</strong> Outgoing email notifications can be routed to external SMTP or simulated safely for offline evaluation.</li>
        </ul>
      </div>

      {/* Demo Credentials Quick Reference */}
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-bold text-stone-900">Demo Role Credentials</h2>
        <p className="mt-1 text-xs text-stone-600">All accounts are pre-seeded in the local database. Password for all seeded accounts is listed below.</p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <span className="text-xs font-semibold text-leaf-800">Institution Admin</span>
            <div className="mt-1 font-mono text-xs text-stone-800">admin@mealguard.local</div>
            <div className="text-[11px] text-stone-500">Pass: Admin12345!</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <span className="text-xs font-semibold text-leaf-800">Kitchen Manager</span>
            <div className="mt-1 font-mono text-xs text-stone-800">manager@mealguard.local</div>
            <div className="text-[11px] text-stone-500">Pass: Manager123!</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <span className="text-xs font-semibold text-leaf-800">Kitchen Staff</span>
            <div className="mt-1 font-mono text-xs text-stone-800">staff@mealguard.local</div>
            <div className="text-[11px] text-stone-500">Pass: Staff12345!</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <span className="text-xs font-semibold text-leaf-800">NGO Partner (City Food Helpers)</span>
            <div className="mt-1 font-mono text-xs text-stone-800">ngo@mealguard.local</div>
            <div className="text-[11px] text-stone-500">Pass: Ngo123456!</div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
            <span className="text-xs font-semibold text-leaf-800">Super Administrator</span>
            <div className="mt-1 font-mono text-xs text-stone-800">superadmin@mealguard.local</div>
            <div className="text-[11px] text-stone-500">Pass: SuperAdmin123!</div>
          </div>
          <div className="rounded-xl border border-dashed border-stone-300 bg-white p-3 flex flex-col justify-center">
            <span className="text-xs font-semibold text-stone-700">Database Reset</span>
            <span className="mt-1 font-mono text-xs text-stone-600">npm run db:reset</span>
            <span className="text-[10px] text-stone-400">Reverts to pristine demo baseline</span>
          </div>
        </div>
      </div>

      {/* 15-Step Story Cards */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-stone-900">The 15-Step SIH Evaluation Workflow</h2>
        <div className="grid grid-cols-1 gap-4">
          {STEPS.map((s) => (
            <div
              key={s.step}
              className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm hover:border-leaf-300 transition"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-leaf-100 text-sm font-bold text-leaf-900">
                    {s.step}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-stone-900">{s.title}</h3>
                    <p className="mt-0.5 text-xs text-stone-500">
                      Recommended Role: <span className="font-semibold text-stone-700">{s.role}</span>
                    </p>
                  </div>
                </div>

                <Link
                  to={s.targetPath}
                  className="inline-flex items-center justify-center rounded-lg bg-leaf-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-leaf-800 self-start shrink-0 shadow-sm"
                >
                  {s.buttonText} →
                </Link>
              </div>

              <div className="mt-3 pl-11 text-xs text-stone-700 space-y-2">
                <p className="font-medium text-stone-800">{s.objective}</p>
                <div className="rounded-lg bg-stone-50 p-2.5 border border-stone-100">
                  <span className="font-semibold text-stone-600 block mb-1">Key Actions &amp; Verifications:</span>
                  <ul className="list-disc pl-4 space-y-0.5 text-stone-600">
                    {s.whatToShow.map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                  </ul>
                </div>
                {s.honestNote && (
                  <p className="text-[11px] text-amber-800 italic">
                    Note: {s.honestNote}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

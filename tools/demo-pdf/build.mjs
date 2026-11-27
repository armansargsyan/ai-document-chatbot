#!/usr/bin/env node
/**
 * Builds the fictional "Acme Corp Employee Handbook 2026" demo PDF used in the
 * product video. Not part of the apps — a standalone tool.
 *
 *   node tools/demo-pdf/build.mjs
 *
 * How it works:
 *   1. Renders the handbook as HTML and prints it to PDF with headless Chrome
 *      (real, extractable text; page numbers via CSS @page margin boxes).
 *   2. Extracts the text per page (unpdf, already a repo dependency) to find
 *      the page each section starts on, then prints again with the real
 *      numbers in the table of contents.
 *   3. Verifies the result: the PDF opens, the text is extractable, and every
 *      demo fact appears exactly once (so chatbot citations are unambiguous).
 *
 * Chrome is looked up in the usual locations; override with CHROME_PATH.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractText, getDocumentProxy } from 'unpdf';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(HERE, 'acme-employee-handbook.pdf');
const TITLE = 'Acme Corp Employee Handbook 2026';

const SECTIONS = [
  'Welcome',
  'Company Values',
  'Working Hours & Remote Work',
  'Vacation & Leave',
  'Sick Leave',
  'Benefits & Health Insurance',
  'Equipment & IT Policy',
  'Travel & Expenses',
  'Performance Reviews',
  'Code of Conduct',
  'Contacts',
];

/** The facts the demo questions rely on. Each must appear exactly once. */
const FACTS = [
  {
    label: 'Vacation: 20 days, 25 after 3 years',
    pattern: /New employees receive 20 vacation days per year/g,
  },
  {
    label: 'Vacation entitlement rises to 25',
    pattern: /rises to 25 vacation days per year/g,
  },
  {
    label: 'Carry-over: up to 5 days',
    pattern: /Up to 5 unused vacation days can be carried over/g,
  },
  { label: 'Carry-over deadline: March 31', pattern: /March 31/g },
  { label: 'Remote: up to 3 days per week', pattern: /up to 3 days per week/g },
  { label: 'Sick leave: 10 paid days', pattern: /10 paid sick days/g },
  {
    label: "Sick leave: doctor's note after 3 days",
    pattern: /doctor's note/g,
  },
  { label: 'Equipment: $1,500 every 2 years', pattern: /\$1,500/g },
  { label: 'Travel meals: $60 per day', pattern: /\$60/g },
  { label: 'Receipts: within 14 days', pattern: /14 days/g },
  {
    label: 'Reviews: June and December',
    pattern: /twice a year, in June and December/g,
  },
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

const CSS = /* css */ `
  @page {
    size: Letter;
    margin: 0.7in 0.8in 0.8in;
    @bottom-left {
      content: "Acme Corp \\00B7  Employee Handbook 2026";
      font: 8.5pt "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #6b7280;
    }
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font: 8.5pt "Helvetica Neue", Helvetica, Arial, sans-serif;
      color: #6b7280;
    }
  }
  @page :first {
    margin: 0;
    @bottom-left { content: none; }
    @bottom-right { content: none; }
  }

  :root {
    --ink: #1f2937;
    --muted: #6b7280;
    --line: #e5e7eb;
    --brand: #1d4ed8;
    --brand-dark: #1e3a8a;
    --brand-soft: #eff6ff;
  }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    font-size: 10pt;
    line-height: 1.42;
    color: var(--ink);
  }

  /* Cover */
  .cover {
    height: 11in;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 1.1in 1in 0.9in;
    background: linear-gradient(160deg, var(--brand-dark) 0%, var(--brand) 60%, #3b82f6 100%);
    color: #fff;
    break-after: page;
  }
  .logo { display: flex; align-items: center; gap: 12px; font-size: 15pt; font-weight: 700; letter-spacing: 0.02em; }
  .logo-mark {
    width: 40px; height: 40px; border-radius: 10px; background: #fff; color: var(--brand);
    display: flex; align-items: center; justify-content: center; font-size: 20pt; font-weight: 800;
  }
  .cover h1 { font-size: 40pt; line-height: 1.1; margin: 0 0 14px; font-weight: 700; letter-spacing: -0.01em; }
  .cover .subtitle { font-size: 14pt; opacity: 0.9; margin: 0; max-width: 5in; }
  .cover .meta { font-size: 10pt; opacity: 0.85; border-top: 1px solid rgba(255, 255, 255, 0.35); padding-top: 14px; }
  .cover .meta p { margin: 2px 0; }

  /* Table of contents */
  .toc { break-after: page; }
  .toc h2 { margin-top: 0; }
  .toc ol { list-style: none; padding: 0; margin: 24px 0 0; }
  .toc li { display: flex; align-items: baseline; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 11.5pt; }
  .toc .num { width: 34px; color: var(--brand); font-weight: 700; }
  .toc .name { flex: 1; }
  .toc .page { color: var(--muted); font-variant-numeric: tabular-nums; }
  .toc .note { margin-top: 28px; color: var(--muted); font-size: 9.5pt; }

  /* Sections */
  section { break-before: page; }
  .eyebrow { color: var(--brand); font-size: 9pt; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; margin: 0 0 4px; }
  h2 { font-size: 19pt; line-height: 1.2; margin: 0 0 12px; color: var(--brand-dark); padding-bottom: 8px; border-bottom: 2px solid var(--brand); }
  h3 { font-size: 11.5pt; margin: 14px 0 4px; color: var(--ink); break-after: avoid; }
  p { margin: 0 0 7px; }
  ul, ol { margin: 0 0 8px; padding-left: 20px; }
  li { margin-bottom: 2px; }
  .lead { font-size: 10.5pt; color: #374151; }

  .key {
    border-left: 4px solid var(--brand);
    background: var(--brand-soft);
    padding: 8px 12px;
    margin: 8px 0 10px;
    border-radius: 0 6px 6px 0;
    break-inside: avoid;
  }
  .key strong { color: var(--brand-dark); }

  table { width: 100%; border-collapse: collapse; margin: 8px 0 12px; font-size: 9pt; break-inside: avoid; }
  caption { text-align: left; font-weight: 700; font-size: 9.5pt; color: var(--muted); padding-bottom: 6px; }
  th { background: var(--brand-dark); color: #fff; text-align: left; font-weight: 600; padding: 5px 9px; }
  td { padding: 5px 9px; border-bottom: 1px solid var(--line); vertical-align: top; }
  tr:nth-child(even) td { background: #f9fafb; }

  .signature { margin-top: 10px; }
  .signature .name { font-weight: 700; margin: 0; }
  .signature .role { color: var(--muted); margin: 0; }
  .fineprint { color: var(--muted); font-size: 9pt; margin-top: 20px; }
`;

const COVER = /* html */ `
  <div class="cover">
    <div class="logo"><div class="logo-mark">A</div>Acme Corp</div>
    <div>
      <h1>Employee Handbook 2026</h1>
      <p class="subtitle">Policies, benefits and practical guidance for everyone who works at Acme Corp.</p>
    </div>
    <div class="meta">
      <p>Version 4.0 &middot; Effective January 1, 2026</p>
      <p>Owner: People &amp; Culture</p>
      <p>Fictional document created for product demonstration purposes. Any resemblance to real organizations or people is coincidental.</p>
    </div>
  </div>
`;

function toc(pages) {
  const rows = SECTIONS.map(
    (name, i) =>
      `<li><span class="num">${i + 1}</span><span class="name">${escapeHtml(name)}</span><span class="page">${pages[i]}</span></li>`,
  ).join('');
  return /* html */ `
    <div class="toc">
      <p class="eyebrow">Contents</p>
      <h2>Table of Contents</h2>
      <ol>${rows}</ol>
      <p class="note">This handbook summarizes Acme Corp policy as of January 2026. Where local law grants employees more generous terms, local law applies. Questions about any policy can be sent to the People &amp; Culture team (see section 11).</p>
    </div>
  `;
}

const BODY = [
  /* 1. Welcome */ `
    <p class="lead">Welcome to Acme Corp. Whether you joined us this week or have been here for years, this handbook is your guide to how we work, what we offer, and what we expect from one another.</p>
    <p>Acme Corp was founded in 2009 in Riverton with a simple idea: warehouses and workshops deserve tools that are as reliable as the people who use them. Today we design and build modular storage systems, smart shelving and the software that keeps them running, for more than four thousand customers in 31 countries.</p>
    <p>We have grown from a team of six in a rented garage into a company of roughly 850 people across three offices and a fully distributed engineering group. What has not changed is our belief that great products come from people who are trusted, supported and given room to do their best work.</p>

    <h3>A message from our CEO</h3>
    <p>When I joined Acme as its first operations hire, the "employee handbook" was a single page taped to the coffee machine. We have come a long way since then, but I still want this document to feel like that page did: short enough to read, honest about what we expect, and clear about how we look after you.</p>
    <p>Please take an hour in your first week to read it end to end. Keep it handy, and if something here is unclear or out of date, tell us. Policies are written by people, and they get better when people question them.</p>
    <div class="signature">
      <p class="name">Morgan Ellery</p>
      <p class="role">Chief Executive Officer, Acme Corp</p>
    </div>

    <h3>How to use this handbook</h3>
    <ul>
      <li>Each section covers one topic and can be read on its own.</li>
      <li>Highlighted boxes contain the key rule for that topic.</li>
      <li>Your offer letter or employment contract takes precedence if it differs from this handbook.</li>
      <li>The latest version always lives on PeopleHub, our HR portal. Printed copies may be out of date.</li>
    </ul>

    <table>
      <caption>Acme Corp at a glance</caption>
      <tr><th>Item</th><th>Details</th></tr>
      <tr><td>Headquarters</td><td>Riverton (design, sales and corporate functions)</td></tr>
      <tr><td>Other offices</td><td>Lakeside manufacturing campus; Eastgate customer center</td></tr>
      <tr><td>Employees</td><td>Approximately 850</td></tr>
      <tr><td>HR portal</td><td>PeopleHub (leave requests, payslips, benefits enrollment)</td></tr>
      <tr><td>Fiscal year</td><td>January to December</td></tr>
    </table>
  `,

  /* 2. Company Values */ `
    <p class="lead">Our values describe how we make decisions when no policy covers the situation. They are used in hiring, in feedback conversations and when we decide who to promote.</p>

    <h3>Build things that last</h3>
    <p>Our customers rely on our shelving to hold heavy loads for decades and on our software to run their operations every day. We prefer the durable solution over the quick one, we fix root causes, and we take pride in work that does not need to be redone.</p>

    <h3>Say it plainly</h3>
    <p>We communicate directly and kindly. Bad news travels fast at Acme, because problems are cheapest to fix when they are small. We write things down, share context generously and avoid jargon when plain words will do.</p>

    <h3>Own the outcome</h3>
    <p>Everyone is responsible for results, not just for tasks. If you see something broken, you either fix it or make sure the right person knows. We celebrate people who raise their hand, and we never punish honest mistakes made in good faith.</p>

    <h3>Win as a team</h3>
    <p>We share credit, help colleagues outside our own team and assume positive intent. Disagreement is welcome; once a decision is made, we commit to it together.</p>

    <h3>Keep learning</h3>
    <p>Our industry changes quickly. We invest in training, encourage curiosity and expect every employee to grow in their role. Asking "why?" is always allowed.</p>

    <table>
      <caption>Values in practice</caption>
      <tr><th>Value</th><th>What it looks like</th><th>What it does not look like</th></tr>
      <tr><td>Build things that last</td><td>Writing tests, documenting decisions, planning maintenance</td><td>Shipping a workaround and moving on</td></tr>
      <tr><td>Say it plainly</td><td>Flagging a delay as soon as it is known</td><td>Waiting until a deadline is missed</td></tr>
      <tr><td>Own the outcome</td><td>Following a customer issue until it is solved</td><td>"That is not my job"</td></tr>
      <tr><td>Win as a team</td><td>Reviewing a colleague's work promptly</td><td>Keeping information to gain an advantage</td></tr>
      <tr><td>Keep learning</td><td>Sharing lessons from a project retrospective</td><td>Repeating the same mistake quietly</td></tr>
    </table>
  `,

  /* 3. Working Hours & Remote Work */ `
    <p class="lead">Acme Corp supports flexible working. We care about results and reliable collaboration more than about when or where you sit down at your desk.</p>

    <h3>Standard working hours</h3>
    <p>A full-time position at Acme is 40 hours per week, normally Monday to Friday. You may choose your start and finish times, provided you are available during our core collaboration hours of 10:00 to 15:00 local time. Part-time schedules are agreed individually and recorded in your contract.</p>
    <p>Employees at the Lakeside manufacturing campus work in scheduled shifts. Shift patterns, handovers and break times are published by the site manager at least four weeks in advance.</p>

    <h3>Breaks and overtime</h3>
    <ul>
      <li>Take an unpaid lunch break of at least 30 minutes on any day you work more than six hours.</li>
      <li>Employees in non-exempt roles must have overtime approved by their manager in advance. Approved overtime is paid at one and a half times the regular hourly rate.</li>
      <li>Exempt employees are not paid overtime but are encouraged to take time back after periods of unusually long hours, in agreement with their manager.</li>
    </ul>

    <h3>Remote work</h3>
    <div class="key"><strong>Remote work policy:</strong> Employees in eligible roles may work remotely up to 3 days per week, with approval from their team lead.</div>
    <p>Approval is given per person, not per team, and is normally agreed during onboarding. Your team lead may ask you to be in the office on specific days for workshops, planning sessions or customer visits. Roles that require on-site presence, such as manufacturing and facilities, are not eligible for remote work.</p>

    <h3>Requirements for working remotely</h3>
    <ul>
      <li>A quiet workspace where confidential conversations cannot be overheard.</li>
      <li>A reliable internet connection and use of the company VPN for internal systems.</li>
      <li>Being reachable on chat and video during core collaboration hours.</li>
      <li>Following the Equipment &amp; IT Policy for any company device used at home.</li>
    </ul>

    <h3>Working from another country</h3>
    <p>Working from abroad has tax and legal consequences for both you and Acme. You may work from another country for up to four weeks per calendar year, only with written approval from People &amp; Culture obtained before you travel.</p>

    <h3>Time tracking</h3>
    <p>Non-exempt employees record their hours in PeopleHub each day. Exempt employees record only absences such as vacation and sick leave.</p>
  `,

  /* 4. Vacation & Leave */ `
    <p class="lead">Rest is part of doing good work. We expect everyone to take their vacation, and managers are responsible for making sure their teams can.</p>

    <h3>4.1 Annual vacation entitlement</h3>
    <div class="key"><strong>Vacation entitlement:</strong> New employees receive 20 vacation days per year. After 3 years of continuous service, the entitlement rises to 25 vacation days per year.</div>
    <p>The higher entitlement applies from the start of the calendar year following your third work anniversary. In your first calendar year, your entitlement is pro-rated from your start date. Part-time employees receive vacation in proportion to their contracted hours.</p>
    <p>Vacation days are working days. Weekends and company holidays that fall within your vacation do not count against your balance.</p>

    <h3>4.2 Requesting time off</h3>
    <ul>
      <li>Request vacation in PeopleHub. Your manager approves or declines it, usually within three working days.</li>
      <li>Give at least one month's notice for absences longer than one week, and reasonable notice for shorter ones.</li>
      <li>During the busy season (October and November) the operations and support teams coordinate time off to keep minimum coverage.</li>
      <li>Set an out-of-office message and hand over open work before you leave.</li>
    </ul>

    <h3>4.3 Company holidays</h3>
    <p>In addition to vacation, Acme observes the following company holidays in 2026. Offices are closed, and shift workers who are scheduled on these days receive an extra day off in lieu.</p>
    <table>
      <caption>Company holidays 2026</caption>
      <tr><th>Holiday</th><th>Date</th></tr>
      <tr><td>New Year's Day</td><td>Thursday, January 1</td></tr>
      <tr><td>Founders' Day</td><td>Friday, April 17</td></tr>
      <tr><td>Memorial Day</td><td>Monday, May 25</td></tr>
      <tr><td>Independence Day (observed)</td><td>Friday, July 3</td></tr>
      <tr><td>Labor Day</td><td>Monday, September 7</td></tr>
      <tr><td>Thanksgiving Day</td><td>Thursday, November 26</td></tr>
      <tr><td>Day after Thanksgiving</td><td>Friday, November 27</td></tr>
      <tr><td>Christmas Eve</td><td>Thursday, December 24</td></tr>
      <tr><td>Christmas Day</td><td>Friday, December 25</td></tr>
    </table>

    <h3>4.4 Carrying over unused vacation</h3>
    <div class="key"><strong>Carry-over rule:</strong> Up to 5 unused vacation days can be carried over to the next calendar year. Carried-over days must be used by March 31; any that are still unused after that date expire.</div>
    <p>Unused days above the carry-over limit are forfeited at the end of the calendar year, unless local law requires otherwise. Unused vacation is not paid out during employment. When you leave Acme, any remaining balance for the current year is paid with your final salary.</p>
    <p>If a business need prevented you from taking vacation, for example a major customer project approved by a director, speak to People &amp; Culture before the end of the year about an exception.</p>

    <h3>4.5 Other types of leave</h3>
    <table>
      <caption>Other paid and unpaid leave</caption>
      <tr><th>Leave type</th><th>Entitlement</th><th>How to request</th></tr>
      <tr><td>Parental leave</td><td>16 weeks paid for the primary caregiver; 8 weeks paid for the secondary caregiver</td><td>Notify People &amp; Culture at least eight weeks before</td></tr>
      <tr><td>Bereavement leave</td><td>Up to one working week paid for a close family member</td><td>Tell your manager; no documentation needed</td></tr>
      <tr><td>Jury duty</td><td>Full pay for the duration of service</td><td>Share the summons with People &amp; Culture</td></tr>
      <tr><td>Volunteering day</td><td>One paid day per year for registered charity work</td><td>Request in PeopleHub as "Volunteering"</td></tr>
      <tr><td>Unpaid leave</td><td>Up to three months, at the company's discretion</td><td>Written request to your manager and People &amp; Culture</td></tr>
    </table>
  `,

  /* 5. Sick Leave */ `
    <p class="lead">If you are ill, rest and recover. Please do not come to work sick, and do not log in from bed to "just check a few emails".</p>

    <h3>Paid sick days</h3>
    <div class="key"><strong>Sick leave:</strong> Every employee receives 10 paid sick days per year. A doctor's note is required after 3 consecutive days of sick leave.</div>
    <p>Sick days are available from your first day of employment and reset every January. They are separate from vacation and cannot be carried over or paid out. Sick days can also be used for medical appointments that cannot be scheduled outside working hours and to care for a sick child or dependent.</p>

    <h3>Reporting an absence</h3>
    <ol>
      <li>Tell your manager as early as possible, and before your shift or core hours begin where you can.</li>
      <li>Record the absence in PeopleHub under "Sick leave" on the first day, or on your first day back if you could not do so earlier.</li>
      <li>If the absence continues, keep your manager updated on how long you expect to be away.</li>
    </ol>
    <p>You do not need to share a diagnosis with your manager. Medical documents should be uploaded to PeopleHub, where only People &amp; Culture can see them.</p>

    <h3>Longer illness</h3>
    <p>If you are unable to work for an extended period, Acme's short-term disability insurance replaces 70 percent of your base salary after your paid sick days are used, for up to 26 weeks. Long-term disability coverage starts after that. People &amp; Culture will contact you to explain the process and help with the paperwork.</p>

    <h3>Returning to work</h3>
    <p>After a longer absence, your manager will meet with you to agree on a return plan. This can include reduced hours for a few weeks, temporary changes to your duties or a workplace assessment. Our goal is a safe and sustainable return, not a fast one.</p>

    <h3>Workplace injuries</h3>
    <p>Report any injury at work, however minor, to your manager and the site safety officer on the same day. Workplace injuries are handled under workers' compensation and do not use your sick days.</p>

    <table>
      <caption>Who to contact</caption>
      <tr><th>Situation</th><th>Contact</th></tr>
      <tr><td>Short absence</td><td>Your manager, then record it in PeopleHub</td></tr>
      <tr><td>Extended illness or disability claim</td><td>People &amp; Culture, benefits team</td></tr>
      <tr><td>Injury at work</td><td>Your manager and the site safety officer</td></tr>
      <tr><td>Emotional wellbeing</td><td>Employee Assistance Program (confidential, free)</td></tr>
    </table>
  `,

  /* 6. Benefits & Health Insurance */ `
    <p class="lead">Acme's benefits are designed to protect your health, support your family and help you plan for the future. Most benefits start on your first day.</p>

    <table>
      <caption>Benefits overview</caption>
      <tr><th>Benefit</th><th>What you get</th><th>Eligibility</th></tr>
      <tr><td>Health insurance</td><td>Choice of three Meridale Health medical plans; Acme pays 85% of the employee premium</td><td>From day one</td></tr>
      <tr><td>Dental and vision</td><td>Preventive care covered in full; Acme pays 100% of the employee premium</td><td>From day one</td></tr>
      <tr><td>Life insurance</td><td>Coverage of two times your annual base salary at no cost to you</td><td>From day one</td></tr>
      <tr><td>Retirement plan</td><td>401(k) with a company match of 100% of contributions up to 4% of salary</td><td>After the first full month</td></tr>
      <tr><td>Disability insurance</td><td>Short-term and long-term coverage (see Sick Leave)</td><td>From day one</td></tr>
      <tr><td>Wellness stipend</td><td>$40 per month toward gym, sports or wellbeing apps</td><td>After probation</td></tr>
      <tr><td>Learning budget</td><td>$1,000 per year for courses, books and conferences</td><td>After probation</td></tr>
      <tr><td>Employee Assistance Program</td><td>Free, confidential counseling, legal and financial guidance for you and your household</td><td>From day one</td></tr>
    </table>

    <h3>Medical plans</h3>
    <p>All three medical plans use the Meridale Health national network and include prescription coverage, telehealth visits at no cost and mental health care on the same terms as physical care.</p>
    <table>
      <caption>Meridale Health plans 2026 (employee-only coverage)</caption>
      <tr><th>Plan</th><th>Your monthly premium</th><th>Annual deductible</th><th>Out-of-pocket maximum</th></tr>
      <tr><td>Core</td><td>$0</td><td>$2,800</td><td>$6,000</td></tr>
      <tr><td>Plus</td><td>$45</td><td>$1,200</td><td>$4,000</td></tr>
      <tr><td>Premier</td><td>$110</td><td>$400</td><td>$2,500</td></tr>
    </table>
    <p>The Core plan is paired with a Health Savings Account, to which Acme contributes $750 per year. Premiums for covering a spouse, partner or children are listed in PeopleHub.</p>

    <h3>Enrolling and making changes</h3>
    <ul>
      <li>New employees choose their plans in PeopleHub within 30 days of their start date. If you make no choice, you are enrolled in the Core plan for yourself only.</li>
      <li>Open enrollment runs every year in the first two weeks of November, for coverage starting January 1.</li>
      <li>Outside open enrollment, you can change coverage within 30 days of a qualifying life event such as marriage, birth or adoption.</li>
    </ul>
  `,

  /* 7. Equipment & IT Policy */ `
    <p class="lead">Good tools help you do your best work, and secure habits protect our customers. This section explains what equipment you receive and how to use company systems safely.</p>

    <h3>Equipment budget</h3>
    <div class="key"><strong>Equipment budget:</strong> Each employee has an equipment budget of $1,500 every 2 years for a laptop and accessories.</div>
    <p>You choose from the approved device catalog in the IT portal, which includes laptops, monitors, keyboards, headsets and docking stations. The budget renews from the date of your last laptop order. Purchases above the budget need approval from your department head. Ergonomic equipment recommended by a workplace assessment is paid separately and does not reduce your budget.</p>
    <p>All equipment remains the property of Acme Corp and must be returned when you leave or when a device is replaced.</p>

    <h3>Security basics</h3>
    <ul>
      <li>Use the company password manager and a unique password for every system.</li>
      <li>Multi-factor authentication is mandatory for email, PeopleHub and all customer systems.</li>
      <li>Lock your screen whenever you step away, even at home.</li>
      <li>Install software only from the IT self-service catalog. Request anything else through an IT ticket.</li>
      <li>Keep your device updated; IT installs security patches automatically and may restart devices overnight.</li>
      <li>Never store company data on personal devices or personal cloud accounts.</li>
    </ul>

    <h3>Data classification</h3>
    <table>
      <caption>How to handle information</caption>
      <tr><th>Class</th><th>Examples</th><th>Handling</th></tr>
      <tr><td>Public</td><td>Website content, published product sheets</td><td>No restrictions</td></tr>
      <tr><td>Internal</td><td>Team plans, internal announcements</td><td>Share only inside Acme</td></tr>
      <tr><td>Confidential</td><td>Customer contracts, pricing, roadmaps</td><td>Need-to-know; encrypted storage only</td></tr>
      <tr><td>Restricted</td><td>Employee records, payment data, credentials</td><td>Named people only; never by email</td></tr>
    </table>

    <h3>Acceptable use</h3>
    <p>Company devices and accounts are for work. Reasonable personal use, such as checking the news at lunch, is fine as long as it does not interfere with your work or break the law. Acme may monitor company systems for security purposes, in line with applicable privacy law.</p>

    <h3>Lost devices and security incidents</h3>
    <p>Report a lost or stolen device, a suspicious email or a possible data leak to the IT Service Desk immediately, and in any case within 24 hours. Reporting quickly is what matters: no one is disciplined for reporting an honest mistake.</p>
  `,

  /* 8. Travel & Expenses */ `
    <p class="lead">When you travel or spend money on Acme's behalf, spend it as carefully as if it were your own. This section covers booking, spending limits and reimbursement.</p>

    <h3>Before you travel</h3>
    <ul>
      <li>Business trips need approval from your manager before anything is booked.</li>
      <li>Book flights, hotels and rental cars through TripDesk, our travel booking tool, so that we can reach you in an emergency.</li>
      <li>Economy class is standard. Premium economy is allowed for flights longer than six hours.</li>
    </ul>

    <h3>Hotels</h3>
    <table>
      <caption>Nightly hotel limits (before taxes)</caption>
      <tr><th>Destination type</th><th>Examples</th><th>Limit per night</th></tr>
      <tr><td>Standard</td><td>Most cities and regional locations</td><td>$180</td></tr>
      <tr><td>High cost</td><td>Major business centers</td><td>$240</td></tr>
      <tr><td>Premium</td><td>A short list of very high-cost cities, published in TripDesk</td><td>$300</td></tr>
    </table>

    <h3>Meals while traveling</h3>
    <div class="key"><strong>Travel meals:</strong> Meals while traveling on business are reimbursed up to $60 per day. Receipts must be submitted within 14 days of the end of the trip.</div>
    <p>The daily meal limit covers breakfast, lunch, dinner and non-alcoholic drinks. If a meal is included in your hotel rate or provided at a conference, it should not also be claimed. Client meals are covered under business entertainment below, not under the daily meal limit.</p>

    <h3>Other expenses</h3>
    <table>
      <caption>Reimbursable expenses</caption>
      <tr><th>Expense</th><th>Rule</th></tr>
      <tr><td>Personal car</td><td>Mileage at the current IRS rate; parking and tolls at cost</td></tr>
      <tr><td>Taxis and ride-hailing</td><td>Allowed when public transport is impractical</td></tr>
      <tr><td>Business entertainment</td><td>Pre-approved by your manager; list all attendees on the claim</td></tr>
      <tr><td>Not reimbursable</td><td>Alcohol (except approved client entertainment), minibar items, fines, upgrades you choose yourself, and costs for non-employees traveling with you</td></tr>
    </table>

    <h3>Submitting a claim</h3>
    <p>Submit expenses in the Expenses module of PeopleHub, with a photo of each itemized receipt. Your manager approves the claim, and approved claims are paid with the next payroll run.</p>
  `,

  /* 9. Performance Reviews */ `
    <p class="lead">Feedback at Acme happens all year in regular one-to-one conversations. Formal reviews make sure that this feedback is summarized fairly and that everyone has clear goals.</p>

    <h3>Review cycle</h3>
    <div class="key"><strong>Performance reviews:</strong> Formal performance reviews take place twice a year, in June and December.</div>
    <p>The mid-year review focuses on progress, development and adjusting goals. The year-end review also includes a performance rating, which is used in compensation and promotion decisions. Employees who joined less than three months before a review take part in an informal check-in instead.</p>

    <h3>How a review works</h3>
    <ol>
      <li><strong>Self-assessment.</strong> You reflect on your goals, achievements and areas for growth in PeopleHub.</li>
      <li><strong>Peer feedback.</strong> You and your manager choose two to four colleagues to share feedback.</li>
      <li><strong>Manager assessment.</strong> Your manager writes a summary based on your self-assessment, peer feedback and their own observations.</li>
      <li><strong>Calibration.</strong> Managers in each department meet to make sure ratings are consistent and fair.</li>
      <li><strong>Review conversation.</strong> You and your manager discuss the outcome and agree on goals for the next period.</li>
    </ol>

    <h3>Ratings</h3>
    <table>
      <caption>Year-end rating scale</caption>
      <tr><th>Rating</th><th>Meaning</th></tr>
      <tr><td>Exceptional</td><td>Consistently exceeded expectations and raised the bar for others</td></tr>
      <tr><td>Strong</td><td>Exceeded expectations in important areas</td></tr>
      <tr><td>Solid</td><td>Fully met the expectations of the role</td></tr>
      <tr><td>Developing</td><td>Met some expectations; clear areas to improve</td></tr>
      <tr><td>Below expectations</td><td>Did not meet the expectations of the role</td></tr>
    </table>

    <h3>Goals</h3>
    <p>Each employee has three to five goals per review period, linked to their team's quarterly objectives. Good goals are specific, measurable and within your influence. Goals can be updated at any time if priorities change.</p>

    <h3>Compensation and promotions</h3>
    <p>Salary adjustments and promotions are decided after the year-end review and take effect in the first payroll of the new year. Promotions can also be proposed outside the cycle when someone has clearly grown into a larger role.</p>

    <h3>Support to improve</h3>
    <p>If performance falls below expectations, your manager will agree a written improvement plan with you, with clear goals, regular check-ins and the support you need. The aim is to help you succeed.</p>
  `,

  /* 10. Code of Conduct */ `
    <p class="lead">Our reputation is built by every interaction we have with customers, partners and each other. This code applies to all employees, contractors and anyone acting on Acme's behalf.</p>

    <h3>Respect and inclusion</h3>
    <p>We treat everyone with dignity. Acme does not tolerate discrimination, harassment or bullying of any kind, including on the basis of race, color, religion, sex, gender identity, sexual orientation, national origin, age, disability or any other protected characteristic. This applies in the office, at company events, online and when traveling for work.</p>

    <h3>Harassment</h3>
    <p>Harassment includes unwelcome comments, jokes, images, physical contact or advances that create an intimidating or offensive environment. It is judged by its effect on the person, not by the intention behind it. If someone tells you your behavior makes them uncomfortable, stop.</p>

    <h3>Conflicts of interest</h3>
    <p>Avoid situations where personal interests could influence your decisions at work. Disclose to your manager and Legal any outside job, investment in a supplier or competitor, or close relationship with someone you hire, manage or buy from. Most conflicts can be managed once they are disclosed.</p>

    <h3>Gifts and hospitality</h3>
    <ul>
      <li>You may accept occasional gifts worth less than $75, such as branded items or a modest meal.</li>
      <li>Never accept cash, gift cards or anything offered in exchange for a business decision.</li>
      <li>Record all gifts above that value in the gifts register and ask Legal before accepting them.</li>
      <li>Never offer anything of value to a government official without approval from Legal.</li>
    </ul>

    <h3>Confidentiality</h3>
    <p>Protect confidential information about Acme, our customers and our colleagues, both during and after your employment. Do not discuss confidential matters in public places, and follow the data classification rules in the Equipment &amp; IT Policy.</p>

    <h3>Speaking up</h3>
    <p>If you see or experience something that breaks this code, tell your manager, People &amp; Culture or Legal. You can also report anonymously through the Acme Ethics Line, run by an independent provider and available around the clock.</p>
    <div class="key"><strong>No retaliation:</strong> Acme will not tolerate retaliation against anyone who raises a concern in good faith or helps with an investigation.</div>

    <h3>Consequences</h3>
    <p>Breaking this code can lead to disciplinary action, up to and including termination of employment, and in some cases may be reported to the authorities.</p>
  `,

  /* 11. Contacts */ `
    <p class="lead">Not sure who to ask? Start here. Most requests can also be raised as a ticket in PeopleHub, which routes them to the right team.</p>

    <table>
      <caption>Key contacts</caption>
      <tr><th>Team</th><th>Contact person</th><th>Email</th><th>Phone</th></tr>
      <tr><td>People &amp; Culture</td><td>Priya Halvorsen, Head of People</td><td>people@acme-corp.example</td><td>(555) 010-2200</td></tr>
      <tr><td>Benefits and payroll</td><td>Tomas Ridley, Benefits Lead</td><td>benefits@acme-corp.example</td><td>(555) 010-2210</td></tr>
      <tr><td>IT Service Desk</td><td>Available around the clock</td><td>it-help@acme-corp.example</td><td>(555) 010-2300</td></tr>
      <tr><td>Travel and expenses</td><td>Lena Okafor, Finance Operations</td><td>travel@acme-corp.example</td><td>(555) 010-2400</td></tr>
      <tr><td>Facilities</td><td>Graham Velez, Facilities Manager</td><td>facilities@acme-corp.example</td><td>(555) 010-2500</td></tr>
      <tr><td>Legal and compliance</td><td>Ines Marchetti, General Counsel</td><td>legal@acme-corp.example</td><td>(555) 010-2600</td></tr>
      <tr><td>Health and safety</td><td>Site safety officers</td><td>safety@acme-corp.example</td><td>(555) 010-2700</td></tr>
    </table>

    <h3>Confidential support</h3>
    <table>
      <tr><th>Service</th><th>How to reach it</th></tr>
      <tr><td>Acme Ethics Line (anonymous)</td><td>ethics.acme-corp.example or (555) 010-2900</td></tr>
      <tr><td>Employee Assistance Program</td><td>(555) 010-2950, any time</td></tr>
    </table>

    <h3>Offices</h3>
    <table>
      <tr><th>Office</th><th>Address</th><th>Reception hours</th></tr>
      <tr><td>Riverton headquarters</td><td>400 Foundry Lane, Riverton</td><td>Monday to Friday, 08:00 to 18:00</td></tr>
      <tr><td>Lakeside manufacturing campus</td><td>12 Mill Road, Lakeside</td><td>Staffed during all shifts</td></tr>
      <tr><td>Eastgate customer center</td><td>88 Harbor Avenue, Eastgate</td><td>Monday to Friday, 08:30 to 17:30</td></tr>
    </table>

    <h3>In an emergency</h3>
    <p>Call local emergency services first. Then inform your manager and the site safety officer. Emergency procedures and evacuation maps are posted at every office entrance.</p>

    <p class="fineprint">This handbook does not form a contract of employment. Acme Corp may update its policies at any time; the current version is always available on PeopleHub. Acme Corp and every person named in this handbook are fictional and exist only for product demonstration purposes.</p>
  `,
];

function renderHtml(tocPages) {
  const sections = SECTIONS.map(
    (name, i) => /* html */ `
      <section>
        <p class="eyebrow">Section ${i + 1}</p>
        <h2>${i + 1}. ${escapeHtml(name)}</h2>
        ${BODY[i]}
      </section>`,
  ).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${TITLE}</title>
<style>${CSS}</style>
</head>
<body>${COVER}${toc(tocPages)}${sections}</body>
</html>`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// Rendering and checks
// ---------------------------------------------------------------------------

function findChrome() {
  const chrome = CHROME_CANDIDATES.find((path) => existsSync(path));
  if (!chrome) {
    throw new Error(
      'Chrome/Chromium not found. Set CHROME_PATH to a Chrome executable.',
    );
  }
  return chrome;
}

function printToPdf(chrome, html, workDir, outFile) {
  const htmlFile = join(workDir, 'handbook.html');
  writeFileSync(htmlFile, html);
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${join(workDir, 'profile')}`,
      '--no-pdf-header-footer',
      `--print-to-pdf=${outFile}`,
      pathToFileURL(htmlFile).href,
    ],
    { stdio: 'pipe' },
  );
}

async function readPages(file) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(file)));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, pages: text.map((page) => page.replace(/\s+/g, ' ')) };
}

/** 1-based start page of each section (searching after the cover and contents). */
function sectionPages(pages) {
  return SECTIONS.map((name, i) => {
    const heading = `${i + 1}. ${name}`;
    const index = pages.findIndex(
      (text, page) => page >= 2 && text.includes(heading),
    );
    if (index === -1)
      throw new Error(`Section heading not found: "${heading}"`);
    return index + 1;
  });
}

function checkFacts(pages) {
  const problems = [];
  const report = FACTS.map(({ label, pattern }) => {
    const hits = pages.flatMap((text, i) =>
      Array(text.match(pattern)?.length ?? 0).fill(i + 1),
    );
    if (hits.length !== 1)
      problems.push(
        `"${label}" found ${hits.length} times (pages: ${hits.join(', ') || 'none'})`,
      );
    return `  p.${String(hits[0] ?? '?').padEnd(3)} ${label}`;
  });
  return { report, problems };
}

async function main() {
  const chrome = findChrome();
  const workDir = mkdtempSync(join(tmpdir(), 'acme-handbook-'));
  try {
    // Pass 1: placeholder page numbers of the same width, so the layout matches pass 2.
    const draft = join(workDir, 'draft.pdf');
    printToPdf(chrome, renderHtml(SECTIONS.map(() => '00')), workDir, draft);
    const tocPages = sectionPages((await readPages(draft)).pages);

    // Pass 2: real page numbers in the table of contents.
    printToPdf(chrome, renderHtml(tocPages), workDir, OUTPUT);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }

  // Verify the final file: it opens, text extracts, the TOC is right, facts are unique.
  const { totalPages, pages } = await readPages(OUTPUT);
  const problems = [];
  const chars = pages.reduce((sum, text) => sum + text.trim().length, 0);
  if (chars < 10_000)
    problems.push(`only ${chars} characters of text extracted`);

  const finalPages = sectionPages(pages);
  const tocText = pages[1];
  finalPages.forEach((page, i) => {
    if (!tocText.includes(`${SECTIONS[i]} ${page}`))
      problems.push(`TOC entry for "${SECTIONS[i]}" does not say page ${page}`);
  });

  const facts = checkFacts(pages);
  problems.push(...facts.problems);

  console.log(`✓ Wrote ${OUTPUT}`);
  console.log(
    `  ${totalPages} pages, ${chars.toLocaleString('en-US')} characters of extractable text`,
  );
  console.log('Sections:');
  SECTIONS.forEach((name, i) =>
    console.log(`  p.${String(finalPages[i]).padEnd(3)} ${i + 1}. ${name}`),
  );
  console.log('Demo facts:');
  console.log(facts.report.join('\n'));

  if (problems.length) {
    console.error(`\n✗ Verification failed:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  console.log(
    '✓ Verified: PDF opens, text is extractable, TOC matches, each fact appears once.',
  );
}

await main();

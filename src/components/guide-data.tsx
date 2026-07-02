import { P, UL, Callout, SignInUrl, type GuideDoc } from "@/components/guide-content";

export const userGuide: GuideDoc = {
  kind: "user",
  eyebrow: "User guide",
  title: (
    <>
      ClockWork for <span className="text-gold">Virtual Assistants</span>
    </>
  ),
  lede: "Everything you need to clock in confidently, get credit for your work, and let the SOP library grow from what you do.",
  sections: [
    {
      id: "welcome",
      number: 1,
      title: "Welcome to ClockWork",
      body: (
        <>
          <P>
            ClockWork is a transparent time tracker that also turns your repeated work into step-by-step guides (SOPs).
            When you clock in, it records your work sessions so your hours are accurate and provable — and it quietly
            learns the workflows you repeat so they can become playbooks. You always see exactly what your admin sees.
            Nothing is hidden.
          </P>
          <P>
            Why members like it: your hours are accurate (no more "trust me"), your work is visible so you get credit for it,
            and the SOPs it builds mean less re-explaining and faster onboarding for whoever comes next.
          </P>
        </>
      ),
    },
    {
      id: "what-gets-tracked",
      number: 2,
      title: "What gets tracked (and what never is)",
      body: (
        <>
          <P>
            <strong>Recorded while you're clocked in:</strong> the start and end of each session plus any breaks; the
            app or website you're actively using (page title and URL); active vs idle time (never your keystrokes);
            occasional screenshots of your active tab for context; the sequence of clicks for repeated tasks, so
            ClockWork can draft SOPs.
          </P>
          <P>
            <strong>Never recorded:</strong> anything while you're clocked out or on a break; keystrokes, passwords,
            camera, or microphone; personal tabs kept in a separate browser profile.
          </P>
          <P>
            <strong>Your rights:</strong> see exactly what admins see about you, in real time; stop recording anytime
            (Pause or Clock out); request deletion of your captured data.
          </P>
          <Callout>
            You can review all of this anytime on the Consent page — open it from the "What gets tracked?" link on your
            Day screen.
          </Callout>
        </>
      ),
    },
    {
      id: "getting-started",
      number: 3,
      title: "Getting started: your account",
      body: (
        <>
          <P>
            Your admin creates your account and gives you a one-time temporary password. Sign in at{" "}
            <SignInUrl />{" "}
            with your email and that password, then change it. If you ever get locked out, use "Forgot password?" on the
            sign-in screen (type your email in the field first, then click it). The first thing you'll see is your Day
            screen with a short setup checklist.
          </P>
        </>
      ),
    },
    {
      id: "install-extension",
      number: 4,
      title: "Install the browser extension",
      body: (
        <>
          <P>
            ClockWork records through a Chrome extension. From the sidebar, open <strong>Install extension</strong> and
            follow three steps:
          </P>
          <ol className="list-decimal pl-5 space-y-1.5 mb-3 marker:text-gold/70">
            <li>Download the .zip and unzip it — you'll get a folder called "clockwork."</li>
            <li>
              Go to <code className="text-gold">chrome://extensions</code>, turn on Developer mode (top-right), click
              "Load unpacked," and select the clockwork folder.
            </li>
            <li>The Install page is listening — it confirms the moment the extension says hello.</li>
          </ol>
          <P>
            It loads as an "unpacked" extension because it isn't on the Chrome Web Store yet. That's normal and safe —
            you control the folder it lives in. Keep the unzipped folder where it is; Chrome runs it live from there.
          </P>
        </>
      ),
    },
    {
      id: "clocking",
      number: 5,
      title: "Clocking in and out",
      body: (
        <>
          <P>
            You clock in and out from the extension popup (the ClockWork icon in your Chrome toolbar) — not the website.
            When you clock in:
          </P>
          <UL>
            <li>Choose the screen or tab to share when prompted. You can stop sharing anytime from the browser bar.</li>
            <li>Optionally tag the session with a client so your hours roll up to the right project.</li>
          </UL>
          <P>
            Your Day screen lights up the moment your session starts. When you're done, Clock out — or Pause for a break
            — from the same popup.
          </P>
          <P>
            Off the clock, your Day screen shows a quick checklist: extension installed, signed in as you, screen
            capture allowed, then open the popup and Clock In.
          </P>
        </>
      ),
    },
    {
      id: "day-dashboard",
      number: 6,
      title: "Your Day dashboard",
      body: (
        <>
          <P>"My day" is your home base. At a glance:</P>
          <UL>
            <li><strong>Status</strong> — off the clock, or live with a running timer while you work.</li>
            <li><strong>Today total / Active / Idle</strong> — your hours so far today.</li>
            <li><strong>Time by app today</strong> — where your time actually went.</li>
            <li><strong>Today's sessions and Today's breaks</strong> — your clock-in/out and break history.</li>
            <li><strong>SOPs from your work</strong> — playbooks generated from what you've done.</li>
          </UL>
          <P>You always see exactly what your admin sees — no surprises, ever.</P>
        </>
      ),
    },
    {
      id: "breaks-idle",
      number: 7,
      title: "Breaks and idle time",
      body: (
        <>
          <P>
            <strong>Breaks:</strong> when you Pause, ClockWork logs a break and stops counting active time. Your
            billable time is active time minus breaks.
          </P>
          <P>
            <strong>Idle:</strong> if you stop interacting for a while, ClockWork marks that time idle and may nudge you
            to confirm you're still working (your admin sets the threshold). Idle time is shown separately so your
            active hours stay honest.
          </P>
        </>
      ),
    },
    {
      id: "sop-library",
      number: 8,
      title: "The SOP library",
      body: (
        <>
          <P>
            SOPs are step-by-step guides ClockWork drafts from real work — every step has a screenshot. Open SOPs from
            the sidebar.
          </P>
          <UL>
            <li>Search, and filter by All / Mine / New / Auto / Reviewed.</li>
            <li>Open a card to read it, or hit Play walkthrough for a guided, step-by-step player.</li>
          </UL>
          <P>In the walkthrough player:</P>
          <UL>
            <li>Next/Previous or the arrow keys move between steps; Space auto-plays; the film strip lets you jump to any step.</li>
            <li>Cinema mode (press <kbd className="kbd">F</kbd>) gives you a full-screen theater; <kbd className="kbd">Z</kbd> zooms a screenshot; <kbd className="kbd">Esc</kbd> exits.</li>
            <li><strong>Share step</strong> copies a link to that exact step.</li>
            <li><strong>Mark as followed</strong> once you've completed it.</li>
          </UL>
        </>
      ),
    },
    {
      id: "questions",
      number: 9,
      title: "Asking questions on a SOP",
      body: (
        <P>
          Every SOP has a Discussion area. Leave a note, or toggle <strong>Question</strong> to flag it — your admin
          gets notified. You can tag your comment to the current step so it's clear what you're asking about. Use this
          instead of pinging on chat; it keeps the answer attached to the SOP for the next person.
        </P>
      ),
    },
    {
      id: "shortcuts",
      number: 10,
      title: "Shortcuts & extras",
      body: (
        <UL>
          <li>
            <strong>Command palette:</strong> press <kbd className="kbd">⌘K</kbd> (<kbd className="kbd">Ctrl+K</kbd> on
            Windows) to jump to any page or SOP, or to sign out — just type and go.
          </li>
          <li><strong>Notifications:</strong> the bell keeps you posted, like when an admin answers your question.</li>
        </UL>
      ),
    },
    {
      id: "privacy",
      number: 11,
      title: "Privacy & your rights",
      body: (
        <P>
          You're in control. Pause or Clock out stops recording instantly. Personal browsing in a separate Chrome
          profile is never captured. You can review what's tracked anytime on the Consent page, and you can ask your
          admin to delete your captured data.
        </P>
      ),
    },
    {
      id: "troubleshooting",
      number: 12,
      title: "Troubleshooting & FAQ",
      body: (
        <UL>
          <li>
            <strong>"My Day still says off the clock."</strong> Clock-in happens in the extension popup, not on the
            website. Open the ClockWork icon in your toolbar and click Clock In — the page updates on its own.
          </li>
          <li>
            <strong>"The extension isn't recording."</strong> Check that it's installed (<code>chrome://extensions</code>),
            that you're signed in as yourself, and that you allowed screen capture when prompted.
          </li>
          <li>
            <strong>"I just reinstalled or updated the extension."</strong> After any reload, open the popup and Clock
            In again.
          </li>
          <li>
            <strong>"I forgot my password."</strong> Use "Forgot password?" on the sign-in screen — type your email in
            the field first, then click it.
          </li>
          <li>
            <strong>"Can you see my keystrokes or passwords?"</strong> No. Never. Only clicks on interactive elements
            (for building SOPs) and periodic screenshots while you're clocked in.
          </li>
        </UL>
      ),
    },
  ],
};

export const adminGuide: GuideDoc = {
  kind: "admin",
  eyebrow: "Admin guide",
  title: (
    <>
      ClockWork for <span className="text-gold">Admins</span>
    </>
  ),
  lede: "Run the workspace: invite members, watch live and historical work, approve timesheets, run payroll, and turn repeated work into SOPs.",
  sections: [
    {
      id: "overview",
      number: 1,
      title: "Overview",
      body: (
        <P>
          As an admin you run the workspace: invite and manage members, watch live and historical work, approve timesheets,
          run payroll, turn repeated work into SOPs, and keep an audit trail. You also have everything a member has — your
          own My Day, the SOP library, and so on. Your admin tools live under <strong>Team</strong> in the sidebar.
        </P>
      ),
    },
    {
      id: "workspace-setup",
      number: 2,
      title: "Workspace setup",
      body: (
        <>
          <P>
            The first account created becomes the admin; after that, admins invite everyone else. Set workspace-wide
            rules under <strong>Team → Settings</strong>:
          </P>
          <UL>
            <li><strong>Keep screenshots</strong> — how many days screenshots are kept before they auto-expire.</li>
            <li><strong>Idle after</strong> — minutes of no interaction before time counts as idle (and the member gets a nudge).</li>
            <li><strong>Break warning</strong> — fires when a single break runs longer than this.</li>
          </UL>
          <P>Save to apply these to the whole team.</P>
        </>
      ),
    },
    {
      id: "vas",
      number: 3,
      title: "Inviting & managing members (Team → Members)",
      body: (
        <UL>
          <li>
            <strong>Invite member:</strong> enter a name and email; ClockWork generates a one-time temporary password for
            you to share with them — no email needed. They sign in and change it.
          </li>
          <li><strong>Roles:</strong> switch a member between va and admin (promote a trusted partner to admin).</li>
          <li>
            <strong>Status:</strong> set active or paused. Pausing stops a member from clocking in without deleting any of
            their data.
          </li>
          <li><strong>Set rate:</strong> give a member an hourly pay rate, which Payroll uses.</li>
        </UL>
      ),
    },
    {
      id: "clients",
      number: 4,
      title: "Clients (Team → Clients)",
      body: (
        <P>
          Add the clients your team works for. Members tag each session with a client at clock-in, so hours roll up by
          project across Timesheets and Payroll. You can rename a client inline, or archive one — a soft delete that
          keeps the history. Archived clients stay listed with a badge.
        </P>
      ),
    },
    {
      id: "team-dashboard",
      number: 5,
      title: "The Team dashboard",
      body: (
        <UL>
          <li>
            <strong>Today:</strong> a calm overview — Working now, Idle, Active hours, Idle hours — plus a tile per member
            showing status, minutes worked today, last screenshot thumbnail, last activity, and idle %. It auto-refreshes.
          </li>
          <li><strong>Live:</strong> a focused "who's working right now" list.</li>
        </UL>
      ),
    },
    {
      id: "timesheets",
      number: 6,
      title: "Timesheets (Team → Timesheets)",
      body: (
        <>
          <UL>
            <li>Toggle Day or Week, step through periods, or jump to This week.</li>
            <li>Filter by client.</li>
            <li>See Time by client and a per-member breakdown (total, active, idle, billable, breaks).</li>
            <li><strong>Approve weeks:</strong> a weekly sign-off marks hours ready to pay and feeds Payroll.</li>
            <li>Export CSV, or Print/PDF.</li>
          </UL>
          <Callout>Billable time = active time minus breaks.</Callout>
        </>
      ),
    },
    {
      id: "payroll",
      number: 7,
      title: "Payroll (Team → Payroll)",
      body: (
        <UL>
          <li>Pick a period: This week, Last week, Last 2 weeks, This month, Last month, or a Custom range.</li>
          <li>See Billable hours, Total owed, and how many members still need a rate.</li>
          <li>
            <strong>Payroll by member</strong> lists active, breaks, billable, rate/hr, amount, and approval status. A member
            with no rate shows "not set" and no amount — set their rate under Members.
          </li>
          <li>Approval reflects the weekly sign-off from Timesheets; fully approved weeks are ready to pay.</li>
          <li>Export payroll CSV.</li>
        </UL>
      ),
    },
    {
      id: "signatures",
      number: 8,
      title: "Signatures & automatic SOPs (Team → Signatures)",
      body: (
        <P>
          ClockWork watches for click sequences your team repeats and surfaces them as <strong>Signatures</strong> —
          with how many times each has been seen and where. Click <strong>Create draft SOP</strong> and ClockWork turns
          that sequence into a titled, step-by-step SOP with screenshots, in one click. If a signature already has an
          SOP, you'll see a "SOP exists" badge.
        </P>
      ),
    },
    {
      id: "sop-library-admin",
      number: 9,
      title: "Managing the SOP library (SOPs)",
      body: (
        <UL>
          <li>Browse, search, and filter by All / New / Auto / Reviewed. Admins see every SOP across the team.</li>
          <li>Open an SOP to read it or play the walkthrough, and edit the AI's draft (title, steps) as needed.</li>
          <li>
            <strong>Review:</strong> when a member asks a question, the SOP is flagged Needs review and you're notified.
            Answer in the Discussion and Mark resolved. Mark SOPs reviewed to track which ones are vetted.
          </li>
        </UL>
      ),
    },
    {
      id: "drill-va",
      number: 10,
      title: "Drilling into a member",
      body: (
        <P>
          From the Today and Members views you can open a member's detail page to see their sessions, screenshots, and the SOPs
          they're generating — handy for coaching and for verifying work.
        </P>
      ),
    },
    {
      id: "client-share",
      number: 11,
      title: "Client share links",
      body: (
        <P>
          Want to show a client what's being done for them? Generate a client share link from the command palette
          ("Generate client share link…") to share a scoped, read-only view. Treat it like a password — anyone with the
          link can open it.
        </P>
      ),
    },
    {
      id: "audit",
      number: 12,
      title: "Security, privacy & the audit log (Team → Audit)",
      body: (
        <UL>
          <li>
            <strong>Audit log:</strong> every sensitive action is recorded — session adjustments, SOP creation,
            password-reset attempts (including failures and rate-limit hits), and admin invites (including rate-limit
            hits). Filter by action, range, or search across email, IP, actor, and metadata; export CSV.
          </li>
          <li><strong>Rate limiting</strong> protects password reset and invites from abuse.</li>
          <li>
            <strong>Consent:</strong> every member sees exactly what's tracked before they clock in (the Consent page), and
            can request deletion.
          </li>
          <li><strong>Retention:</strong> screenshots auto-expire on the schedule you set in Settings.</li>
        </UL>
      ),
    },
    {
      id: "power-tools",
      number: 13,
      title: "Power tools",
      body: (
        <UL>
          <li>
            <strong>Command palette (<kbd className="kbd">⌘K</kbd>):</strong> jump to any Team section (Today, Live,
            Timesheets, Payroll, Clients, Members, Signatures, Audit, Settings), open any SOP, jump to a member, or generate a
            client link — all by typing.
          </li>
          <li><strong>Notifications:</strong> the bell flags questions and items that need review.</li>
        </UL>
      ),
    },
    {
      id: "rollout",
      number: 14,
      title: "Rolling it out (best practices)",
      body: (
        <UL>
          <li>Start by adding your clients and setting each member's rate.</li>
          <li>Walk new members through the Consent page first — transparency is what drives adoption.</li>
          <li>Have each member install the extension and do one clock-in with you to confirm it's working.</li>
          <li>Set a sensible idle threshold and screenshot retention in Settings.</li>
          <li>Review and tidy up auto-drafted SOPs weekly, and mark the good ones reviewed.</li>
          <li>Approve timesheets weekly so Payroll stays one click away.</li>
        </UL>
      ),
    },
    {
      id: "troubleshooting-admin",
      number: 15,
      title: "Troubleshooting & FAQ",
      body: (
        <UL>
          <li>
            <strong>"A member shows offline but says they're working."</strong> Clock-in is via the extension popup —
            confirm they installed it, are signed in as themselves, and allowed screen capture. After any extension
            reload they must Clock In again.
          </li>
          <li>
            <strong>"Payroll shows $0 or no amount."</strong> The member has no rate set (Members → Set rate), or the week
            hasn't been approved yet (Timesheets).
          </li>
          <li><strong>"An SOP looks rough."</strong> It's an AI draft — edit the title and steps, then mark it reviewed.</li>
          <li>
            <strong>"Where did personal browsing go?"</strong> It's never captured. Off-the-clock time and separate
            browser profiles are excluded by design.
          </li>
        </UL>
      ),
    },
  ],
};

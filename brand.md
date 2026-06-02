# Brand Identity — Plain and Simple
**Version:** 1.0 (May 2026)
**Purpose:** This document is the single source of truth for all design and content agents. Read this before generating any UI component, copy, marketing asset, or visual output.

---

## Product Overview

**Name:** Plain and Simple
**Category:** Controlling software for architecture and structural engineering professionals
**Core promise:** The tool that gets out of your way and lets you do the work. Domain-deep, visually quiet.

**The name is the brief.** Every design decision should be able to answer: *is this plain? is this simple?* If not, remove it.

---

## Target Users

**Primary:** Architects and structural engineers — technically proficient, detail-oriented, time-poor, and allergic to software that talks down to them or buries features in UI flourishes.

**What they need from the product:**
- Fast access to the information and controls that matter
- Confidence that the tool understands their domain (use correct terminology, support professional workflows)
- Zero learning curve for basic tasks; discoverable depth for advanced ones
- Data that's legible at a glance — no decoding required

**What they do not want:**
- Marketing language in the UI ("Supercharge your workflow!")
- Unnecessary animations or decorative elements that slow them down
- Ambiguous labels or icons that require trial and error
- Being asked to confirm things they already know

---

## Design Principles

These four principles govern every screen, component, and interaction. When trade-offs arise, use them as a tiebreaker.

### 1. Clarity over cleverness
Every screen should answer two questions immediately: *What am I looking at?* and *What can I do here?* If a user has to wonder, the design has failed. Labels are literal. Hierarchy is obvious. Nothing is hidden that shouldn't be.

### 2. Low entry barrier
A structural engineer opening Plain and Simple for the first time should be able to complete a core task without reading documentation. Power features are discoverable, never mandatory. Progressive disclosure: show the essentials first, surface depth on demand.

### 3. Domain credibility
Use the language of the profession. Show that Plain and Simple understands how architects and engineers actually work — their units, their conventions, their mental models. This is not a generic SaaS tool that happens to serve construction. It is built for this world.

### 4. Help is ambient
Guidance appears in context, not buried in a help center. Tooltips, inline labels, and empty-state copy should do the teaching. The tool anticipates confusion and prevents it quietly.

---

## Visual Identity

### Color Palette

The dominant feel is **clean and minimal** — neutrals and whitespace carry most of the visual weight. Warmth is introduced through carefully chosen accents and typography, not through loud color.

| Role | Name | Hex | Usage |
|------|------|-----|-------|
| Background | Off-white | `#F8F6F3` | Page and panel backgrounds — warm white, not stark |
| Surface | White | `#FFFFFF` | Cards, modals, input fields |
| Surface Alt | Warm grey | `#F0EDE8` | Alternating rows, secondary panels, subtle dividers |
| Border | Stone | `#E2DDD7` | All borders, dividers, outlines |
| Text Primary | Charcoal | `#1C1917` | Body text, labels, headings |
| Text Secondary | Warm grey | `#78716C` | Supporting text, metadata, captions |
| Text Disabled | Light stone | `#A8A29E` | Disabled states, placeholder text |
| Primary Action | Slate | `#334155` | Primary buttons, active states, links |
| Primary Hover | Dark Slate | `#1E293B` | Hover state for primary actions |
| Accent | Warm amber | `#B45309` | Highlights, active navigation, key data points — use sparingly |
| Success | Forest | `#15803D` | Positive states, validation, completed steps |
| Warning | Amber | `#D97706` | Caution states, non-critical alerts |
| Error | Rose | `#BE123C` | Errors, destructive actions, critical alerts |

**Rules:**
- Never use more than 2 accent colors on a single screen
- Background colors should never compete with content
- Use color to communicate state, not decoration

### Typography

**Primary Typeface:** Inter (or system-ui as fallback)
Inter is legible at small sizes, has excellent number rendering (critical for engineering data), and reads as serious without being stiff.

| Scale | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| Display | 28px | 600 | 1.25 | Page titles only |
| Heading 1 | 22px | 600 | 1.3 | Section headings |
| Heading 2 | 18px | 600 | 1.35 | Card titles, panel headers |
| Heading 3 | 15px | 600 | 1.4 | Sub-sections, table headers |
| Body | 14px | 400 | 1.6 | All body copy, descriptions |
| Body Strong | 14px | 500 | 1.6 | Emphasized body text, labels |
| Small | 12px | 400 | 1.5 | Metadata, captions, footnotes |
| Mono | 13px | 400 | 1.5 | Values, measurements, codes, formulas |

**Rules:**
- Use monospace for all numeric output, units, and calculation results — this is a professional tool, precision matters visually
- Never use more than 2 weight levels on a single screen
- Headings should be short enough to scan in under 2 seconds

### Spacing & Layout

Base unit: **4px**. All spacing, padding, and margins are multiples of 4.

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Icon padding, tight internal spacing |
| sm | 8px | Between related elements within a component |
| md | 16px | Standard component padding |
| lg | 24px | Between components in a section |
| xl | 32px | Between sections |
| 2xl | 48px | Page-level sections |

**Layout:**
- Max content width: 1280px, centered
- Sidebar width: 240px (if applicable)
- Use generous whitespace — don't pack in features to prove depth
- Data tables and calculation outputs: always left-align labels, right-align numeric values

### Iconography

- Use a single consistent icon set — **Lucide** (clean, minimal, open-weight lines)
- Icon size: 16px inline, 20px standalone
- Icons never appear without a label unless the action is universally understood (close, search)
- Do not use filled/solid icons as decoration — they signal state (active, selected, warning)

### Elevation & Shadow

Use shadow sparingly. Flat is the default.

| Level | CSS | Usage |
|-------|-----|-------|
| 0 | none | Default — cards, panels |
| 1 | `0 1px 3px rgba(0,0,0,0.08)` | Dropdowns, floating elements |
| 2 | `0 4px 12px rgba(0,0,0,0.10)` | Modals, popovers |

### Border Radius

| Element | Radius |
|---------|--------|
| Buttons | 6px |
| Cards / panels | 8px |
| Inputs | 6px |
| Modals | 10px |
| Tags / badges | 4px |

---

## Voice & Tone

### Core character
**Confident. Precise. Quietly expert.**

Plain and Simple sounds like the most knowledgeable colleague in the room — the one who gives you a straight answer without showing off. It never lectures, never hedges unnecessarily, and never uses three words when one will do.

### Tone by context

| Context | Tone | Example |
|---------|------|---------|
| UI labels | Literal and direct | "Export Report" not "Download your results" |
| Empty states | Helpful, not cute | "No calculations yet. Start by selecting a load case." |
| Error messages | Honest, actionable | "Connection failed. Check your network and try again." |
| Success states | Quiet confirmation | "Saved." — not "Great job! Your work is saved!" |
| Onboarding | Peer-to-peer | "You know your workflow. This is how Plain and Simple fits in." |
| Marketing | Credible, not hyped | "Built for the precision your work demands." |

### Words to use
clear, accurate, reliable, efficient, precise, structured, complete, verified, professional, direct

### Words to avoid
supercharge, revolutionize, seamlessly, unlock, powerful, game-changing, easy (say *clear* or *direct* instead), simply (unless instructing), amazing, delightful

### Grammar rules
- Sentence case for all UI text (not Title Case)
- Imperative for buttons and actions ("Export", "Run Calculation", "Add Load Case")
- No exclamation marks in the product UI
- Numbers over 999 use a period as thousands separator in European markets: 1.000 — follow locale settings

---

## Component Patterns

### Data Tables (primary UI pattern — used constantly)
- Column headers: right-align numbers, left-align text
- Row height: 40px standard, 32px compact mode
- Alternating row background using Surface Alt (`#F0EDE8`)
- Numeric values: always monospace, unit displayed inline (e.g. `12.4 kN/m²`)
- Sort indicators visible only on hover or active column
- Frozen first column for wide tables

### Forms & Inputs
- Labels always above the field, never inside (placeholder is not a label)
- Group related fields visually; separate groups with 24px gap
- Validation: inline, immediate on blur — not on submit
- Required fields: mark optional ones with "(optional)" rather than required ones with "*"

### Primary Buttons
- Background: Slate `#334155`, text white
- Only one primary action per screen
- Destructive actions: Rose `#BE123C`, require confirmation dialog

### Empty States
- Always explain why it's empty and what to do next
- Never just "No data found"
- Icon (optional, 40px), heading (1 line), action text, CTA button

### Loading States
- Skeleton loaders for data tables and cards
- Never a full-page spinner
- If load > 2s, show progress indicator with estimated time if known

---

## Marketing Voice (for landing pages and campaigns)

The audience is professionals who've been burned by overpromising software before. Earn their trust by being specific and honest.

**Landing page structure:**
1. One-line value proposition — what it does, who it's for
2. The problem it solves — in the user's language, not ours
3. How it works — concrete, no magic words
4. Evidence — specifics over generalities (features, not feelings)
5. CTA — direct ("Start your free trial" not "See the magic")

**Headline formula:** [What it does] + [for whom] + [without the usual friction]
Example: *"Structural calculations, organized the way you think — not the way software usually forces you to."*

---

## Placeholders (to be completed)

The following sections need input from the product owner before agents can use them fully:

- [ ] **Logo file location and usage rules** — upload logo asset and define clear space, min size, don't-dos
- [ ] **Product screenshots / UI references** — actual screenshots of the app for agents to reference when generating components consistent with existing screens
- [ ] **Domain glossary** — key terms used in the app (load cases, structural elements, calculation types) so agents use correct terminology
- [ ] **Competitor differentiation** — 2–3 sentences on how Plain and Simple differs from alternatives (AutoCAD, Dlubal, hand calculations)
- [ ] **Locale / market** — primary market (DACH? Italy? Pan-European?) affects number formats, date formats, language

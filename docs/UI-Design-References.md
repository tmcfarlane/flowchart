# UI Design References - Zero Click Dev

This document captures the complete design system, color palette, typography, components, and UI patterns used throughout the Zero Click Dev application. Use this as a reference for building future apps that should match the same visual identity.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Color System](#color-system)
3. [Typography](#typography)
4. [Spacing & Layout](#spacing--layout)
5. [Components](#components)
6. [Animations & Transitions](#animations--transitions)
7. [Shadows & Effects](#shadows--effects)
8. [Responsive Design](#responsive-design)
9. [Accessibility](#accessibility)
10. [Code Examples](#code-examples)

---

## Design Philosophy

- **Dark-first design**: The entire UI is built around a dark theme with charcoal backgrounds and vibrant teal/cyan accents
- **Modern & minimalist**: Clean layouts with generous whitespace
- **Premium tech feel**: Subtle gradients, glass-morphism effects, and glowing accents
- **Mobile-first responsive**: Components scale elegantly from mobile to 4K displays

---

## Color System

### CSS Custom Properties (HSL Format)

All colors are defined as CSS custom properties in `app/globals.css` using HSL values:

```css
:root {
  /* Background Colors */
  --background: 210 11% 7%;           /* #0f1211 - Main dark background */
  --foreground: 160 14% 93%;          /* #e7eceb - Primary text color */

  /* Muted Colors */
  --muted: 240 2% 16%;                /* #27272a - Muted backgrounds */
  --muted-foreground: 160 14% 93% / 0.7;     /* rgba(231, 236, 235, 0.7) */
  --muted-foreground-light: 160 14% 93% / 0.5;
  --muted-foreground-dark: 160 14% 93% / 0.6;

  /* Card Colors */
  --card: 220 17% 98% / 0.01;         /* Near-transparent white overlay */
  --card-foreground: 160 14% 93%;

  /* Popover Colors */
  --popover: 210 11% 7%;
  --popover-foreground: 160 14% 93%;

  /* Primary Accent - Teal/Cyan */
  --primary: 165 96% 71%;             /* #78fcd6 - Main accent color */
  --primary-foreground: 160 8% 6%;    /* #0d0f0e - Text on primary */
  --primary-dark: 160 100% 50%;       /* #00ffb6 - Darker/brighter teal */
  --primary-light: 160 48% 87%;       /* Lighter teal shade */

  /* Secondary Colors */
  --secondary: 160 14% 93%;           /* #e7eceb */
  --secondary-foreground: 165 14% 8%; /* #141a18 */

  /* Accent Colors */
  --accent: 240 2% 25%;               /* #3f3f42 */
  --accent-foreground: 240 2% 96%;    /* #f4f4f5 */

  /* Border Colors */
  --border: 240 100% 100% / 0.08;     /* rgba(255, 255, 255, 0.08) */
  --border-light: 210 17% 6% / 0.1;
  --border-dark: 210 17% 6% / 0.05;

  /* Focus Ring */
  --ring: 165 96% 71%;                /* Matches primary */

  /* Border Radius */
  --radius: 0.5rem;                   /* 8px base radius */
}
```

### Key Color Values (Hex Reference)

| Purpose | Hex Code | HSL | Usage |
|---------|----------|-----|-------|
| **Background** | `#0f1211` | `210 11% 7%` | Main page background |
| **Foreground (Text)** | `#e7eceb` | `160 14% 93%` | Primary text color |
| **Primary Accent** | `#78fcd6` | `165 96% 71%` | CTAs, highlights, links |
| **Primary Dark** | `#00ffb6` | `160 100% 50%` | Hover states, gradients |
| **Muted Background** | `#27272a` | `240 2% 16%` | Card backgrounds, subtle areas |
| **Muted Text** | `rgba(231, 236, 235, 0.7)` | - | Secondary text |
| **Border** | `rgba(255, 255, 255, 0.08)` | - | Subtle borders |

### Primary Gradient

The signature gradient used for CTAs and important elements:

```css
/* Standard gradient */
background: linear-gradient(to right, #78fcd6, #00ffb6);

/* Tailwind classes */
bg-gradient-to-r from-[#78fcd6] to-[#00ffb6]

/* Hover state (reversed) */
hover:from-[#00ffb6] hover:to-[#78fcd6]
```

### Color with Opacity Patterns

```css
/* Backgrounds with transparency */
bg-[#78fcd6]/10   /* 10% opacity - subtle backgrounds */
bg-[#78fcd6]/20   /* 20% opacity - hover backgrounds */
bg-[#78fcd6]/30   /* 30% opacity - active states */

/* Border with transparency */
border-[#78fcd6]/30   /* Subtle accent borders */
border-[#78fcd6]/50   /* More visible borders */

/* Shadow with color */
shadow-[#78fcd6]/20   /* Subtle colored shadows */
shadow-[#78fcd6]/30   /* Standard colored shadows */
shadow-[#78fcd6]/50   /* Prominent colored shadows */
```

---

## Typography

### Font Family

**Primary Font**: Geist Sans (Variable font from Vercel)
**Monospace Font**: Geist Mono (for code snippets)

```tsx
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'

// Applied globally
html {
  font-family: ${GeistSans.style.fontFamily};
  --font-sans: ${GeistSans.variable};
  --font-mono: ${GeistMono.variable};
}
```

### Responsive Font Sizes

Custom responsive font sizes that scale smoothly across breakpoints:

```ts
// tailwind.config.ts
fontSize: {
  // Micro sizes
  'micro': ['0.563rem', { lineHeight: '0.75rem' }],           // 9px
  '2xs': ['0.625rem', { lineHeight: '0.875rem' }],            // 10px
  '2xs-responsive': ['clamp(0.563rem, 0.5rem + 0.15vw, 0.688rem)', { lineHeight: '0.875rem' }], // 9px → 11px
  'xs-micro': ['clamp(0.625rem, 0.563rem + 0.15vw, 0.75rem)', { lineHeight: '1rem' }],          // 10px → 12px

  // Standard responsive sizes
  'xs-responsive': ['0.75rem', { lineHeight: '1rem' }],       // 12px (static)
  'sm-responsive': ['clamp(0.813rem, 0.75rem + 0.15vw, 0.938rem)', { lineHeight: '1.25rem' }],  // 13px → 15px
  'base-responsive': ['clamp(0.875rem, 0.813rem + 0.15vw, 1rem)', { lineHeight: '1.5rem' }],    // 14px → 16px
  'md-responsive': ['clamp(0.938rem, 0.875rem + 0.15vw, 1.063rem)', { lineHeight: '1.75rem' }], // 15px → 17px
  'lg-responsive': ['clamp(1rem, 0.938rem + 0.15vw, 1.125rem)', { lineHeight: '1.75rem' }],     // 16px → 18px
  'xl-responsive': ['clamp(1.125rem, 1rem + 0.3vw, 1.25rem)', { lineHeight: '1.75rem' }],       // 18px → 20px
  '2xl-responsive': ['clamp(1.25rem, 1.125rem + 0.3vw, 1.5rem)', { lineHeight: '2rem' }],       // 20px → 24px
  '3xl-responsive': ['clamp(1.5rem, 1.25rem + 0.5vw, 1.875rem)', { lineHeight: '2.25rem' }],    // 24px → 30px
  '4xl-responsive': ['clamp(1.875rem, 1.5rem + 0.75vw, 2.25rem)', { lineHeight: '2.5rem' }],    // 30px → 36px
  '5xl-responsive': ['clamp(2.25rem, 1.875rem + 1vw, 3rem)', { lineHeight: '1' }],              // 36px → 48px
}
```

### Font Weight Usage

| Weight | Class | Usage |
|--------|-------|-------|
| Normal | `font-normal` | Body text, descriptions |
| Medium | `font-medium` | Labels, secondary headings, buttons |
| Semibold | `font-semibold` | Section headings, important text |
| Bold | `font-bold` | Hero headings, CTAs, emphasis |

### Heading Hierarchy

```tsx
// H1 - Hero headings
<h1 className="text-foreground text-[clamp(3rem,3.75vw,3.5rem)] font-bold leading-tight tracking-tight">

// H2 - Section headings
<h2 className="text-foreground text-3xl md:text-4xl lg:text-5xl font-bold mb-4">

// H3 - Card/subsection headings
<h3 className="text-foreground text-xl md:text-2xl font-bold leading-tight">

// H4 - Small section headings
<h4 className="text-foreground text-sm md:text-base font-semibold mb-1">
```

### Text Utilities

```css
/* Reading text (optimized for mobile readability) */
.text-reading { @apply text-md-responsive; }
.text-reading-small { @apply text-base-responsive; }
.text-reading-muted { @apply text-reading text-muted-foreground; }
```

---

## Spacing & Layout

### Container

```ts
container: {
  center: true,
  padding: "2rem",
  screens: {
    "2xl": "1400px",
  },
}
```

### Breakpoints

```ts
screens: {
  'xs': '360px',
  'sm': '640px',
  'md': '768px',
  'lg': '1024px',
  'xl': '1280px',
  '2xl': '1440px',
  '3xl': '1600px',
  '4xl': '1920px',
}
```

### Common Spacing Patterns

```tsx
// Section padding
className="py-16 md:py-24 lg:py-32 px-4 md:px-8"

// Card padding
className="p-6 md:p-8 lg:p-10"

// Gap between items
className="gap-4 md:gap-6 lg:gap-8"

// Margin between sections
className="mb-8 md:mb-12 lg:mb-16"
```

### Border Radius

```ts
borderRadius: {
  lg: "var(--radius)",           // 0.5rem (8px)
  md: "calc(var(--radius) - 2px)", // 6px
  sm: "calc(var(--radius) - 4px)", // 4px
}

// Common patterns
rounded-lg    // Standard cards, buttons
rounded-xl    // Larger cards, modals
rounded-2xl   // Hero sections, major containers
rounded-full  // Pill buttons, avatars, badges
```

---

## Components

### Button Variants

```tsx
// Primary CTA Button (Gradient)
<Button className="bg-gradient-to-r from-[#78fcd6] to-[#00ffb6] text-[#0f1211] hover:from-[#00ffb6] hover:to-[#78fcd6] px-8 py-3 rounded-full font-semibold shadow-lg hover:shadow-[#78fcd6]/50 ring-2 ring-[#78fcd6]/30 transition-all duration-300 hover:scale-105">

// Secondary Button (Outline with Gradient BG)
<Button className="border-[#78fcd6]/30 text-foreground hover:bg-[#78fcd6]/10 hover:border-[#78fcd6]/50 px-8 py-6 font-semibold">

// Ghost Button (Subtle)
<Button className="bg-gradient-to-r from-[#78fcd6]/20 to-[#00ffb6]/20 border border-[#78fcd6]/30 text-[#78fcd6] hover:from-[#78fcd6]/30 hover:to-[#00ffb6]/30 rounded-xl">

// Solid Primary Button
<Button className="bg-[#78fcd6] text-[#0f1211] hover:bg-[#00ffb6] px-6 py-2 rounded-full font-medium shadow-sm transition-colors">
```

### Card Styles

```tsx
// Standard Card
<div className="rounded-lg border bg-card text-card-foreground shadow-sm">

// Glass-morphism Card
<div className="bg-card/50 backdrop-blur-sm p-8 md:p-10 rounded-2xl border border-border shadow-xl hover:shadow-2xl hover:shadow-[#78fcd6]/10 transition-shadow transition-colors duration-500 hover:border-[#78fcd6]/20">

// Interactive Card with Hover
<div className="group bg-muted/30 rounded-2xl p-6 border border-border hover:border-[#78fcd6]/30 transition-all duration-300 hover:shadow-lg hover:shadow-[#78fcd6]/10">
```

### Input Fields

```tsx
<input className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm" />
```

### Labels

```tsx
<label className="text-sm font-medium text-foreground">
```

### Quick Reply Buttons (Chat Widget Style)

```tsx
<button className="text-xs px-3 py-1.5 border border-[#78fcd6]/30 rounded-full hover:bg-[#78fcd6]/10 hover:border-[#78fcd6]/50 transition-all duration-300 bg-gradient-to-r from-black/20 to-transparent backdrop-blur-sm text-[#78fcd6] font-medium hover:shadow-lg hover:shadow-[#78fcd6]/20 hover:scale-105">
```

### Badges/Pills

```tsx
<span className="text-xs px-2 py-1 rounded-full bg-[#78fcd6]/10 text-[#78fcd6] font-medium ring-1 ring-[#78fcd6]/30">
```

### Icon Containers

```tsx
// Gradient icon container
<div className="w-11 h-11 md:w-14 md:h-14 shrink-0 rounded-xl md:rounded-2xl bg-gradient-to-br from-[#78fcd6]/30 to-[#00ffb6]/20 text-[#78fcd6] flex items-center justify-center font-bold text-lg md:text-xl shadow-lg shadow-[#78fcd6]/20 ring-2 ring-[#78fcd6]/20 group-hover:scale-110 transition-transform duration-300">
```

---

## Animations & Transitions

### Keyframe Animations

```ts
// tailwind.config.ts
keyframes: {
  "accordion-down": {
    from: { height: "0" },
    to: { height: "var(--radix-accordion-content-height)" },
  },
  "accordion-up": {
    from: { height: "var(--radix-accordion-content-height)" },
    to: { height: "0" },
  },
  "fade-in": {
    from: { opacity: "0" },
    to: { opacity: "1" },
  },
  "slide-in-from-bottom": {
    from: { transform: "translate3d(0, 20px, 0)", opacity: "0" },
    to: { transform: "translate3d(0, 0, 0)", opacity: "1" },
  },
  "slide-in-from-bottom-2": {
    from: { transform: "translate3d(0, 40px, 0)", opacity: "0" },
    to: { transform: "translate3d(0, 0, 0)", opacity: "1" },
  },
  "slide-in-from-bottom-3": {
    from: { transform: "translate3d(0, 60px, 0)", opacity: "0" },
    to: { transform: "translate3d(0, 0, 0)", opacity: "1" },
  },
  "slide-in-from-left": {
    from: { transform: "translate3d(-20px, 0, 0)", opacity: "0" },
    to: { transform: "translate3d(0, 0, 0)", opacity: "1" },
  },
  "slide-in-from-right": {
    from: { transform: "translate3d(20px, 0, 0)", opacity: "0" },
    to: { transform: "translate3d(0, 0, 0)", opacity: "1" },
  },
  "zoom-in": {
    from: { transform: "scale3d(0.95, 0.95, 1)", opacity: "0" },
    to: { transform: "scale3d(1, 1, 1)", opacity: "1" },
  },
}
```

### CSS Custom Animations

```css
/* Glow Pulse */
@keyframes glow-pulse {
  0%, 100% { box-shadow: 0 0 20px rgba(120, 252, 214, 0.3); }
  50% { box-shadow: 0 0 30px rgba(120, 252, 214, 0.6); }
}
.animate-glow-pulse { animation: glow-pulse 2s ease-in-out infinite; }

/* Floating effect */
@keyframes float {
  0%, 100% { transform: translateY(0px); }
  50% { transform: translateY(-10px); }
}
.animate-float { animation: float 3s ease-in-out infinite; }

/* Shimmer effect */
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
.animate-shimmer { animation: shimmer 2s infinite; }

/* Border glow animation */
@keyframes border-glow {
  0% {
    border-color: rgba(120, 252, 214, 0.6);
    box-shadow: 0 0 10px rgba(120, 252, 214, 0.4),
                0 0 20px rgba(120, 252, 214, 0.3),
                0 0 30px rgba(120, 252, 214, 0.2),
                inset 0 0 10px rgba(120, 252, 214, 0.1);
  }
  50% {
    border-color: rgba(120, 252, 214, 1);
    box-shadow: 0 0 20px rgba(120, 252, 214, 0.6),
                0 0 30px rgba(120, 252, 214, 0.5),
                0 0 40px rgba(120, 252, 214, 0.4),
                inset 0 0 20px rgba(120, 252, 214, 0.2);
  }
  100% {
    border-color: rgba(120, 252, 214, 0.6);
    box-shadow: 0 0 10px rgba(120, 252, 214, 0.4),
                0 0 20px rgba(120, 252, 214, 0.3),
                0 0 30px rgba(120, 252, 214, 0.2),
                inset 0 0 10px rgba(120, 252, 214, 0.1);
  }
}
.animate-border-glow { animation: border-glow 3s ease-in-out infinite; }

/* Text glow effect */
.text-glow-cyan {
  text-shadow: 
    0 0 10px rgba(120, 252, 214, 0.3),
    0 0 20px rgba(120, 252, 214, 0.2),
    0 0 30px rgba(0, 255, 182, 0.1);
}
```

### Transition Patterns

```tsx
// Standard transition
transition-all duration-300

// Color transitions
transition-colors duration-300

// Scale on hover
hover:scale-105 transition-transform duration-300

// Combined hover effects
hover:shadow-lg hover:shadow-[#78fcd6]/20 hover:scale-105 transition-all duration-300
```

### Animation Delays

```ts
animationDelay: {
  "100": "100ms",
  "200": "200ms",
  "300": "300ms",
  "400": "400ms",
  "500": "500ms",
  "600": "600ms",
  "700": "700ms",
}
```

---

## Shadows & Effects

### Standard Shadows

```tsx
shadow-sm      // Subtle shadow
shadow-lg      // Standard elevation
shadow-xl      // Higher elevation
shadow-2xl     // Maximum elevation

// Colored shadows
shadow-[#78fcd6]/20   // Subtle teal glow
shadow-[#78fcd6]/30   // Medium teal glow
shadow-[#78fcd6]/50   // Strong teal glow
```

### Glass-morphism Effect

```tsx
className="bg-card/50 backdrop-blur-sm"
className="bg-gradient-to-r from-black/20 to-transparent backdrop-blur-sm"
```

### Ring Effects

```tsx
ring-1 ring-[#78fcd6]/30        // Subtle ring
ring-2 ring-[#78fcd6]/20        // Standard ring
hover:ring-4 hover:ring-[#78fcd6]/40  // Expanded hover ring
```

---

## Responsive Design

### Mobile-First Patterns

```tsx
// Typography scaling
text-base md:text-lg lg:text-xl

// Spacing scaling
p-4 md:p-6 lg:p-8
gap-4 md:gap-6 lg:gap-8
py-16 md:py-24 lg:py-32

// Layout changes
flex-col md:flex-row
grid-cols-1 md:grid-cols-2 lg:grid-cols-3

// Visibility
hidden md:flex
md:hidden

// Size scaling
w-10 h-10 md:w-14 md:h-14
```

### Performance Optimization

```css
/* Reduce work below the fold */
.belowFold {
  content-visibility: auto;
  contain-intrinsic-size: 1000px 800px;
}

/* Respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  * {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
```

---

## Accessibility

### Focus States

```tsx
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2
```

### Text Rendering

```css
h1, h2, h3, h4, h5, h6, p {
  font-display: swap;
  text-rendering: optimizeSpeed;
}
```

### Disabled States

```tsx
disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed
```

---

## Code Examples

### Complete Primary CTA Button

```tsx
<Button 
  className="w-full bg-gradient-to-r from-[#78fcd6] to-[#00ffb6] text-[#0f1211] 
             hover:from-[#00ffb6] hover:to-[#78fcd6] 
             px-8 py-6 rounded-full font-semibold text-lg 
             shadow-2xl ring-2 ring-[#78fcd6]/30 
             transition-all duration-300 hover:scale-105 hover:shadow-[#78fcd6]/50 
             disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
>
  Get Started
</Button>
```

### Complete Card Component

```tsx
<div className="group bg-card/50 backdrop-blur-sm p-8 md:p-10 rounded-2xl 
                border border-border shadow-xl 
                hover:shadow-2xl hover:shadow-[#78fcd6]/10 
                transition-shadow transition-colors duration-500 
                hover:border-[#78fcd6]/20">
  <h3 className="text-foreground text-xl md:text-2xl font-bold 
                 group-hover:text-[#78fcd6] transition-colors duration-300">
    Card Title
  </h3>
  <p className="text-muted-foreground text-md-responsive leading-relaxed mt-4">
    Card description text goes here.
  </p>
</div>
```

### Hero Section Pattern

```tsx
<section className="py-16 md:py-24 lg:py-32 px-4 md:px-8">
  <div className="max-w-4xl mx-auto text-center">
    <h1 className="text-foreground text-4xl md:text-5xl lg:text-6xl font-bold 
                   leading-tight bg-gradient-to-r from-white via-white to-white/80 
                   bg-clip-text text-transparent">
      Headline Text Here
    </h1>
    <p className="text-muted-foreground text-lg md:text-xl font-medium 
                  leading-relaxed mt-6 max-w-2xl mx-auto">
      Supporting description text that explains the value proposition.
    </p>
    <div className="flex flex-col sm:flex-row gap-4 justify-center mt-8">
      <Button className="bg-gradient-to-r from-[#78fcd6] to-[#00ffb6] 
                         text-[#0f1211] hover:from-[#00ffb6] hover:to-[#78fcd6] 
                         rounded-full font-semibold px-8 py-3">
        Primary CTA
      </Button>
      <Button className="border-[#78fcd6]/30 text-foreground 
                         hover:bg-[#78fcd6]/10 hover:border-[#78fcd6]/50 
                         rounded-full font-medium px-8 py-3" 
              variant="outline">
        Secondary CTA
      </Button>
    </div>
  </div>
</section>
```

### Feature Card with Icon

```tsx
<div className="group flex gap-4 p-6 rounded-2xl bg-muted/30 border border-border 
                hover:border-[#78fcd6]/30 transition-all duration-300 
                hover:shadow-lg hover:shadow-[#78fcd6]/10">
  {/* Icon Container */}
  <div className="w-12 h-12 shrink-0 rounded-xl bg-gradient-to-br 
                  from-[#78fcd6]/30 to-[#00ffb6]/20 text-[#78fcd6] 
                  flex items-center justify-center 
                  shadow-lg shadow-[#78fcd6]/20 ring-2 ring-[#78fcd6]/20 
                  group-hover:scale-110 transition-transform duration-300">
    <IconComponent className="w-6 h-6" />
  </div>
  
  {/* Content */}
  <div>
    <h4 className="text-foreground text-lg font-bold 
                   group-hover:text-[#78fcd6] transition-colors duration-300">
      Feature Title
    </h4>
    <p className="text-muted-foreground text-base-responsive mt-2">
      Feature description explaining the benefit.
    </p>
  </div>
</div>
```

---

## Dependencies

To replicate this design system, ensure these packages are installed:

```json
{
  "dependencies": {
    "geist": "^1.0.0",
    "tailwindcss": "^3.4.0",
    "tailwindcss-animate": "^1.0.7",
    "@radix-ui/react-slot": "^1.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.0.0",
    "tailwind-merge": "^2.0.0"
  }
}
```

---

## File References

- `app/globals.css` - CSS custom properties and utility classes
- `tailwind.config.ts` - Tailwind theme configuration
- `app/layout.tsx` - Font loading setup
- `components/ui/button.tsx` - Button component variants
- `components/ui/card.tsx` - Card component structure
- `lib/utils.ts` - `cn()` utility for class merging

---

*Last updated: Auto-generated from codebase analysis*

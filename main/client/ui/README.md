# @bslt/ui

> Write once, use everywhere.

Shared React components for the web app. Plain CSS with CSS variables - zero runtime overhead, browser-native dark mode.

## Features

- 26 elements (Button, Input, Badge, Table...) 🧱
- 16 components (Dialog, Tabs, Select, FormField...) 🔲
- 15 layouts (AppShell, Modal, Sidebar, ResizablePanel...) 📐
- 23+ hooks (useDisclosure, useClickOutside, useVirtualScroll...) 🪝
- Custom router (~150 lines, replaces react-router) 🛣️
- CSS variables theming 🎨
- Dark mode (prefers-color-scheme) 🌙
- ~1400 tests passing ✅

## Installation

```bash
pnpm add @bslt/ui
```

## Usage

```typescript
import { Button, Card, Dialog, AppShell, useDisclosure, Router, Routes, Route } from '@bslt/ui';

function MyComponent() {
  const { isOpen, open, close } = useDisclosure();

  return (
    <Router>
      <Routes>
        <Route path="/" element={
          <>
            <Button onClick={open}>Open Dialog</Button>
            <Dialog open={isOpen} onClose={close}>
              <Dialog.Header>Title</Dialog.Header>
              <Dialog.Body>Content</Dialog.Body>
            </Dialog>
          </>
        } />
      </Routes>
    </Router>
  );
}
```

## Architecture

```
┌──────────────┐
│  apps/web    │
│  (10-20%)    │
└──────┬───────┘
       ▼
      ┌──────────────────┐
      │  shared/ui     │
      │  (80-90%)        │
      │                  │
      │  Button, Card,   │
      │  Dialog, Tabs... │
      └──────────────────┘
```

Platform-specific code stays in apps. Everything else lives here.

## Elements

Atomic building blocks (26 total).

```typescript
import {
  Alert, Avatar, Badge, Box, Button, Checkbox, CloseButton,
  Divider, EnvironmentBadge, Heading, Input, Kbd, MenuItem,
  PasswordInput, Progress, Skeleton, Spinner, Switch,
  Table, Text, TextArea, Toaster, Tooltip,
  VersionBadge, VisuallyHidden
} from '@bslt/ui';

// Table has composable parts
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Data</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

## Components

Composed multi-part components (16 total).

```typescript
import {
  Accordion, Card, Dialog, Dropdown, FocusTrap, FormField,
  Image, LoadingContainer, Pagination, Popover,
  Radio, RadioGroup, Select, Slider, Tabs, Toast
} from '@bslt/ui';

// Composable parts
<Card>
  <Card.Header>Title</Card.Header>
  <Card.Body>Content</Card.Body>
  <Card.Footer>Actions</Card.Footer>
</Card>

// Form fields with labels and errors
<FormField label="Email" error={errors.email}>
  <Input type="email" {...register('email')} />
</FormField>
```

## Layouts

Page structure and overlays (15 total).

```typescript
// Containers (4)
import { AuthLayout, Container, PageContainer, StackedLayout } from '@bslt/ui';

// Layers (4)
import { Modal, Overlay, ProtectedRoute, ScrollArea } from '@bslt/ui';

// Shells (7)
import {
  AppShell, BottombarLayout, LeftSidebarLayout,
  ResizablePanel, ResizablePanelGroup, ResizableSeparator,
  RightSidebarLayout, TopbarLayout
} from '@bslt/ui';

// AppShell for complex layouts
<AppShell>
  <AppShell.Topbar>...</AppShell.Topbar>
  <AppShell.Sidebar>...</AppShell.Sidebar>
  <AppShell.Main>...</AppShell.Main>
</AppShell>

// Or use specialized layouts
<LeftSidebarLayout sidebar={<Nav />}>
  <PageContainer>Content</PageContainer>
</LeftSidebarLayout>

// Resizable panels
<ResizablePanelGroup direction="horizontal">
  <ResizablePanel defaultSize={30}>Sidebar</ResizablePanel>
  <ResizableSeparator />
  <ResizablePanel defaultSize={70}>Main</ResizablePanel>
</ResizablePanelGroup>
```

## Hooks

Reusable behavior patterns (23+ hooks).

```typescript
import {
  // State management
  useDisclosure, // open/close state
  useControllableState, // controlled/uncontrolled state
  useFormState, // form field state
  useLocalStorage, // persistent state

  // UI interactions
  useClickOutside, // detect clicks outside element
  useDebounce, // debounced values
  useCopyToClipboard, // copy text to clipboard
  useResendCooldown, // resend button cooldown

  // Navigation
  useHistoryNav, // browser history navigation
  useAuthModeNavigation, // auth mode switching

  // Keyboard
  useKeyboardShortcut, // single shortcut
  useKeyboardShortcuts, // multiple shortcuts
  useUndoRedoShortcuts, // undo/redo with platform detection

  // Responsive
  useMediaQuery, // responsive breakpoints
  useWindowSize, // window dimensions
  useOnScreen, // intersection observer

  // Theming
  useThemeMode, // light/dark mode
  useDensity, // spacing density
  useContrast, // contrast mode
  usePanelConfig, // panel configuration
} from '@bslt/ui';
```

## Router

Custom router implementation (~150 lines) that replaces react-router-dom.

```typescript
import {
  Router, Routes, Route, Link, Navigate,
  useNavigate, useLocation, useParams, useSearchParams,
  useNavigationType, useHistory
} from '@bslt/ui';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/users/:id" element={<UserPage />} />
        <Route path="/old" element={<Navigate to="/new" />} />
      </Routes>
    </Router>
  );
}

function Nav() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigationType = useNavigationType(); // 'PUSH' | 'POP' | 'REPLACE'

  return (
    <>
      <Link to="/home">Home</Link>
      <button onClick={() => navigate('/dashboard')}>Dashboard</Button>
    </>
  );
}
```

**Features:**

- Path params (`:id`), query strings, wildcards (`*`)
- Nested routes with `<Outlet>`
- `MemoryRouter` for testing
- `NavigationType` tracking (PUSH/POP/REPLACE)
- History abstraction (`push`, `replace`, `go`, `back`, `forward`)
- Scroll restoration (save on navigate, restore on back/forward)

**Benchmark (100 navigations with render cycles):**

| Router           | Time    | Per Navigation |
| ---------------- | ------- | -------------- |
| Custom           | ~920ms  | ~9.2ms         |
| react-router-dom | ~1000ms | ~10.0ms        |

**~10% faster** with a fraction of the code. Direct `useSyncExternalStore` integration with no extra abstraction layers.

## Utils

Utility functions for common patterns.

````typescript
import {
  cn,                  // className merge utility
  createFormHandler,   // form submission handler
  parseMarkdown,       // markdown to React
  Markdown,            // markdown component
  SyntaxHighlighter,   // code syntax highlighting
  highlightCode,       // highlight code string
} from '@bslt/ui';

// Merge classNames conditionally
const className = cn('base-class', {
  'active': isActive,
  'disabled': isDisabled
});

// Parse markdown with syntax highlighting
<Markdown content="# Hello\n```ts\nconst x = 1;\n```" />
````

## Theming

CSS variables for zero-runtime theming.

```css
/* theme.css */
:root {
  --ui-color-primary: #2563eb;
  --ui-color-bg: #ffffff;
  --ui-radius-md: 0.625rem;
}

@media (prefers-color-scheme: dark) {
  :root {
    --ui-color-primary: #3b82f6;
    --ui-color-bg: #0b1220;
  }
}
```

### Breakpoints & responsive tokens

Canonical viewport scale (source: `src/theme/breakpoints.ts`, emitted as
`--ui-breakpoint-*`). `@media` rules cannot read `var()`, so every media query
in the codebase must use one of these rem values literally:

| Token | rem | px   | Device class                                       |
| ----- | --- | ---- | -------------------------------------------------- |
| sm    | 30  | 480  | Large phones                                       |
| md    | 48  | 768  | Portrait tablets — mobile cutoff (= `useIsMobile`) |
| lg    | 64  | 1024 | Landscape tablets / small laptops                  |
| xl    | 80  | 1280 | Laptops (fluid-token midpoint)                     |
| 2xl   | 96  | 1536 | Large / ultrawide desktops                         |

Related tokens:

- `--ui-content-max` (90rem) — max readable width for main content areas.
- `--ui-touch-target` (2.75rem / 44px) — minimum hit area applied to
  interactive elements under `@media (pointer: coarse)`.
- Fluid tokens: `--ui-gap-2xl/3xl` and `--ui-font-size-lg/xl` are `clamp()`
  values that scale with the viewport and hit their historical values at an
  80rem viewport (laptops render the classic design unchanged).

TypeScript access:

```typescript
import {
  // Design tokens
  breakpoints, contentMaxWidth, touchTargetSize,
  colors, darkColors, lightColors, spacing, radius, typography, motion,

  // Theme utilities
  ThemeProvider, useTheme,
  getContrastCssVariables, getDensityCssVariables,

  // Density & contrast
  useDensity, useContrast, DEFAULT_DENSITY, DEFAULT_CONTRAST_MODE,
} from '@bslt/ui';

// Wrap app with theme provider
<ThemeProvider defaultMode="dark" defaultDensity="comfortable">
  <App />
</ThemeProvider>
```

## Project Structure

```
shared/ui/src/
├── elements/        # 26 atomic components (Button, Input, Badge...)
├── components/      # 16 composed components (Dialog, Tabs, Select...)
├── layouts/
│   ├── containers/  # 4 containers (Container, PageContainer, AuthLayout, StackedLayout)
│   ├── layers/      # 4 layers (Modal, Overlay, ProtectedRoute, ScrollArea)
│   └── shells/      # 7 shells (AppShell, ResizablePanel, *SidebarLayout...)
├── hooks/           # 23+ hooks (useDisclosure, useVirtualScroll, usePaginatedQuery...)
├── router/          # Custom router (~150 lines)
├── providers/       # Optimized context providers
├── theme/           # Design tokens (colors, spacing, radius, typography, motion, density, contrast)
├── utils/           # Utilities (cn, markdown, syntax highlighting, form handlers)
└── styles/          # CSS files
    ├── theme.css
    ├── elements.css
    ├── components.css
    ├── layouts.css
    └── utilities.css
```

## Commands

```sh
pnpm --filter @bslt/ui build      # build
pnpm --filter @bslt/ui test       # run tests
pnpm --filter @bslt/ui type-check # check types
```

## Creating Components

```typescript
// 1. Create component
// shared/ui/src/elements/Tag.tsx
const Tag = forwardRef<HTMLSpanElement, TagProps>((props, ref) => {
  const { variant = 'default', className = '', ...rest } = props;
  return <span ref={ref} className={`tag tag-${variant} ${className}`} {...rest} />;
});

// 2. Add styles to elements.css
// 3. Export from elements/index.ts
// 4. Write tests
// 5. Use anywhere
import { Tag } from '@bslt/ui';
```

## Trade-offs

**CSS variables over CSS-in-JS:** Zero runtime, browser-native theming. No dynamic prop-based styles.

**Explicit exports:** More maintenance, but reliable tree-shaking.

**Composition over configuration:** Simple components, compose the pieces yourself.

**Platform-agnostic:** No platform-specific optimizations in shared code.

---

[Read the detailed docs](../../docs) for architecture decisions, development workflows, and contribution guidelines.

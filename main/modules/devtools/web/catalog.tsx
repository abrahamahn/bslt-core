// main/modules/devtools/web/catalog.tsx
import {
  Accordion,
  Alert,
  AppShell,
  AspectRatio,
  AsyncBoundary,
  AuthFormLayout,
  AuthLayout,
  Avatar,
  Badge,
  BottombarLayout,
  Box,
  Button,
  Card,
  Center,
  Checkbox,
  CloseButton,
  Cluster,
  Container,
  DelayedFallback,
  Dialog,
  Divider,
  Dropdown,
  EmptyState,
  EnvironmentBadge,
  ErrorBoundary,
  FeatureHint,
  FileInput,
  FocusTrap,
  FormField,
  Grid,
  Heading,
  ICON_SPRITE,
  Icon,
  IconButton,
  Image,
  Inline,
  Input,
  Kbd,
  LabeledValueRow,
  LeftSidebarLayout,
  Markdown,
  MenuItem,
  MetricValue,
  OAuthButton,
  Overlay,
  PageContainer,
  PageHeader,
  PageShell,
  Pagination,
  PasswordInput,
  PeekLink,
  Popover,
  Progress,
  Radio,
  RadioGroup,
  ResizablePanel,
  ResizablePanelGroup,
  ResizableSeparator,
  RightSidebarLayout,
  ScrollArea,
  Select,
  SidePeek,
  Skeleton,
  SkipLink,
  Slider,
  Spinner,
  Stack,
  StackedLayout,
  StatusBadge,
  Switch,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  Text,
  TextArea,
  ThemeProvider,
  TitledCardSection,
  Toaster,
  Tooltip,
  TopbarLayout,
  VersionBadge,
  VisuallyHidden,
  buildBrandScale,
  type IconName,
} from '@bslt/ui';

import type { ReactNode } from 'react';

export type ComponentCategory = 'elements' | 'components' | 'hooks' | 'layouts' | 'theme' | 'utils';

export type ComponentVariant = {
  name: string;
  description: string;
  code: string;
  render: () => ReactNode;
};

export type ComponentDemo = {
  id: string;
  name: string;
  category: ComponentCategory;
  description: string;
  variants: ComponentVariant[];
  props?: Record<string, unknown>;
  docs?: string;
  relatedDocs?: string[];
};

export type UILibraryPaneConfig = {
  top: { visible: boolean; size: number };
  left: { visible: boolean; size: number };
  right: { visible: boolean; size: number };
  bottom: { visible: boolean; size: number };
};

const SAMPLES = {
  primaryButton: 'Primary Button',
  secondaryButton: 'Secondary Button',
  disabledButton: 'Disabled Button',
  infoAlert: 'Information message',
  successAlert: 'Success message',
  warningAlert: 'Warning message',
  dangerAlert: 'Error message',
  activeBadge: 'Active',
  pendingBadge: 'Pending',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  passwordPlaceholder: 'Enter password',
  passwordAria: 'Account password',
  notesPlaceholder: 'Add notes...',
  notesAria: 'Workspace notes',
  cardHeading: 'Summary Card',
  cardBody: 'Structured container for grouped settings and metrics.',
  enableNotifications: 'Enable notifications',
  autoSave: 'Auto-save drafts',
  optionStarter: 'Starter',
  optionPro: 'Pro',
  selectAria: 'Plan tier',
  colName: 'Name',
  colStatus: 'Status',
  rowApi: 'API Gateway',
  rowHealthy: 'Healthy',
  tableCaption: 'Active platform services',
  tableFooterLabel: 'Total services',
  tableFooterCount: '1',
  containerHeading: 'Responsive Container',
  containerBody: 'Constrained content width for readable layouts.',
  pageHeading: 'Page Container',
  pageBody: 'Standard padded workspace frame.',
  pageEyebrow: 'Foundation',
  boxFirst: 'Item 1',
  boxSecond: 'Item 2',
  closeAria: 'Dismiss item',
  fileInputLabel: 'Upload attachment',
  iconActionAria: 'Open notifications',
  kbdShortcut: 'Ctrl+K',
  menuItemLabel: 'Account Settings',
  oauthContinue: 'Continue with GitHub',
  skipLinkLabel: 'Skip to content',
  tooltipContent: 'Helpful keyboard shortcut',
  tooltipTrigger: 'Hover target',
  visuallyHiddenCopy: 'Screen reader announcement',
  authHeader: 'Sign in to workspace',
  authFooter: 'Protected by MFA',
  delayedText: 'Loading preview...',
  dialogTrigger: 'Dialog Preview',
  dialogTitle: 'Confirm action',
  dialogDescription: 'Review changes before applying.',
  dropdownTrigger: 'Actions',
  emptyTitle: 'No items yet',
  emptyDescription: 'Create your first record to populate this view.',
  errorHealthy: 'Protected subtree',
  hintTitle: 'Quick tip',
  hintDescription: 'Press slash to filter results.',
  focusTrapButton: 'Focused control',
  imageAlt: 'Brand mark preview',
  imageFallback: 'Image preview',
  labeledRowLabel: 'Environment',
  labeledRowValue: 'Production',
  markdownSample: '**Bold** and `inline code` preview.',
  metricLabel: 'Monthly active users',
  metricValue: 1280,
  paginationAria: 'Catalog pages',
  peekLinkCopy: 'Open in Side Peek',
  popoverTrigger: 'Details',
  popoverAria: 'Show details popover',
  radioStarter: 'Starter plan',
  radioPro: 'Pro plan',
  radioGroupAria: 'Billing tier',
  sliderAria: 'Volume level',
  statusLive: 'Live',
  tabOverview: 'Overview',
  tabActivity: 'Activity',
  tabOverviewBody: 'Primary overview panel.',
  tabActivityBody: 'Recent activity stream.',
  titledSectionHeading: 'Security posture',
  shellTop: 'Top bar',
  shellSide: 'Navigation',
  shellRight: 'Inspector',
  shellBottom: 'Bottom bar',
  shellMain: 'Workspace content',
  authLayoutTitle: 'Welcome back',
  authLayoutDesc: 'Enter your credentials to continue.',
  stackedHero: 'Hero banner',
  themePreview: 'Theme context active',
  inlineImageSvg:
    'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="40"><rect width="64" height="40" fill="%232856c6"/></svg>',
} as const;

const SAMPLE_ICONS: readonly IconName[] = ['bell', 'check', 'lock', 'mail'];

export const componentCatalog: Record<string, ComponentDemo> = {
  // ===========================================================================
  // Elements (37)
  // ===========================================================================
  alert: {
    id: 'alert',
    name: 'Alert',
    category: 'elements',
    description: 'Contextual status banner',
    variants: [
      {
        name: 'Info',
        description: 'Informational tone',
        code: '<Alert tone="info">Information message</Alert>',
        render: () => <Alert tone="info">{SAMPLES.infoAlert}</Alert>,
      },
      {
        name: 'Success',
        description: 'Success tone',
        code: '<Alert tone="success">Success message</Alert>',
        render: () => <Alert tone="success">{SAMPLES.successAlert}</Alert>,
      },
      {
        name: 'Warning',
        description: 'Warning tone',
        code: '<Alert tone="warning">Warning message</Alert>',
        render: () => <Alert tone="warning">{SAMPLES.warningAlert}</Alert>,
      },
      {
        name: 'Danger',
        description: 'Danger tone',
        code: '<Alert tone="danger">Error message</Alert>',
        render: () => <Alert tone="danger">{SAMPLES.dangerAlert}</Alert>,
      },
    ],
  },
  avatar: {
    id: 'avatar',
    name: 'Avatar',
    category: 'elements',
    description: 'User avatar with fallback initials',
    variants: [
      {
        name: 'Initials',
        description: 'Fallback initials avatar',
        code: '<Avatar fallback="JD" />',
        render: () => <Avatar fallback="JD" />,
      },
    ],
  },
  badge: {
    id: 'badge',
    name: 'Badge',
    category: 'elements',
    description: 'Compact status pill',
    variants: [
      {
        name: 'Success',
        description: 'Success status pill',
        code: '<Badge tone="success">Active</Badge>',
        render: () => <Badge tone="success">{SAMPLES.activeBadge}</Badge>,
      },
      {
        name: 'Warning',
        description: 'Warning status pill',
        code: '<Badge tone="warning">Pending</Badge>',
        render: () => <Badge tone="warning">{SAMPLES.pendingBadge}</Badge>,
      },
    ],
  },
  box: {
    id: 'box',
    name: 'Box',
    category: 'elements',
    description: 'Flex container with spacing controls',
    variants: [
      {
        name: 'Row',
        description: 'Horizontal flex row',
        code: '<Box flexDirection="row"><Button>Item 1</Button></Box>',
        render: () => (
          <Box flexDirection="row" padding="var(--ui-gap-md)" className="gap-2">
            <Button size="small">{SAMPLES.boxFirst}</Button>
            <Button size="small" variant="secondary">
              {SAMPLES.boxSecond}
            </Button>
          </Box>
        ),
      },
    ],
  },
  button: {
    id: 'button',
    name: 'Button',
    category: 'elements',
    description: 'Interactive button element with variants and sizes',
    variants: [
      {
        name: 'Primary',
        description: 'Default primary button',
        code: '<Button>Primary Button</Button>',
        render: () => <Button>{SAMPLES.primaryButton}</Button>,
      },
      {
        name: 'Secondary',
        description: 'Secondary button variant',
        code: '<Button variant="secondary">Secondary Button</Button>',
        render: () => <Button variant="secondary">{SAMPLES.secondaryButton}</Button>,
      },
      {
        name: 'Disabled',
        description: 'Disabled button state',
        code: '<Button disabled>Disabled Button</Button>',
        render: () => <Button disabled>{SAMPLES.disabledButton}</Button>,
      },
    ],
  },
  checkbox: {
    id: 'checkbox',
    name: 'Checkbox',
    category: 'elements',
    description: 'Accessible boolean checkbox input',
    variants: [
      {
        name: 'Checked',
        description: 'Labeled checked state',
        code: '<Checkbox checked label="Enable notifications" />',
        render: () => <Checkbox checked label={SAMPLES.enableNotifications} onChange={() => {}} />,
      },
    ],
  },
  closeButton: {
    id: 'closeButton',
    name: 'CloseButton',
    category: 'elements',
    description: 'Icon-only dismiss button',
    variants: [
      {
        name: 'Default',
        description: 'Standard dismiss control',
        code: '<CloseButton aria-label="Dismiss item" />',
        render: () => <CloseButton aria-label={SAMPLES.closeAria} />,
      },
    ],
  },
  divider: {
    id: 'divider',
    name: 'Divider',
    category: 'elements',
    description: 'Decorative horizontal rule',
    variants: [
      {
        name: 'Horizontal',
        description: 'Section separator rule',
        code: '<Divider />',
        render: () => (
          <div className="w-full">
            <Text size="sm">{SAMPLES.boxFirst}</Text>
            <Divider />
            <Text size="sm">{SAMPLES.boxSecond}</Text>
          </div>
        ),
      },
    ],
  },
  environmentBadge: {
    id: 'environmentBadge',
    name: 'EnvironmentBadge',
    category: 'elements',
    description: 'Runtime environment indicator pill',
    variants: [
      {
        name: 'Development',
        description: 'Short environment tag',
        code: '<EnvironmentBadge environment="development" />',
        render: () => <EnvironmentBadge environment="development" />,
      },
    ],
  },
  fileInput: {
    id: 'fileInput',
    name: 'FileInput',
    category: 'elements',
    description: 'Accessible file picker trigger',
    variants: [
      {
        name: 'Field',
        description: 'Labeled file input control',
        code: '<FileInput aria-label="Upload attachment" />',
        render: () => <FileInput aria-label={SAMPLES.fileInputLabel} />,
      },
    ],
  },
  heading: {
    id: 'heading',
    name: 'Heading',
    category: 'elements',
    description: 'Semantic section heading scale',
    variants: [
      {
        name: 'Medium',
        description: 'Section heading',
        code: '<Heading as="h3" size="md">Summary Card</Heading>',
        render: () => (
          <Heading as="h3" size="md">
            {SAMPLES.cardHeading}
          </Heading>
        ),
      },
    ],
  },
  icon: {
    id: 'icon',
    name: 'Icon',
    category: 'elements',
    description: `Owned SVG icon sprite (${String(Object.keys(ICON_SPRITE).length)} icons)`,
    variants: [
      {
        name: 'Sprite Set',
        description: 'Sample owned vector icons',
        code: '<Icon name="bell" />',
        render: () => (
          <Inline gap="sm">
            {SAMPLE_ICONS.map((icon) => (
              <Icon key={icon} name={icon} />
            ))}
          </Inline>
        ),
      },
    ],
  },
  iconButton: {
    id: 'iconButton',
    name: 'IconButton',
    category: 'elements',
    description: 'Square accessible icon button',
    variants: [
      {
        name: 'Bell',
        description: 'Icon slot button with accessible label',
        code: '<IconButton icon="bell" aria-label="Open notifications" />',
        render: () => <IconButton icon="bell" aria-label={SAMPLES.iconActionAria} />,
      },
    ],
  },
  input: {
    id: 'input',
    name: 'Input',
    category: 'elements',
    description: 'Single-line text input primitive',
    variants: [
      {
        name: 'Default',
        description: 'Text input with control contrast border',
        code: '<Input placeholder="you@example.com" />',
        render: () => (
          <Input
            aria-label={SAMPLES.emailLabel}
            placeholder={SAMPLES.emailPlaceholder}
            defaultValue=""
          />
        ),
      },
    ],
  },
  kbd: {
    id: 'kbd',
    name: 'Kbd',
    category: 'elements',
    description: 'Keyboard shortcut keycap label',
    variants: [
      {
        name: 'Shortcut',
        description: 'Inline key combination',
        code: '<Kbd>Ctrl+K</Kbd>',
        render: () => <Kbd>{SAMPLES.kbdShortcut}</Kbd>,
      },
    ],
  },
  menuItem: {
    id: 'menuItem',
    name: 'MenuItem',
    category: 'elements',
    description: 'Interactive menu action row',
    variants: [
      {
        name: 'Default',
        description: 'Selectable menu item',
        code: '<MenuItem>Account Settings</MenuItem>',
        render: () => <MenuItem>{SAMPLES.menuItemLabel}</MenuItem>,
      },
    ],
  },
  oAuthButton: {
    id: 'oAuthButton',
    name: 'OAuthButton',
    category: 'elements',
    description: 'Federated identity provider button',
    variants: [
      {
        name: 'Provider',
        description: 'Secondary full-width provider trigger',
        code: '<OAuthButton>Continue with GitHub</OAuthButton>',
        render: () => <OAuthButton>{SAMPLES.oauthContinue}</OAuthButton>,
      },
    ],
  },
  passwordInput: {
    id: 'passwordInput',
    name: 'PasswordInput',
    category: 'elements',
    description: 'Password field with visibility toggle',
    variants: [
      {
        name: 'Default',
        description: 'Masked password input',
        code: '<PasswordInput placeholder="Enter password" />',
        render: () => (
          <PasswordInput
            aria-label={SAMPLES.passwordAria}
            placeholder={SAMPLES.passwordPlaceholder}
            defaultValue=""
          />
        ),
      },
    ],
  },
  progress: {
    id: 'progress',
    name: 'Progress',
    category: 'elements',
    description: 'Determinate completion bar',
    variants: [
      {
        name: 'Determinate',
        description: '65% progress bar',
        code: '<Progress value={65} />',
        render: () => (
          <div className="w-full">
            <Progress value={65} />
          </div>
        ),
      },
    ],
  },
  skeleton: {
    id: 'skeleton',
    name: 'Skeleton',
    category: 'elements',
    description: 'Loading placeholder shimmer block',
    variants: [
      {
        name: 'Line',
        description: 'Single line placeholder',
        code: '<Skeleton height="1rem" width="8rem" />',
        render: () => <Skeleton height="1rem" width="8rem" />,
      },
    ],
  },
  skipLink: {
    id: 'skipLink',
    name: 'SkipLink',
    category: 'elements',
    description: 'Keyboard-focusable landmark bypass link',
    variants: [
      {
        name: 'Default',
        description: 'Skip to main landmark anchor',
        code: '<SkipLink targetId="main-content" />',
        render: () => <SkipLink targetId="main-content" label={SAMPLES.skipLinkLabel} />,
      },
    ],
  },
  spinner: {
    id: 'spinner',
    name: 'Spinner',
    category: 'elements',
    description: 'Indeterminate activity indicator',
    variants: [
      {
        name: 'Default',
        description: 'Animated status spinner',
        code: '<Spinner />',
        render: () => <Spinner />,
      },
    ],
  },
  switch: {
    id: 'switch',
    name: 'Switch',
    category: 'elements',
    description: 'Two-state toggle switch',
    variants: [
      {
        name: 'Checked',
        description: 'Active switch control',
        code: '<Switch checked />',
        render: () => (
          <label className="flex items-center gap-2">
            <Switch checked onChange={() => {}} />
            <Text size="sm">{SAMPLES.autoSave}</Text>
          </label>
        ),
      },
    ],
  },
  table: {
    id: 'table',
    name: 'Table',
    category: 'elements',
    description: 'Structured data table',
    variants: [
      {
        name: 'Basic Table',
        description: 'Header and row cells',
        code: '<Table>...</Table>',
        render: () => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{SAMPLES.colName}</TableHead>
                <TableHead>{SAMPLES.colStatus}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{SAMPLES.rowApi}</TableCell>
                <TableCell>{SAMPLES.rowHealthy}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ),
      },
    ],
  },
  tableBody: {
    id: 'tableBody',
    name: 'TableBody',
    category: 'elements',
    description: 'Semantic tbody group for Table rows',
    variants: [
      {
        name: 'Default',
        description: 'Body rows inside Table',
        code: '<Table><TableBody><TableRow><TableCell>API Gateway</TableCell></TableRow></TableBody></Table>',
        render: () => (
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>{SAMPLES.rowApi}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ),
      },
    ],
  },
  tableCaption: {
    id: 'tableCaption',
    name: 'TableCaption',
    category: 'elements',
    description: 'Accessible caption for data tables',
    variants: [
      {
        name: 'Default',
        description: 'Table with caption summary',
        code: '<Table><TableCaption>Active platform services</TableCaption></Table>',
        render: () => (
          <Table>
            <TableCaption>{SAMPLES.tableCaption}</TableCaption>
            <TableBody>
              <TableRow>
                <TableCell>{SAMPLES.rowApi}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ),
      },
    ],
  },
  tableCell: {
    id: 'tableCell',
    name: 'TableCell',
    category: 'elements',
    description: 'Standard td data cell',
    variants: [
      {
        name: 'Default',
        description: 'Data cell inside TableRow',
        code: '<TableCell>Healthy</TableCell>',
        render: () => (
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>{SAMPLES.rowHealthy}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ),
      },
    ],
  },
  tableFooter: {
    id: 'tableFooter',
    name: 'TableFooter',
    category: 'elements',
    description: 'Summary tfoot section for Table',
    variants: [
      {
        name: 'Summary Row',
        description: 'Table footer totals row',
        code: '<TableFooter><TableRow><TableCell>Total</TableCell></TableRow></TableFooter>',
        render: () => (
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>{SAMPLES.rowApi}</TableCell>
                <TableCell>{SAMPLES.rowHealthy}</TableCell>
              </TableRow>
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell>{SAMPLES.tableFooterLabel}</TableCell>
                <TableCell>{SAMPLES.tableFooterCount}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        ),
      },
    ],
  },
  tableHead: {
    id: 'tableHead',
    name: 'TableHead',
    category: 'elements',
    description: 'Column header th cell',
    variants: [
      {
        name: 'Default',
        description: 'Header column cell',
        code: '<TableHead>Name</TableHead>',
        render: () => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{SAMPLES.colName}</TableHead>
              </TableRow>
            </TableHeader>
          </Table>
        ),
      },
    ],
  },
  tableHeader: {
    id: 'tableHeader',
    name: 'TableHeader',
    category: 'elements',
    description: 'Semantic thead section',
    variants: [
      {
        name: 'Default',
        description: 'Table header row group',
        code: '<TableHeader><TableRow><TableHead>Status</TableHead></TableRow></TableHeader>',
        render: () => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{SAMPLES.colStatus}</TableHead>
              </TableRow>
            </TableHeader>
          </Table>
        ),
      },
    ],
  },
  tableRow: {
    id: 'tableRow',
    name: 'TableRow',
    category: 'elements',
    description: 'Horizontal tr row element',
    variants: [
      {
        name: 'Default',
        description: 'Two-cell row',
        code: '<TableRow><TableCell>API Gateway</TableCell></TableRow>',
        render: () => (
          <Table>
            <TableBody>
              <TableRow>
                <TableCell>{SAMPLES.rowApi}</TableCell>
                <TableCell>{SAMPLES.rowHealthy}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        ),
      },
    ],
  },
  text: {
    id: 'text',
    name: 'Text',
    category: 'elements',
    description: 'Body copy typography primitive',
    variants: [
      {
        name: 'Muted',
        description: 'Secondary body copy',
        code: '<Text tone="muted">Structured container...</Text>',
        render: () => <Text tone="muted">{SAMPLES.cardBody}</Text>,
      },
    ],
  },
  textArea: {
    id: 'textArea',
    name: 'TextArea',
    category: 'elements',
    description: 'Multi-line text input control',
    variants: [
      {
        name: 'Default',
        description: 'Resizable multi-line field',
        code: '<TextArea rows={2} placeholder="Add notes..." />',
        render: () => (
          <TextArea
            aria-label={SAMPLES.notesAria}
            placeholder={SAMPLES.notesPlaceholder}
            rows={2}
            defaultValue=""
          />
        ),
      },
    ],
  },
  toaster: {
    id: 'toaster',
    name: 'Toaster',
    category: 'elements',
    description: 'Toast notification region renderer',
    variants: [
      {
        name: 'Idle Region',
        description: 'Mounted empty toast container',
        code: '<Toaster messages={[]} onDismiss={() => {}} />',
        render: () => (
          <div>
            <Text size="sm" tone="muted">
              {SAMPLES.infoAlert}
            </Text>
            <Toaster messages={[]} onDismiss={() => {}} />
          </div>
        ),
      },
    ],
  },
  tooltip: {
    id: 'tooltip',
    name: 'Tooltip',
    category: 'elements',
    description: 'Hover and focus contextual hint',
    variants: [
      {
        name: 'Top',
        description: 'Button wrapped in Tooltip',
        code: '<Tooltip content="Helpful keyboard shortcut"><Button>Hover target</Button></Tooltip>',
        render: () => (
          <Tooltip content={SAMPLES.tooltipContent}>
            <Button variant="secondary" size="small">
              {SAMPLES.tooltipTrigger}
            </Button>
          </Tooltip>
        ),
      },
    ],
  },
  versionBadge: {
    id: 'versionBadge',
    name: 'VersionBadge',
    category: 'elements',
    description: 'Release version tag pill',
    variants: [
      {
        name: 'Semantic Version',
        description: 'Prefixed release badge',
        code: '<VersionBadge version="1.0.0" />',
        render: () => <VersionBadge version="1.0.0" />,
      },
    ],
  },
  visuallyHidden: {
    id: 'visuallyHidden',
    name: 'VisuallyHidden',
    category: 'elements',
    description: 'Screen-reader-only visually clipped span',
    variants: [
      {
        name: 'Accessible Label',
        description: 'Visible badge paired with SR-only context',
        code: '<VisuallyHidden>Screen reader announcement</VisuallyHidden>',
        render: () => (
          <Inline gap="xs">
            <Badge tone="info">{SAMPLES.activeBadge}</Badge>
            <VisuallyHidden>{SAMPLES.visuallyHiddenCopy}</VisuallyHidden>
          </Inline>
        ),
      },
    ],
  },

  // ===========================================================================
  // Components (26)
  // ===========================================================================
  accordion: {
    id: 'accordion',
    name: 'Accordion',
    category: 'components',
    description: 'Collapsible disclosure sections',
    variants: [
      {
        name: 'Basic',
        description: 'Multi-item accordion',
        code: '<Accordion items={[...]} />',
        render: () => (
          <Accordion
            items={[
              { id: '1', title: 'Section 1', content: 'Content for section 1' },
              { id: '2', title: 'Section 2', content: 'Content for section 2' },
            ]}
          />
        ),
      },
    ],
  },
  asyncBoundary: {
    id: 'asyncBoundary',
    name: 'AsyncBoundary',
    category: 'components',
    description: 'Unified suspense, loading, and error boundary',
    variants: [
      {
        name: 'Resolved',
        description: 'Rendered content inside AsyncBoundary',
        code: '<AsyncBoundary><Text>Ready</Text></AsyncBoundary>',
        render: () => (
          <AsyncBoundary>
            <Text size="sm">{SAMPLES.errorHealthy}</Text>
          </AsyncBoundary>
        ),
      },
    ],
  },
  authFormLayout: {
    id: 'authFormLayout',
    name: 'AuthFormLayout',
    category: 'components',
    description: 'Structured authentication form sections',
    variants: [
      {
        name: 'Standard',
        description: 'Header and content slots',
        code: '<AuthFormLayout>...</AuthFormLayout>',
        render: () => (
          <AuthFormLayout>
            <AuthFormLayout.Header>
              <Heading as="h3" size="sm">
                {SAMPLES.authHeader}
              </Heading>
            </AuthFormLayout.Header>
            <AuthFormLayout.Content>
              <Text size="xs" tone="muted">
                {SAMPLES.authFooter}
              </Text>
            </AuthFormLayout.Content>
          </AuthFormLayout>
        ),
      },
    ],
  },
  card: {
    id: 'card',
    name: 'Card',
    category: 'components',
    description: 'Surface container for grouped content',
    variants: [
      {
        name: 'Titled Card',
        description: 'Card with heading and body copy',
        code: '<Card><Heading as="h3" size="sm">Summary Card</Heading></Card>',
        render: () => (
          <Card className="p-4 space-y-2">
            <Heading as="h3" size="sm">
              {SAMPLES.cardHeading}
            </Heading>
            <Text tone="muted">{SAMPLES.cardBody}</Text>
          </Card>
        ),
      },
    ],
  },
  delayedFallback: {
    id: 'delayedFallback',
    name: 'DelayedFallback',
    category: 'components',
    description: 'Flash-free delayed loading placeholder',
    variants: [
      {
        name: 'Immediate Preview',
        description: 'Zero-delay fallback child',
        code: '<DelayedFallback delay={0}><Text>Loading preview...</Text></DelayedFallback>',
        render: () => (
          <DelayedFallback delay={0}>
            <Text size="sm" tone="muted">
              {SAMPLES.delayedText}
            </Text>
          </DelayedFallback>
        ),
      },
    ],
  },
  dialog: {
    id: 'dialog',
    name: 'Dialog',
    category: 'components',
    description: 'Modal and non-modal dialog primitive',
    variants: [
      {
        name: 'Closed Trigger',
        description: 'Uncontrolled dialog with trigger button',
        code: '<Dialog.Root><Dialog.Trigger>Dialog Preview</Dialog.Trigger>...</Dialog.Root>',
        render: () => (
          <Dialog.Root>
            <Dialog.Trigger>{SAMPLES.dialogTrigger}</Dialog.Trigger>
            <Dialog.Header>
              <Dialog.Title>{SAMPLES.dialogTitle}</Dialog.Title>
              <Dialog.Description>{SAMPLES.dialogDescription}</Dialog.Description>
            </Dialog.Header>
          </Dialog.Root>
        ),
      },
    ],
  },
  dropdown: {
    id: 'dropdown',
    name: 'Dropdown',
    category: 'components',
    description: 'Keyboard-navigable action menu',
    variants: [
      {
        name: 'Bottom Menu',
        description: 'Collapsed dropdown trigger',
        code: '<Dropdown trigger="Actions"><MenuItem>Account Settings</MenuItem></Dropdown>',
        render: () => (
          <Dropdown trigger={SAMPLES.dropdownTrigger}>
            <MenuItem>{SAMPLES.menuItemLabel}</MenuItem>
          </Dropdown>
        ),
      },
    ],
  },
  emptyState: {
    id: 'emptyState',
    name: 'EmptyState',
    category: 'components',
    description: 'Zero-data placeholder card',
    variants: [
      {
        name: 'Default',
        description: 'Title and guidance copy',
        code: '<EmptyState title="No items yet" description="..." />',
        render: () => (
          <EmptyState title={SAMPLES.emptyTitle} description={SAMPLES.emptyDescription} />
        ),
      },
    ],
  },
  errorBoundary: {
    id: 'errorBoundary',
    name: 'ErrorBoundary',
    category: 'components',
    description: 'Render-phase exception boundary',
    variants: [
      {
        name: 'Healthy Subtree',
        description: 'Guarded child content',
        code: '<ErrorBoundary><Text>Protected subtree</Text></ErrorBoundary>',
        render: () => (
          <ErrorBoundary>
            <Text size="sm">{SAMPLES.errorHealthy}</Text>
          </ErrorBoundary>
        ),
      },
    ],
  },
  featureHint: {
    id: 'featureHint',
    name: 'FeatureHint',
    category: 'components',
    description: 'Dismissible onboarding callout anchor',
    variants: [
      {
        name: 'Anchored Control',
        description: 'Wrapped target button',
        code: '<FeatureHint featureKey="catalog-demo" title="Quick tip" description="...">...</FeatureHint>',
        render: () => (
          <FeatureHint
            featureKey="catalog-demo-dismissed"
            title={SAMPLES.hintTitle}
            description={SAMPLES.hintDescription}
          >
            <Button size="small" variant="secondary">
              {SAMPLES.boxFirst}
            </Button>
          </FeatureHint>
        ),
      },
    ],
  },
  focusTrap: {
    id: 'focusTrap',
    name: 'FocusTrap',
    category: 'components',
    description: 'Keyboard Tab loop container',
    variants: [
      {
        name: 'Inline Container',
        description: 'Passive container preview',
        code: '<FocusTrap><Text>Focused control</Text></FocusTrap>',
        render: () => (
          <FocusTrap>
            <Text size="sm">{SAMPLES.focusTrapButton}</Text>
          </FocusTrap>
        ),
      },
    ],
  },
  formField: {
    id: 'formField',
    name: 'FormField',
    category: 'components',
    description: 'Labeled input and validation wrapper',
    variants: [
      {
        name: 'Email & Notes',
        description: 'Paired FormField with Input and TextArea',
        code: '<FormField label="Email"><Input /></FormField>',
        render: () => (
          <div className="space-y-3">
            <FormField label={SAMPLES.emailLabel} htmlFor="catalog-email">
              <Input id="catalog-email" placeholder={SAMPLES.emailPlaceholder} defaultValue="" />
            </FormField>
            <TextArea
              aria-label={SAMPLES.notesAria}
              placeholder={SAMPLES.notesPlaceholder}
              rows={2}
              defaultValue=""
            />
          </div>
        ),
      },
    ],
  },
  image: {
    id: 'image',
    name: 'Image',
    category: 'components',
    description: 'Responsive image element with fallback handling',
    variants: [
      {
        name: 'Inline SVG',
        description: 'Data-URI vector preview',
        code: '<Image src="..." alt="Brand mark preview" />',
        render: () => (
          <Image
            src={SAMPLES.inlineImageSvg}
            alt={SAMPLES.imageAlt}
            fallback={<span>{SAMPLES.imageFallback}</span>}
          />
        ),
      },
    ],
  },
  labeledValueRow: {
    id: 'labeledValueRow',
    name: 'LabeledValueRow',
    category: 'components',
    description: 'Key-value metadata display pair',
    variants: [
      {
        name: 'Default',
        description: 'Static key and value',
        code: '<LabeledValueRow label="Environment" value="Production" />',
        render: () => (
          <LabeledValueRow label={SAMPLES.labeledRowLabel} value={SAMPLES.labeledRowValue} />
        ),
      },
    ],
  },
  markdown: {
    id: 'markdown',
    name: 'Markdown',
    category: 'components',
    description: 'Safe owned Markdown renderer',
    variants: [
      {
        name: 'Inline Formatting',
        description: 'Bold and code span rendering',
        code: '<Markdown>**Bold** and `inline code`</Markdown>',
        render: () => <Markdown>{SAMPLES.markdownSample}</Markdown>,
      },
    ],
  },
  metricValue: {
    id: 'metricValue',
    name: 'MetricValue',
    category: 'components',
    description: 'Formatted KPI stat block with skeleton state',
    variants: [
      {
        name: 'Formatted Number',
        description: 'Numeric KPI metric',
        code: '<MetricValue label="Monthly active users" value={1280} formatNumber />',
        render: () => (
          <MetricValue label={SAMPLES.metricLabel} value={SAMPLES.metricValue} formatNumber />
        ),
      },
    ],
  },
  pagination: {
    id: 'pagination',
    name: 'Pagination',
    category: 'components',
    description: 'Accessible page navigation controls',
    variants: [
      {
        name: 'Multi-page',
        description: 'Page 2 of 5',
        code: '<Pagination value={2} totalPages={5} />',
        render: () => <Pagination value={2} totalPages={5} ariaLabel={SAMPLES.paginationAria} />,
      },
    ],
  },
  peekLink: {
    id: 'peekLink',
    name: 'PeekLink',
    category: 'components',
    description: 'Anchor that opens a SidePeek query target',
    variants: [
      {
        name: 'Default',
        description: 'Side-peek navigation link',
        code: '<PeekLink to="/side-peek-ui-library">Open in Side Peek</PeekLink>',
        render: () => <PeekLink to="/side-peek-ui-library">{SAMPLES.peekLinkCopy}</PeekLink>,
      },
    ],
  },
  popover: {
    id: 'popover',
    name: 'Popover',
    category: 'components',
    description: 'Anchored disclosure card',
    variants: [
      {
        name: 'Bottom',
        description: 'Trigger button with popover content',
        code: '<Popover trigger={<Button>Details</Button>}><Text>...</Text></Popover>',
        render: () => (
          <Popover
            aria-label={SAMPLES.popoverAria}
            trigger={
              <Button size="small" variant="secondary">
                {SAMPLES.popoverTrigger}
              </Button>
            }
          >
            <Text size="sm">{SAMPLES.cardBody}</Text>
          </Popover>
        ),
      },
    ],
  },
  radio: {
    id: 'radio',
    name: 'Radio',
    category: 'components',
    description: 'Single radio option inside RadioGroup',
    variants: [
      {
        name: 'Selected',
        description: 'Checked radio control',
        code: '<RadioGroup name="tier" value="starter"><Radio value="starter" label="Starter plan" /></RadioGroup>',
        render: () => (
          <RadioGroup
            name="catalog-radio-single"
            value="starter"
            aria-label={SAMPLES.radioGroupAria}
          >
            <Radio value="starter" label={SAMPLES.radioStarter} />
          </RadioGroup>
        ),
      },
    ],
  },
  radioGroup: {
    id: 'radioGroup',
    name: 'RadioGroup',
    category: 'components',
    description: 'Roving-focus group of Radio controls',
    variants: [
      {
        name: 'Two Options',
        description: 'Paired billing tier radios',
        code: '<RadioGroup name="plan" value="pro">...</RadioGroup>',
        render: () => (
          <RadioGroup name="catalog-radio-group" value="pro" aria-label={SAMPLES.radioGroupAria}>
            <Radio value="starter" label={SAMPLES.radioStarter} />
            <Radio value="pro" label={SAMPLES.radioPro} />
          </RadioGroup>
        ),
      },
    ],
  },
  select: {
    id: 'select',
    name: 'Select',
    category: 'components',
    description: 'Accessible custom listbox select',
    variants: [
      {
        name: 'Default',
        description: 'Two-option plan selector',
        code: '<Select value="starter"><option value="starter">Starter</option></Select>',
        render: () => (
          <Select aria-label={SAMPLES.selectAria} value="starter" onChange={() => {}}>
            <option value="starter">{SAMPLES.optionStarter}</option>
            <option value="pro">{SAMPLES.optionPro}</option>
          </Select>
        ),
      },
    ],
  },
  slider: {
    id: 'slider',
    name: 'Slider',
    category: 'components',
    description: 'Range input slider control',
    variants: [
      {
        name: 'Midpoint',
        description: '50% range value',
        code: '<Slider defaultValue={50} aria-label="Volume level" />',
        render: () => <Slider defaultValue={50} aria-label={SAMPLES.sliderAria} />,
      },
    ],
  },
  statusBadge: {
    id: 'statusBadge',
    name: 'StatusBadge',
    category: 'components',
    description: 'Domain-neutral semantic tone badge',
    variants: [
      {
        name: 'Live Tone',
        description: `Brand 500 ${buildBrandScale('oklch(0.62 0.19 264)').scale[500]}`,
        code: '<StatusBadge tone="live" label="Live" />',
        render: () => <StatusBadge tone="live" label={SAMPLES.statusLive} />,
      },
    ],
  },
  tabs: {
    id: 'tabs',
    name: 'Tabs',
    category: 'components',
    description: 'Accessible tablist and tabpanel switcher',
    variants: [
      {
        name: 'Two Tabs',
        description: 'Overview and activity tabs',
        code: '<Tabs items={[...]} />',
        render: () => (
          <Tabs
            items={[
              {
                id: 'overview',
                label: SAMPLES.tabOverview,
                content: <Text size="sm">{SAMPLES.tabOverviewBody}</Text>,
              },
              {
                id: 'activity',
                label: SAMPLES.tabActivity,
                content: <Text size="sm">{SAMPLES.tabActivityBody}</Text>,
              },
            ]}
          />
        ),
      },
    ],
  },
  titledCardSection: {
    id: 'titledCardSection',
    name: 'TitledCardSection',
    category: 'components',
    description: 'Card section with standardized heading',
    variants: [
      {
        name: 'Default',
        description: 'Card with h3 title and body',
        code: '<TitledCardSection title="Security posture">...</TitledCardSection>',
        render: () => (
          <TitledCardSection title={SAMPLES.titledSectionHeading}>
            <Text size="sm" tone="muted">
              {SAMPLES.cardBody}
            </Text>
          </TitledCardSection>
        ),
      },
    ],
  },

  // ===========================================================================
  // Layouts (23)
  // ===========================================================================
  appShell: {
    id: 'appShell',
    name: 'AppShell',
    category: 'layouts',
    description: 'Multi-slot application frame primitive',
    variants: [
      {
        name: 'Header & Main',
        description: 'Framed workspace preview',
        code: '<AppShell header={<TopbarLayout>Top bar</TopbarLayout>}>Workspace content</AppShell>',
        render: () => (
          <div className="devtools-catalog-stage w-full">
            <AppShell header={<Text size="xs">{SAMPLES.shellTop}</Text>}>
              <Text size="sm">{SAMPLES.shellMain}</Text>
            </AppShell>
          </div>
        ),
      },
    ],
  },
  aspectRatio: {
    id: 'aspectRatio',
    name: 'AspectRatio',
    category: 'layouts',
    description: 'Intrinsic media ratio box',
    variants: [
      {
        name: 'Video 16:9',
        description: 'Widescreen aspect box',
        code: '<AspectRatio ratio="video"><Card>Item 1</Card></AspectRatio>',
        render: () => (
          <div className="w-full max-w-xs">
            <AspectRatio ratio="video">
              <Card className="p-2 flex-center">{SAMPLES.boxFirst}</Card>
            </AspectRatio>
          </div>
        ),
      },
    ],
  },
  authLayout: {
    id: 'authLayout',
    name: 'AuthLayout',
    category: 'layouts',
    description: 'Centered authentication card frame',
    variants: [
      {
        name: 'Sign In Frame',
        description: 'Titled narrow card container',
        code: '<AuthLayout title="Welcome back">...</AuthLayout>',
        render: () => (
          <div className="devtools-catalog-stage w-full">
            <AuthLayout title={SAMPLES.authLayoutTitle} description={SAMPLES.authLayoutDesc}>
              <Button size="small">{SAMPLES.primaryButton}</Button>
            </AuthLayout>
          </div>
        ),
      },
    ],
  },
  bottombarLayout: {
    id: 'bottombarLayout',
    name: 'BottombarLayout',
    category: 'layouts',
    description: 'Mobile bottom navigation bar primitive',
    variants: [
      {
        name: 'Default',
        description: 'Bordered bottom bar',
        code: '<BottombarLayout>Bottom bar</BottombarLayout>',
        render: () => (
          <div className="w-full">
            <BottombarLayout>
              <Text size="xs">{SAMPLES.shellBottom}</Text>
            </BottombarLayout>
          </div>
        ),
      },
    ],
  },
  center: {
    id: 'center',
    name: 'Center',
    category: 'layouts',
    description: 'Horizontally centered max-width wrapper',
    variants: [
      {
        name: 'Small',
        description: 'Centered card block',
        code: '<Center maxWidth="sm"><Card>Item 1</Card></Center>',
        render: () => (
          <Center maxWidth="sm">
            <Card className="p-2">{SAMPLES.boxFirst}</Card>
          </Center>
        ),
      },
    ],
  },
  cluster: {
    id: 'cluster',
    name: 'Cluster',
    category: 'layouts',
    description: 'Wrapping horizontal tag/chip layout',
    variants: [
      {
        name: 'Pills',
        description: 'Clustered semantic badges',
        code: '<Cluster gap="xs"><Badge>Active</Badge></Cluster>',
        render: () => (
          <Cluster gap="xs">
            <Badge tone="live">{SAMPLES.activeBadge}</Badge>
            <Badge tone="premium">{SAMPLES.optionPro}</Badge>
          </Cluster>
        ),
      },
    ],
  },
  container: {
    id: 'container',
    name: 'Container',
    category: 'layouts',
    description: 'Width-constrained responsive layout wrapper',
    variants: [
      {
        name: 'Medium',
        description: 'Default 960px container',
        code: '<Container size="md">...</Container>',
        render: () => (
          <div className="devtools-catalog-stage">
            <Container size="md">
              <Card className="p-4">
                <Heading as="h3" size="sm">
                  {SAMPLES.containerHeading}
                </Heading>
                <Text tone="muted">{SAMPLES.containerBody}</Text>
              </Card>
            </Container>
          </div>
        ),
      },
    ],
  },
  grid: {
    id: 'grid',
    name: 'Grid',
    category: 'layouts',
    description: 'CSS Grid layout primitive',
    variants: [
      {
        name: 'Two Columns',
        description: 'Equal two-column grid',
        code: '<Grid columns={2} gap="sm">...</Grid>',
        render: () => (
          <Grid columns={2} gap="sm" className="w-full">
            <Card className="p-2">{SAMPLES.boxFirst}</Card>
            <Card className="p-2">{SAMPLES.boxSecond}</Card>
          </Grid>
        ),
      },
    ],
  },
  inline: {
    id: 'inline',
    name: 'Inline',
    category: 'layouts',
    description: 'Single-axis inline row primitive',
    variants: [
      {
        name: 'Aligned Row',
        description: 'Inline icon and label',
        code: '<Inline gap="sm"><Icon name="check" /><Text>Healthy</Text></Inline>',
        render: () => (
          <Inline gap="sm">
            <Icon name="check" />
            <Text size="sm">{SAMPLES.rowHealthy}</Text>
          </Inline>
        ),
      },
    ],
  },
  leftSidebarLayout: {
    id: 'leftSidebarLayout',
    name: 'LeftSidebarLayout',
    category: 'layouts',
    description: 'Primary navigation rail container',
    variants: [
      {
        name: 'Bordered Rail',
        description: 'Sidebar slot frame',
        code: '<LeftSidebarLayout width="10rem">Navigation</LeftSidebarLayout>',
        render: () => (
          <LeftSidebarLayout width="10rem">
            <Text size="xs">{SAMPLES.shellSide}</Text>
          </LeftSidebarLayout>
        ),
      },
    ],
  },
  overlay: {
    id: 'overlay',
    name: 'Overlay',
    category: 'layouts',
    description: 'Portal backdrop scrim layer',
    variants: [
      {
        name: 'Closed Scrim',
        description: 'Unmounted backdrop when open is false',
        code: '<Overlay open={false} />',
        render: () => (
          <div>
            <Text size="sm" tone="muted">
              {SAMPLES.dialogDescription}
            </Text>
            <Overlay open={false} />
          </div>
        ),
      },
    ],
  },
  pageContainer: {
    id: 'pageContainer',
    name: 'PageContainer',
    category: 'layouts',
    description: 'Standard padded page frame',
    variants: [
      {
        name: 'Default',
        description: 'Workspace page container',
        code: '<PageContainer>...</PageContainer>',
        render: () => (
          <div className="devtools-catalog-stage">
            <PageContainer>
              <Heading as="h3" size="sm">
                {SAMPLES.pageHeading}
              </Heading>
              <Text tone="muted">{SAMPLES.pageBody}</Text>
            </PageContainer>
          </div>
        ),
      },
    ],
  },
  pageHeader: {
    id: 'pageHeader',
    name: 'PageHeader',
    category: 'layouts',
    description: 'Standardized eyebrow, title, and description header',
    variants: [
      {
        name: 'With Eyebrow',
        description: 'Page header block',
        code: '<PageHeader eyebrow="Foundation" title="Page Container" description="..." />',
        render: () => (
          <PageHeader
            eyebrow={SAMPLES.pageEyebrow}
            title={SAMPLES.pageHeading}
            description={SAMPLES.pageBody}
          />
        ),
      },
    ],
  },
  pageShell: {
    id: 'pageShell',
    name: 'PageShell',
    category: 'layouts',
    description: 'Composable page wrapper with header slot',
    variants: [
      {
        name: 'Medium',
        description: 'PageShell wrapping Stack content',
        code: '<PageShell header={<PageHeader title="Page Container" />}>...</PageShell>',
        render: () => (
          <PageShell
            size="md"
            header={<PageHeader title={SAMPLES.pageHeading} description={SAMPLES.pageBody} />}
          >
            <Text size="sm">{SAMPLES.shellMain}</Text>
          </PageShell>
        ),
      },
    ],
  },
  resizablePanel: {
    id: 'resizablePanel',
    name: 'ResizablePanel',
    category: 'layouts',
    description: 'Console pane with adjustable flex basis',
    variants: [
      {
        name: 'Default Pane',
        description: 'Single pane inside ResizablePanelGroup',
        code: '<ResizablePanelGroup><ResizablePanel defaultSize={50}>...</ResizablePanel></ResizablePanelGroup>',
        render: () => (
          <ResizablePanelGroup className="w-full">
            <ResizablePanel defaultSize={50}>
              <Card className="p-2">{SAMPLES.boxFirst}</Card>
            </ResizablePanel>
            <ResizablePanel defaultSize={50}>
              <Card className="p-2">{SAMPLES.boxSecond}</Card>
            </ResizablePanel>
          </ResizablePanelGroup>
        ),
      },
    ],
  },
  resizablePanelGroup: {
    id: 'resizablePanelGroup',
    name: 'ResizablePanelGroup',
    category: 'layouts',
    description: 'Horizontal or vertical split-pane container (ConsoleShell)',
    variants: [
      {
        name: 'Horizontal Split',
        description: 'Two resizable console panes',
        code: '<ResizablePanelGroup direction="horizontal">...</ResizablePanelGroup>',
        render: () => (
          <ResizablePanelGroup direction="horizontal" className="w-full">
            <ResizablePanel defaultSize={40}>
              <Card className="p-2">{SAMPLES.shellSide}</Card>
            </ResizablePanel>
            <ResizablePanel defaultSize={60}>
              <Card className="p-2">{SAMPLES.shellMain}</Card>
            </ResizablePanel>
          </ResizablePanelGroup>
        ),
      },
    ],
  },
  resizableSeparator: {
    id: 'resizableSeparator',
    name: 'ResizableSeparator',
    category: 'layouts',
    description: 'Accessible WAI-ARIA window splitter handle',
    variants: [
      {
        name: 'Horizontal Handle',
        description: 'Keyboard-focusable separator',
        code: '<ResizableSeparator direction="horizontal" currentSize={50} />',
        render: () => (
          <div className="flex items-center gap-2">
            <Text size="xs">{SAMPLES.boxFirst}</Text>
            <ResizableSeparator direction="horizontal" currentSize={50} />
            <Text size="xs">{SAMPLES.boxSecond}</Text>
          </div>
        ),
      },
    ],
  },
  rightSidebarLayout: {
    id: 'rightSidebarLayout',
    name: 'RightSidebarLayout',
    category: 'layouts',
    description: 'Secondary inspector aside container',
    variants: [
      {
        name: 'Bordered Aside',
        description: 'Inspector rail',
        code: '<RightSidebarLayout width="10rem">Inspector</RightSidebarLayout>',
        render: () => (
          <RightSidebarLayout width="10rem">
            <Text size="xs">{SAMPLES.shellRight}</Text>
          </RightSidebarLayout>
        ),
      },
    ],
  },
  scrollArea: {
    id: 'scrollArea',
    name: 'ScrollArea',
    category: 'layouts',
    description: 'Overflow scroll container',
    variants: [
      {
        name: 'Vertical',
        description: 'Scrollable stack region',
        code: '<ScrollArea><Stack>...</Stack></ScrollArea>',
        render: () => (
          <ScrollArea className="max-w-xs">
            <Stack gap="xs">
              <Text size="sm">{SAMPLES.boxFirst}</Text>
              <Text size="sm">{SAMPLES.boxSecond}</Text>
            </Stack>
          </ScrollArea>
        ),
      },
    ],
  },
  sidePeek: {
    id: 'sidePeek',
    name: 'SidePeek',
    category: 'layouts',
    description: 'Slide-over contextual detail drawer',
    variants: [
      {
        name: 'Closed Drawer',
        description: 'Collapsed SidePeek root',
        code: '<SidePeek.Root open={false} onClose={() => {}} />',
        render: () => (
          <div>
            <Text size="sm" tone="muted">
              {SAMPLES.peekLinkCopy}
            </Text>
            <SidePeek.Root open={false} onClose={() => {}}>
              <SidePeek.Content>
                <Text size="sm">{SAMPLES.shellRight}</Text>
              </SidePeek.Content>
            </SidePeek.Root>
          </div>
        ),
      },
    ],
  },
  stack: {
    id: 'stack',
    name: 'Stack',
    category: 'layouts',
    description: 'Vertical rhythm flex stack primitive',
    variants: [
      {
        name: 'Small Gap',
        description: 'Vertical stack of cards',
        code: '<Stack gap="sm">...</Stack>',
        render: () => (
          <Stack gap="sm" className="w-full">
            <Card className="p-2">{SAMPLES.boxFirst}</Card>
            <Card className="p-2">{SAMPLES.boxSecond}</Card>
          </Stack>
        ),
      },
    ],
  },
  stackedLayout: {
    id: 'stackedLayout',
    name: 'StackedLayout',
    category: 'layouts',
    description: 'Hero-plus-body vertical marketing layout',
    variants: [
      {
        name: 'With Hero',
        description: 'Hero banner above main body',
        code: '<StackedLayout hero={<Text>Hero banner</Text>}>...</StackedLayout>',
        render: () => (
          <div className="devtools-catalog-stage w-full">
            <StackedLayout hero={<Text size="sm">{SAMPLES.stackedHero}</Text>}>
              <Text size="sm" tone="muted">
                {SAMPLES.shellMain}
              </Text>
            </StackedLayout>
          </div>
        ),
      },
    ],
  },
  topbarLayout: {
    id: 'topbarLayout',
    name: 'TopbarLayout',
    category: 'layouts',
    description: 'Fixed-height shell header bar primitive',
    variants: [
      {
        name: 'Bordered Topbar',
        description: 'Top navigation bar container',
        code: '<TopbarLayout>Top bar</TopbarLayout>',
        render: () => (
          <div className="w-full">
            <TopbarLayout>
              <Text size="xs">{SAMPLES.shellTop}</Text>
            </TopbarLayout>
          </div>
        ),
      },
    ],
  },

  // ===========================================================================
  // Theme (1)
  // ===========================================================================
  themeProvider: {
    id: 'themeProvider',
    name: 'ThemeProvider',
    category: 'theme',
    description: 'Theme mode, contrast, and density React context provider',
    variants: [
      {
        name: 'Scoped Provider',
        description: 'Nested ThemeProvider context',
        code: '<ThemeProvider><Badge tone="success">Theme context active</Badge></ThemeProvider>',
        render: () => (
          <ThemeProvider>
            <Badge tone="success">{SAMPLES.themePreview}</Badge>
          </ThemeProvider>
        ),
      },
    ],
  },
};

export const getComponentsByCategory = (category: string): ComponentDemo[] => {
  return Object.values(componentCatalog).filter((comp) => comp.category === category);
};

export const getAllCategories = (): string[] => {
  return Array.from(new Set(Object.values(componentCatalog).map((comp) => comp.category)));
};

export const getTotalComponentCount = (): number => {
  return Object.keys(componentCatalog).length;
};

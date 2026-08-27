/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { AppBar } from "@/components/AppBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { HelperText } from "@/components/ui/HelperText";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { SelectableActionList, type ActionListItem } from "@/components/lists/SelectableActionList";
import { toast } from "@/hooks/use-toast";
import { APP_STYLES, DEFAULT_APP_STYLE_ID, type AppStyleMode } from "@/generated/appStyles";
import { HEALTH_TIMELINE_STATE_COLORS } from "@/lib/diagnostics/healthHistoryTimeline";

/**
 * Developer-only style gallery (spec.md section 11), gated behind the app_styles_gallery_enabled
 * feature flag. Mounts the *shipped* components, not copies, so the gallery cannot drift from the
 * real app. `?style=` and `?mode=` force one palette for a screenshot run by writing the same
 * data-app-style attribute and .dark class the app uses, restoring both on unmount.
 *
 * "table" is absent from the data section: src/components/ui/table.tsx was deleted in Phase 2 as
 * a dead primitive, and inventing one only for the gallery would break the no-copies rule.
 */

const SAMPLE_LIST_ITEMS: ActionListItem[] = [
  {
    id: "1",
    title: "Commodore_Sixty_Four_Anniversary_Megademo_Part_One.sid",
    subtitle: "3:34",
    selected: true,
    actionLabel: "Play",
  },
  { id: "2", title: "Short.sid", subtitle: "1:01", selected: false, actionLabel: "Play" },
  { id: "3", title: "A disabled row", subtitle: "unavailable", selected: false, isDimmed: true, actionLabel: "Play" },
];

const SAMPLE_CHART_DATA = [
  { t: 0, a: 12, b: 18 },
  { t: 1, a: 18, b: 14 },
  { t: 2, a: 14, b: 22 },
  { t: 3, a: 22, b: 16 },
  { t: 4, a: 16, b: 24 },
];

const GallerySection = ({ slug, title, children }: { slug: string; title: string; children: React.ReactNode }) => (
  <section className="space-y-3 rounded-panel border border-border p-4" data-testid={`style-gallery-section-${slug}`}>
    <h2 className="text-lg font-semibold">{title}</h2>
    <div className="space-y-3">{children}</div>
  </section>
);

export default function AppStylesGalleryPage() {
  const [searchParams] = useSearchParams();
  const requestedStyleId = searchParams.get("style") ?? DEFAULT_APP_STYLE_ID;
  const requestedMode = (searchParams.get("mode") as AppStyleMode | null) ?? "light";
  const style = useMemo(
    () => APP_STYLES.find((candidate) => candidate.id === requestedStyleId) ?? APP_STYLES[0],
    [requestedStyleId],
  );
  const mode: AppStyleMode = style.modes.includes(requestedMode) ? requestedMode : style.modes[0];

  useEffect(() => {
    const html = document.documentElement;
    const previousStyleAttr = html.getAttribute("data-app-style");
    const hadDarkClass = html.classList.contains("dark");
    html.setAttribute("data-app-style", style.id);
    html.classList.toggle("dark", mode === "dark");
    html.classList.toggle("light", mode === "light");
    return () => {
      if (previousStyleAttr) html.setAttribute("data-app-style", previousStyleAttr);
      else html.removeAttribute("data-app-style");
      html.classList.toggle("dark", hadDarkClass);
      html.classList.toggle("light", !hadDarkClass);
    };
  }, [style.id, mode]);

  const [sliderValue, setSliderValue] = useState([40]);
  // Closed by default: Dialog/AlertDialog/Sheet are all full-screen fixed overlays, and having
  // more than one open at once buries every other section's screenshot under their backdrops.
  // The gallery's default view is the trigger row; a reviewer opens one deliberately to check
  // its own chrome under the active style.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div
      className="min-h-screen bg-background pb-24"
      data-testid="app-styles-gallery-page"
      data-gallery-style={style.id}
      data-gallery-mode={mode}
    >
      <AppBar title={`Dev: Styles — ${style.name} (${mode})`} titleTestId="style-gallery-title" />

      <div className="mx-auto max-w-3xl space-y-6 p-4">
        <GallerySection slug="app-bar" title="App bar">
          <HelperText>The app bar above is the real component, rendered by this page like any other.</HelperText>
        </GallerySection>

        <GallerySection slug="cards" title="Cards">
          <Card>
            <CardHeader>
              <CardTitle>Card title</CardTitle>
              <CardDescription>A card description line.</CardDescription>
            </CardHeader>
            <CardContent>Card body content.</CardContent>
          </Card>
        </GallerySection>

        <GallerySection slug="buttons" title="Buttons">
          <div className="flex flex-wrap gap-2">
            {(["default", "secondary", "outline", "ghost", "link", "destructive"] as const).map((variant) => (
              <Button key={variant} variant={variant}>
                {variant}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["sm", "default", "lg", "icon"] as const).map((size) => (
              <Button key={size} size={size}>
                {size === "icon" ? "•" : size}
              </Button>
            ))}
            <Button disabled>disabled</Button>
          </div>
        </GallerySection>

        <GallerySection slug="focus-and-selection" title="Focus and selection">
          {/* The real CSS rules (src/index.css) apply to these attributes exactly as they do
              during live keypad navigation; only the FocusNavigationProvider wiring that sets
              them at runtime is not mounted here. */}
          <div className="flex flex-wrap gap-4">
            <div data-key-selected="true" className="rounded-md border border-border bg-card px-3 py-2">
              Keypad selection
            </div>
            <div data-key-scope="true" className="rounded-md border border-border bg-card px-3 py-2">
              Group scope
            </div>
            <div data-c64-tap-flash="true" className="rounded-md border border-border bg-card px-3 py-2">
              Tap flash
            </div>
            <button type="button" className="focus-flash rounded-md border border-border bg-card px-3 py-2">
              Focus-visible ring (tab to me)
            </button>
          </div>
        </GallerySection>

        <GallerySection slug="inputs" title="Inputs">
          <Input placeholder="Text input" defaultValue="c64u.local" />
          <Select defaultValue="a">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a">Option A</SelectItem>
              <SelectItem value="b">Option B</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <Checkbox id="gallery-checkbox" defaultChecked />
            <label htmlFor="gallery-checkbox">Checkbox</label>
          </div>
          <RadioGroup defaultValue="x" className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <RadioGroupItem value="x" id="gallery-radio-x" />
              <label htmlFor="gallery-radio-x">X</label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="y" id="gallery-radio-y" />
              <label htmlFor="gallery-radio-y">Y</label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Switch id="gallery-switch" defaultChecked />
            <label htmlFor="gallery-switch">Switch</label>
          </div>
          <Slider value={sliderValue} onValueChange={setSliderValue} max={100} step={1} />
          <InputOTP maxLength={4}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>
        </GallerySection>

        <GallerySection slug="feedback" title="Feedback">
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
          <Progress value={62} />
          <Button variant="outline" onClick={() => toast({ title: "Gallery toast", description: "A real toast." })}>
            Show toast
          </Button>
          <Alert>
            <AlertTitle>Heads up</AlertTitle>
            <AlertDescription>An informational alert.</AlertDescription>
          </Alert>
          <Alert variant="destructive">
            <AlertTitle>Error state</AlertTitle>
            <AlertDescription>Something needs attention.</AlertDescription>
          </Alert>
          <HelperText>Secondary helper text, the kind shown under most controls.</HelperText>
          {/* The real empty-state pattern (SelectableActionList.tsx), not a bespoke gallery
              treatment: a muted, small paragraph in place of the list. */}
          <p className="text-xs text-muted-foreground" data-testid="gallery-empty-state">
            No items yet.
          </p>
        </GallerySection>

        <GallerySection slug="overlays" title="Overlays">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              Open dialog
            </Button>
            <Button variant="outline" onClick={() => setAlertDialogOpen(true)}>
              Open alert dialog
            </Button>
            <Button variant="outline" onClick={() => setSheetOpen(true)}>
              Open bottom sheet
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Open popover</Button>
              </PopoverTrigger>
              <PopoverContent>A popover's content.</PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline">Hover for tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>A tooltip.</TooltipContent>
            </Tooltip>
          </div>
          {/* The interstitial scrim itself, at the opacity a depth-1 backdrop uses. */}
          <div
            className="relative h-16 overflow-hidden rounded-md border border-border"
            data-testid="gallery-interstitial-scrim"
          >
            <div className="absolute inset-0 bg-scrim/40" />
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog</DialogTitle>
                <DialogDescription>A decision interstitial.</DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
          <AlertDialog open={alertDialogOpen} onOpenChange={setAlertDialogOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>This is an alert dialog.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction>Confirm</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="bottom">
              <SheetHeader>
                <SheetTitle>Bottom sheet</SheetTitle>
                <SheetDescription>A workflow surface.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </GallerySection>

        <GallerySection slug="navigation" title="Navigation">
          <HelperText>The tab bar is shared app chrome and renders below on every page, this one included.</HelperText>
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">One</TabsTrigger>
              <TabsTrigger value="two">Two</TabsTrigger>
            </TabsList>
            <TabsContent value="one">Tab one content.</TabsContent>
            <TabsContent value="two">Tab two content.</TabsContent>
          </Tabs>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="#">Home</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Current</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious href="#" />
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#" isActive>
                  1
                </PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationLink href="#">2</PaginationLink>
              </PaginationItem>
              <PaginationItem>
                <PaginationNext href="#" />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </GallerySection>

        <GallerySection slug="data" title="Data">
          <SelectableActionList
            title="Sample list"
            items={SAMPLE_LIST_ITEMS}
            emptyLabel="Nothing here"
            selectedCount={1}
            allSelected={false}
            onToggleSelectAll={() => undefined}
            maxVisible={10}
            listTestId="gallery-list"
            rowTestId="gallery-list-row"
          />
          <div className="h-48 rounded-md border border-border p-2" data-testid="gallery-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={SAMPLE_CHART_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="t" stroke="hsl(var(--muted-foreground))" />
                <YAxis stroke="hsl(var(--muted-foreground))" />
                <Line type="monotone" dataKey="a" stroke="hsl(var(--chart-1))" dot={false} />
                <Line type="monotone" dataKey="b" stroke="hsl(var(--chart-2))" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="flex h-6 overflow-hidden rounded-md border border-border" data-testid="gallery-diag-timeline">
            {Object.entries(HEALTH_TIMELINE_STATE_COLORS).map(([state, color]) => (
              <div key={state} className="flex-1" style={{ backgroundColor: color }} title={state} />
            ))}
          </div>
        </GallerySection>
      </div>
    </div>
  );
}
